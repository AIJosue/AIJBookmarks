let currentFilter = 'dead';
let currentResults = null;
let cleanupPreviewData = { emptyFolders: [], duplicateBookmarks: [] };

// ── Initialization ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadResults();

  document.getElementById('runBtn').addEventListener('click', runHealthCheck);

  // Summary card filters
  document.querySelectorAll('.summary-card').forEach(card => {
    card.addEventListener('click', () => {
      setFilter(card.dataset.filter);
    });
  });

  // Bulk actions
  const bulkDeleteDead = document.getElementById('bulkDeleteDead');
  if (bulkDeleteDead) {
    bulkDeleteDead.addEventListener('click', () => bulkFix('deleteAllDead'));
  }
  const bulkFixRedirects = document.getElementById('bulkFixRedirects');
  if (bulkFixRedirects) {
    bulkFixRedirects.addEventListener('click', () => bulkFix('fixAllRedirects'));
  }
  const bulkDeleteDuplicates = document.getElementById('bulkDeleteDuplicates');
  if (bulkDeleteDuplicates) {
    bulkDeleteDuplicates.addEventListener('click', bulkDeleteDuplicatesAction);
  }
  const bulkDeleteEmptyFolders = document.getElementById('bulkDeleteEmptyFolders');
  if (bulkDeleteEmptyFolders) {
    bulkDeleteEmptyFolders.addEventListener('click', bulkDeleteEmptyFoldersAction);
  }
});

// Progress updates arrive via chrome.storage.onChanged instead of a 500ms poll loop —
// the service worker already throttles its writes to roughly that cadence, so polling
// on top of that was mostly re-reading a value that hadn't changed.
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area !== 'session' && area !== 'local') || !changes.healthCheckProgress) return;
  const progress = changes.healthCheckProgress.newValue;
  if (!progress) return;

  if (progress.inProgress) {
    showProgress(progress.current, progress.total);
    if (progress.summary) {
      renderSummary(progress.summary, null, true);
    }
  } else {
    // A check finished — possibly started elsewhere (e.g. the periodic alarm) — so
    // reflect the final results instead of leaving a stale progress bar on screen.
    hideProgress();
    loadResults();
  }
});

// ── Run health check ─────────────────────────────────────────

async function runHealthCheck() {
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  showProgress(0, 0);
  renderSummary({ dead: 0, redirected: 0, ok: 0 }, null, true);

  try {
    const result = await chrome.runtime.sendMessage({ action: 'runHealthCheck' });
    hideProgress();
    if (result && result.success) {
      await loadResults();
    } else {
      showError(result ? result.error : 'Health check failed.');
    }
  } catch (err) {
    hideProgress();
    showError(err.message || 'Unexpected error running health check.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Health Check';
  }
}

function showProgress(current, total) {
  const section = document.getElementById('progressSection');
  section.style.display = 'block';
  document.getElementById('progressCurrent').textContent = current;
  document.getElementById('progressTotal').textContent = total;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progressBarFill').style.width = `${pct}%`;
}

function hideProgress() {
  document.getElementById('progressSection').style.display = 'none';
}

// ── Load & render results ─────────────────────────────────────

async function loadCleanupData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getCleanupPreview' });
    if (response?.success) {
      cleanupPreviewData = {
        emptyFolders: response.emptyFolders || [],
        duplicateBookmarks: response.duplicateBookmarks || []
      };
      const dupEl = document.getElementById('sumDuplicates');
      if (dupEl) dupEl.textContent = cleanupPreviewData.duplicateBookmarks.length;
      const folderEl = document.getElementById('sumEmptyFolders');
      if (folderEl) folderEl.textContent = cleanupPreviewData.emptyFolders.length;
    }
  } catch (e) {
    console.warn('Could not load cleanup preview:', e);
  }
}

async function loadResults() {
  await loadCleanupData();
  const data = await chrome.runtime.sendMessage({ action: 'getHealthCheckData' }).catch(() => null);

  // If a check is in progress, show the progress bar and real-time live numbers
  if (data?.healthCheckProgress && data.healthCheckProgress.inProgress) {
    const { current, total, summary } = data.healthCheckProgress;
    showProgress(current, total);
    if (summary) {
      renderSummary(summary, null, true);
    }
    return;
  }

  if (!data || !data.healthCheckResults) {
    if (currentFilter === 'duplicates' || currentFilter === 'empty_folders') {
      renderResults([]);
    } else {
      renderEmptyState('no-data');
    }
    const deadEl = document.getElementById('sumDead');
    if (deadEl) deadEl.textContent = '–';
    const redirectEl = document.getElementById('sumRedirected');
    if (redirectEl) redirectEl.textContent = '–';
    const okEl = document.getElementById('sumOk');
    if (okEl) okEl.textContent = '–';
    const label = document.getElementById('lastRunLabel');
    if (label) label.textContent = '';
    return;
  }

  currentResults = data.healthCheckResults;
  renderSummary(currentResults.summary, currentResults.lastRun);
  renderResults(currentResults.results);
}

function renderSummary(summary, lastRun, isLive = false) {
  if (!summary) return;
  const deadEl = document.getElementById('sumDead');
  if (deadEl) deadEl.textContent = (summary.dead || 0) + (summary.domainGone || 0);

  const redirectEl = document.getElementById('sumRedirected');
  if (redirectEl) redirectEl.textContent = summary.redirected || 0;

  const okEl = document.getElementById('sumOk');
  if (okEl) okEl.textContent = (summary.ok || 0) + (summary.stale || 0) + (summary.titleChanged || 0);

  const dupEl = document.getElementById('sumDuplicates');
  if (dupEl && dupEl.textContent === '–') {
    dupEl.textContent = cleanupPreviewData.duplicateBookmarks.length;
  }
  const folderEl = document.getElementById('sumEmptyFolders');
  if (folderEl && folderEl.textContent === '–') {
    folderEl.textContent = cleanupPreviewData.emptyFolders.length;
  }

  const label = document.getElementById('lastRunLabel');
  if (label) {
    if (isLive) {
      label.textContent = 'Scanning bookmarks in real-time…';
      label.style.color = '#1a73e8';
      label.style.fontWeight = '500';
    } else if (lastRun) {
      const d = new Date(lastRun);
      label.textContent = `Last checked: ${d.toLocaleString()}`;
      label.style.color = '';
      label.style.fontWeight = '';
    }
  }
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.summary-card').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  renderResults(currentResults ? currentResults.results : []);
}

function renderResults(results) {
  const list = document.getElementById('resultsList');
  list.textContent = '';

  if (currentFilter === 'duplicates') {
    const duplicates = cleanupPreviewData.duplicateBookmarks || [];
    updateBulkBar(duplicates);
    if (duplicates.length === 0) {
      renderEmptyState('no-duplicates');
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const dup of duplicates) {
      fragment.appendChild(buildDuplicateCard(dup));
    }
    list.appendChild(fragment);
    return;
  }

  if (currentFilter === 'empty_folders') {
    const emptyFolders = cleanupPreviewData.emptyFolders || [];
    updateBulkBar(emptyFolders);
    if (emptyFolders.length === 0) {
      renderEmptyState('no-empty-folders');
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const folder of emptyFolders) {
      fragment.appendChild(buildEmptyFolderCard(folder));
    }
    list.appendChild(fragment);
    return;
  }

  if (!results || results.length === 0) {
    renderEmptyState('no-data');
    return;
  }

  const filtered = filterResults(results, currentFilter);
  updateBulkBar(filtered);

  if (filtered.length === 0) {
    renderEmptyState(currentFilter === 'ok' ? 'all-good' : 'no-issues');
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of filtered) {
    fragment.appendChild(buildResultCard(entry));
  }
  list.appendChild(fragment);
}

function filterResults(results, filter) {
  // Always hide dismissed items unless explicitly showing "ok" (healthy)
  switch (filter) {
  case 'issues':
    return results.filter(r => (r.issues.includes('dead') || r.issues.includes('domain_gone') || r.issues.includes('redirect')) && !r.dismissed && !r.fixed);
  case 'dead':
    return results.filter(r => (r.issues.includes('dead') || r.issues.includes('domain_gone')) && !r.dismissed);
  case 'redirect':
    return results.filter(r => r.issues.includes('redirect') && !r.dismissed);
  case 'stale':
    return results.filter(r => r.issues.includes('stale') && !r.dismissed);
  case 'ok':
    return results.filter(r => (!r.issues.includes('dead') && !r.issues.includes('domain_gone') && !r.issues.includes('redirect')) || r.fixed);
  default:
    return results;
  }
}

function buildResultCard(entry) {
  const card = document.createElement('div');
  card.className = `result-card${entry.dismissed ? ' dismissed' : ''}${entry.fixed ? ' fixed' : ''}`;
  card.dataset.id = entry.id;

  // Header row: title + badges
  const header = document.createElement('div');
  header.className = 'result-header';

  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = entry.title || '(untitled)';
  header.appendChild(title);

  // Badges for each issue
  const badgeGroup = document.createElement('div');
  badgeGroup.style.display = 'flex';
  badgeGroup.style.gap = '4px';
  badgeGroup.style.flexShrink = '0';

  if (entry.fixed) {
    badgeGroup.appendChild(makeBadge('Fixed', 'fixed'));
  } else if (entry.dismissed) {
    badgeGroup.appendChild(makeBadge('Dismissed', 'ok'));
  } else {
    if (entry.challengeProtected) {
      badgeGroup.appendChild(makeBadge('🛡️ Bot Protected', 'protected'));
    }
    const relevantIssues = entry.issues.filter(i => i === 'dead' || i === 'domain_gone' || i === 'redirect');
    for (const issue of relevantIssues) {
      badgeGroup.appendChild(makeBadge(issueLabel(issue), issue));
    }
  }
  header.appendChild(badgeGroup);
  card.appendChild(header);

  // URL
  const urlEl = document.createElement('a');
  urlEl.className = 'result-url';
  urlEl.href = entry.url;
  urlEl.target = '_blank';
  urlEl.rel = 'noopener noreferrer';
  urlEl.textContent = entry.url;
  card.appendChild(urlEl);

  // Meta info
  const meta = buildMetaLine(entry);
  if (meta) { card.appendChild(meta); }

  // Redirect target
  if (entry.newUrl && !entry.fixed) {
    const redirectInfo = document.createElement('div');
    redirectInfo.className = 'result-new-url';
    const strong = document.createElement('strong');
    strong.textContent = 'Redirects to: ';
    redirectInfo.appendChild(strong);
    redirectInfo.appendChild(document.createTextNode(entry.newUrl));
    card.appendChild(redirectInfo);
  }

  // New title suggestion
  if (entry.newTitle && !entry.fixed) {
    const titleInfo = document.createElement('div');
    titleInfo.className = 'result-new-url';
    const strong = document.createElement('strong');
    strong.textContent = 'New title: ';
    titleInfo.appendChild(strong);
    titleInfo.appendChild(document.createTextNode(entry.newTitle));
    card.appendChild(titleInfo);
  }

  // Action buttons
  if (!entry.dismissed && !entry.fixed) {
    const actions = buildActionButtons(entry);
    card.appendChild(actions);
  }

  return card;
}

function buildMetaLine(entry) {
  const parts = [];

  if (entry.statusCode) {
    if (entry.statusCode >= 200 && entry.statusCode < 400) {
      parts.push('✓ Online');
    } else {
      parts.push(`⚠️ Error (${entry.statusCode})`);
    }
  } else if (entry.statusCode === 0) {
    parts.push('⚠️ Unreachable');
  }

  if (entry.challengeProtected) {
    parts.push('🛡️ Cloudflare / Captcha Protected');
  }

  if (entry.dateLastUsed) {
    parts.push(`Last visited ${timeAgo(entry.dateLastUsed)}`);
  } else if (entry.dateAdded) {
    parts.push(`Added ${timeAgo(entry.dateAdded)}`);
  }

  if (entry.checkedAt) {
    parts.push(`Checked ${timeAgo(new Date(entry.checkedAt).getTime())}`);
  }

  if (parts.length === 0) return null;

  const el = document.createElement('div');
  el.className = 'result-meta';
  el.textContent = parts.join(' · ');
  return el;
}

function buildActionButtons(entry) {
  const row = document.createElement('div');
  row.className = 'result-actions';

  if (entry.issues.includes('redirect') && entry.newUrl) {
    const btn = makeButton('Update URL', 'btn-primary btn-sm', async () => {
      await applyFix(entry.id, 'updateUrl', entry.newUrl);
    });
    row.appendChild(btn);
  }

  if (entry.issues.includes('dead') || entry.issues.includes('domain_gone')) {
    const btn = makeButton('Delete Bookmark', 'btn-danger btn-sm', async () => {
      if (confirm(`Delete "${entry.title || entry.url}"?`)) {
        await applyFix(entry.id, 'delete');
      }
    });
    row.appendChild(btn);
  }

  // Dismiss always available (except already-dismissed)
  const dismiss = makeButton('Dismiss', 'btn-ghost btn-sm', async () => {
    await dismiss_(entry.id);
  });
  row.appendChild(dismiss);

  return row;
}

// ── Actions ───────────────────────────────────────────────────

async function applyFix(bookmarkId, fixType, newValue) {
  const result = await chrome.runtime.sendMessage({ action: 'applyHealthFix', bookmarkId, fixType, newValue });
  if (result && result.success) {
    await refreshResults();
  } else {
    alert('Could not apply fix: ' + (result ? result.error : 'Unknown error'));
  }
}

async function dismiss_(bookmarkId) {
  await chrome.runtime.sendMessage({ action: 'dismissHealthIssue', bookmarkId });
  await refreshResults();
}

async function bulkFix(fixType) {
  if (!currentResults) return;

  let ids = [];
  let confirmMsg = '';

  if (fixType === 'deleteAllDead') {
    ids = currentResults.results
      .filter(r => (r.issues.includes('dead') || r.issues.includes('domain_gone')) && !r.dismissed)
      .map(r => r.id);
    confirmMsg = `Delete ${ids.length} dead bookmarks? This cannot be undone.`;
  } else if (fixType === 'fixAllRedirects') {
    ids = currentResults.results
      .filter(r => r.issues.includes('redirect') && r.newUrl && !r.dismissed)
      .map(r => r.id);
    confirmMsg = `Update URL for ${ids.length} redirected bookmarks?`;
  }

  if (ids.length === 0) return;
  if (!confirm(confirmMsg)) return;

  await chrome.runtime.sendMessage({ action: 'applyBulkFix', fixType, ids });
  await refreshResults();
}

async function refreshResults() {
  const data = await chrome.runtime.sendMessage({ action: 'getHealthCheckData' });
  if (data.healthCheckResults) {
    currentResults = data.healthCheckResults;
    renderSummary(currentResults.summary, currentResults.lastRun);
    renderResults(currentResults.results);
  }
}

// ── Bulk action bar visibility ────────────────────────────────

function updateBulkBar(results) {
  if (currentFilter === 'duplicates') {
    const dupCount = cleanupPreviewData.duplicateBookmarks ? cleanupPreviewData.duplicateBookmarks.length : 0;
    const bulkDeleteDuplicates = document.getElementById('bulkDeleteDuplicates');
    if (bulkDeleteDuplicates) {
      bulkDeleteDuplicates.style.display = dupCount > 0 ? 'inline-block' : 'none';
      bulkDeleteDuplicates.textContent = `Delete all duplicates (${dupCount})`;
    }
    const bulkDeleteDead = document.getElementById('bulkDeleteDead');
    if (bulkDeleteDead) bulkDeleteDead.style.display = 'none';
    const bulkFixRedirects = document.getElementById('bulkFixRedirects');
    if (bulkFixRedirects) bulkFixRedirects.style.display = 'none';
    const bulkDeleteEmptyFolders = document.getElementById('bulkDeleteEmptyFolders');
    if (bulkDeleteEmptyFolders) bulkDeleteEmptyFolders.style.display = 'none';

    document.getElementById('bulkBar').style.display = dupCount > 0 ? 'flex' : 'none';
    return;
  }

  if (currentFilter === 'empty_folders') {
    const emptyCount = cleanupPreviewData.emptyFolders ? cleanupPreviewData.emptyFolders.length : 0;
    const bulkDeleteEmptyFolders = document.getElementById('bulkDeleteEmptyFolders');
    if (bulkDeleteEmptyFolders) {
      bulkDeleteEmptyFolders.style.display = emptyCount > 0 ? 'inline-block' : 'none';
      bulkDeleteEmptyFolders.textContent = `Delete all empty folders (${emptyCount})`;
    }
    const bulkDeleteDead = document.getElementById('bulkDeleteDead');
    if (bulkDeleteDead) bulkDeleteDead.style.display = 'none';
    const bulkFixRedirects = document.getElementById('bulkFixRedirects');
    if (bulkFixRedirects) bulkFixRedirects.style.display = 'none';
    const bulkDeleteDuplicates = document.getElementById('bulkDeleteDuplicates');
    if (bulkDeleteDuplicates) bulkDeleteDuplicates.style.display = 'none';

    document.getElementById('bulkBar').style.display = emptyCount > 0 ? 'flex' : 'none';
    return;
  }

  const bulkDeleteDuplicates = document.getElementById('bulkDeleteDuplicates');
  if (bulkDeleteDuplicates) bulkDeleteDuplicates.style.display = 'none';
  const bulkDeleteEmptyFolders = document.getElementById('bulkDeleteEmptyFolders');
  if (bulkDeleteEmptyFolders) bulkDeleteEmptyFolders.style.display = 'none';

  // Single pass accumulating every count, instead of separate .filter() scans.
  let deadCount = 0;
  let redirectCount = 0;

  for (const r of results || []) {
    if (r.dismissed) continue;
    if (r.issues.includes('dead') || r.issues.includes('domain_gone')) deadCount++;
    if (r.issues.includes('redirect') && r.newUrl) redirectCount++;
  }

  // Only show bulk actions relevant to the current filter
  const showDead = ['issues', 'dead'].includes(currentFilter) && deadCount > 1;
  const showRedirects = ['issues', 'redirect'].includes(currentFilter) && redirectCount > 1;

  const bulkDeleteDead = document.getElementById('bulkDeleteDead');
  const bulkFixRedirects = document.getElementById('bulkFixRedirects');

  if (bulkDeleteDead) {
    bulkDeleteDead.style.display = showDead ? 'inline-block' : 'none';
    bulkDeleteDead.textContent = `Delete all dead (${deadCount})`;
  }

  if (bulkFixRedirects) {
    bulkFixRedirects.style.display = showRedirects ? 'inline-block' : 'none';
    bulkFixRedirects.textContent = `Fix all redirects (${redirectCount})`;
  }

  const anyBulk = showDead || showRedirects;
  document.getElementById('bulkBar').style.display = anyBulk ? 'flex' : 'none';
}

// ── Empty states ──────────────────────────────────────────────

function renderEmptyState(type) {
  const list = document.getElementById('resultsList');
  list.textContent = '';
  document.getElementById('bulkBar').style.display = 'none';

  const el = document.createElement('div');
  el.className = 'empty-state';

  if (type === 'no-data') {
    el.innerHTML = '<div class="empty-icon">🔍</div><p>No health check has been run yet.<br>Click <strong>Run Health Check</strong> to scan your bookmarks.</p>';
  } else if (type === 'all-good') {
    el.innerHTML = '<div class="empty-icon">✅</div><p>All healthy bookmarks are shown here once you run a check.</p>';
  } else if (type === 'no-duplicates') {
    el.innerHTML = '<div class="empty-icon">✅</div><p>No duplicate bookmarks found across your folders.</p>';
  } else if (type === 'no-empty-folders') {
    el.innerHTML = '<div class="empty-icon">✅</div><p>No empty bookmark folders found.</p>';
  } else {
    el.innerHTML = '<div class="empty-icon">✅</div><p>No issues found in this category.</p>';
  }

  list.appendChild(el);
}

function showError(msg) {
  const list = document.getElementById('resultsList');
  list.textContent = '';
  const el = document.createElement('div');
  el.className = 'empty-state';
  const icon = document.createElement('div');
  icon.className = 'empty-icon';
  icon.textContent = '⚠️';
  const p = document.createElement('p');
  p.textContent = msg;
  el.appendChild(icon);
  el.appendChild(p);
  list.appendChild(el);
}

// ── Duplicate & Empty Folder Cards ────────────────────────────

function buildDuplicateCard(dup) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.id = dup.id;

  const header = document.createElement('div');
  header.className = 'result-header';

  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = dup.title || '(untitled)';
  header.appendChild(title);

  const badgeGroup = document.createElement('div');
  badgeGroup.style.display = 'flex';
  badgeGroup.style.gap = '4px';
  badgeGroup.style.flexShrink = '0';
  badgeGroup.appendChild(makeBadge('Duplicate', 'duplicate'));
  header.appendChild(badgeGroup);
  card.appendChild(header);

  const urlEl = document.createElement('a');
  urlEl.className = 'result-url';
  urlEl.href = dup.url;
  urlEl.target = '_blank';
  urlEl.rel = 'noopener noreferrer';
  urlEl.textContent = dup.url;
  card.appendChild(urlEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = `In folder: ${dup.path || 'Bookmarks Bar'}`;
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const delBtn = makeButton('Delete Duplicate', 'btn-danger btn-sm', async () => {
    await deleteDuplicateSingle(dup.id);
  });
  actions.appendChild(delBtn);
  card.appendChild(actions);

  return card;
}

function buildEmptyFolderCard(folder) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.id = folder.id;

  const header = document.createElement('div');
  header.className = 'result-header';

  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = `📁 ${folder.title || '(Untitled Folder)'}`;
  header.appendChild(title);

  const badgeGroup = document.createElement('div');
  badgeGroup.style.display = 'flex';
  badgeGroup.style.gap = '4px';
  badgeGroup.style.flexShrink = '0';
  badgeGroup.appendChild(makeBadge('Empty Folder', 'empty_folder'));
  header.appendChild(badgeGroup);
  card.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = `Path: ${folder.path || folder.title}`;
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const delBtn = makeButton('Delete Folder', 'btn-danger btn-sm', async () => {
    await deleteEmptyFolderSingle(folder.id);
  });
  actions.appendChild(delBtn);
  card.appendChild(actions);

  return card;
}

// ── Actions ───────────────────────────────────────────────────

async function deleteDuplicateSingle(id) {
  try {
    await chrome.bookmarks.remove(id);
    await loadCleanupData();
    renderResults(currentResults ? currentResults.results : []);
  } catch (error) {
    alert('Could not delete duplicate: ' + error.message);
  }
}

async function deleteEmptyFolderSingle(id) {
  const protectedIds = new Set(['0', 'root________', '1', '2', '3', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______', 'tags________']);
  if (protectedIds.has(String(id))) {
    alert('Built-in browser root folders cannot be deleted.');
    return;
  }
  try {
    await chrome.bookmarks.remove(id);
    await loadCleanupData();
    renderResults(currentResults ? currentResults.results : []);
  } catch (error) {
    alert('Could not delete folder: ' + error.message);
  }
}

async function bulkDeleteDuplicatesAction() {
  const count = cleanupPreviewData.duplicateBookmarks.length;
  if (count === 0) return;
  if (!confirm(`Delete ${count} duplicate bookmark${count === 1 ? '' : 's'}? The first instance of each bookmark will be preserved.`)) return;

  const btn = document.getElementById('bulkDeleteDuplicates');
  if (btn) btn.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      action: 'applyCleanup',
      options: { removeDuplicateBookmarks: true, removeEmptyFolders: false }
    });
    await loadCleanupData();
    renderResults(currentResults ? currentResults.results : []);
  } catch (error) {
    alert('Could not delete duplicates: ' + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function bulkDeleteEmptyFoldersAction() {
  const count = cleanupPreviewData.emptyFolders.length;
  if (count === 0) return;
  if (!confirm(`Delete ${count} empty folder${count === 1 ? '' : 's'}?`)) return;

  const btn = document.getElementById('bulkDeleteEmptyFolders');
  if (btn) btn.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      action: 'applyCleanup',
      options: { removeEmptyFolders: true, removeDuplicateBookmarks: false }
    });
    await loadCleanupData();
    renderResults(currentResults ? currentResults.results : []);
  } catch (error) {
    alert('Could not delete empty folders: ' + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function makeBadge(label, type) {
  const span = document.createElement('span');
  span.className = `badge badge-${type}`;
  span.textContent = label;
  return span;
}

function makeButton(label, classes, onClick) {
  const btn = document.createElement('button');
  btn.className = `btn ${classes}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function issueLabel(issue) {
  return {
    dead: 'Dead Link',
    domain_gone: 'Dead Link',
    redirect: 'Redirect',
    stale: 'Stale'
  }[issue] || issue;
}

function timeAgo(timestampMs) {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}yr ago`;
}


