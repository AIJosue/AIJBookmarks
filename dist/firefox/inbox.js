let bookmarks = [];
let bookmarksById = new Map();
let rowsById = new Map(); // bookmarkId -> { tr, checkbox, sugCell, statusEl }
let selectedScope = { type: 'roots' };

let totalInputTokens = 0;
let totalOutputTokens = 0;
let lastResponseTime = 0;
let batchTimerInterval = null;
let completedBatchesCount = 0;
let isAnalyzing = false;

// Listen for real-time batch progress events from the background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'sortBatchProgress') {
    handleBatchProgress(message.progress);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get({
    sortAllowCreateFolders: false,
    sortNewFolderLocation: 'root-bar',
    sortAllowRecursiveFolders: false
  });
  const allowFoldersCb = document.getElementById('allowCreateFolders');
  const inboxNewFolderControls = document.getElementById('inboxNewFolderControls');
  const inboxNewFolderLocation = document.getElementById('inboxNewFolderLocation');
  const inboxAllowRecursiveFolders = document.getElementById('inboxAllowRecursiveFolders');

  if (allowFoldersCb) {
    allowFoldersCb.checked = Boolean(settings.sortAllowCreateFolders);
    if (inboxNewFolderControls) {
      inboxNewFolderControls.style.display = allowFoldersCb.checked ? 'flex' : 'none';
    }
    allowFoldersCb.addEventListener('change', (e) => {
      chrome.storage.sync.set({ sortAllowCreateFolders: e.target.checked });
      if (inboxNewFolderControls) {
        inboxNewFolderControls.style.display = e.target.checked ? 'flex' : 'none';
      }
    });
  }

  if (inboxAllowRecursiveFolders) {
    inboxAllowRecursiveFolders.checked = Boolean(settings.sortAllowRecursiveFolders);
    inboxAllowRecursiveFolders.addEventListener('change', (e) => {
      chrome.storage.sync.set({ sortAllowRecursiveFolders: e.target.checked });
    });
  }

  if (inboxNewFolderLocation) {
    inboxNewFolderLocation.addEventListener('change', (e) => {
      chrome.storage.sync.set({ sortNewFolderLocation: e.target.value });
    });
  }

  await loadSortingScopeFolders(settings.sortNewFolderLocation);
  await loadUnsortedBookmarks();

  // Delegated listener — handles all checkbox changes without per-row binding
  document.getElementById('bookmarkRows').addEventListener('change', (e) => {
    if (e.target.classList.contains('bm-cb')) {
      for (const [id, row] of rowsById.entries()) {
        if (row.checkbox === e.target) {
          const bm = bookmarksById.get(id);
          if (bm && bm.suggestedFolder) {
            setStatus(id, e.target.checked ? 'approved' : 'denied', e.target.checked ? 'Approved to move' : 'Denied / Skipped');
          }
          break;
        }
      }
      updateButtonCounts();
    }
  });

  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('analyzeBtn').addEventListener('click', analyzeSelected);
  document.getElementById('stopAnalysisBtn').addEventListener('click', stopAnalysis);
  document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);
  document.getElementById('applyBtn').addEventListener('click', applySelected);
  document.getElementById('sortScopeMode').addEventListener('change', handleScopeModeChange);
  document.getElementById('sortFolderSelect').addEventListener('change', handleFolderScopeChange);
  document.getElementById('refreshScopeBtn').addEventListener('click', async () => {
    const settings = await chrome.storage.sync.get({ sortNewFolderLocation: 'root-bar' });
    await loadSortingScopeFolders(settings.sortNewFolderLocation);
    await loadUnsortedBookmarks();
  });
  document.getElementById('selectAll').addEventListener('change', (e) => {
    for (const [id, row] of rowsById.entries()) {
      if (!row.checkbox.disabled) {
        row.checkbox.checked = e.target.checked;
        const bm = bookmarksById.get(id);
        if (bm && bm.suggestedFolder) {
          setStatus(id, e.target.checked ? 'approved' : 'denied', e.target.checked ? 'Approved to move' : 'Denied / Skipped');
        }
      }
    }
    updateButtonCounts();
  });

  const aiConfig = await chrome.runtime.sendMessage({ action: 'checkAIConfig' }).catch(() => null);
  const sortModelSelect = document.getElementById('sortModelSelect');
  const sortBadge = document.getElementById('localEmbeddingSortBadge');
  const sortCheckbox = document.getElementById('useLocalEmbeddingsSort');

  function initSortModelSelector(config) {
    if (!sortModelSelect) return;
    sortModelSelect.innerHTML = '';

    const models = config?.availableModels || [];
    let selectedValue = 'auto';

    // 1. If any model is loaded, preselect it!
    const loadedModel = models.find(m => m.isLoaded);
    if (loadedModel) {
      selectedValue = loadedModel.id;
    } else if (config?.loadedModelId) {
      selectedValue = config.loadedModelId;
    } else if (config?.hasCloudAI) {
      selectedValue = 'cloud';
    } else {
      selectedValue = 'embeddinggemma-2';
    }

    // Populate dropdown options with available models
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      const statusText = m.isLoaded ? ' • Loaded & Active' : (m.status === 'downloaded' ? ' • Downloaded' : '');
      opt.textContent = `${m.name}${statusText}`;
      if (m.id === selectedValue) {
        opt.selected = true;
      }
      sortModelSelect.appendChild(opt);
    }

    // If Cloud AI is configured, also list it
    if (config?.hasCloudAI) {
      const optCloud = document.createElement('option');
      optCloud.value = 'cloud';
      const providerName = config?.cloudProvider ? config.cloudProvider.toUpperCase() : 'Cloud API';
      optCloud.textContent = `☁️ ${providerName} (Cloud AI)`;
      if (selectedValue === 'cloud') {
        optCloud.selected = true;
      }
      sortModelSelect.appendChild(optCloud);
    }

    function refreshSortModelBadge() {
      const currentVal = sortModelSelect.value;
      if (currentVal === 'cloud') {
        if (sortBadge) {
          sortBadge.textContent = '☁️ Cloud API Active';
          sortBadge.style.background = '#e8f0fe';
          sortBadge.style.color = '#1a73e8';
          sortBadge.style.display = 'inline-block';
        }
        if (sortCheckbox) sortCheckbox.checked = false;
        return;
      }

      if (sortCheckbox) sortCheckbox.checked = true;
      const chosenModel = models.find(m => m.id === currentVal);
      if (chosenModel?.isLoaded) {
        if (sortBadge) {
          sortBadge.textContent = `🧠 ${chosenModel.name.split(' ')[0]} Loaded (Offline)`;
          sortBadge.style.background = '#e6f4ea';
          sortBadge.style.color = '#137333';
          sortBadge.style.display = 'inline-block';
        }
      } else if (chosenModel?.status === 'downloaded') {
        if (sortBadge) {
          sortBadge.textContent = 'Downloaded (Loads on sort)';
          sortBadge.style.background = '#fef7e0';
          sortBadge.style.color = '#b06000';
          sortBadge.style.display = 'inline-block';
        }
      } else {
        if (sortBadge) {
          sortBadge.textContent = 'Built-in Fallback';
          sortBadge.style.background = '#f1f3f4';
          sortBadge.style.color = '#5f6368';
          sortBadge.style.display = 'inline-block';
        }
      }
    }

    sortModelSelect.addEventListener('change', () => {
      refreshSortModelBadge();
      const currentVal = sortModelSelect.value;
      if (currentVal !== 'cloud' && currentVal !== 'auto') {
        chrome.runtime.sendMessage({ action: 'loadModel', modelId: currentVal }).catch(() => {});
      }
    });

    refreshSortModelBadge();
  }

  initSortModelSelector(aiConfig);

  const activeModelName = aiConfig?.loadedModelName || 'EmbeddingGemma-2';
  if (aiConfig && !aiConfig.hasAI && !aiConfig.hasLocalAI) {
    const alertBox = document.getElementById('alertBox');
    if (alertBox && bookmarks.length > 0) {
      alertBox.className = 'alert alert-info';
      alertBox.innerHTML = `ℹ️ Using <strong>built-in ${activeModelName} engine</strong> for bookmark sorting. For full model weights, <a href="#" id="openSettingsAlertLink" style="color:#1a73e8;font-weight:600;text-decoration:underline;">download in Settings</a>.`;
      document.getElementById('openSettingsAlertLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }
  } else if (aiConfig?.hasLocalAI && !aiConfig?.hasCloudAI) {
    const alertBox = document.getElementById('alertBox');
    if (alertBox && bookmarks.length > 0 && alertBox.classList.contains('alert-loading')) {
      alertBox.className = 'alert alert-info';
      alertBox.innerHTML = `🧠 <strong>Local ${activeModelName} Model Active.</strong> Bookmarks will be organized on-device without cloud API keys.`;
    }
  }
});

async function fetchSortingScopeFoldersDirectly() {
  if (!chrome?.bookmarks?.getTree) return [];
  try {
    const tree = await chrome.bookmarks.getTree();
    const rootNode = tree?.[0];
    if (!rootNode) return [];

    const rootOrder = ['Bookmarks Toolbar', 'Bookmarks Bar', 'Bookmarks Menu', 'Other Bookmarks', 'Mobile Bookmarks'];
    function getRootLabel(nodeId, title) {
      const sId = String(nodeId);
      if (sId === 'toolbar_____' || sId === '1') return 'Bookmarks Toolbar';
      if (sId === 'menu________') return 'Bookmarks Menu';
      if (sId === 'unfiled_____' || sId === '2') return 'Other Bookmarks';
      if (sId === 'mobile______' || sId === '3') return 'Mobile Bookmarks';
      return title || 'Bookmarks';
    }

    const folders = [];
    for (const rootChild of rootNode.children || []) {
      if (rootChild.url) continue;
      const rootId = String(rootChild.id);
      const rootLabel = getRootLabel(rootId, rootChild.title);
      const directBookmarks = (rootChild.children || []).filter(c => Boolean(c.url));

      folders.push({
        id: rootId,
        title: rootLabel,
        path: rootLabel,
        rootName: rootLabel,
        depth: 0,
        isRoot: true,
        directBookmarkCount: directBookmarks.length
      });

      function walkSub(children, parentPath, depth) {
        for (const node of children || []) {
          if (node.url) continue;
          const title = node.title || 'Untitled folder';
          const lower = title.toLowerCase();
          if (lower === 'mozilla firefox' || lower === 'firefox') continue;
          const canonicalPath = `${parentPath}/${title}`;
          folders.push({
            id: String(node.id),
            title,
            path: canonicalPath,
            rootName: rootLabel,
            depth,
            isRoot: false,
            directBookmarkCount: (node.children || []).filter(c => Boolean(c.url)).length
          });
          if (node.children && node.children.length > 0) {
            walkSub(node.children, canonicalPath, depth + 1);
          }
        }
      }

      if (rootChild.children && rootChild.children.length > 0) {
        walkSub(rootChild.children, rootLabel, 1);
      }
    }

    return folders.sort((a, b) => {
      if (a.rootName !== b.rootName) {
        const idxA = rootOrder.indexOf(a.rootName);
        const idxB = rootOrder.indexOf(b.rootName);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.rootName.localeCompare(b.rootName);
      }
      if (a.isRoot && !b.isRoot) return -1;
      if (!a.isRoot && b.isRoot) return 1;
      return a.path.localeCompare(b.path);
    });
  } catch (err) {
    console.warn('Direct bookmark tree query failed:', err);
    return [];
  }
}

async function loadSortingScopeFolders(savedNewFolderLocation = null) {
  const select = document.getElementById('sortFolderSelect');
  const datalist = document.getElementById('existingFoldersList');
  const inboxNewFolderSelect = document.getElementById('inboxNewFolderLocation');

  try {
    let folderList = [];
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSortingScopeFolders' });
      if (response?.success && Array.isArray(response.folders) && response.folders.length > 0) {
        folderList = response.folders;
      }
    } catch {
      // Fallback to direct query below
    }

    if (folderList.length === 0) {
      folderList = await fetchSortingScopeFoldersDirectly();
    }

    const curSelectedFolder = select.value;
    select.textContent = '';
    if (datalist) datalist.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a folder or subfolder…';
    select.appendChild(placeholder);

    if (inboxNewFolderSelect) {
      const curVal = savedNewFolderLocation || inboxNewFolderSelect.value || 'root-bar';
      inboxNewFolderSelect.textContent = '';
      const optBar = document.createElement('option');
      optBar.value = 'root-bar';
      optBar.textContent = 'Bookmarks Bar / Toolbar';
      inboxNewFolderSelect.appendChild(optBar);

      const optMenu = document.createElement('option');
      optMenu.value = 'root-menu';
      optMenu.textContent = 'Bookmarks Menu';
      inboxNewFolderSelect.appendChild(optMenu);

      const optOther = document.createElement('option');
      optOther.value = 'root-other';
      optOther.textContent = 'Other Bookmarks';
      inboxNewFolderSelect.appendChild(optOther);

      for (let nfi = 0; nfi < folderList.length; nfi++) {
        const folder = folderList[nfi];
        if (folder.isRoot) continue;
        const opt = document.createElement('option');
        opt.value = folder.id;
        // Build tree indent matching the main dropdown
        let treePrefix = '';
        if (folder.depth > 0) {
          const isLast = !folderList.slice(nfi + 1).some(
            f => f.rootName === folder.rootName && f.depth === folder.depth && f.path.split('/').slice(0, -1).join('/') === folder.path.split('/').slice(0, -1).join('/')
          );
          treePrefix = '\u00A0\u00A0\u00A0\u00A0'.repeat(folder.depth - 1) + (isLast ? '└─ ' : '├─ ');
        }
        const leafName = folder.title || folder.path.split('/').pop() || folder.path;
        opt.textContent = `${folder.rootName ? `[${folder.rootName}] ` : ''}${treePrefix}${leafName}`;
        inboxNewFolderSelect.appendChild(opt);
      }
      if (curVal) {
        inboxNewFolderSelect.value = curVal;
      }
    }

    for (let fi = 0; fi < folderList.length; fi++) {
      const folder = folderList[fi];
      const option = document.createElement('option');
      option.value = folder.id;
      const countLabel = `(${folder.directBookmarkCount} direct bookmark${folder.directBookmarkCount === 1 ? '' : 's'})`;

      // Build natural nested tree indentation
      let prefix = '';
      if (folder.isRoot) {
        prefix = '📁 ';
      } else if (folder.depth > 0) {
        // Check if this is the last sibling at this depth within the same root
        const isLastAtDepth = !folderList.slice(fi + 1).some(
          f => f.rootName === folder.rootName && f.depth === folder.depth && f.path.split('/').slice(0, -1).join('/') === folder.path.split('/').slice(0, -1).join('/')
        );
        const treeChar = isLastAtDepth ? '└─ ' : '├─ ';
        // Each depth level gets padding + tree connector
        prefix = '\u00A0\u00A0\u00A0\u00A0'.repeat(folder.depth - 1) + treeChar;
      }

      const displayName = folder.title || folder.path.split('/').pop() || folder.path;
      option.textContent = `${prefix}${displayName} ${countLabel}`;
      select.appendChild(option);

      if (datalist) {
        const dataOpt = document.createElement('option');
        dataOpt.value = folder.path;
        datalist.appendChild(dataOpt);

        // Also add leaf name if different
        if (folder.title && folder.title !== folder.path) {
          const leafOpt = document.createElement('option');
          leafOpt.value = folder.title;
          datalist.appendChild(leafOpt);
        }
      }
    }

    if (curSelectedFolder && [...select.options].some(o => o.value === curSelectedFolder)) {
      select.value = curSelectedFolder;
    }
  } catch (error) {
    document.getElementById('scopeNote').textContent = `Could not load folders: ${error.message}`;
  }
}

function handleScopeModeChange() {
  const folderMode = document.getElementById('sortScopeMode').value === 'folder';
  const field = document.getElementById('sortFolderField');
  const select = document.getElementById('sortFolderSelect');
  field.style.display = folderMode ? '' : 'none';
  select.disabled = !folderMode;
  if (!folderMode) {
    selectedScope = { type: 'roots' };
    loadUnsortedBookmarks();
    return;
  }

  // If user switched to folder mode and nothing was selected yet, auto-select the first folder with bookmarks
  if (!select.value && select.options.length > 1) {
    let candidateIndex = 1;
    for (let i = 1; i < select.options.length; i++) {
      if (select.options[i].textContent.includes('direct bookmark') && !select.options[i].textContent.includes('(0 direct bookmarks)')) {
        candidateIndex = i;
        break;
      }
    }
    select.selectedIndex = candidateIndex;
  }

  selectedScope = { type: 'folder', folderId: select.value };
  document.getElementById('scopeDescription').textContent = 'Choose a folder or subfolder. Only direct bookmarks in that one folder will be included.';
  document.getElementById('scopeNote').textContent = 'Nested folders are not included. Choose the exact folder whose direct bookmarks you want to sort.';
  if (select.value) loadUnsortedBookmarks();
  else clearBookmarkTable('Choose a folder or subfolder to load its direct bookmarks.');
}

function handleFolderScopeChange() {
  const folderId = document.getElementById('sortFolderSelect').value;
  selectedScope = { type: 'folder', folderId };
  if (folderId) loadUnsortedBookmarks();
  else clearBookmarkTable('Choose a folder or subfolder to load its direct bookmarks.');
}

function clearBookmarkTable(message) {
  bookmarks = [];
  bookmarksById = new Map();
  rowsById = new Map();
  document.getElementById('bookmarkRows').textContent = '';
  document.getElementById('tableCard').style.display = 'none';
  document.getElementById('deleteSelectedBtn').style.display = 'none';
  document.getElementById('applyBtn').style.display = 'none';
  const progressCard = document.getElementById('batchProgressCard');
  if (progressCard) progressCard.style.display = 'none';
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('selectAll').checked = false;
  showAlert(message, 'info');
}

let domainRules = [];

function getParsedDomainRules(rules) {
  const parsed = [];
  for (const rule of rules || []) {
    let domain = (rule.domain || '').trim().toLowerCase();
    const folder = (rule.folder || '').trim();
    if (!domain || !folder) continue;
    domain = domain.replace(/^https?:\/\//i, '');
    const slashIdx = domain.indexOf('/');
    let host = slashIdx === -1 ? domain : domain.slice(0, slashIdx);
    let pathPrefix = slashIdx === -1 ? null : domain.slice(slashIdx);
    host = host.replace(/^www\./i, '').replace(/\/+$/, '');
    if (pathPrefix === '/' || pathPrefix === '') pathPrefix = null;
    if (host) {
      parsed.push({ host, pathPrefix, folder });
    }
  }
  return parsed;
}

function matchesDomainRule(url, rules) {
  const parsedRules = getParsedDomainRules(rules);
  if (parsedRules.length === 0) return null;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./i, '');
    const pathname = urlObj.pathname;
    for (const rule of parsedRules) {
      const hostMatch = hostname === rule.host || hostname.endsWith('.' + rule.host);
      if (!hostMatch) continue;
      if (rule.pathPrefix === null || pathname.toLowerCase().startsWith(rule.pathPrefix.toLowerCase())) {
        return rule.folder;
      }
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

async function loadUnsortedBookmarks() {
  let response;
  document.getElementById('refreshScopeBtn').disabled = true;
  const progressCard = document.getElementById('batchProgressCard');
  if (progressCard) progressCard.style.display = 'none';

  if (selectedScope.type === 'folder' && !selectedScope.folderId) {
    const select = document.getElementById('sortFolderSelect');
    if (select?.value) {
      selectedScope.folderId = select.value;
    } else if (select && select.options.length > 1) {
      let candidateIndex = 1;
      for (let i = 1; i < select.options.length; i++) {
        if (select.options[i].textContent.includes('direct bookmark') && !select.options[i].textContent.includes('(0 direct bookmarks)')) {
          candidateIndex = i;
          break;
        }
      }
      select.selectedIndex = candidateIndex;
      selectedScope.folderId = select.value;
    }
  }

  try {
    const settings = await chrome.storage.sync.get({ domainRules: [] });
    domainRules = Array.isArray(settings.domainRules) ? settings.domainRules : [];
    try {
      response = await chrome.runtime.sendMessage({ action: 'getUnsortedBookmarks', scope: selectedScope });
    } catch {
      // Fallback to direct chrome.bookmarks query
    }

    if (!response?.success) {
      if (selectedScope.type === 'folder') {
        if (!selectedScope.folderId) {
          response = { success: true, bookmarks: [], scopeLabel: 'None selected', noFolderSelected: true };
        } else if (chrome?.bookmarks?.getChildren) {
          const children = await chrome.bookmarks.getChildren(selectedScope.folderId);
          let folderTitle = 'folder';
          try {
            const [folderNode] = await chrome.bookmarks.get(selectedScope.folderId);
            folderTitle = folderNode?.title || folderTitle;
          } catch {
            // Ignore
          }
          response = {
            success: true,
            bookmarks: children.filter(c => Boolean(c.url)),
            scopeLabel: `direct bookmarks in “${folderTitle}”`
          };
        }
      }
    }
  } catch (e) {
    showAlert('Extension error: ' + e.message, 'error');
    return;
  } finally {
    document.getElementById('refreshScopeBtn').disabled = false;
  }

  if (response?.noFolderSelected) {
    clearBookmarkTable('Choose a folder or subfolder above to load its direct bookmarks.');
    return;
  }
  if (!response?.success) {
    showAlert('Error loading bookmarks: ' + (response?.error || 'Unknown error'), 'error');
    return;
  }
  const scopeLabel = response.scopeLabel || 'the selected scope';
  document.getElementById('scopeDescription').textContent = `Sorting scope: ${scopeLabel}.`;
  document.getElementById('scopeNote').textContent = selectedScope.type === 'folder'
    ? 'Only direct bookmarks in the selected folder are included. Its nested folders and their bookmarks are excluded.'
    : 'Safe default: only direct bookmarks on the Bookmarks Bar and Other Bookmarks are included. Folders and their nested contents are excluded.';
  bookmarks = response.bookmarks;
  bookmarksById = new Map(bookmarks.map(bm => [bm.id, bm]));
  if (bookmarks.length === 0) {
    showAlert(`No direct bookmarks found in ${scopeLabel}.`, 'success');
    document.getElementById('tableCard').style.display = 'none';
    document.getElementById('deleteSelectedBtn').style.display = 'none';
    document.getElementById('applyBtn').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = true;
    return;
  }
  showAlert(`Found ${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''} in ${scopeLabel}. Click "Analyze Selected" to get AI folder suggestions.`, 'info');
  renderTable();
  document.getElementById('tableCard').style.display = '';
  document.getElementById('deleteSelectedBtn').style.display = '';
  updateButtonCounts();
  document.getElementById('refreshScopeBtn').disabled = false;
}

function renderTable() {
  const tbody = document.getElementById('bookmarkRows');
  tbody.textContent = '';
  rowsById = new Map();

  const fragment = document.createDocumentFragment();

  for (const bm of bookmarks) {
    const tr = document.createElement('tr');

    const tdCb = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bm-cb';
    cb.checked = true;
    tdCb.appendChild(cb);

    const tdTitle = document.createElement('td');
    const titleDiv = document.createElement('div');
    titleDiv.className = 'bm-title';
    const link = document.createElement('a');
    link.href = bm.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = bm.title || bm.url;
    titleDiv.appendChild(link);
    const urlDiv = document.createElement('div');
    urlDiv.className = 'bm-url';
    urlDiv.textContent = bm.url;
    tdTitle.appendChild(titleDiv);
    tdTitle.appendChild(urlDiv);

    const tdSug = document.createElement('td');
    const tdStatus = document.createElement('td');
    const statusEl = document.createElement('span');

    const matchedRuleFolder = matchesDomainRule(bm.url, domainRules);
    if (matchedRuleFolder) {
      bm.suggestedFolder = matchedRuleFolder;
      bm.fromRule = true;
      statusEl.className = 'row-status approved';
      statusEl.textContent = 'Rule: Ready';
    } else {
      tdSug.textContent = '—';
      statusEl.className = 'row-status ready';
      statusEl.textContent = 'Waiting';
    }
    tdStatus.appendChild(statusEl);

    tr.appendChild(tdCb);
    tr.appendChild(tdTitle);
    tr.appendChild(tdSug);
    tr.appendChild(tdStatus);
    fragment.appendChild(tr);

    rowsById.set(bm.id, { tr, checkbox: cb, sugCell: tdSug, statusEl });
    if (bm.suggestedFolder) {
      renderSuggestion(bm.id, bm.suggestedFolder);
    }
  }

  tbody.appendChild(fragment);
}

function handleBatchProgress(progress) {
  if (!progress) return;
  const progressCard = document.getElementById('batchProgressCard');
  const titleEl = document.getElementById('batchProgressTitle');
  const logList = document.getElementById('batchLogList');
  const progressBar = document.getElementById('batchProgressBarFill');
  const tokensMetric = document.getElementById('batchTokensMetric');

  if (progress.type === 'rulesApplied') {
    if (Array.isArray(progress.results)) {
      for (const res of progress.results) {
        const bm = bookmarksById.get(res.id);
        const row = rowsById.get(res.id);
        if (res.success) {
          if (bm) {
            bm.suggestedFolder = res.matchedCategory || 'Other';
            bm.fromRule = true;
          }
          renderSuggestion(res.id, res.matchedCategory || 'Other');
          const isApproved = row ? row.checkbox.checked : true;
          setStatus(res.id, isApproved ? 'approved' : 'denied', isApproved ? 'Approved (Rule)' : 'Denied / Skipped');
        }
      }
    }
    updateButtonCounts();
    return;
  }

  if (progressCard) progressCard.style.display = '';

  if (progress.type === 'batchStart') {
    if (titleEl) {
      titleEl.textContent = progress.totalBatches > 1
        ? `Analyzing ${progress.totalBatches} batches in parallel (${completedBatchesCount}/${progress.totalBatches} complete)…`
        : `Processing Batch 1 of 1 (${progress.bookmarkCount} bookmark${progress.bookmarkCount === 1 ? '' : 's'})…`;
    }

    const pct = Math.round((completedBatchesCount / progress.totalBatches) * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;

    // Mark bookmarks in table with specific batch number
    if (Array.isArray(progress.bookmarks)) {
      for (const bm of progress.bookmarks) {
        setStatus(bm.id, 'analyzing', `Batch ${progress.batchIndex}: Analyzing…`);
      }
    }

    // Add or update batch log entry
    let logEntry = document.getElementById(`batch-entry-${progress.batchIndex}`);
    if (!logEntry) {
      logEntry = document.createElement('div');
      logEntry.id = `batch-entry-${progress.batchIndex}`;
      logEntry.className = 'batch-log-entry active';

      const left = document.createElement('div');
      left.className = 'batch-log-left';

      const title = document.createElement('div');
      title.className = 'batch-log-title';
      title.textContent = `Batch ${progress.batchIndex} of ${progress.totalBatches} (${progress.bookmarkCount} bookmark${progress.bookmarkCount === 1 ? '' : 's'})`;

      const items = document.createElement('div');
      items.className = 'batch-log-items';
      const previewList = (progress.bookmarks || []).map(b => b.title || b.url);
      const previewText = previewList.slice(0, 3).join(', ') + (previewList.length > 3 ? ` +${previewList.length - 3} more` : '');
      items.textContent = previewText;
      items.title = previewList.join('\n');

      left.appendChild(title);
      left.appendChild(items);

      const stats = document.createElement('div');
      stats.className = 'batch-log-stats';
      stats.textContent = `In: ~${(progress.inputTokens || 0).toLocaleString()} tok | Sending…`;

      logEntry.appendChild(left);
      logEntry.appendChild(stats);
      if (logList) logList.appendChild(logEntry);
    } else {
      logEntry.className = 'batch-log-entry active';
    }
  } else if (progress.type === 'cancelled') {
    if (titleEl) titleEl.textContent = 'Analysis stopped.';
    const stopBtn = document.getElementById('stopAnalysisBtn');
    if (stopBtn) {
      stopBtn.style.display = 'none';
      stopBtn.disabled = false;
      stopBtn.textContent = '⏹ Stop';
    }
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
      analyzeBtn.style.display = '';
      analyzeBtn.disabled = false;
    }
    isAnalyzing = false;
  } else if (progress.type === 'batchComplete') {
    completedBatchesCount++;
    const now = Date.now();
    const timeSinceLast = lastResponseTime > 0 ? ((now - lastResponseTime) / 1000).toFixed(1) : ((progress.durationMs || 0) / 1000).toFixed(1);
    lastResponseTime = now;

    totalInputTokens += progress.inputTokens || 0;
    totalOutputTokens += progress.outputTokens || 0;

    if (tokensMetric) {
      tokensMetric.textContent = `${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out tokens`;
    }

    if (titleEl) {
      titleEl.textContent = progress.totalBatches > 1
        ? `Analyzing ${progress.totalBatches} batches in parallel (${completedBatchesCount}/${progress.totalBatches} complete)…`
        : 'Completed Batch 1 of 1';
    }

    const pct = Math.round((completedBatchesCount / progress.totalBatches) * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;

    // Immediately render results in table for this completed batch in real time!
    if (Array.isArray(progress.results)) {
      for (const res of progress.results) {
        const bm = bookmarksById.get(res.id);
        const row = rowsById.get(res.id);
        if (res.success) {
          if (bm) bm.suggestedFolder = res.matchedCategory || 'Other';
          renderSuggestion(res.id, res.matchedCategory || 'Other');
          const isApproved = row ? row.checkbox.checked : true;
          setStatus(res.id, isApproved ? 'approved' : 'denied', isApproved ? 'Approved to move' : 'Denied / Skipped');
        } else {
          setStatus(res.id, 'error', res.error || 'Error');
        }
      }
    }

    // Update log entry
    const logEntry = document.getElementById(`batch-entry-${progress.batchIndex}`);
    if (logEntry) {
      logEntry.className = progress.success ? 'batch-log-entry complete' : 'batch-log-entry error';
      const stats = logEntry.querySelector('.batch-log-stats');
      if (stats) {
        const durSec = ((progress.durationMs || 0) / 1000).toFixed(1);
        if (progress.success) {
          stats.textContent = `In: ${(progress.inputTokens || 0).toLocaleString()} tok | Out: ${(progress.outputTokens || 0).toLocaleString()} tok | ${durSec}s (Δ ${timeSinceLast}s)`;
        } else {
          stats.textContent = `Error | In: ${(progress.inputTokens || 0).toLocaleString()} tok | ${durSec}s`;
          stats.title = progress.error || 'Unknown error';
        }
      }
    }

    updateButtonCounts();
  }
}

async function analyzeSelected() {
  const checkedIds = [...rowsById.entries()]
    .filter(([, row]) => row.checkbox.checked)
    .map(([id]) => id);

  if (checkedIds.length === 0) {
    showAlert('No bookmarks selected.', 'info');
    return;
  }



  const btn = document.getElementById('analyzeBtn');
  const stopBtn = document.getElementById('stopAnalysisBtn');
  btn.disabled = true;
  btn.style.display = 'none';
  stopBtn.style.display = '';
  stopBtn.disabled = false;
  stopBtn.textContent = '⏹ Stop';
  isAnalyzing = true;

  const total = checkedIds.length;
  btn.textContent = 'Analyzing bookmarks…';
  showAlert(`Preparing batch analysis for ${total} bookmark${total === 1 ? '' : 's'}…`, 'loading');

  // Reset batch progress UI and telemetry
  totalInputTokens = 0;
  totalOutputTokens = 0;
  completedBatchesCount = 0;
  const startTime = Date.now();
  lastResponseTime = startTime;

  const progressCard = document.getElementById('batchProgressCard');
  const spinner = document.getElementById('batchProgressSpinner');
  const titleEl = document.getElementById('batchProgressTitle');
  const logList = document.getElementById('batchLogList');
  const progressBar = document.getElementById('batchProgressBarFill');
  const timeMetric = document.getElementById('batchTimeMetric');
  const tokensMetric = document.getElementById('batchTokensMetric');

  if (progressCard) progressCard.style.display = '';
  if (spinner) spinner.style.display = 'inline-block';
  if (titleEl) titleEl.textContent = 'Calculating batches and context…';
  if (logList) logList.textContent = '';
  if (progressBar) progressBar.style.width = '0%';
  if (tokensMetric) tokensMetric.textContent = '0 in / 0 out tokens';
  if (timeMetric) timeMetric.textContent = '0.0s elapsed';

  if (batchTimerInterval) clearInterval(batchTimerInterval);
  batchTimerInterval = setInterval(() => {
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    if (timeMetric) timeMetric.textContent = `${elapsedSec}s elapsed`;
  }, 100);

  const sortModelSelect = document.getElementById('sortModelSelect');
  const selectedModelId = sortModelSelect?.value || 'auto';
  const isCloudSelected = selectedModelId === 'cloud';
  const useLocalSort = !isCloudSelected;
  const allowCreateFolders = Boolean(document.getElementById('allowCreateFolders')?.checked);
  const newFolderLocation = document.getElementById('inboxNewFolderLocation')?.value || 'root-bar';
  const allowRecursive = Boolean(document.getElementById('inboxAllowRecursiveFolders')?.checked);
  let hitRateLimit = false;

  checkedIds.forEach(id => setStatus(id, 'analyzing', 'Waiting for batch…'));

  let response = null;
  let caughtErrorMessage = null;
  try {
    const selectedBookmarks = checkedIds.map(id => bookmarksById.get(id)).filter(Boolean);
    response = await chrome.runtime.sendMessage({
      action: 'getAISuggestionsBatch',
      bookmarks: selectedBookmarks.map(({ id, title, url }) => ({ id, title, url })),
      allowCreateFolders,
      modelId: selectedModelId,
      useLocalJevModel: useLocalSort,
      useLocalEmbeddings: useLocalSort,
      options: {
        allowCreateFolders,
        newFolderLocation,
        allowRecursive,
        modelId: selectedModelId,
        useLocalJevModel: useLocalSort,
        useLocalEmbeddings: useLocalSort
      }
    });

    if (response && !response.success && response.error) {
      throw new Error(response.error);
    }

    const resultById = new Map((response?.results || []).map(result => [String(result.id), result]));
    for (const id of checkedIds) {
      const result = resultById.get(String(id));
      const bm = bookmarksById.get(id);
      const row = rowsById.get(id);
      if (!result) {
        setStatus(id, 'error', 'No result returned for this bookmark.');
        continue;
      }
      if (result.success) {
        bm.suggestedFolder = result.matchedCategory || 'Other';
        renderSuggestion(id, bm.suggestedFolder);
        const isApproved = row ? row.checkbox.checked : true;
        setStatus(id, isApproved ? 'approved' : 'denied', isApproved ? 'Approved to move' : 'Denied / Skipped');
      } else {
        setStatus(id, 'error', result.error || 'Error');
        if (isRateLimitError(result.error)) hitRateLimit = true;
      }
    }
  } catch (error) {
    caughtErrorMessage = error.message || 'Batch analysis failed';
    for (const id of checkedIds) setStatus(id, 'error', caughtErrorMessage);
    hitRateLimit = isRateLimitError(caughtErrorMessage);
  } finally {
    if (batchTimerInterval) {
      clearInterval(batchTimerInterval);
      batchTimerInterval = null;
    }
    const finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (timeMetric) timeMetric.textContent = `${finalElapsed}s total`;
    if (spinner) spinner.style.display = 'none';
    if (progressBar) progressBar.style.width = '100%';
    if (titleEl) {
      titleEl.textContent = `Completed ${completedBatchesCount} batch${completedBatchesCount === 1 ? '' : 'es'} in ${finalElapsed}s`;
    }
  }

  btn.textContent = 'Analyze Selected';
  btn.disabled = false;

  // Pause for user approval — do not auto-apply changes
  const successfullyAnalyzed = checkedIds.filter(id => bookmarksById.get(id)?.suggestedFolder);

  if (successfullyAnalyzed.length > 0) {
    if (response?.cancelled) {
      showAlert(`Analysis stopped by user (${successfullyAnalyzed.length}/${total} processed). Check bookmarks to approve or uncheck to deny moving them, then click "Apply Changes".`, 'info');
    } else if (hitRateLimit) {
      showAlert(`Partially analyzed (${successfullyAnalyzed.length}/${total} bookmarks): AI rate limit reached. Review approved suggestions below or uncheck to deny, then click "Apply Changes".`, 'error');
    } else {
      showAlert(`Analysis complete (${successfullyAnalyzed.length}/${total} processed). Check bookmarks to approve or uncheck to deny moving them, then click "Apply Changes".`, 'success');
    }
  } else if (response?.cancelled) {
    showAlert('Analysis stopped by user.', 'info');
  } else if (caughtErrorMessage) {
    showAlert(`Analysis failed: ${caughtErrorMessage}`, 'error');
  } else if (hitRateLimit) {
    showAlert('Stopped early: rate limit reached before suggestions were generated. Wait and retry.', 'error');
  } else {
    const resultById = new Map((response?.results || []).map(result => [String(result.id), result]));
    const firstErrorMessage = checkedIds.map(id => resultById.get(String(id))?.error).find(Boolean) || response?.error;
    if (firstErrorMessage) {
      showAlert(`Analysis failed: ${firstErrorMessage}`, 'error');
    } else {
      showAlert('Analysis complete, but no folder suggestions were generated. Make sure your AI Provider API key is configured in Settings.', 'error');
    }
  }

  isAnalyzing = false;
  document.getElementById('analyzeBtn').style.display = '';
  document.getElementById('stopAnalysisBtn').style.display = 'none';

  updateButtonCounts();
}

async function stopAnalysis() {
  if (!isAnalyzing) return;
  const stopBtn = document.getElementById('stopAnalysisBtn');
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping…';
  await chrome.runtime.sendMessage({ action: 'cancelBatchAnalysis' });
}


function isRateLimitError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('rate limit') || text.includes('quota') || text.includes('429') || text.includes('resource_exhausted');
}

function renderSuggestion(bookmarkId, folder) {
  const row = rowsById.get(bookmarkId);
  if (!row) return;
  const cell = row.sugCell;
  cell.textContent = '';

  const badge = document.createElement('span');
  badge.className = 'suggestion';
  badge.textContent = folder;
  badge.title = 'Click to edit';
  badge.style.cursor = 'pointer';

  badge.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'suggestion-edit';
    input.setAttribute('list', 'existingFoldersList');
    input.value = folder;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const newFolder = input.value.trim() || folder;
      const bm = bookmarksById.get(bookmarkId);
      if (bm) bm.suggestedFolder = newFolder;
      if (row.checkbox) {
        row.checkbox.checked = true;
      }
      setStatus(bookmarkId, 'approved', 'Approved to move');
      renderSuggestion(bookmarkId, newFolder);
      updateButtonCounts();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') renderSuggestion(bookmarkId, folder);
    });
  });

  cell.appendChild(badge);
}

async function applySelected() {
  const toMove = [...rowsById.entries()]
    .filter(([id, row]) => row.checkbox.checked && bookmarksById.get(id)?.suggestedFolder)
    .map(([id]) => id);

  if (toMove.length === 0) {
    showAlert('No approved bookmarks selected to move.', 'info');
    return;
  }

  const btn = document.getElementById('applyBtn');
  btn.disabled = true;

  toMove.forEach(id => setStatus(id, 'moving', 'Moving…'));

  const allowCreateFolders = Boolean(document.getElementById('allowCreateFolders')?.checked);
  const newFolderLocation = document.getElementById('inboxNewFolderLocation')?.value || 'root-bar';
  const allowRecursive = Boolean(document.getElementById('inboxAllowRecursiveFolders')?.checked);
  const items = toMove.map(id => ({ bookmarkId: id, categoryPath: bookmarksById.get(id).suggestedFolder }));

  let response;
  try {
    // One message for the whole batch — the background page resolves each distinct
    // folder path once instead of the page sending (and re-resolving) one move per row.
    response = await chrome.runtime.sendMessage({
      action: 'moveBookmarks',
      items,
      allowCreateFolders,
      options: {
        allowCreateFolders,
        newFolderLocation,
        allowRecursive
      }
    });
  } catch (e) {
    toMove.forEach(id => setStatus(id, 'error', 'Failed: ' + e.message));
    btn.disabled = false;
    return;
  }

  const resultById = new Map((response.results || []).map(r => [r.bookmarkId, r]));
  const movedIds = [];

  for (const id of toMove) {
    const result = resultById.get(id);
    if (result && result.success) {
      setStatus(id, 'done', 'Moved');
      movedIds.push(id);
    } else {
      setStatus(id, 'error', 'Failed: ' + (result ? result.error : 'Unknown error'));
    }
  }

  // Patch out the rows that actually left the unsorted set instead of re-fetching
  // and re-rendering the whole table.
  removeRows(movedIds);

  btn.disabled = false;
  updateButtonCounts();
  showAlert(`Successfully moved ${movedIds.length} approved bookmark${movedIds.length === 1 ? '' : 's'}.`, 'success');
}

async function deleteSelected() {
  const toDelete = [...rowsById.entries()]
    .filter(([, row]) => row.checkbox.checked)
    .map(([id]) => id);

  if (toDelete.length === 0) {
    showAlert('No bookmarks selected for deletion.', 'info');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${toDelete.length} selected bookmark(s)?`)) {
    return;
  }

  const btn = document.getElementById('deleteSelectedBtn');
  btn.disabled = true;

  toDelete.forEach(id => setStatus(id, 'moving', 'Deleting…'));

  let response;
  try {
    response = await chrome.runtime.sendMessage({ action: 'deleteBookmarks', bookmarkIds: toDelete });
  } catch (e) {
    toDelete.forEach(id => setStatus(id, 'error', 'Failed: ' + e.message));
    btn.disabled = false;
    return;
  }

  const resultById = new Map((response.results || []).map(r => [r.bookmarkId, r]));
  const deletedIds = [];

  for (const id of toDelete) {
    const result = resultById.get(id);
    if (result && result.success) {
      setStatus(id, 'done', 'Deleted');
      deletedIds.push(id);
    } else {
      setStatus(id, 'error', 'Failed: ' + (result ? result.error : 'Unknown error'));
    }
  }

  removeRows(deletedIds);

  btn.disabled = false;
  updateButtonCounts();
}

/**
 * Removes rows for bookmarks that have left the unsorted set (moved or deleted)
 * directly from the DOM and local state, instead of re-fetching the remaining
 * unsorted bookmarks and re-rendering the whole table.
 */
function removeRows(bookmarkIds) {
  if (bookmarkIds.length === 0) return;
  const idSet = new Set(bookmarkIds);

  for (const id of bookmarkIds) {
    const row = rowsById.get(id);
    if (row) row.tr.remove();
    rowsById.delete(id);
    bookmarksById.delete(id);
  }
  bookmarks = bookmarks.filter(bm => !idSet.has(bm.id));

  if (bookmarks.length === 0) {
    document.getElementById('tableCard').style.display = 'none';
    document.getElementById('deleteSelectedBtn').style.display = 'none';
    document.getElementById('applyBtn').style.display = 'none';
  }
}

function setStatus(bookmarkId, state, text) {
  const row = rowsById.get(bookmarkId);
  if (!row) return;
  row.statusEl.className = `row-status ${state}`;
  const fullText = String(text || '');
  row.statusEl.title = fullText;
  row.statusEl.textContent = fullText.length > 140 ? `${fullText.slice(0, 137)}...` : fullText;
}

function updateButtonCounts() {
  let selectedCount = 0;
  let approvedCount = 0;
  let totalWithSuggestions = 0;
  let hasAiSuggestions = false;

  for (const [id, row] of rowsById.entries()) {
    const bm = bookmarksById.get(id);
    if (bm?.suggestedFolder) {
      totalWithSuggestions++;
      if (!bm.fromRule) hasAiSuggestions = true;
    }
    if (row.checkbox.checked) {
      selectedCount++;
      if (bm?.suggestedFolder) {
        approvedCount++;
      }
    }
  }

  const applyBtn = document.getElementById('applyBtn');
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');

  if (totalWithSuggestions > 0) {
    applyBtn.style.display = '';
    applyBtn.textContent = `Apply Changes (${approvedCount})`;
    applyBtn.disabled = approvedCount === 0;
    applyBtn.className = 'btn btn-primary';
    analyzeBtn.className = hasAiSuggestions ? 'btn btn-secondary' : 'btn btn-primary';
    analyzeBtn.textContent = hasAiSuggestions ? 'Re-analyze Selected' : 'Analyze Selected';
  } else {
    applyBtn.style.display = 'none';
    applyBtn.className = 'btn btn-secondary';
    analyzeBtn.className = 'btn btn-primary';
    analyzeBtn.textContent = 'Analyze Selected';
  }

  deleteBtn.textContent = `Delete Selected (${selectedCount})`;
  deleteBtn.disabled = selectedCount === 0;
  analyzeBtn.disabled = selectedCount === 0;
}

function showAlert(msg, type) {
  const el = document.getElementById('alertBox');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
}
