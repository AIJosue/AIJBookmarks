const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const statusCard = document.getElementById('statusCard');
const statusSpinner = document.getElementById('statusSpinner');
const statusText = document.getElementById('statusText');
const resultsContainer = document.getElementById('resultsContainer');
const emptyState = document.getElementById('emptyState');

searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});

function showStatus(message, type = 'loading') {
  statusCard.className = 'status-card visible' + (type !== 'loading' ? ` ${type}` : '');
  statusSpinner.style.display = type === 'loading' ? '' : 'none';
  statusText.textContent = message;
}

function hideStatus() {
  statusCard.className = 'status-card';
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
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
  return `${years}y ago`;
}


function buildResultCard(entry) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const title = document.createElement('div');
  title.className = 'result-title';
  const link = document.createElement('a');
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = entry.title || entry.url;
  title.appendChild(link);
  card.appendChild(title);

  const url = document.createElement('div');
  url.className = 'result-url';
  url.textContent = entry.url;
  card.appendChild(url);

  const meta = document.createElement('div');
  meta.className = 'result-meta';

  if (entry.folderPath) {
    const folder = document.createElement('span');
    folder.className = 'result-folder';
    folder.textContent = entry.folderPath;
    meta.appendChild(folder);
  }

  if (entry.dateAdded) {
    const date = document.createElement('span');
    date.className = 'result-date';
    date.textContent = `Added ${timeAgo(entry.dateAdded)}`;
    meta.appendChild(date);
  }

  card.appendChild(meta);
  return card;
}

function renderResults(results, meta = {}) {
  resultsContainer.textContent = '';
  emptyState.classList.remove('visible');

  if (results.length === 0) {
    emptyState.classList.add('visible');
    return;
  }

  const header = document.createElement('div');
  header.className = 'results-header';
  const countText = `Found ${results.length} bookmark${results.length !== 1 ? 's' : ''}`;
  if (meta.gpuAccelerated && meta.gpuDurationMs != null) {
    header.innerHTML = `${countText} <span class="badge" style="font-size: 11px; margin-left: 8px; color: #1a73e8; background: #e8f0fe; padding: 2px 8px; border-radius: 4px; font-weight: 500;">⚡ WebGPU Compute (${meta.gpuDurationMs}ms)</span>`;
  } else {
    header.textContent = countText;
  }
  resultsContainer.appendChild(header);

  // Build off-DOM and append once instead of one reflow-triggering append per card.
  const fragment = document.createDocumentFragment();
  for (const entry of results) {
    fragment.appendChild(buildResultCard(entry));
  }
  resultsContainer.appendChild(fragment);
}

let hasAIConfigured = false;

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  resultsContainer.textContent = '';
  emptyState.classList.remove('visible');

  try {
    showStatus('Searching bookmarks\u2026');
    let result;

    if (hasAIConfigured) {
      result = await chrome.runtime.sendMessage({
        action: 'searchBookmarksSemantic',
        semanticIntent: query,
        excludeIds: []
      });
    } else {
      const keywords = query.split(/\s+/).filter(Boolean);
      result = await chrome.runtime.sendMessage({
        action: 'searchBookmarksLocal',
        keywords
      });
    }

    if (!result.success) throw new Error(result.error);

    renderResults(result.results, {
      gpuAccelerated: result.gpuAccelerated,
      gpuDurationMs: result.gpuDurationMs
    });
    hideStatus();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    searchBtn.disabled = false;
  }
}

async function init() {
  const result = await chrome.runtime.sendMessage({ action: 'checkAIConfig' });
  hasAIConfigured = Boolean(result && result.hasAI);
  if (!hasAIConfigured) {
    showStatus('Running in Local Fast Search Mode (Configure AI in Settings for semantic search).', 'info');
  }
}

(async () => {
  await init();
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q) {
    searchInput.value = q;
    await handleSearch();
  }
})();
