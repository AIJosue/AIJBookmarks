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
    inboxNewFolderLocation.value = settings.sortNewFolderLocation || 'root-bar';
    inboxNewFolderLocation.addEventListener('change', (e) => {
      chrome.storage.sync.set({ sortNewFolderLocation: e.target.value });
    });
  }

  await loadSortingScopeFolders();
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
  document.getElementById('refreshScopeBtn').addEventListener('click', () => loadUnsortedBookmarks());
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
  if (aiConfig && !aiConfig.hasAI) {
    const alertBox = document.getElementById('alertBox');
    if (alertBox && bookmarks.length > 0) {
      alertBox.className = 'alert alert-info';
      alertBox.innerHTML = '⚠️ <strong>AI Provider not configured.</strong> Please open <a href="#" id="openSettingsAlertLink" style="color:#1a73e8;font-weight:600;text-decoration:underline;">Extension Settings</a> and enter your API key to enable AI sorting.';
      document.getElementById('openSettingsAlertLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }
  }
});

async function loadSortingScopeFolders() {
  const select = document.getElementById('sortFolderSelect');
  const datalist = document.getElementById('existingFoldersList');
  const inboxNewFolderSelect = document.getElementById('inboxNewFolderLocation');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSortingScopeFolders' });
    if (!response?.success) throw new Error(response?.error || 'Could not load folders');
    select.textContent = '';
    if (datalist) datalist.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a folder…';
    select.appendChild(placeholder);

    if (inboxNewFolderSelect) {
      const curVal = inboxNewFolderSelect.value || 'root-bar';
      inboxNewFolderSelect.textContent = '';
      const optBar = document.createElement('option');
      optBar.value = 'root-bar';
      optBar.textContent = 'Bookmarks Bar';
      inboxNewFolderSelect.appendChild(optBar);

      const optOther = document.createElement('option');
      optOther.value = 'root-other';
      optOther.textContent = 'Other Bookmarks';
      inboxNewFolderSelect.appendChild(optOther);

      const optMenu = document.createElement('option');
      optMenu.value = 'root-menu';
      optMenu.textContent = 'Bookmarks Menu';
      inboxNewFolderSelect.appendChild(optMenu);

      for (const folder of response.folders || []) {
        const opt = document.createElement('option');
        opt.value = folder.id;
        opt.textContent = folder.path;
        inboxNewFolderSelect.appendChild(opt);
      }
      inboxNewFolderSelect.value = curVal;
    }

    for (const folder of response.folders || []) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = `${folder.path} (${folder.directBookmarkCount} direct bookmark${folder.directBookmarkCount === 1 ? '' : 's'})`;
      select.appendChild(option);

      if (datalist) {
        const dataOpt = document.createElement('option');
        dataOpt.value = folder.path;
        datalist.appendChild(dataOpt);
      }
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
  } catch (err) {
    // Ignore invalid URL
  }
  return null;
}

async function loadUnsortedBookmarks() {
  let response;
  document.getElementById('refreshScopeBtn').disabled = true;
  const progressCard = document.getElementById('batchProgressCard');
  if (progressCard) progressCard.style.display = 'none';
  try {
    const settings = await chrome.storage.sync.get({ domainRules: [] });
    domainRules = Array.isArray(settings.domainRules) ? settings.domainRules : [];
    response = await chrome.runtime.sendMessage({ action: 'getUnsortedBookmarks', scope: selectedScope });
  } catch (e) {
    showAlert('Extension error: ' + e.message, 'error');
    return;
  } finally {
    document.getElementById('refreshScopeBtn').disabled = false;
  }
  if (!response.success) {
    showAlert('Error loading bookmarks: ' + response.error, 'error');
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
        : `Completed Batch 1 of 1`;
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

  const aiConfig = await chrome.runtime.sendMessage({ action: 'checkAIConfig' }).catch(() => null);
  if (aiConfig && !aiConfig.hasAI) {
    showAlert('AI Provider not configured. Please open Extension Settings to enter your API key before sorting bookmarks.', 'error');
    chrome.runtime.openOptionsPage();
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
  btn.textContent = `Analyzing bookmarks…`;
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
      options: {
        allowCreateFolders,
        newFolderLocation,
        allowRecursive
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
    showAlert(`Stopped early: rate limit reached before suggestions were generated. Wait and retry.`, 'error');
  } else {
    const resultById = new Map((response?.results || []).map(result => [String(result.id), result]));
    const firstErrorMessage = checkedIds.map(id => resultById.get(String(id))?.error).find(Boolean) || response?.error;
    if (firstErrorMessage) {
      showAlert(`Analysis failed: ${firstErrorMessage}`, 'error');
    } else {
      showAlert(`Analysis complete, but no folder suggestions were generated. Make sure your AI Provider API key is configured in Settings.`, 'error');
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

  for (const [id, row] of rowsById.entries()) {
    const bm = bookmarksById.get(id);
    if (bm?.suggestedFolder) {
      totalWithSuggestions++;
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
    analyzeBtn.className = 'btn btn-secondary';
    analyzeBtn.textContent = 'Re-analyze Selected';
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
