const USER_AGENT = 'Mozilla/5.0 (compatible; AIJbookmarks/1.0)';

// Browser bookmark root IDs differ between browsers (e.g. Chrome uses '0', '1', '2', '3'; Firefox uses 'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______')
let BOOKMARK_ROOT_IDS = { ROOT: '0', BAR: '1', OTHER: '2', MENU: 'menu________', MOBILE: '3' };

// Root IDs cannot change within a profile session, so the discovery call is memoised
// in a module-level promise — every caller within this service-worker lifetime shares
// the same in-flight/resolved lookup instead of re-fetching the whole tree.
let rootIdsPromise = null;

// ── Hoisted module-level state ──────────────────────────────────────────
// These let/const declarations are placed before any listener registration
// so that hoisted function declarations can reference them safely in
// Firefox's background-script execution model (avoids TDZ errors).
let parsedDomainRulesCache = { key: null, parsed: [] };

const BINARY_CONTEXT_STEPS = [
  4096,     // 4K
  8192,     // 8K
  16384,    // 16K
  32768,    // 32K
  65536,    // 64K
  131072,   // 128K
  262144,   // 256K
  524288,   // 512K
  1048576,  // 1M
  2097152   // 2M
];

const CHALLENGE_TITLE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /cloudflare/i,
  /security check/i,
  /security challenge/i,
  /verify you are human/i,
  /verify that you are human/i,
  /ddos protection/i,
  /robot check/i,
  /access denied/i,
  /checking your browser/i,
  /human verification/i,
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /bot verification/i,
  /shieldsquare/i,
  /imperva/i,
  /incapsula/i,
  /datadome/i,
  /akamai/i,
  /sucuri webproxy/i
];

const CHALLENGE_BODY_SIGNATURES = [
  'cf-chl-bypass',
  'cf-browser-verification',
  'challenges.cloudflare.com',
  'cf-turnstile',
  '__cf_chl_opt',
  'cf_chl_prog',
  'g-recaptcha',
  'hcaptcha.com',
  'recaptcha/api',
  'datadome.js',
  'akamai-bm',
  'px-captcha',
  'perimeterx',
  'cf-error-details',
  'ray id:',
  'verify you are a human',
  'verifying you are human',
  'enable javascript and cookies to continue'
];

const HOST_POLITENESS_MS = 150;

let batchAnalysisCancelled = false;

// Dynamically discover root IDs if they differ on this browser or profile
function initializeRootIds() {
  if (!rootIdsPromise) {
    rootIdsPromise = (async () => {
      try {
        const tree = await chrome.bookmarks.getTree();
        const rootNode = tree[0];
        if (rootNode) {
          BOOKMARK_ROOT_IDS.ROOT = String(rootNode.id);
          if (rootNode.children && rootNode.children.length > 0) {
            for (const child of rootNode.children) {
              const lowerTitle = (child.title || '').toLowerCase();
              const id = String(child.id);
              if (id === 'toolbar_____' || id === '1' || lowerTitle.includes('toolbar') || lowerTitle.includes('bar') || lowerTitle.includes('favorites')) {
                BOOKMARK_ROOT_IDS.BAR = id;
              } else if (id === 'unfiled_____' || id === '2' || lowerTitle.includes('unfiled') || (lowerTitle.includes('other') && !lowerTitle.includes('bar'))) {
                BOOKMARK_ROOT_IDS.OTHER = id;
              } else if (id === 'menu________' || id === 'menu_____' || lowerTitle.includes('menu')) {
                BOOKMARK_ROOT_IDS.MENU = id;
              } else if (id === 'mobile______' || id === 'mobile_____' || id === '3' || lowerTitle.includes('mobile')) {
                BOOKMARK_ROOT_IDS.MOBILE = id;
              }
            }
            // Fallback for BAR / OTHER if not identified by title/known ID
            if (!BOOKMARK_ROOT_IDS.BAR && rootNode.children[0]) {
              BOOKMARK_ROOT_IDS.BAR = String(rootNode.children[0].id);
            }
            if (!BOOKMARK_ROOT_IDS.OTHER && rootNode.children[1]) {
              BOOKMARK_ROOT_IDS.OTHER = String(rootNode.children[1].id);
            }
          }
        }
      } catch (err) {
        console.warn('Could not dynamically discover root folder IDs, using defaults:', err);
      }
    })();
  }
  return rootIdsPromise;
}

// Listen for messages from popup and health-check page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const actionsWithResponse = [
    'analyzeBookmark', 'runHealthCheck', 'getHealthCheckData', 'applyHealthFix',
    'applyBulkFix', 'dismissHealthIssue', 'setupHealthCheckAlarm', 'parseSearchQuery',
    'searchBookmarksLocal', 'searchBookmarksSemantic', 'checkAIConfig', 'undoBookmark',
    'getUnsortedBookmarks', 'getSortingScopeFolders', 'getExistingFolders', 'getAISuggestion', 'getAISuggestionsBatch', 'cancelBatchAnalysis', 'getFolderOrganizationData', 'generateFolderOrganizationPlan', 'applyFolderOrganizationPlan', 'getCleanupPreview', 'applyCleanup', 'moveBookmarks', 'deleteBookmarks',
    'getGpuStatus', 'gpuSearchBookmarks'
  ];

  if (!actionsWithResponse.includes(request.action)) {
    return false;
  }

  (async () => {
    try {
      switch (request.action) {
      case 'analyzeBookmark': {
        const res = await handleAnalyzeBookmark(request);
        sendResponse(res);
        break;
      }
      case 'runHealthCheck': {
        const res = await runHealthCheck();
        sendResponse(res);
        break;
      }
      case 'getHealthCheckData': {
        const data = await getHealthCheckData();
        sendResponse(data);
        break;
      }
      case 'applyHealthFix': {
        const res = await applyHealthFix(request.bookmarkId, request.fixType, request.newValue);
        sendResponse(res);
        break;
      }
      case 'applyBulkFix': {
        const res = await applyBulkFix(request.fixType, request.ids);
        sendResponse(res);
        break;
      }
      case 'dismissHealthIssue': {
        const res = await dismissHealthIssue(request.bookmarkId);
        sendResponse(res);
        break;
      }
      case 'setupHealthCheckAlarm': {
        await setupHealthCheckAlarm();
        sendResponse({ success: true });
        break;
      }
      case 'parseSearchQuery': {
        const res = await handleParseSearchQuery(request.query);
        sendResponse(res);
        break;
      }
      case 'searchBookmarksLocal': {
        const res = await handleLocalBookmarkSearch(request.keywords, request.dateRange);
        sendResponse(res);
        break;
      }
      case 'searchBookmarksSemantic': {
        const res = await handleSemanticBookmarkSearch(request.semanticIntent, request.excludeIds);
        sendResponse(res);
        break;
      }
      case 'checkAIConfig': {
        const { hasAI } = await getAIConfig();
        sendResponse({ hasAI });
        break;
      }
      case 'undoBookmark': {
        await chrome.bookmarks.remove(request.bookmarkId);
        sendResponse({ success: true });
        break;
      }
      case 'getUnsortedBookmarks': {
        const result = await getUnsortedBookmarks(request.scope);
        sendResponse({ success: true, ...result });
        break;
      }
      case 'getSortingScopeFolders': {
        const folders = await getSortingScopeFolders();
        sendResponse({ success: true, folders });
        break;
      }
      case 'getExistingFolders': {
        const folders = await getExistingBookmarkFolders();
        sendResponse({ success: true, folders });
        break;
      }
      case 'getAISuggestion': {
        const res = await handleGetAISuggestion(request);
        sendResponse(res);
        break;
      }
      case 'getAISuggestionsBatch': {
        const options = request.options || { allowCreateFolders: request.allowCreateFolders };
        const res = await handleGetAISuggestionsBatch(request.bookmarks, options);
        sendResponse(res);
        break;
      }
      case 'cancelBatchAnalysis': {
        batchAnalysisCancelled = true;
        sendResponse({ success: true });
        break;
      }
      case 'getFolderOrganizationData': {
        const res = await handleGetFolderOrganizationData();
        sendResponse(res);
        break;
      }
      case 'generateFolderOrganizationPlan': {
        const res = await handleGenerateFolderOrganizationPlan(request.folders, request.targetFolderCount);
        sendResponse(res);
        break;
      }
      case 'applyFolderOrganizationPlan': {
        const res = await handleApplyFolderOrganizationPlan(request.operations);
        sendResponse(res);
        break;
      }
      case 'getCleanupPreview': {
        const res = await handleGetCleanupPreview();
        sendResponse(res);
        break;
      }
      case 'applyCleanup': {
        const options = request.options || request || {};
        const res = await handleApplyCleanup(options);
        sendResponse(res);
        break;
      }
      case 'moveBookmarks': {
        const options = request.options || { allowCreateFolders: request.allowCreateFolders };
        const res = await handleMoveBookmarks(request.items, options);
        sendResponse(res);
        break;
      }
      case 'deleteBookmarks': {
        const res = await handleDeleteBookmarks(request.bookmarkIds);
        sendResponse(res);
        break;
      }
      case 'getGpuStatus': {
        const res = await handleGetGpuStatus();
        sendResponse(res);
        break;
      }
      case 'gpuSearchBookmarks': {
        const res = await handleLocalBookmarkSearch(request.keywords, request.dateRange, { forceGpu: true });
        sendResponse(res);
        break;
      }
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open for async response
});

/**
 * Access level initialization for chrome.storage.session
 */
if (chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
}

function getSessionStorage() {
  return chrome.storage?.session || chrome.storage?.local;
}

/**
 * Zero-copy ArrayBuffer encoding and transfer utilities.
 * Uses TextEncoder / TextDecoder to convert between strings/objects and ArrayBuffers
 * allowing ownership transfer across contexts without structured cloning overhead.
 */
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeToTransferableArrayBuffer(data) {
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
  const uint8 = textEncoder.encode(jsonString);
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

function decodeTransferableArrayBuffer(buffer) {
  if (!buffer) return null;
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const str = textDecoder.decode(uint8);
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * WebGPU Offscreen Architecture & VRAM Storage Management
 */
let isGpuIndexSynced = false;

async function handleGetGpuStatus() {
  try {
    const status = await initWebGPU();
    return { success: true, ...status };
  } catch (err) {
    return { success: false, supported: false, error: err.message };
  }
}

/**
 * 32-bit FNV-1a hash algorithm for tokenization
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Tokenizes a string into distinct 32-bit uint32 hashes
 */
function tokenizeToHashes(text, maxTokens = 8) {
  const hashes = new Uint32Array(maxTokens);
  if (!text) return hashes;
  const words = text.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  for (let i = 0; i < Math.min(maxTokens, words.length); i++) {
    hashes[i] = fnv1a32(words[i]);
  }
  return hashes;
}

/**
 * Packs full bookmark list into a dense ArrayBuffer for zero-copy GPU VRAM synchronization
 */
function packBookmarksForVram(bookmarks) {
  const count = bookmarks.length;
  // 16 uint32s per bookmark = 64 bytes
  const uint32Array = new Uint32Array(count * 16);

  for (let i = 0; i < count; i++) {
    const bm = bookmarks[i];
    const offset = i * 16;
    uint32Array[offset + 0] = parseInt(bm.id, 10) || (i + 1);
    uint32Array[offset + 1] = Math.floor((bm.dateAdded || 0) / 1000);

    const titleHashes = tokenizeToHashes(bm.title || '', 8);
    const urlClean = (bm.url || '').replace(/^https?:\/\/(www\.)?/, '');
    const urlHashes = tokenizeToHashes(urlClean, 4);

    uint32Array[offset + 2] = (bm.title || '').length;
    uint32Array[offset + 3] = (bm.url || '').length;

    for (let t = 0; t < 8; t++) {
      uint32Array[offset + 4 + t] = titleHashes[t];
    }
    for (let u = 0; u < 4; u++) {
      uint32Array[offset + 12 + u] = urlHashes[u];
    }
  }

  return { buffer: uint32Array.buffer, count };
}

/**
 * Cached traversal of the full bookmark tree. A single getTree() call derives
 * the folder-path list, an id -> folder-path map, and the flat list of bookmark
 * leaf nodes together, so callers that used to each do their own full-tree read
 * (getExistingBookmarkFolders, getFolderPathMap, getAllBookmarks) now share one.
 * The cache is invalidated by the chrome.bookmarks.on* listeners registered below
 * whenever the tree structure actually changes.
 * @returns {Promise<{folders: string[], folderPathMap: Object<string,string>, allBookmarks: chrome.bookmarks.BookmarkTreeNode[]}>}
 */
let bookmarkTreeDataPromise = null;

function invalidateBookmarkTreeCache() {
  bookmarkTreeDataPromise = null;
  isGpuIndexSynced = false;
  if (chrome.storage?.session) {
    chrome.storage.session.remove(['cachedFolders', 'cachedFolderPathMap']).catch(() => {});
  }
}

function getBookmarkTreeData() {
  if (!bookmarkTreeDataPromise) {
    bookmarkTreeDataPromise = computeBookmarkTreeData();
  }
  return bookmarkTreeDataPromise;
}

async function computeBookmarkTreeData() {
  await initializeRootIds();
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const folderPathMap = {
    [BOOKMARK_ROOT_IDS.BAR]: 'Bookmarks Bar',
    [BOOKMARK_ROOT_IDS.OTHER]: 'Other Bookmarks',
    [BOOKMARK_ROOT_IDS.MENU]: 'Bookmarks Menu',
    [BOOKMARK_ROOT_IDS.MOBILE]: 'Mobile Bookmarks',
    '1': 'Bookmarks Bar',
    '2': 'Other Bookmarks',
    '3': 'Mobile Bookmarks',
    'toolbar_____': 'Bookmarks Toolbar',
    'unfiled_____': 'Other Bookmarks',
    'menu________': 'Bookmarks Menu',
    'mobile______': 'Mobile Bookmarks'
  };
  const allBookmarks = [];
  const rootIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT), String(BOOKMARK_ROOT_IDS.BAR),
    String(BOOKMARK_ROOT_IDS.OTHER), String(BOOKMARK_ROOT_IDS.MENU),
    String(BOOKMARK_ROOT_IDS.MOBILE),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));

  function traverse(nodes, path = '') {
    for (const node of nodes || []) {
      // Bookmarks (have a url) are leaves — collect them and move on
      if (node.url) {
        allBookmarks.push(node);
        continue;
      }

      const nodeId = String(node.id || '');
      const parentId = node.parentId != null ? String(node.parentId) : null;

      // Skip root containers (Root, Bookmarks Bar, Other Bookmarks, Bookmarks Menu, Mobile)
      // but process their children
      if (parentId == null || parentId === '0' || parentId === 'root________' || parentId === BOOKMARK_ROOT_IDS.ROOT || rootIds.has(nodeId)) {
        if (node.children) {
          traverse(node.children, '');
        }
        continue;
      }

      // Build the current path
      const currentPath = path ? `${path}/${node.title}` : node.title;

      if (node.title) {
        folders.push(currentPath);
        folderPathMap[node.id] = currentPath;
      }

      // Recursively process children
      if (node.children) {
        traverse(node.children, currentPath);
      }
    }
  }

  traverse(tree);
  return { folders, folderPathMap, allBookmarks };
}

// Registered at the top level (not inside a function) so these fire for the whole
// service-worker lifetime. All state above is pure derived state, so a cold rebuild
// on the next call after a service-worker restart is correct — no persistence needed.
chrome.bookmarks.onCreated.addListener(invalidateBookmarkTreeCache);
chrome.bookmarks.onRemoved.addListener(invalidateBookmarkTreeCache);
chrome.bookmarks.onChanged.addListener(invalidateBookmarkTreeCache);
chrome.bookmarks.onMoved.addListener(invalidateBookmarkTreeCache);
chrome.bookmarks.onChildrenReordered.addListener(invalidateBookmarkTreeCache);

/**
 * Scans the user's bookmark tree and extracts all folder paths
 * @returns {Promise<string[]>} Array of folder paths (e.g., "Work/Projects/Web")
 */
async function getExistingBookmarkFolders() {
  const { folders } = await getBookmarkTreeData();
  return folders;
}

/**
 * Determines if a URL is restricted from being fetched directly by Chrome extension policies.
 * Chrome blocks extension service workers and pages from fetching internal schemes (chrome://, about:)
 * and official store domains (chromewebstore.google.com, chrome.google.com) with CORS blocks.
 */
function isRestrictedExtensionUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'edge:', 'view-source:', 'data:', 'javascript:', 'file:'].includes(protocol)) {
      return true;
    }

    if (hostname === 'chromewebstore.google.com' ||
        hostname === 'chrome.google.com' ||
        hostname === 'microsoftedge.microsoft.com' ||
        hostname === 'addons.mozilla.org') {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Fetches a URL with a timeout, returning null (instead of throwing) on any network
 * failure so callers can decide whether to fall back to a different method.
 */
async function fetchWithTimeout(url, method, timeoutMs) {
  if (isRestrictedExtensionUrl(url)) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cancels/drains a response body we don't intend to read, so the connection is
 * released instead of left open and unread.
 */
function abortResponseBody(response) {
  if (response && response.body) {
    response.body.cancel().catch(() => {});
  }
}

/**
 * Reads a response body up to `maxChars` decoded characters, then cancels the reader
 * — which propagates to abort the underlying transfer — instead of downloading and
 * decoding a response that may be many times larger than what's actually used.
 * @param {Response} response
 * @param {number} maxChars
 * @returns {Promise<string>}
 */
async function readTextUpTo(response, maxChars) {
  if (!response.body) {
    // Environments without a streamable body fall back to a full read.
    const text = await response.text();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  const reader = response.body.getReader();
  let text = '';

  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      text += textDecoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Fetches the HTML content of a URL for analysis. Streams the response and stops
 * reading — aborting the rest of the transfer — as soon as `maxChars` characters
 * have been decoded, instead of downloading a whole (possibly multi-MB) page for a
 * few KB of prompt content.
 */
async function fetchHtmlContent(url, maxChars = 8000) {
  console.log(`Fetching HTML content for: ${url}`);
  const response = await fetchWithTimeout(url, 'GET', 10000);
  if (!response) {
    console.error('Error fetching HTML: request failed or timed out');
    return null;
  }

  if (!response.ok) {
    console.error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    abortResponseBody(response);
    return null;
  }

  try {
    return await readTextUpTo(response, maxChars);
  } catch (error) {
    console.error('Error fetching HTML:', error);
    return null;
  }
}

/**
 * Calls the configured AI provider and returns the raw response text.
 * @param {string} prompt - The prompt to send
 * @param {object} settings - User settings from chrome.storage.sync
 * @param {string} provider - 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'google-cloud'
 * @param {number} [maxTokens=1024] - Maximum tokens in response
 * @returns {Promise<string>} Raw response text from the AI
 */
/**
 * Calls the configured AI provider with stats (tokens and duration).
 * @param {string} prompt
 * @param {object} settings
 * @param {string} provider
 * @param {number} [maxTokens=1024]
 * @returns {Promise<{responseText: string, inputTokens: number, outputTokens: number, durationMs: number}>}
 */
async function callAIWithStats(prompt, settings, provider, maxTokens = 1024) {
  function formatProviderApiError(activeProvider, status, errorText) {
    if (activeProvider === 'gemini' && status === 429) {
      return 'Gemini quota/rate limit reached (HTTP 429). Try again in a minute, reduce analyze batch size, switch provider/model, or raise Gemini quota.';
    }
    const compact = String(errorText || '').replace(/\s+/g, ' ').trim();
    const short = compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
    const providerName = activeProvider === 'anthropic' ? 'Anthropic' : activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1);
    return `${providerName} API error: ${status}${short ? ` - ${short}` : ''}`;
  }

  function normalizeGeminiModel(model) {
    const normalized = (model || '').replace(/^models\//, '');
    if (!normalized || normalized === 'gemini-3.7-flash') {
      return 'gemini-3.6-flash';
    }
    return normalized;
  }

  // Gemini, Google Cloud, or custom/local OpenAI endpoints can take longer
  const isCustomOpenAI = provider === 'openai' && Boolean(settings.openaiBaseUrl && !settings.openaiBaseUrl.includes('api.openai.com'));
  const TIMEOUT_MS = (provider === 'gemini' || provider === 'google-cloud' || isCustomOpenAI) ? 120000 : 35000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startTime = Date.now();

  try {
    if (provider === 'openai') {
      const rawBaseUrl = settings.openaiBaseUrl || 'https://api.openai.com/v1';
      const isCustomEndpoint = Boolean(rawBaseUrl && !rawBaseUrl.includes('api.openai.com'));
      if (!isCustomEndpoint && (!settings.openaiApiKey || !settings.openaiApiKey.trim())) {
        throw new Error('OpenAI API key is not configured. Please open Extension Settings to enter your API key.');
      }
      let response;
      try {
        const baseUrl = rawBaseUrl.replace(/\/+$/, '');
        const openaiModel = settings.openaiCustomModel?.trim() || settings.openaiModel || '';
        const requestBody = {
          model: openaiModel,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        };
        // Disable reasoning/thinking for reasoning models
        if (openaiModel.startsWith('o1') || openaiModel.startsWith('o3') || openaiModel.startsWith('o4')) {
          requestBody.reasoning_effort = 'low';
        }

        const headers = {
          'Content-Type': 'application/json'
        };
        if (settings.openaiApiKey && settings.openaiApiKey.trim()) {
          headers['Authorization'] = `Bearer ${settings.openaiApiKey.trim()}`;
        }

        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } catch (error) {
        console.error('Error calling OpenAI / Compatible API:', error);
        throw new Error(`Failed to call OpenAI API (${settings.openaiBaseUrl || 'https://api.openai.com/v1'}): ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API error:', response.status, errorText);
        throw new Error(formatProviderApiError('openai', response.status, errorText));
      }

      const message = await response.json();
      const responseText = message.choices?.[0]?.message?.content;
      if (!responseText) {
        console.error('No content in OpenAI response:', JSON.stringify(message));
        throw new Error('No content in OpenAI response');
      }
      const inputTokens = message.usage?.prompt_tokens ?? estimateTokensFromText(prompt);
      const outputTokens = message.usage?.completion_tokens ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else if (provider === 'openrouter') {
      if (!settings.openrouterApiKey || !settings.openrouterApiKey.trim()) {
        throw new Error('OpenRouter API key is not configured. Please open Extension Settings to enter your API key.');
      }
      if (!settings.openrouterModel || !settings.openrouterModel.trim()) {
        throw new Error('OpenRouter model is not selected. Please open Extension Settings to choose a model.');
      }
      let response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openrouterApiKey}`,
            'HTTP-Referer': 'https://github.com/aijbookmarks',
            'X-Title': 'AIJbookmarks'
          },
          body: JSON.stringify({
            model: settings.openrouterModel,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
            reasoning: {
              max_tokens: 0
            }
          }),
          signal: controller.signal
        });
      } catch (error) {
        console.error('Error calling OpenRouter API:', error);
        throw new Error(`Failed to call OpenRouter API: ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouter API error:', response.status, errorText);
        throw new Error(formatProviderApiError('openrouter', response.status, errorText));
      }

      const message = await response.json();
      const responseText = message.choices?.[0]?.message?.content;
      if (!responseText) {
        console.error('No content in OpenRouter response:', JSON.stringify(message));
        throw new Error('No content in OpenRouter response');
      }
      const inputTokens = message.usage?.prompt_tokens ?? estimateTokensFromText(prompt);
      const outputTokens = message.usage?.completion_tokens ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else if (provider === 'google-cloud') {
      let response;
      try {
        const model = String(settings.googleCloudModel || 'gemini-3.7-flash').replace(/^models\//, '');
        const rawApiKey = typeof settings.googleCloudApiKey === 'string' ? settings.googleCloudApiKey.trim() : '';
        if (!rawApiKey) {
          throw new Error('Google Cloud API key not configured. Please configure it in Extension Settings.');
        }
        response = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': rawApiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              maxOutputTokens: maxTokens,
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingBudget: 0
              }
            }
          }),
          signal: controller.signal
        });

        if (!response.ok && response.status === 400) {
          const errorText = await response.clone().text();
          if (errorText.includes('thinkingConfig') || errorText.includes('thinking_config') || errorText.includes('thinkingBudget')) {
            response = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': rawApiKey
              },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: maxTokens,
                  responseMimeType: 'application/json'
                }
              }),
              signal: controller.signal
            });
          }
        }
      } catch (error) {
        console.error('Error calling Google Cloud API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`Google Cloud API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds. Try a smaller batch or a faster model.`);
        }
        throw new Error(`Failed to call Google Cloud API: ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Cloud API error:', response.status, errorText);
        throw new Error(formatProviderApiError('google-cloud', response.status, errorText));
      }

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        console.error('No content in Google Cloud response:', JSON.stringify(data));
        throw new Error('No content in Google Cloud response');
      }
      const inputTokens = data.usageMetadata?.promptTokenCount ?? estimateTokensFromText(prompt);
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else if (provider === 'gemini') {
      const geminiKey = typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '';
      if (!geminiKey) {
        throw new Error('Gemini API key not configured. Please configure it in Extension Settings.');
      }
      const rawModel = normalizeGeminiModel(settings.geminiModel);
      const geminiModels = [rawModel, 'gemini-3.6-flash', 'gemini-1.5-flash'].filter(Boolean);
      const uniqueGeminiModels = [...new Set(geminiModels)];

      let response = null;
      let lastErrorText = '';
      for (const model of uniqueGeminiModels) {
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': geminiKey
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                maxOutputTokens: maxTokens,
                thinkingConfig: { thinkingBudget: 0 }
              }
            }),
            signal: controller.signal
          });

          if (!response.ok && response.status === 400) {
            const errorText = await response.clone().text();
            if (errorText.includes('thinkingConfig') || errorText.includes('thinking_config') || errorText.includes('thinkingBudget')) {
              response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': geminiKey
                },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { maxOutputTokens: maxTokens }
                }),
                signal: controller.signal
              });
            }
          }

          if (response.ok) break;
          lastErrorText = await response.text();
          if (response.status !== 404) break;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          lastErrorText = error.message;
        }
      }

      if (!response || !response.ok) {
        console.error('Gemini API error:', response?.status, lastErrorText);
        throw new Error(formatProviderApiError('gemini', response?.status || 500, lastErrorText));
      }

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        console.error('No content in Gemini response:', JSON.stringify(data));
        throw new Error('No content in Gemini response');
      }
      const inputTokens = data.usageMetadata?.promptTokenCount ?? estimateTokensFromText(prompt);
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else {
      if (!settings.anthropicApiKey || !settings.anthropicApiKey.trim()) {
        throw new Error('Anthropic Claude API key is not configured. Please open Extension Settings to enter your API key.');
      }
      const anthropicModels = [
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20241022',
        'claude-haiku-4-5-20251001'
      ];
      let response = null;
      let lastErrorText = '';
      for (const anthropicModel of anthropicModels) {
        try {
          response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': settings.anthropicApiKey.trim(),
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: anthropicModel,
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }]
            }),
            signal: controller.signal
          });
          if (response.ok) break;
          lastErrorText = await response.text();
          if (response.status !== 404 && response.status !== 400) break;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          lastErrorText = error.message;
        }
      }

      if (!response || !response.ok) {
        console.error('Anthropic API error:', response?.status, lastErrorText);
        throw new Error(formatProviderApiError('anthropic', response?.status || 500, lastErrorText));
      }

      const message = await response.json();
      const textContent = message.content?.find(block => block.type === 'text');
      if (!textContent) {
        console.error('No text content in Claude response. Response:', JSON.stringify(message.content));
        throw new Error('No text content in Claude response');
      }
      const responseText = textContent.text;
      const inputTokens = message.usage?.input_tokens ?? estimateTokensFromText(prompt);
      const outputTokens = message.usage?.output_tokens ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function callAI(prompt, settings, provider, maxTokens = 1024) {
  const { responseText } = await callAIWithStats(prompt, settings, provider, maxTokens);
  return responseText;
}

/**
 * Analyzes a bookmark URL using the configured AI provider
 */
async function analyzeBookmark(url, settings, provider, providedTitle) {
  // Fetch HTML content if no title was provided
  let htmlContent = null;
  if (!providedTitle) {
    // fetchHtmlContent already stops downloading once it has this many characters,
    // to keep token usage reasonable without paying for a full-page transfer.
    const HTML_CHAR_LIMIT = 8000;
    htmlContent = await fetchHtmlContent(url, HTML_CHAR_LIMIT);
    if (htmlContent && htmlContent.length >= HTML_CHAR_LIMIT) {
      htmlContent += '\n... [content truncated]';
    }
  }

  // Get the user's existing bookmark folders
  const existingFolders = await getExistingBookmarkFolders();
  console.log('Found existing bookmark folders:', existingFolders.length);

  // Build the category matching section of the prompt
  let categorySection = '';
  if (existingFolders.length > 0) {
    // Limit folders passed to the AI to prevent excessive context size or request timeouts
    let foldersToSuggest = existingFolders;
    if (foldersToSuggest.length > 100) {
      foldersToSuggest = foldersToSuggest.slice(0, 100);
    }
    categorySection = `
Additionally, if this is NOT an article, you MUST match it to exactly ONE category - the single best match from the user's existing bookmark folders:
${foldersToSuggest.join('\n')}

IMPORTANT: Return ONLY ONE category path that best matches the URL content. Use the EXACT path from the list above. If none of the existing folders are appropriate, you may suggest a new folder name.`;
  } else {
    categorySection = `
Additionally, if this is NOT an article, suggest a category path for organizing this bookmark (e.g., "Work/Development/Tools" or "Personal/Finance").`;
  }

  const prompt = `Analyze this bookmark and provide:
1. Whether this is a web article/blog post (true) or something else like a tool, homepage, documentation, etc. (false)
2. What type of content this is (e.g., "article", "tool", "documentation", "homepage", "video", "repository", etc.)
3. The title of the page${providedTitle ? ` (the provided title is: "${providedTitle}")` : ' - extract this from the HTML content (check meta tags like og:title, twitter:title, or the <title> tag)'}
4. A brief summary (1-2 sentences) of what the page is about
5. 2-3 relevant categories or tags

URL: ${url}
${htmlContent ? `\nHTML Content (first 8000 chars):\n${htmlContent}` : ''}

${!url.includes('article') && !url.includes('blog') && !url.includes('post') ? categorySection : ''}

Please respond in JSON format:
{
  "isArticle": true or false,
  "contentType": "article" or "tool" or "documentation" etc.,
  "title": "Title here",
  "summary": "Summary here",
  "categories": ["category1", "category2", "category3"],
  "matchedCategory": "Single/Best/Category/Path" (REQUIRED if not an article - return only ONE category)
}`;

  const responseText = await callAI(prompt, settings, provider);

  // Parse the JSON response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Could not find JSON in AI response. Response text:', responseText);
    throw new Error('Could not find JSON in AI response');
  }

  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Error parsing JSON from AI response:', error);
    console.error('JSON string:', jsonMatch[0]);
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }

  // If not an article and no matched category, set to "Other"
  if (!result.isArticle && !result.matchedCategory) {
    result.matchedCategory = 'Other';
  }

  return result;
}

/**
 * Saves an article to Instapaper using the Simple API
 */
async function saveToInstapaper(url, title, username, password) {
  const instapaperUrl = 'https://www.instapaper.com/api/add';

  // Prepare the request body
  const params = new URLSearchParams({
    url: url,
    title: title
  });

  // Use HTTP Basic Authentication
  const auth = btoa(`${username}:${password}`);

  try {
    console.log(`Saving to Instapaper: ${url}`);
    const response = await fetch(instapaperUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      },
      body: params.toString()
    });

    if (response.status === 201) {
      // Successfully created
      const bookmarkId = parseInt(await response.text(), 10);
      return { success: true, bookmarkId };
    } else if (response.status === 200) {
      // Already exists
      return { success: true };
    } else if (response.status === 403) {
      return { success: false, error: 'Invalid Instapaper credentials' };
    } else if (response.status === 400) {
      return { success: false, error: 'Invalid request parameters' };
    } else if (response.status === 500) {
      return { success: false, error: 'Instapaper service error' };
    } else {
      return { success: false, error: `Unexpected status: ${response.status}` };
    }
  } catch (error) {
    console.error('Error saving to Instapaper:', error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Creates a task in Todoist using the REST API v1
 */
async function createTodoistTask(url, title, summary, apiToken) {
  const todoistUrl = 'https://api.todoist.com/api/v1/tasks';

  // Create task content with URL and summary
  const taskContent = `${title}\n${url}\n\n${summary}`;

  try {
    console.log(`Creating Todoist task: ${title}`);
    const response = await fetch(todoistUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        content: taskContent
      })
    });

    if (response.ok) {
      // Successfully created
      const taskData = await response.json();
      return { success: true, taskId: taskData.id };
    } else if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Invalid Todoist API token' };
    } else if (response.status === 400) {
      return { success: false, error: 'Invalid request parameters' };
    } else {
      const errorText = await response.text();
      return { success: false, error: `Unexpected status: ${response.status} - ${errorText}` };
    }
  } catch (error) {
    console.error('Error creating Todoist task:', error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Saves a URL to Readwise Reader via the v3 Save API.
 * @see https://readwise.io/reader_api
 */
async function saveToReadwise(url, title, accessToken) {
  try {
    const response = await fetch('https://readwise.io/api/v3/save/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${accessToken}`
      },
      body: JSON.stringify({ url, title })
    });
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      return { success: false, error: 'Invalid Readwise access token' };
    } else {
      const text = await response.text();
      return { success: false, error: `Readwise error: ${response.status} - ${text}` };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Saves a URL to Raindrop.io via the REST API.
 * @see https://developer.raindrop.io/v1/raindrops/single#create-raindrop
 */
async function saveToRaindrop(url, title, tags, accessToken) {
  try {
    const body = { link: url, title: title || url };
    if (tags && tags.length > 0) body.tags = tags;
    const response = await fetch('https://api.raindrop.io/rest/v1/raindrop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      return { success: false, error: 'Invalid Raindrop.io access token' };
    } else {
      const text = await response.text();
      return { success: false, error: `Raindrop.io error: ${response.status} - ${text}` };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Opens the Things app (macOS/iOS) to add a to-do via URL scheme.
 * Uses things:///add?title=...&notes=... (no API token required).
 * @see https://culturedcode.com/things/help/url-scheme/
 */
async function addToThings(url, title, summary) {
  const notes = [url, summary].filter(Boolean).join('\n\n');
  const titleEncoded = encodeURIComponent(title || 'Bookmark');
  const notesEncoded = encodeURIComponent(notes);
  const thingsUrl = `things:///add?title=${titleEncoded}&notes=${notesEncoded}`;

  try {
    await chrome.tabs.create({ url: thingsUrl });
    return { success: true };
  } catch (error) {
    console.error('Error opening Things:', error);
    return { success: false, error: error.message || 'Could not open Things' };
  }
}

/**
 * Checks whether a bookmark with the given URL already exists
 * @param {string} url
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode|null>} The existing bookmark, or null
 */
async function findDuplicateBookmark(url) {
  const results = await chrome.bookmarks.search({ url });
  return results.length > 0 ? results[0] : null;
}

async function handleAnalyzeBookmark({ url, title, saveToInstapaper: saveToInstapaperOption, createTodoist, createThings, autoBookmark, saveToReadwise: saveToReadwiseOption, saveToRaindrop: saveToRaindropOption }) {
  try {
    // Duplicate detection — check before calling AI
    const duplicate = await findDuplicateBookmark(url);
    if (duplicate) {
      return {
        success: false,
        error: `Already bookmarked as "${duplicate.title}".`
      };
    }

    // Get settings from storage
    const settings = await chrome.storage.sync.get({
      aiProvider: 'anthropic',
      anthropicApiKey: '',
      openaiApiKey: '',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: "",
      openaiCustomModel: '',
      openrouterApiKey: '',
      openrouterModel: '',
      geminiApiKey: '',
      geminiModel: 'gemini-3.6-flash',
      googleCloudApiKey: '',
      googleCloudModel: 'gemini-3.7-flash',
      instapaperUsername: '',
      instapaperPassword: '',
      todoistApiToken: '',
      domainRules: [],
      readwiseEnabled: false,
      readwiseAccessToken: '',
      raindropEnabled: false,
      raindropAccessToken: ''
    });

    const provider = settings.aiProvider || 'anthropic';

    // Validate AI provider credentials are configured
    if (provider === 'openai') {
      const isCustomEndpoint = Boolean(settings.openaiBaseUrl && !settings.openaiBaseUrl.includes('api.openai.com'));
      if (!isCustomEndpoint && (!settings.openaiApiKey || settings.openaiApiKey.trim() === '')) {
        throw new Error('OpenAI API key not configured. Please configure it in Extension Settings.');
      }
    } else if (provider === 'openrouter') {
      if (!settings.openrouterApiKey || settings.openrouterApiKey.trim() === '') {
        throw new Error('OpenRouter API key not configured. Please configure it in Extension Settings.');
      }
      if (!settings.openrouterModel || settings.openrouterModel.trim() === '') {
        throw new Error('OpenRouter model not selected. Please select a model in Extension Settings.');
      }
    } else if (provider === 'gemini') {
      if (!settings.geminiApiKey || settings.geminiApiKey.trim() === '') {
        throw new Error('Gemini API key not configured. Please configure it in Extension Settings.');
      }
    } else if (provider === 'google-cloud') {
      if (!settings.googleCloudApiKey || settings.googleCloudApiKey.trim() === '') {
        throw new Error('Google Cloud API key not configured. Please configure it in Extension Settings.');
      }
    } else {
      if (!settings.anthropicApiKey || settings.anthropicApiKey.trim() === '') {
        throw new Error('Anthropic API key not configured. Please configure it in Extension Settings.');
      }
    }

    // Check domain rules before calling AI
    const ruleFolder = matchesDomainRule(url, settings.domainRules || []);

    // Analyze the bookmark using the configured AI provider (or use domain rule)
    const analysis = ruleFolder
      ? { isArticle: false, contentType: 'page', title: title || url, summary: '', categories: [], matchedCategory: ruleFolder }
      : await analyzeBookmark(url, settings, provider, title);

    // Fire all integrations concurrently — they are fully independent
    const [instapaperResult, todoistResult, thingsResult, readwiseResult, raindropResult] = await Promise.all([
      (saveToInstapaperOption && analysis.isArticle && settings.instapaperUsername && settings.instapaperPassword)
        ? saveToInstapaper(url, analysis.title, settings.instapaperUsername, settings.instapaperPassword)
        : null,
      (createTodoist && settings.todoistApiToken)
        ? createTodoistTask(url, analysis.title, analysis.summary, settings.todoistApiToken)
        : null,
      createThings
        ? addToThings(url, analysis.title, analysis.summary)
        : null,
      (saveToReadwiseOption && settings.readwiseEnabled && settings.readwiseAccessToken)
        ? saveToReadwise(url, analysis.title, settings.readwiseAccessToken)
        : null,
      (saveToRaindropOption && settings.raindropEnabled && settings.raindropAccessToken)
        ? saveToRaindrop(url, analysis.title, analysis.categories, settings.raindropAccessToken)
        : null
    ]);

    let bookmarkCreated = false;
    let bookmarkId = null;

    // If auto-bookmark is enabled and it's not an article, create the bookmark
    // Articles are saved to Instapaper instead of Chrome bookmarks
    if (autoBookmark && !analysis.isArticle) {
      const categoryPath = analysis.matchedCategory || 'Other';
      bookmarkId = await createBookmarkInCategory(url, analysis.title || title, categoryPath);
      bookmarkCreated = true;
    }

    return {
      success: true,
      data: {
        url: url,
        isArticle: analysis.isArticle,
        contentType: analysis.contentType,
        title: analysis.title,
        summary: analysis.summary,
        categories: analysis.categories,
        matchedCategory: analysis.matchedCategory,
        instapaper: instapaperResult ? {
          saved: instapaperResult.success,
          bookmarkId: instapaperResult.bookmarkId,
          error: instapaperResult.error
        } : null,
        todoist: todoistResult ? {
          created: todoistResult.success,
          taskId: todoistResult.taskId,
          error: todoistResult.error
        } : null,
        things: thingsResult ? {
          opened: thingsResult.success,
          error: thingsResult.error
        } : null,
        readwise: readwiseResult ? {
          saved: readwiseResult.success,
          error: readwiseResult.error
        } : null,
        raindrop: raindropResult ? {
          saved: raindropResult.success,
          error: raindropResult.error
        } : null,
        bookmarkCreated: bookmarkCreated,
        chromeBookmarkId: bookmarkId,
        analyzedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Error analyzing bookmark:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Creates a bookmark in the specified category path
 * @param {string} url - The URL to bookmark
 * @param {string} title - The bookmark title
 * @param {string} categoryPath - The category path (e.g., "Work/Projects/Web")
 * @returns {Promise<string>} The created bookmark ID
 */
/**
 * Walks (and creates if needed) the folder hierarchy for categoryPath,
 * returning the ID of the deepest folder.
 * Supports choosing a base target parent folder/location and restricting recursive multi-level nesting.
 * @param {string} categoryPath
 * @param {object} [options]
 * @param {string} [options.newFolderLocation='root-bar']
 * @param {boolean} [options.allowRecursive=true]
 * @returns {Promise<string>}
 */
async function ensureFolderPath(categoryPath, options = {}) {
  await initializeRootIds();
  const allowRecursive = options.allowRecursive !== false;
  const targetLoc = options.newFolderLocation || 'root-bar';

  let baseParentId = BOOKMARK_ROOT_IDS.BAR;
  if (targetLoc === 'root-other' || targetLoc === BOOKMARK_ROOT_IDS.OTHER) {
    baseParentId = BOOKMARK_ROOT_IDS.OTHER;
  } else if (targetLoc === 'root-menu' || targetLoc === BOOKMARK_ROOT_IDS.MENU) {
    baseParentId = BOOKMARK_ROOT_IDS.MENU || BOOKMARK_ROOT_IDS.BAR;
  } else if (targetLoc && targetLoc !== 'root-bar' && targetLoc !== BOOKMARK_ROOT_IDS.BAR) {
    try {
      const [existingNode] = await chrome.bookmarks.get(String(targetLoc));
      if (existingNode && !existingNode.url) {
        baseParentId = String(existingNode.id);
      }
    } catch {
      baseParentId = BOOKMARK_ROOT_IDS.BAR;
    }
  }

  let segments = String(categoryPath || '').split('/').map(c => c.trim()).filter(c => c.length > 0);
  if (segments.length === 0) {
    return baseParentId;
  }

  // If recursive subfolder creation is disabled, only allow 1 level of new subfolder
  if (!allowRecursive && segments.length > 1) {
    segments = [segments[0]];
  }

  let parentId = baseParentId;
  for (const segment of segments) {
    const folder = await getOrCreateFolder(segment, parentId);
    parentId = folder.id;
  }
  return parentId;
}

async function createBookmarkInCategory(url, title, categoryPath) {
  const parentId = await ensureFolderPath(categoryPath);
  const bookmark = await chrome.bookmarks.create({ parentId, title, url });
  return bookmark.id;
}

/**
 * Finds an existing folder ID for the given categoryPath without creating any new folders.
 * Checks for exact path match, case-insensitive match, root prefixes, and parent path fallback.
 * @param {string} categoryPath
 * @returns {Promise<string>} The resolved existing folder ID
 */
async function findExistingFolderId(categoryPath) {
  await initializeRootIds();
  const rawPath = String(categoryPath || '').trim();
  if (!rawPath) return BOOKMARK_ROOT_IDS.BAR;

  const { folderPathMap } = await getBookmarkTreeData();

  // Check if rawPath is already a valid existing folder ID directly
  if (folderPathMap[rawPath] || rawPath === BOOKMARK_ROOT_IDS.BAR || rawPath === BOOKMARK_ROOT_IDS.OTHER || rawPath === BOOKMARK_ROOT_IDS.MENU || rawPath === BOOKMARK_ROOT_IDS.MOBILE) {
    return rawPath;
  }

  // Build normalized lookup maps: normalizedPath -> folderId
  const normalizedMap = new Map();
  for (const [id, path] of Object.entries(folderPathMap)) {
    normalizedMap.set(path.trim().toLowerCase(), id);
  }

  // Strip leading/trailing slashes
  const cleanPath = rawPath.replace(/^\/+|\/+$/g, '').trim();
  const lowerClean = cleanPath.toLowerCase();

  // Direct check or lowercase check
  if (normalizedMap.has(lowerClean)) {
    return normalizedMap.get(lowerClean);
  }

  // Check if path has root prefix like "bookmarks bar/work", "toolbar/work", "other bookmarks/work", or "bookmarks menu/work"
  const barPrefixes = ['bookmarks bar/', 'bookmarks bar /', 'bookmarks/', 'bookmarks toolbar/', 'bookmarks toolbar /', 'toolbar/'];
  const otherPrefixes = ['other bookmarks/', 'other bookmarks /', 'other/', 'unfiled bookmarks/', 'unfiled/'];
  const menuPrefixes = ['bookmarks menu/', 'bookmarks menu /', 'menu/'];
  for (const prefix of barPrefixes) {
    if (lowerClean.startsWith(prefix)) {
      const sub = lowerClean.slice(prefix.length).trim();
      if (!sub) return BOOKMARK_ROOT_IDS.BAR;
      if (normalizedMap.has(sub)) return normalizedMap.get(sub);
    }
  }
  for (const prefix of otherPrefixes) {
    if (lowerClean.startsWith(prefix)) {
      const sub = lowerClean.slice(prefix.length).trim();
      if (!sub) return BOOKMARK_ROOT_IDS.OTHER;
      if (normalizedMap.has(sub)) return normalizedMap.get(sub);
    }
  }
  for (const prefix of menuPrefixes) {
    if (lowerClean.startsWith(prefix)) {
      const sub = lowerClean.slice(prefix.length).trim();
      if (!sub) return BOOKMARK_ROOT_IDS.MENU || BOOKMARK_ROOT_IDS.BAR;
      if (normalizedMap.has(sub)) return normalizedMap.get(sub);
    }
  }

  // If path is "bookmarks bar", "bookmarks toolbar", "other bookmarks", "unfiled bookmarks", "bookmarks menu" directly
  if (lowerClean === 'bookmarks bar' || lowerClean === 'bookmarks' || lowerClean === 'bookmarks toolbar' || lowerClean === 'toolbar') return BOOKMARK_ROOT_IDS.BAR;
  if (lowerClean === 'other bookmarks' || lowerClean === 'other' || lowerClean === 'unfiled bookmarks' || lowerClean === 'unfiled') return BOOKMARK_ROOT_IDS.OTHER;
  if (lowerClean === 'bookmarks menu' || lowerClean === 'menu') return BOOKMARK_ROOT_IDS.MENU || BOOKMARK_ROOT_IDS.BAR;

  // Try matching prefixes / parent segments from longest to shortest
  const segments = cleanPath.split('/').map(s => s.trim()).filter(Boolean);
  while (segments.length > 1) {
    segments.pop();
    const parentPath = segments.join('/').toLowerCase();
    if (normalizedMap.has(parentPath)) {
      return normalizedMap.get(parentPath);
    }
  }

  // Fallback: Default to Bookmarks Bar without creating any folder
  return BOOKMARK_ROOT_IDS.BAR;
}

/**
 * Normalizes an AI suggested category to an existing folder from the available list.
 * If allowCreateFolders is false, guarantees that the returned category path matches an existing folder.
 * If allowCreateFolders is true and options.allowRecursive is false, restricts new folders to single level.
 * @param {string} suggestedCategory
 * @param {string[]} existingFolders
 * @param {boolean} allowCreateFolders
 * @param {object} [options]
 * @param {boolean} [options.allowRecursive=true]
 * @returns {string}
 */
function normalizeCategoryToExistingFolders(suggestedCategory, existingFolders, allowCreateFolders, options = {}) {
  const trimmed = (suggestedCategory || '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return (existingFolders && existingFolders[0]) || 'Bookmarks Bar';
  
  if (allowCreateFolders) {
    const allowRecursive = options?.allowRecursive !== false;
    if (!allowRecursive && trimmed.includes('/')) {
      const firstSegment = trimmed.split('/')[0].trim();
      return firstSegment || trimmed;
    }
    return trimmed;
  }
  
  if (!existingFolders || existingFolders.length === 0) return 'Bookmarks Bar';

  // 1. Exact match
  if (existingFolders.includes(trimmed)) return trimmed;

  // 2. Case-insensitive match
  const lower = trimmed.toLowerCase();
  const caseMatch = existingFolders.find(f => f.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // 3. Strip root prefix if present (e.g. "Bookmarks bar/Work" -> "Work")
  for (const prefix of ['bookmarks bar/', 'other bookmarks/', 'bookmarks/']) {
    if (lower.startsWith(prefix)) {
      const sub = lower.slice(prefix.length).trim();
      const subMatch = existingFolders.find(f => f.toLowerCase() === sub);
      if (subMatch) return subMatch;
    }
  }

  // 4. Try matching parent segments
  const segments = trimmed.split('/').map(s => s.trim()).filter(Boolean);
  while (segments.length > 1) {
    segments.pop();
    const parent = segments.join('/').toLowerCase();
    const parentMatch = existingFolders.find(f => f.toLowerCase() === parent);
    if (parentMatch) return parentMatch;
  }

  // 5. Try segment or significant word match
  const words = lower.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  if (words.length > 0) {
    const wordMatch = existingFolders.find(f => {
      const fLower = f.toLowerCase();
      const fSegments = fLower.split('/').map(s => s.trim());
      return fSegments.some(seg => words.includes(seg) || (seg.length >= 3 && lower.includes(seg)));
    });
    if (wordMatch) return wordMatch;
  }

  // 6. Fallback to first existing folder
  return existingFolders[0];
}

/**
 * Settings (and therefore domainRules) are re-fetched from chrome.storage.sync on every
 * call, so there's no stable array reference to key a cache off of — instead the parsed
 * {host, pathPrefix} form is cached by the rules' serialised content. A bulk operation
 * (e.g. analysing many inbox bookmarks) reuses the same parse instead of re-splitting
 * every rule's domain string for every single URL.
 */
function getParsedDomainRules(rules) {
  const key = JSON.stringify(rules || []);
  if (parsedDomainRulesCache.key !== key) {
    const parsed = [];
    for (const rule of rules || []) {
      let domain = (rule.domain || '').trim().toLowerCase();
      const folder = (rule.folder || '').trim();
      if (!domain || !folder) continue;

      // Strip protocol if user included https:// or http://
      domain = domain.replace(/^https?:\/\//i, '');
      const slashIdx = domain.indexOf('/');
      let host = slashIdx === -1 ? domain : domain.slice(0, slashIdx);
      let pathPrefix = slashIdx === -1 ? null : domain.slice(slashIdx);

      // Clean host and normalize path
      host = host.replace(/^www\./i, '').replace(/\/+$/, '');
      if (pathPrefix === '/' || pathPrefix === '') pathPrefix = null;

      if (host) {
        parsed.push({ host, pathPrefix, folder });
      }
    }
    parsedDomainRulesCache = { key, parsed };
  }
  return parsedDomainRulesCache.parsed;
}

/**
 * Checks if a URL matches any domain rule and returns the target folder path.
 * Rules with a "/" are matched as hostname + path prefix (e.g. "youtube.com/watch").
 * Rules without "/" are matched as hostname only (e.g. "github.com", including subdomains).
 * @param {string} url
 * @param {Array<{domain: string, folder: string}>} rules
 * @returns {string|null} The matched folder path, or null if no rule matches
 */
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
    console.warn('Domain rule matching skipped for invalid URL:', url, err);
  }
  return null;
}

/**
 * Returns all bookmarks sitting directly on the Bookmarks Bar or Other
 * Bookmarks (i.e. not inside any subfolder). These are the "unsorted" ones.
 */
async function getUnsortedBookmarks(scope = {}) {
  await initializeRootIds();
  if (scope?.type === 'folder') {
    const folderId = String(scope.folderId || '');
    if (!folderId) throw new Error('Choose a folder or subfolder to sort.');
    const nodes = await chrome.bookmarks.get(folderId);
    const folder = nodes?.[0];
    if (!folder || folder.url) throw new Error('The selected sorting folder no longer exists. Choose it again.');
    const children = await chrome.bookmarks.getChildren(folderId);
    return {
      bookmarks: children.filter(node => Boolean(node.url)),
      scopeLabel: `direct bookmarks in “${folder.title || 'Untitled folder'}”`
    };
  }

  const rootFetchers = [
    chrome.bookmarks.getChildren(BOOKMARK_ROOT_IDS.BAR).catch(e => {
      console.warn(`Could not read children from Bookmarks Bar (${BOOKMARK_ROOT_IDS.BAR}):`, e);
      return [];
    }),
    chrome.bookmarks.getChildren(BOOKMARK_ROOT_IDS.OTHER).catch(e => {
      console.warn(`Could not read children from Other Bookmarks (${BOOKMARK_ROOT_IDS.OTHER}):`, e);
      return [];
    })
  ];

  if (BOOKMARK_ROOT_IDS.MENU && BOOKMARK_ROOT_IDS.MENU !== BOOKMARK_ROOT_IDS.BAR && BOOKMARK_ROOT_IDS.MENU !== BOOKMARK_ROOT_IDS.OTHER) {
    rootFetchers.push(
      chrome.bookmarks.getChildren(BOOKMARK_ROOT_IDS.MENU).catch(e => {
        console.warn(`Could not read children from Bookmarks Menu (${BOOKMARK_ROOT_IDS.MENU}):`, e);
        return [];
      })
    );
  }

  const rootResults = await Promise.all(rootFetchers);
  const flattened = rootResults.flat();
  return {
    bookmarks: flattened.filter(node => Boolean(node.url)),
    scopeLabel: 'direct bookmarks in your Bookmarks Bar, Other Bookmarks, and Bookmarks Menu'
  };
}

/**
 * Returns all user folders for the explicit sorting-scope picker. IDs, not paths,
 * are used when sorting to avoid ambiguity between folders with the same name.
 */
async function getSortingScopeFolders() {
  await initializeRootIds();
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const protectedRootIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT), String(BOOKMARK_ROOT_IDS.BAR),
    String(BOOKMARK_ROOT_IDS.OTHER), String(BOOKMARK_ROOT_IDS.MENU),
    String(BOOKMARK_ROOT_IDS.MOBILE),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));
  function walk(nodes, path = '') {
    for (const node of nodes || []) {
      if (node.url) continue;
      const nodeId = String(node.id);
      if (protectedRootIds.has(nodeId) || node.parentId == null) {
        walk(node.children, node.title || path);
        continue;
      }
      const folderPath = path ? `${path}/${node.title || 'Untitled folder'}` : (node.title || 'Untitled folder');
      folders.push({
        id: nodeId,
        path: folderPath,
        directBookmarkCount: (node.children || []).filter(child => Boolean(child.url)).length
      });
      walk(node.children, folderPath);
    }
  }
  walk(tree);
  return folders.sort((a, b) => a.path.localeCompare(b.path));
}

function extractJsonPayload(responseText, expectedType) {
  const text = String(responseText || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [];
  const addCandidate = (start, end) => {
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  };

  if (expectedType === 'array') {
    addCandidate(text.indexOf('['), text.lastIndexOf(']'));
    const wrapperKeys = ['results', 'bookmarks', 'suggestions', 'items', 'data'];
    for (const key of wrapperKeys) {
      const keyIndex = text.indexOf(`"${key}"`);
      if (keyIndex < 0) continue;
      const arrayStart = text.indexOf('[', keyIndex);
      if (arrayStart >= 0) addCandidate(arrayStart, text.lastIndexOf(']'));
    }
  } else {
    addCandidate(text.indexOf('{'), text.lastIndexOf('}'));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (expectedType === 'array') {
        if (Array.isArray(parsed)) return parsed;
        for (const key of ['results', 'bookmarks', 'suggestions', 'items', 'data']) {
          if (Array.isArray(parsed?.[key])) return parsed[key];
        }
      } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate; model output may contain prose or multiple blocks.
    }
  }
  return null;
}

async function handleGetAISuggestion({ url, title }) {
  const { settings, provider } = await getAIConfig();
  const ruleFolder = matchesDomainRule(url, settings.domainRules || []);
  if (ruleFolder) {
    return { success: true, matchedCategory: ruleFolder };
  }
  const analysis = await analyzeBookmark(url, settings, provider, title);
  return {
    success: true,
    matchedCategory: analysis.matchedCategory || 'Other',
    isArticle: analysis.isArticle,
    contentType: analysis.contentType
  };
}

/**
 * Broadcasts batch progress events to any open extension views (such as To Sort inbox).
 * @param {object} progressData
 */
function broadcastBatchProgress(progressData) {
  try {
    const sessionStore = getSessionStorage();
    if (sessionStore?.set) {
      sessionStore.set({ sortBatchProgress: progressData }).catch(() => {});
    }
    chrome.runtime.sendMessage({ action: 'sortBatchProgress', progress: progressData }).catch(() => {});
  } catch {
    // Ignore if no listeners are open
  }
}

/**
 * Analyze multiple bookmarks in context-sized batches. The bookmark ID is included
 * in both the prompt and required response, so results can be mapped back exactly.
 * When options.allowCreateFolders is false (default), restricts suggestions to existing folders.
 */
async function handleGetAISuggestionsBatch(inputBookmarks, options = {}) {
  batchAnalysisCancelled = false;
  const { settings, provider, hasAI } = await getAIConfig();
  const source = Array.isArray(inputBookmarks) ? inputBookmarks : [];
  if (source.length === 0) return { success: true, results: [] };

  if (!hasAI) {
    return {
      success: false,
      error: 'No AI provider configured. Please open Extension Settings to configure your API key.',
      results: source.map(bm => ({
        id: bm.id,
        success: false,
        error: 'No AI provider configured. Open Extension Settings to configure an API key.'
      }))
    };
  }

  const allowCreateFolders = typeof options?.allowCreateFolders === 'boolean'
    ? options.allowCreateFolders
    : (typeof options?.options?.allowCreateFolders === 'boolean'
      ? options.options.allowCreateFolders
      : Boolean(settings.sortAllowCreateFolders));

  const newFolderLocation = options?.options?.newFolderLocation || options?.newFolderLocation || settings.sortNewFolderLocation || 'root-bar';
  const allowRecursive = typeof options?.options?.allowRecursive === 'boolean'
    ? options.options.allowRecursive
    : (typeof options?.allowRecursive === 'boolean'
      ? options.allowRecursive
      : Boolean(settings.sortAllowRecursiveFolders));

  const existingFolders = await getExistingBookmarkFolders();

  const results = [];
  const aiBookmarks = [];
  const ruleMatches = [];
  for (const bm of source) {
    const ruleFolder = matchesDomainRule(bm.url, settings.domainRules || []);
    if (ruleFolder) {
      const finalFolder = normalizeCategoryToExistingFolders(ruleFolder, existingFolders, allowCreateFolders, { allowRecursive });
      const itemRes = { id: bm.id, success: true, matchedCategory: finalFolder, fromRule: true };
      results.push(itemRes);
      ruleMatches.push(itemRes);
    } else {
      aiBookmarks.push({ id: bm.id, title: bm.title || '', url: bm.url });
    }
  }

  if (ruleMatches.length > 0) {
    broadcastBatchProgress({
      type: 'rulesApplied',
      count: ruleMatches.length,
      results: ruleMatches
    });
  }

  if (aiBookmarks.length === 0) {
    const order = new Map(source.map((bm, index) => [String(bm.id), index]));
    results.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
    return { success: true, results };
  }

  const contextWindowTokens = sanitizeContextWindowTokens(settings.modelContextWindow);
  // User-configured batch size (default: 100, clamped between 5 and 100)
  const configuredBatchSize = typeof options?.batchSize === 'number'
    ? options.batchSize
    : (parseInt(settings.sortBatchSize, 10) || 100);
  const maxItemsPerBatch = Math.max(5, Math.min(100, configuredBatchSize));
  const batches = buildSemanticBatches(aiBookmarks, '', contextWindowTokens, maxItemsPerBatch);

  let folderListText = '';
  let promptInstructions = '';

  if (!allowCreateFolders) {
    if (existingFolders.length > 0) {
      folderListText = existingFolders.slice(0, 300).join('\n');
      promptInstructions = `You are sorting bookmarks into existing folders. You MUST ONLY choose from the list of Existing Folders below. Do NOT invent new folders, do NOT modify folder names, and do NOT create category paths that are not in the list.

Existing Folders:
${folderListText}`;
    } else {
      promptInstructions = `No custom bookmark folders exist. Assign every bookmark to "Bookmarks Bar". Do NOT create new folders.`;
    }
  } else {
    let locationNote = '';
    if (newFolderLocation === 'root-other') {
      locationNote = ' Any new folders will be placed in "Other Bookmarks".';
    } else if (newFolderLocation && newFolderLocation !== 'root-bar') {
      const locFolder = existingFolders.find(f => f.includes(newFolderLocation)) || newFolderLocation;
      locationNote = ` Any new folders will be placed inside folder "${locFolder}".`;
    }

    const recursiveNote = allowRecursive
      ? 'You may suggest nested subfolder paths (e.g. "Work/Development") when appropriate.'
      : 'Do NOT suggest nested multi-level folder paths (e.g. do NOT output "A/B/C"). Suggest ONLY single-level concise folder names (e.g. "Development", "Finance", "News").';

    if (existingFolders.length > 0) {
      folderListText = existingFolders.slice(0, 300).join('\n');
      promptInstructions = `Choose the single best folder category for each bookmark. Use an existing folder from the list below when it is a good fit; otherwise you may suggest a new concise folder name.${locationNote} ${recursiveNote}

Existing Folders:
${folderListText}`;
    } else {
      promptInstructions = `For each bookmark, suggest a concise category name.${locationNote} ${recursiveNote}`;
    }
  }

  const totalBatches = batches.length;
  // User-configured parallel batch concurrency (default: 4, clamped between 1 and 10)
  const configuredConcurrency = typeof options?.batchConcurrency === 'number'
    ? options.batchConcurrency
    : (parseInt(settings.sortBatchConcurrency, 10) || 4);
  const CONCURRENCY = Math.max(1, Math.min(10, Math.min(configuredConcurrency, totalBatches)));

  async function processBatch(batch, bIndex) {
    const batchNumber = bIndex + 1;
    const prompt = `Analyze every bookmark below. Return exactly one result for every input bookmark, preserving each id exactly.

${promptInstructions}

Return ONLY a JSON array, with no markdown, reasoning, thinking, or explanation, in this shape:
[{"id":"input id","matchedCategory":"Folder/Path"}]

Bookmarks:
${JSON.stringify(batch)}`;

    const estimatedInputTokens = estimateTokensFromText(prompt);
    const batchBookmarkList = batch.map(bm => ({ id: bm.id, title: bm.title || bm.url, url: bm.url }));

    broadcastBatchProgress({
      type: 'batchStart',
      batchIndex: batchNumber,
      totalBatches,
      bookmarkCount: batch.length,
      bookmarks: batchBookmarkList,
      inputTokens: estimatedInputTokens,
      timestamp: Date.now()
    });

    const batchStartTime = Date.now();
    let stats = null;
    const batchResults = [];
    try {
      stats = await callAIWithStats(prompt, settings, provider, Math.min(8192, Math.max(1024, batch.length * 120)));
      const parsed = extractJsonPayload(stats.responseText, 'array');
      if (!parsed) throw new Error('Could not find a valid JSON array in AI response');
      const byId = new Map(batch.map(bm => [String(bm.id), bm]));
      const returnedIds = new Set();
      for (const item of parsed) {
        const id = String(item?.id ?? '');
        const original = byId.get(id);
        const rawFolder = typeof item?.matchedCategory === 'string' ? item.matchedCategory.trim() : '';
        if (!original || returnedIds.has(id) || !rawFolder) continue;
        returnedIds.add(id);
        const folder = normalizeCategoryToExistingFolders(rawFolder, existingFolders, allowCreateFolders, { allowRecursive });
        const itemRes = { id: original.id, success: true, matchedCategory: folder };
        batchResults.push(itemRes);
      }
      for (const bm of batch) {
        if (!returnedIds.has(String(bm.id))) {
          const errRes = { id: bm.id, success: false, error: 'AI did not return a category for this bookmark.' };
          batchResults.push(errRes);
        }
      }

      broadcastBatchProgress({
        type: 'batchComplete',
        batchIndex: batchNumber,
        totalBatches,
        bookmarkCount: batch.length,
        bookmarks: batchBookmarkList,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        durationMs: stats.durationMs,
        results: batchResults,
        success: true
      });
    } catch (error) {
      console.error('Bookmark analysis batch error:', error);
      for (const bm of batch) {
        const errRes = { id: bm.id, success: false, error: error.message };
        batchResults.push(errRes);
      }

      broadcastBatchProgress({
        type: 'batchComplete',
        batchIndex: batchNumber,
        totalBatches,
        bookmarkCount: batch.length,
        bookmarks: batchBookmarkList,
        inputTokens: stats?.inputTokens ?? estimatedInputTokens,
        outputTokens: stats?.outputTokens ?? 0,
        durationMs: Date.now() - batchStartTime,
        results: batchResults,
        success: false,
        error: error.message
      });
    }

    return batchResults;
  }

  let nextBatchIndex = 0;
  const batchOutputs = new Array(totalBatches);

  async function worker() {
    while (nextBatchIndex < totalBatches) {
      if (batchAnalysisCancelled) break;
      const idx = nextBatchIndex++;
      batchOutputs[idx] = await processBatch(batches[idx], idx);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  for (const batchRes of batchOutputs) {
    if (Array.isArray(batchRes)) {
      results.push(...batchRes);
    }
  }

  if (batchAnalysisCancelled) {
    broadcastBatchProgress({ type: 'cancelled' });
  }

  const order = new Map(source.map((bm, index) => [String(bm.id), index]));
  results.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  return { success: true, results, cancelled: batchAnalysisCancelled };
}

/**
 * Builds a folder-only map for the organization planner. Bookmark URLs, titles,
 * and bookmark metadata are intentionally excluded from the payload.
 */
async function handleGetFolderOrganizationData() {
  await initializeRootIds();
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const rootIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT), String(BOOKMARK_ROOT_IDS.BAR),
    String(BOOKMARK_ROOT_IDS.OTHER), String(BOOKMARK_ROOT_IDS.MENU),
    String(BOOKMARK_ROOT_IDS.MOBILE),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));

  function summarize(node) {
    const children = node.children || [];
    const childFolders = children.filter(child => !child.url);
    return {
      bookmarkCount: children.filter(child => Boolean(child.url)).length
        + childFolders.reduce((sum, child) => sum + summarize(child).bookmarkCount, 0),
      descendantFolderCount: childFolders.length
        + childFolders.reduce((sum, child) => sum + summarize(child).descendantFolderCount, 0)
    };
  }
  function walk(nodes, parentPath = '', depth = 0) {
    for (const node of nodes || []) {
      if (node.url) continue;
      const nodeId = String(node.id || '');
      const parentId = node.parentId != null ? String(node.parentId) : null;
      const isDirectRootChild = parentId == null || parentId === '0' || parentId === 'root________' || parentId === BOOKMARK_ROOT_IDS.ROOT;
      const path = isDirectRootChild
        ? (node.title || '(Root)')
        : (parentPath ? `${parentPath}/${node.title}` : node.title);
      const childFolders = (node.children || []).filter(child => !child.url);
      const totals = summarize(node);
      const isRoot = Boolean(rootIds.has(nodeId) || parentId == null || parentId === '0' || parentId === 'root________' || parentId === BOOKMARK_ROOT_IDS.ROOT);
      folders.push({
        id: nodeId,
        title: node.title || '(Root)',
        parentId,
        path,
        depth,
        isRoot,
        directBookmarkCount: (node.children || []).filter(child => Boolean(child.url)).length,
        bookmarkCount: totals.bookmarkCount,
        descendantFolderCount: totals.descendantFolderCount,
        childFolderIds: childFolders.map(child => String(child.id))
      });
      walk(node.children, path, depth + 1);
    }
  }
  walk(tree);
  return { success: true, folders };
}

/**
 * Ask the active AI provider for a validated folder-only merge/reparent plan.
 */
async function handleGenerateFolderOrganizationPlan(inputFolders, requestedFolderCount) {
  const { settings, provider, hasAI } = await getAIConfig();
  if (!hasAI) return { success: false, error: 'Configure an AI provider before organizing folders.' };
  const folders = Array.isArray(inputFolders) ? inputFolders : [];
  const usableFolders = folders.filter(folder => folder && folder.id && !folder.isRoot);
  const targetFolderCount = Math.min(50, Math.max(1, Number.parseInt(requestedFolderCount, 10) || 12));
  if (usableFolders.length < 2) {
    return { success: true, operations: [], summary: 'There are not enough folders to organize.' };
  }
  const prompt = `You are organizing a browser bookmark folder hierarchy with ${usableFolders.length} existing folders. The user requested up to ${targetFolderCount} useful folder changes in the plan. Folder-only changes are allowed: merge duplicate folders with the same purpose and reparent folders into clearer subfolders. Do not rename folders, delete content, edit bookmark titles or URLs, create folders, or invent folder IDs.

Return ONLY valid JSON in this exact shape:
{"operations":[{"action":"merge"|"reparent","sourceId":"folder id","targetId":"folder id","reason":"brief reason"}],"summary":"brief summary"}

Rules:
- Use only IDs from the supplied folder map.
- Never use a root folder as source.
- Merge only when source and target are genuinely duplicate or equivalent folders; merge means moving the source folder's children into the target folder, then removing the now-empty source folder.
- Reparent folders when the target is a clearly better existing parent folder, especially to collapse chains where a folder contains only one subfolder and no direct bookmarks.
- Treat folders with one or zero bookmarks and deep nesting as high-priority cleanup candidates when a safe existing parent is available.
- Return no more than ${targetFolderCount} operations. Produce as many safe, useful operations as the limit allows, not just one or two suggestions.
- Prioritize duplicate-name merges, folders containing only one child folder, long/deep paths, and folders with zero or one direct bookmark. Prefer existing folders with the most total bookmarks and coherent names as canonical targets.
- Use reparent operations to collapse unnecessary chains, and use merge operations when two folders have the same or equivalent purpose.
- Do not propose unnecessary changes. Return an empty operations array when the hierarchy is already coherent.

Folder map:
${JSON.stringify(usableFolders)}`;
  try {
    const responseText = await callAI(prompt, settings, provider, Math.min(8192, Math.max(2048, usableFolders.length * 100)));
    const parsed = extractJsonPayload(responseText, 'object');
    if (!parsed || !Array.isArray(parsed.operations)) {
      return { success: false, error: 'AI did not return a valid folder organization plan.' };
    }
    const byId = new Map(folders.map(folder => [String(folder.id), folder]));
    const operations = [];
    const seen = new Set();
    for (const operation of parsed.operations) {
      const sourceId = String(operation?.sourceId || '');
      const targetId = String(operation?.targetId || '');
      const action = operation?.action === 'merge' || operation?.action === 'reparent' ? operation.action : '';
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!action || !source || !target || source.isRoot || sourceId === targetId || seen.has(sourceId)) continue;
      if (target.path.startsWith(`${source.path}/`)) continue;
      seen.add(sourceId);
      operations.push({ action, sourceId, targetId, reason: String(operation.reason || '').slice(0, 240) });
    }
    return { success: true, operations: operations.slice(0, targetFolderCount), targetFolderCount, summary: String(parsed.summary || `Folder organization plan generated with up to ${targetFolderCount} suggestions.`) };
  } catch (error) {
    console.error('Folder organization planning error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Apply only validated folder operations. No bookmark node is edited directly.
 */
async function handleApplyFolderOrganizationPlan(inputOperations) {
  await initializeRootIds();
  const operations = Array.isArray(inputOperations) ? inputOperations : [];
  const tree = await chrome.bookmarks.getTree();
  const folderIds = new Set();
  const folderById = new Map();
  const rootIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT), String(BOOKMARK_ROOT_IDS.BAR),
    String(BOOKMARK_ROOT_IDS.OTHER), String(BOOKMARK_ROOT_IDS.MENU),
    String(BOOKMARK_ROOT_IDS.MOBILE),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));

  function index(nodes) {
    for (const node of nodes || []) {
      if (!node.url) {
        folderIds.add(String(node.id));
        folderById.set(String(node.id), node);
        index(node.children);
      }
    }
  }
  index(tree);
  const results = [];
  for (const operation of operations) {
    const sourceId = String(operation?.sourceId || '');
    const targetId = String(operation?.targetId || '');
    try {
      if (!folderIds.has(sourceId) || !folderIds.has(targetId) || sourceId === targetId || rootIds.has(sourceId)) {
        throw new Error('Invalid folder operation on root or non-existent folder');
      }
      let ancestor = folderById.get(targetId);
      while (ancestor) {
        if (String(ancestor.id) === sourceId) throw new Error('Cannot move a folder into its own descendant');
        ancestor = folderById.get(String(ancestor.parentId));
      }
      if (operation.action === 'merge') {
        const children = await chrome.bookmarks.getChildren(sourceId);
        for (const child of children) await chrome.bookmarks.move(child.id, { parentId: targetId });
        await chrome.bookmarks.remove(sourceId);
      } else if (operation.action === 'reparent') {
        await chrome.bookmarks.move(sourceId, { parentId: targetId });
      } else {
        throw new Error('Unknown folder operation');
      }
      results.push({ sourceId, targetId, action: operation.action, success: true });
    } catch (error) {
      results.push({ sourceId, targetId, action: operation.action, success: false, error: error.message });
    }
  }
  invalidateBookmarkTreeCache();
  return { success: true, results };
}

/**
 * Build a conservative cleanup preview: exact URL duplicates only, preserving
 * the first bookmark encountered in Chrome's tree order.
 * Built-in Chrome root folders ("Bookmarks bar", "Other bookmarks", "Mobile bookmarks", etc.) are strictly protected.
 */
async function buildCleanupPreview() {
  await initializeRootIds();
  const protectedIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT || '0'),
    String(BOOKMARK_ROOT_IDS.BAR || '1'),
    String(BOOKMARK_ROOT_IDS.OTHER || '2'),
    String(BOOKMARK_ROOT_IDS.MENU || 'menu________'),
    String(BOOKMARK_ROOT_IDS.MOBILE || '3'),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));
  const protectedTitles = new Set([
    'bookmarks bar', 'bookmarks toolbar', 'other bookmarks', 'unfiled bookmarks',
    'bookmarks menu', 'mobile bookmarks', 'synced bookmarks', 'bookmarks', 'other', 'menu', 'toolbar'
  ]);

  const tree = await chrome.bookmarks.getTree();
  const emptyFolders = [];
  const duplicateBookmarks = [];
  const seenUrls = new Map();
  function walk(nodes, path = '') {
    for (const node of nodes || []) {
      if (node.url) {
        const key = String(node.url).trim();
        if (key && seenUrls.has(key)) {
          duplicateBookmarks.push({
            id: String(node.id),
            title: node.title || '',
            url: node.url,
            path,
            keepId: seenUrls.get(key).id
          });
        } else if (key) {
          seenUrls.set(key, { id: String(node.id) });
        }
        continue;
      }
      const nodeIdStr = String(node.id);
      const isProtectedRoot = protectedIds.has(nodeIdStr) ||
        node.parentId == null ||
        node.parentId === BOOKMARK_ROOT_IDS.ROOT ||
        node.parentId === '0' ||
        node.parentId === 'root________' ||
        protectedTitles.has((node.title || '').trim().toLowerCase());

      const childNodes = node.children || [];
      const currentPath = path ? `${path}/${node.title || '(Untitled)'}` : (node.title || '(Root)');
      if (!isProtectedRoot && childNodes.length === 0) {
        emptyFolders.push({ id: String(node.id), title: node.title || '(Untitled)', path: currentPath });
      }
      walk(childNodes, currentPath);
    }
  }
  walk(tree);
  return { emptyFolders, duplicateBookmarks };
}

async function handleGetCleanupPreview() {
  const preview = await buildCleanupPreview();
  return { success: true, ...preview };
}

/**
 * Apply only the selected cleanup types. Duplicate detection is recalculated at
 * apply time, so stale previews cannot remove an unrelated bookmark.
 */
async function handleApplyCleanup(options) {
  await initializeRootIds();
  const protectedIds = new Set([
    String(BOOKMARK_ROOT_IDS.ROOT || '0'),
    String(BOOKMARK_ROOT_IDS.BAR || '1'),
    String(BOOKMARK_ROOT_IDS.OTHER || '2'),
    String(BOOKMARK_ROOT_IDS.MENU || 'menu________'),
    String(BOOKMARK_ROOT_IDS.MOBILE || '3'),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));

  const removeDuplicates = options.removeDuplicateBookmarks === true;
  const removeEmpty = options.removeEmptyFolders === true;
  if (!removeDuplicates && !removeEmpty) return { success: true, removedDuplicates: 0, removedFolders: 0 };
  let removedDuplicates = 0;
  let removedFolders = 0;
  if (removeDuplicates) {
    const preview = await buildCleanupPreview();
    for (const duplicate of preview.duplicateBookmarks) {
      try {
        await chrome.bookmarks.remove(duplicate.id);
        removedDuplicates++;
      } catch (error) {
        console.warn('Could not remove duplicate bookmark:', duplicate.id, error);
      }
    }
  }
  if (removeEmpty) {
    const preview = await buildCleanupPreview();
    // Deepest paths first so removing a child can expose its parent as empty.
    const folders = [...preview.emptyFolders].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
    for (const folder of folders) {
      if (protectedIds.has(String(folder.id))) continue;
      try {
        const children = await chrome.bookmarks.getChildren(folder.id);
        if (children.length === 0) {
          await chrome.bookmarks.remove(folder.id);
          removedFolders++;
        }
      } catch (error) {
        console.warn('Could not remove empty folder:', folder.id, error);
      }
    }
  }
  invalidateBookmarkTreeCache();
  return { success: true, removedDuplicates, removedFolders };
}

/**
 * Moves a batch of bookmarks into their suggested category folders.
 * If options.allowCreateFolders is false (default), only moves into existing folders and never creates new ones.
 * @param {Array<{bookmarkId: string, categoryPath: string}>} items
 * @param {Object} [options]
 * @param {boolean} [options.allowCreateFolders=false]
 * @returns {Promise<{success: boolean, results: Array<{bookmarkId: string, success: boolean, error?: string}>}>}
 */
async function handleMoveBookmarks(items, options = {}) {
  const settings = await chrome.storage.sync.get({
    sortAllowCreateFolders: false,
    sortNewFolderLocation: 'root-bar',
    sortAllowRecursiveFolders: false
  });

  const allowCreateFolders = typeof options?.allowCreateFolders === 'boolean'
    ? options.allowCreateFolders
    : (typeof options?.options?.allowCreateFolders === 'boolean'
      ? options.options.allowCreateFolders
      : Boolean(settings.sortAllowCreateFolders));

  const newFolderLocation = options?.options?.newFolderLocation || options?.newFolderLocation || settings.sortNewFolderLocation || 'root-bar';
  const allowRecursive = typeof options?.options?.allowRecursive === 'boolean'
    ? options.options.allowRecursive
    : (typeof options?.allowRecursive === 'boolean'
      ? options.allowRecursive
      : Boolean(settings.sortAllowRecursiveFolders));

  const folderIdByPath = new Map();
  const results = [];

  for (const { bookmarkId, categoryPath } of items) {
    try {
      let parentId = folderIdByPath.get(categoryPath);
      if (!parentId) {
        if (allowCreateFolders) {
          parentId = await ensureFolderPath(categoryPath, { newFolderLocation, allowRecursive });
        } else {
          parentId = await findExistingFolderId(categoryPath);
        }
        folderIdByPath.set(categoryPath, parentId);
      }
      await chrome.bookmarks.move(bookmarkId, { parentId });
      results.push({ bookmarkId, success: true });
    } catch (error) {
      results.push({ bookmarkId, success: false, error: error.message });
    }
  }

  return { success: true, results };
}

/**
 * Deletes a batch of bookmarks in one message round trip instead of one
 * deleteBookmark message per bookmark.
 * @param {string[]} bookmarkIds
 * @returns {Promise<{success: boolean, results: Array<{bookmarkId: string, success: boolean, error?: string}>}>}
 */
async function handleDeleteBookmarks(bookmarkIds) {
  const results = [];
  for (const bookmarkId of bookmarkIds) {
    try {
      await chrome.bookmarks.remove(bookmarkId);
      results.push({ bookmarkId, success: true });
    } catch (error) {
      results.push({ bookmarkId, success: false, error: error.message });
    }
  }
  return { success: true, results };
}

/**
 * Gets an existing folder or creates it if it doesn't exist
 * @param {string} title - The folder title
 * @param {string} parentId - The parent folder ID
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} The folder node
 */
async function getOrCreateFolder(title, parentId) {
  try {
    // Search for existing folder with this title under the parent
    const children = await chrome.bookmarks.getChildren(parentId);

    // Look for an existing folder with this title
    const existingFolder = children.find(
      child => !child.url && child.title === title
    );

    if (existingFolder) {
      return existingFolder;
    }

    // Create new folder if it doesn't exist
    const newFolder = await chrome.bookmarks.create({
      parentId: parentId,
      title: title
    });

    console.log('Created folder:', newFolder);
    return newFolder;
  } catch (error) {
    console.error('Error getting or creating folder:', error);
    throw error;
  }
}

// Add context menu item for right-click bookmarking
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'aijbookmarks',
    title: 'Analyze and Bookmark with AI',
    contexts: ['page']
  });
  // Set up health check alarm based on saved settings
  setupHealthCheckAlarm().catch(console.error);
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'aijbookmarks') {
    // Open the popup or trigger analysis
    chrome.action.openPopup();
  }
});

// Run periodic health check when alarm fires
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bookmarkHealthCheck') {
    runHealthCheck().catch(console.error);
  }
});

// ============================================================
// Bookmark Search
// ============================================================

/**
 * Builds a map of bookmark node IDs to their folder paths.
 * @returns {Promise<Object<string, string>>} Map of nodeId -> "Folder/Path"
 */
async function getFolderPathMap() {
  const { folderPathMap } = await getBookmarkTreeData();
  return folderPathMap;
}

/**
 * Gets AI provider settings and validates credentials.
 * @returns {Promise<{settings: object, provider: string, hasAI: boolean}>}
 */
async function getAIConfig() {
  const defaults = {
    aiProvider: 'anthropic',
    anthropicApiKey: '',
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: "",
    openaiCustomModel: '',
    modelContextWindow: 131072,
    openrouterApiKey: '',
    openrouterModel: '',
    geminiApiKey: '',
    geminiModel: 'gemini-3.6-flash',
    googleCloudApiKey: '',
    googleCloudModel: 'gemini-3.7-flash',
    domainRules: [],
    sortAllowCreateFolders: false,
    sortNewFolderLocation: 'root-bar',
    sortAllowRecursiveFolders: false,
    sortBatchSize: 100,
    sortBatchConcurrency: 4
  };

  const syncSettings = await chrome.storage.sync.get(defaults).catch(() => ({}));
  const localSettings = await chrome.storage.local.get(defaults).catch(() => ({}));
  const settings = { ...defaults, ...localSettings, ...syncSettings };

  let provider = settings.aiProvider || 'anthropic';
  let hasAI = false;

  function checkProvider(p) {
    if (p === 'openai') {
      const isCustom = Boolean(settings.openaiBaseUrl && !settings.openaiBaseUrl.includes('api.openai.com'));
      return Boolean(settings.openaiApiKey?.trim() || isCustom);
    }
    if (p === 'openrouter') {
      return Boolean(settings.openrouterApiKey?.trim());
    }
    if (p === 'gemini') {
      return Boolean(settings.geminiApiKey?.trim());
    }
    if (p === 'google-cloud') {
      return Boolean(settings.googleCloudApiKey?.trim());
    }
    if (p === 'anthropic') {
      return Boolean(settings.anthropicApiKey?.trim());
    }
    return false;
  }

  hasAI = checkProvider(provider);

  // Auto-switch to configured provider if currently active provider has no API key
  if (!hasAI) {
    const candidates = ['anthropic', 'openai', 'gemini', 'openrouter', 'google-cloud'];
    for (const cand of candidates) {
      if (checkProvider(cand)) {
        provider = cand;
        hasAI = true;
        break;
      }
    }
  }

  return { settings, provider, hasAI };
}

function estimateTokensFromText(text) {
  // Fast heuristic: in English-heavy JSON payloads, one token is roughly 4 chars.
  return Math.ceil((text || '').length / 4);
}

function snapToNearestBinaryContext(value) {
  const num = parseInt(value, 10);
  if (isNaN(num)) return 131072;
  let closest = BINARY_CONTEXT_STEPS[0];
  let minDiff = Math.abs(num - closest);
  for (const step of BINARY_CONTEXT_STEPS) {
    const diff = Math.abs(num - step);
    if (diff < minDiff) {
      minDiff = diff;
      closest = step;
    }
  }
  return closest;
}

function sanitizeContextWindowTokens(value) {
  return snapToNearestBinaryContext(value);
}

function buildSemanticBatches(candidates, semanticIntent, contextWindowTokens, maxItemsPerBatch = Infinity) {
  const RESERVED_TOKENS = 2500;
  const INPUT_BUDGET_RATIO = 0.75;
  const MIN_PROMPT_BUDGET = 2000;
  const perBatchFixedTokens = 250 + estimateTokensFromText(semanticIntent || '');
  const inputTokenBudget = Math.max(
    MIN_PROMPT_BUDGET,
    Math.floor(contextWindowTokens * INPUT_BUDGET_RATIO) - RESERVED_TOKENS - perBatchFixedTokens
  );

  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  for (const bm of candidates) {
    const itemTokens = estimateTokensFromText(JSON.stringify({
      id: bm.id,
      t: bm.title || '',
      u: bm.url
    })) + 2;

    if (currentBatch.length > 0 && (currentTokens + itemTokens) > inputTokenBudget) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    if (currentBatch.length >= maxItemsPerBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(bm);
    currentTokens += itemTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Uses AI to parse a natural language search query into structured parameters.
 * Falls back to simple keyword splitting if AI is not configured.
 */
async function handleParseSearchQuery(query) {
  const { settings, provider, hasAI } = await getAIConfig();

  if (!hasAI) {
    // Fallback: split query into keywords, strip common filler words
    const stopWords = new Set([
      'find', 'show', 'me', 'my', 'all', 'the', 'that', 'about',
      'bookmarks', 'bookmark', 'links', 'link', 'saved', 'i', 'were',
      'what', 'where', 'which', 'a', 'an', 'of', 'to', 'in', 'for',
      'with', 'on', 'at', 'from', 'by', 'it', 'is', 'was', 'are'
    ]);
    const keywords = query.toLowerCase().split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w));
    return {
      success: true,
      data: { keywords, dateRange: null, semanticIntent: query },
      hasAI: false
    };
  }

  const today = new Date().toISOString().split('T')[0];
  const prompt = `Extract search parameters from this bookmark search query.
Today's date is ${today}.

Query: "${query}"

Respond in JSON only:
{
  "keywords": ["keyword1", "keyword2"],
  "dateRange": {"after": "YYYY-MM-DD", "before": "YYYY-MM-DD"} or null,
  "semanticIntent": "brief description of what user is looking for"
}`;

  const responseText = await callAI(prompt, settings, provider, 256);

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse AI response');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    success: true,
    data: {
      keywords: parsed.keywords || [],
      dateRange: parsed.dateRange || null,
      semanticIntent: parsed.semanticIntent || query
    },
    hasAI: true
  };
}

/**
 * Searches bookmarks locally using WebGPU parallel compute and bitonic sorting
 * in VRAM when available, with automatic high-performance CPU fallback.
 */
async function handleLocalBookmarkSearch(keywords, dateRange, options = {}) {
  if (!keywords || keywords.length === 0) {
    return { success: true, results: [] };
  }

  const trimmedKeywords = keywords.map(k => k.trim()).filter(Boolean);
  const folderMap = await getFolderPathMap();
  const allBookmarks = await getAllBookmarks();

  // Attempt WebGPU Parallel Compute & VRAM Search
  try {
    const gpuInit = await initWebGPU();
    if (gpuInit.supported) {
      // Sync VRAM index if needed
      if (!isGpuIndexSynced) {
        const packed = packBookmarksForVram(allBookmarks);
        const syncRes = await syncVramBookmarkIndex(packed.buffer, packed.count);
        if (syncRes && syncRes.success) {
          isGpuIndexSynced = true;
        }
      }

      if (isGpuIndexSynced) {
        const keywordHashes = trimmedKeywords.map(k => fnv1a32(k.toLowerCase())).filter(Boolean);
        const afterDateSeconds = dateRange?.after ? Math.floor(new Date(dateRange.after).getTime() / 1000) : 0;
        const beforeDateSeconds = dateRange?.before ? Math.floor(new Date(dateRange.before).getTime() / 1000) : 0;

        const gpuRes = await runParallelGpuSearchAndSort({
          keywordHashes,
          afterDateSeconds,
          beforeDateSeconds,
          topK: 100
        });

        if (gpuRes && Array.isArray(gpuRes.results)) {
          const results = [];
          for (const item of gpuRes.results) {
            const bm = allBookmarks[item.index];
            if (bm && bm.url) {
              results.push({
                id: bm.id,
                title: bm.title,
                url: bm.url,
                dateAdded: bm.dateAdded,
                folderPath: folderMap[bm.parentId] || '',
                matchType: 'gpu-parallel',
                score: item.score
              });
            }
          }
          return {
            success: true,
            results,
            gpuAccelerated: true,
            gpuDurationMs: gpuRes.data.durationMs,
            totalBookmarks: allBookmarks.length
          };
        }
      }
    }
  } catch (gpuError) {
    console.warn('WebGPU parallel search fell back to CPU:', gpuError);
  }

  // CPU Fallback
  const afterMs = dateRange && dateRange.after ? new Date(dateRange.after).getTime() : null;
  const beforeMs = dateRange && dateRange.before ? new Date(dateRange.before).getTime() : null;

  const matchLists = await Promise.all(
    trimmedKeywords.map(keyword => chrome.bookmarks.search({ query: keyword }))
  );

  const seen = new Set();
  const results = [];

  for (const matches of matchLists) {
    for (const bm of matches) {
      if (!bm.url || seen.has(bm.id)) continue;
      seen.add(bm.id);

      const added = bm.dateAdded || 0;
      if (afterMs !== null && added < afterMs) continue;
      if (beforeMs !== null && added > beforeMs) continue;

      results.push({
        id: bm.id,
        title: bm.title,
        url: bm.url,
        dateAdded: bm.dateAdded,
        folderPath: folderMap[bm.parentId] || '',
        matchType: 'keyword'
      });
    }
  }

  return { success: true, results, gpuAccelerated: false };
}

/**
 * Uses AI to find semantically relevant bookmarks that keyword search may miss.
 * Processes bookmarks in batches to stay within token limits.
 */
async function handleSemanticBookmarkSearch(semanticIntent, excludeIds) {
  const { settings, provider, hasAI } = await getAIConfig();

  if (!hasAI) {
    return { success: true, results: [] };
  }

  const { allBookmarks, folderPathMap: folderMap } = await getBookmarkTreeData();
  const excludeSet = new Set(excludeIds || []);

  // Filter out already-found bookmarks
  const candidates = allBookmarks.filter(bm => !excludeSet.has(bm.id));

  const contextWindowTokens = sanitizeContextWindowTokens(settings.modelContextWindow);
  const batches = buildSemanticBatches(candidates, semanticIntent, contextWindowTokens);

  if (batches.length === 0) {
    return { success: true, results: [] };
  }

  // Batches are independent AI requests sized by the configured context window.
  // Fire them concurrently to minimize end-to-end latency when >1 batch is needed.
  const batchResponses = await Promise.allSettled(batches.map(batch => {
    const bookmarkData = batch.map(bm => ({
      id: bm.id,
      t: bm.title || '',
      u: bm.url
    }));

    const prompt = `Given this search intent: "${semanticIntent}"

Rate each bookmark's relevance (0-10). Return ONLY a JSON array of objects with "id" and "score" for bookmarks scoring 5 or higher. Return an empty array [] if none are relevant.

Bookmarks:
${JSON.stringify(bookmarkData)}`;

    return callAI(prompt, settings, provider, 1024);
  }));

  const allResults = [];

  batchResponses.forEach((response, batchIdx) => {
    if (response.status !== 'fulfilled') {
      console.error('Semantic search batch error:', response.reason);
      return;
    }

    const jsonMatch = response.value.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    try {
      const scored = JSON.parse(jsonMatch[0]);
      // Index this batch once so scoring is an O(1) lookup instead of a linear scan per result.
      const batchById = new Map(batches[batchIdx].map(bm => [bm.id, bm]));
      for (const item of scored) {
        if (item.score < 5) continue;
        const bm = batchById.get(item.id);
        if (!bm) continue;
        allResults.push({
          id: bm.id,
          title: bm.title,
          url: bm.url,
          dateAdded: bm.dateAdded,
          folderPath: folderMap[bm.parentId] || '',
          matchType: 'semantic',
          score: item.score
        });
      }
    } catch (error) {
      console.error('Semantic search batch parse error:', error);
    }
  });

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);
  return { success: true, results: allResults };
}

// ============================================================
// Health Check
// ============================================================

/**
 * Collects all bookmark leaf nodes (those with URLs) from the entire tree.
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>}
 */
async function getAllBookmarks() {
  const { allBookmarks } = await getBookmarkTreeData();
  return allBookmarks;
}

/**
 * Extracts the page title from raw HTML.
 * Prefers og:title, falls back to twitter:title, then <title>.
 * @param {string} html
 * @returns {string|null}
 */
function extractTitleFromHtml(html) {
  // og:title (attribute order varies)
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og) return og[1].trim();

  // twitter:title
  const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i);
  if (tw) return tw[1].trim();

  // <title> tag
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t) return t[1].trim();

  return null;
}

/**
 * Known challenge / bot-protection signatures and titles
 */
function isChallengeTitle(title) {
  if (!title) return false;
  return CHALLENGE_TITLE_PATTERNS.some(p => p.test(title));
}

function isChallengeHtmlOrResponse(response, html = '') {
  if (html) {
    const htmlLower = html.toLowerCase();
    if (CHALLENGE_BODY_SIGNATURES.some(sig => htmlLower.includes(sig))) {
      return true;
    }
    const title = extractTitleFromHtml(html);
    if (title && isChallengeTitle(title)) {
      return true;
    }
  }

  if (response && response.headers) {
    const serverHeader = (response.headers.get('server') || '').toLowerCase();
    const cfRay = response.headers.get('cf-ray');
    const cfMitigated = response.headers.get('cf-mitigated');
    const datadome = response.headers.get('x-datadome') || response.headers.get('x-datadome-response');
    const akamai = response.headers.get('x-akamai-transformed');
    const awsWaf = response.headers.get('x-amzn-waf-action');
    if ((cfRay || cfMitigated || datadome || akamai || awsWaf || serverHeader.includes('cloudflare')) &&
        (response.status === 403 || response.status === 429 || response.status === 503)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes a URL for redirect comparison (removes fragment and trailing slash).
 * @param {string} url
 * @returns {string}
 */
function normalizeUrlForComparison(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Checks a single bookmark for all health issues: dead link, redirect,
 * title change, stale, and domain gone.
 *
 * Probes with HEAD first — it carries no body, so it's far cheaper than GET for what
 * is mostly a liveness + redirect check. A HEAD response is only trusted when it's
 * successful (<400): plenty of real hosts (bot protection, misconfigured servers)
 * block or mishandle HEAD specifically while GET works fine, so any HEAD failure or
 * error status falls back to GET rather than being reported as dead — matching what
 * the original GET-only check would have determined. GET is also used whenever the
 * page is HTML and its body is actually needed to compare titles; any other
 * response's body is drained/aborted without being read.
 * @param {chrome.bookmarks.BookmarkTreeNode} bookmark
 * @param {number} staleDays
 * @returns {Promise<object>}
 */
async function checkSingleBookmark(bookmark, staleDays = 365) {
  if (isRestrictedExtensionUrl(bookmark.url)) {
    const issues = [];
    if (staleDays && staleDays > 0 && typeof bookmark.dateLastUsed === 'number' && bookmark.dateLastUsed > 0) {
      const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
      if ((Date.now() - bookmark.dateLastUsed) > cutoffMs) {
        issues.push('stale');
      }
    }
    return {
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      dateAdded: bookmark.dateAdded,
      dateLastUsed: bookmark.dateLastUsed || null,
      status: issues.includes('stale') ? 'stale' : 'ok',
      issues,
      newUrl: null,
      newTitle: null,
      statusCode: 200,
      challengeProtected: false,
      checkedAt: new Date().toISOString(),
      dismissed: false,
      fixed: false
    };
  }

  const issues = [];
  let newUrl = null;
  let newTitle = null;
  let statusCode = null;
  let challengeProtected = false;

  const TIMEOUT_MS = 12000;

  try {
    let response = await fetchWithTimeout(bookmark.url, 'HEAD', TIMEOUT_MS);
    let usedHead = !!response;

    if (!response || response.status >= 400) {
      abortResponseBody(response);
      response = await fetchWithTimeout(bookmark.url, 'GET', TIMEOUT_MS);
      usedHead = false;
    }

    if (!response) {
      issues.push('dead');
      statusCode = 0;
    } else {
      statusCode = response.status;

      if (statusCode === 404 || statusCode === 410) {
        issues.push('dead');
        abortResponseBody(response);
      } else if (statusCode >= 400) {
        // Status 403 / 503 / 429 might be bot challenges (Cloudflare, Captcha, Datadome, WAF)
        const isChallenge = isChallengeHtmlOrResponse(response);
        if (isChallenge) {
          challengeProtected = true;
          abortResponseBody(response);
        } else {
          // Check if error response body has challenge HTML before marking dead
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('text/html')) {
            const html = await readTextUpTo(response, 15000);
            if (isChallengeHtmlOrResponse(response, html)) {
              challengeProtected = true;
            } else {
              issues.push('dead');
            }
          } else {
            issues.push('dead');
            abortResponseBody(response);
          }
        }
      } else {
        // Check for redirect: compare final URL to original
        const finalUrl = response.url;
        if (finalUrl && normalizeUrlForComparison(finalUrl) !== normalizeUrlForComparison(bookmark.url)) {
          issues.push('redirect');
          newUrl = finalUrl;
        }

        // The site responded successfully (healthy) — drain body immediately
        abortResponseBody(response);
      }
    }
  } catch {
    // Covers failures that occur after a successful connection (e.g. the connection
    // dropping mid-body-read) — fetchWithTimeout itself never throws.
    issues.push('dead');
    statusCode = 0;
  }

  // Staleness: only mark as stale if dateLastUsed is explicitly recorded and exceeds threshold
  if (staleDays && staleDays > 0 && typeof bookmark.dateLastUsed === 'number' && bookmark.dateLastUsed > 0) {
    const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
    if ((Date.now() - bookmark.dateLastUsed) > cutoffMs) {
      issues.push('stale');
    }
  }

  // Primary status: most actionable issue
  let status = 'ok';
  if (issues.includes('dead') || issues.includes('domain_gone')) status = 'dead';
  else if (issues.includes('redirect')) status = 'redirect';
  else if (issues.includes('stale')) status = 'stale';

  return {
    id: bookmark.id,
    url: bookmark.url,
    title: bookmark.title,
    dateAdded: bookmark.dateAdded,
    dateLastUsed: bookmark.dateLastUsed || null,
    status,
    issues,
    newUrl,
    newTitle,
    statusCode,
    challengeProtected,
    checkedAt: new Date().toISOString(),
    dismissed: false,
    fixed: false
  };
}

/**
 * Keeps successive requests to the same host at least HOST_POLITENESS_MS apart,
 * without serialising requests to *different* hosts the way a global inter-batch
 * sleep did. `hostLastRequestAt` is a Map scoped to a single runHealthCheck() run.
 */
async function politenessDelay(url, hostLastRequestAt) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  const now = Date.now();
  const earliestAllowed = (hostLastRequestAt.get(host) || 0) + HOST_POLITENESS_MS;
  hostLastRequestAt.set(host, Math.max(now, earliestAllowed));
  if (earliestAllowed > now) {
    await new Promise(resolve => setTimeout(resolve, earliestAllowed - now));
  }
}

/**
 * Runs a full health check on all bookmarks using a fixed-size worker pool: N workers
 * pull the next bookmark off a shared index instead of running in lock-step batches, so
 * one slow/hanging host costs a single worker slot (up to its own timeout) rather than
 * stalling the rest of a batch for the full timeout.
 * Stores progress and results in chrome.storage.local.
 * @returns {Promise<{ success: boolean, summary: object }>}
 */
async function runHealthCheck() {
  const settings = await chrome.storage.sync.get({ healthCheckStaleDays: 365 });
  const staleDays = settings.healthCheckStaleDays || 365;

  const bookmarks = await getAllBookmarks();
  const total = bookmarks.length;
  const sessionStore = getSessionStorage();

  const liveSummary = {
    total,
    dead: 0,
    redirected: 0,
    stale: 0,
    ok: 0
  };

  await sessionStore.set({
    healthCheckProgress: {
      inProgress: true,
      current: 0,
      total,
      summary: { ...liveSummary }
    }
  });

  const results = new Array(total);
  const hostLastRequestAt = new Map();

  let nextIndex = 0;
  let completed = 0;
  let lastProgressWriteAt = 0;
  const PROGRESS_WRITE_INTERVAL_MS = 500;

  // Progress writes are throttled — the UI only polls/listens every ~500ms anyway,
  // so writing (and broadcasting onChanged) more often than that is pure waste.
  async function writeProgress(force = false) {
    const now = Date.now();
    if (!force && (now - lastProgressWriteAt < PROGRESS_WRITE_INTERVAL_MS)) return;
    lastProgressWriteAt = now;
    await sessionStore.set({
      healthCheckProgress: {
        inProgress: completed < total,
        current: completed,
        total,
        summary: { ...liveSummary }
      }
    });
  }

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      await politenessDelay(bookmarks[i].url, hostLastRequestAt);
      const res = await checkSingleBookmark(bookmarks[i], staleDays);
      results[i] = res;

      // Update live counter
      if (res.issues.includes('dead') || res.issues.includes('domain_gone')) liveSummary.dead++;
      if (res.issues.includes('redirect')) liveSummary.redirected++;
      if (res.issues.includes('stale')) liveSummary.stale++;
      if (res.issues.length === 0) liveSummary.ok++;

      completed++;
      await writeProgress();
    }
  }

  const CONCURRENCY = 15;
  const workerCount = Math.min(CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const summary = {
    total: results.length,
    dead: results.filter(r => r.issues.includes('dead') || r.issues.includes('domain_gone')).length,
    redirected: results.filter(r => r.issues.includes('redirect')).length,
    stale: results.filter(r => r.issues.includes('stale')).length,
    ok: results.filter(r => !r.issues.includes('dead') && !r.issues.includes('domain_gone') && !r.issues.includes('redirect') && !r.issues.includes('stale')).length
  };

  await saveHealthCheckResults(results, summary);

  await sessionStore.set({
    healthCheckProgress: {
      inProgress: false,
      current: total,
      total,
      summary
    }
  });

  return { success: true, summary };
}

/**
 * Clean up legacy disk-persisted health check storage from chrome.storage.local
 */
async function cleanLegacyLocalHealthCheckStorage() {
  try {
    const localKeys = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(localKeys).filter(k => k === 'healthCheckMeta' || k === 'healthCheckProgress' || k.startsWith('hce_'));
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  } catch {}
}

// Clean up legacy disk storage on service worker initialization
cleanLegacyLocalHealthCheckStorage().catch(() => {});

/**
 * Health check results are stored in fast in-memory RAM (chrome.storage.session)
 * using one small key per bookmark (`hce_<id>`) plus a `healthCheckMeta` index.
 * Results exist only in RAM during the active browser session and are automatically
 * cleared when the browser closes.
 */
function healthCheckEntryKey(id) {
  return `hce_${id}`;
}

/**
 * Stores health-check results in RAM (chrome.storage.session),
 * clearing out entries from previous runs.
 */
async function saveHealthCheckResults(results, summary) {
  cleanLegacyLocalHealthCheckStorage().catch(() => {});
  const sessionStore = getSessionStorage();
  const prevStored = await sessionStore.get('healthCheckMeta');
  const prevIds = (prevStored.healthCheckMeta && prevStored.healthCheckMeta.ids) || [];
  const newIds = results.map(r => r.id);
  const newIdSet = new Set(newIds);
  const staleKeys = prevIds.filter(id => !newIdSet.has(id)).map(healthCheckEntryKey);

  if (staleKeys.length > 0) {
    await sessionStore.remove(staleKeys);
  }

  const entries = {};
  for (const r of results) entries[healthCheckEntryKey(r.id)] = r;

  await sessionStore.set({
    ...entries,
    healthCheckMeta: { lastRun: new Date().toISOString(), summary, ids: newIds }
  });
}

/**
 * Reconstructs health check results from fast in-memory session storage (RAM).
 * Returns empty if no check has been run in this browser session.
 */
async function getHealthCheckData() {
  cleanLegacyLocalHealthCheckStorage().catch(() => {});
  const sessionStore = getSessionStorage();
  const sessionStored = await sessionStore.get(['healthCheckMeta', 'healthCheckProgress']);
  const healthCheckProgress = sessionStored?.healthCheckProgress || null;
  const meta = sessionStored?.healthCheckMeta;
  if (!meta) {
    return { healthCheckProgress, healthCheckResults: null };
  }

  const entryKeys = meta.ids.map(healthCheckEntryKey);
  const entriesById = entryKeys.length > 0 ? await sessionStore.get(entryKeys) : {};
  const results = meta.ids.map(id => entriesById[healthCheckEntryKey(id)]).filter(Boolean);

  return {
    healthCheckResults: { lastRun: meta.lastRun, summary: meta.summary, results },
    healthCheckProgress
  };
}

/**
 * Applies a fix action to a single bookmark and updates its in-RAM entry.
 * @param {string} bookmarkId
 * @param {'updateUrl'|'updateTitle'|'delete'} fixType
 * @param {string} [newValue]
 */
async function applyHealthFix(bookmarkId, fixType, newValue) {
  try {
    if (fixType === 'updateUrl') {
      await chrome.bookmarks.update(bookmarkId, { url: newValue });
    } else if (fixType === 'updateTitle') {
      await chrome.bookmarks.update(bookmarkId, { title: newValue });
    } else if (fixType === 'delete') {
      await chrome.bookmarks.remove(bookmarkId);
    }

    const sessionStore = getSessionStorage();
    const metaStored = await sessionStore.get('healthCheckMeta');
    const meta = metaStored.healthCheckMeta;
    if (meta) {
      const entryKey = healthCheckEntryKey(bookmarkId);
      if (fixType === 'delete') {
        await sessionStore.remove(entryKey);
        meta.ids = meta.ids.filter(id => id !== bookmarkId);
        meta.summary.total = Math.max(0, meta.summary.total - 1);
        await sessionStore.set({ healthCheckMeta: meta });
      } else {
        const entryStored = await sessionStore.get(entryKey);
        const entry = entryStored[entryKey];
        if (entry) {
          entry.fixed = true;
          if (fixType === 'updateUrl') entry.url = newValue;
          if (fixType === 'updateTitle') entry.title = newValue;
          await sessionStore.set({ [entryKey]: entry });
        }
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Applies a bulk fix to multiple bookmarks in RAM and deletes bookmarks.
 * @param {'deleteAllDead'|'fixAllRedirects'} fixType
 * @param {string[]} ids
 */
async function applyBulkFix(fixType, ids) {
  const sessionStore = getSessionStorage();
  const metaStored = await sessionStore.get('healthCheckMeta');
  const meta = metaStored.healthCheckMeta;
  if (!meta) return { success: true };

  const entryKeys = ids.map(healthCheckEntryKey);
  const entriesById = await sessionStore.get(entryKeys);

  const toSet = {};
  const toRemoveKeys = [];
  const deletedIds = new Set();
  let modified = false;

  for (const id of ids) {
    const key = healthCheckEntryKey(id);
    const entry = entriesById[key];
    try {
      if (fixType === 'deleteAllDead' || fixType === 'deleteAllStale') {
        await chrome.bookmarks.remove(id);
        toRemoveKeys.push(key);
        deletedIds.add(id);
        modified = true;
      } else if (fixType === 'fixAllRedirects') {
        if (entry && entry.newUrl) {
          await chrome.bookmarks.update(id, { url: entry.newUrl });
          entry.fixed = true;
          entry.url = entry.newUrl;
          toSet[key] = entry;
          modified = true;
        }
      } else if (fixType === 'dismissAllStale') {
        if (entry) {
          entry.dismissed = true;
          toSet[key] = entry;
          modified = true;
        }
      }
    } catch (err) {
      console.error(`Bulk fix failed for bookmark ${id}:`, err);
    }
  }

  if (modified) {
    if (Object.keys(toSet).length > 0) {
      await sessionStore.set(toSet);
    }
    if (toRemoveKeys.length > 0) {
      await sessionStore.remove(toRemoveKeys);
      meta.ids = meta.ids.filter(id => !deletedIds.has(id));
    }
    meta.summary.total = meta.ids.length;
    await sessionStore.set({ healthCheckMeta: meta });
  }

  return { success: true };
}

/**
 * Dismisses a health check issue for a single bookmark in RAM without deleting it.
 * @param {string} bookmarkId
 */
async function dismissHealthIssue(bookmarkId) {
  const sessionStore = getSessionStorage();
  const entryKey = healthCheckEntryKey(bookmarkId);
  const stored = await sessionStore.get(entryKey);
  const entry = stored[entryKey];
  if (entry) {
    entry.dismissed = true;
    await sessionStore.set({ [entryKey]: entry });
  }
  return { success: true };
}

/**
 * Sets up (or clears) the periodic health-check alarm based on stored settings.
 */
async function setupHealthCheckAlarm() {
  await chrome.alarms.clear('bookmarkHealthCheck');

  const settings = await chrome.storage.sync.get({
    healthCheckEnabled: false,
    healthCheckInterval: 'weekly'
  });

  if (!settings.healthCheckEnabled) return;

  const intervalMinutes = {
    daily: 1440,
    weekly: 10080,
    monthly: 43200
  }[settings.healthCheckInterval] || 10080;

  chrome.alarms.create('bookmarkHealthCheck', { periodInMinutes: intervalMinutes });
}
/**
 * AIJbookmarks - WebGPU Offscreen Compute Engine
 *
 * Implements:
 * 1. Persistent in-VRAM storage buffers for bookmark token/feature indices
 * 2. Parallel WGSL compute shaders for similarity scoring & relevance ranking
 * 3. Parallel GPU Bitonic sorting in VRAM
 * 4. Zero-copy ArrayBuffer transfer and mapped memory staging
 */

let gpuDevice = null;
let gpuAdapter = null;
let isInitializing = false;

// Persistent In-VRAM Storage Buffers
let vramBookmarksBuffer = null;
let vramBookmarksCapacity = 0;
let vramBookmarkCount = 0;
let vramPipelines = null;

// Bookmark feature layout in uint32 units (16 uint32s = 64 bytes per bookmark)
// [0]: bookmarkId u32
// [1]: dateAddedSeconds u32
// [2]: titleTokenCount u32
// [3]: urlTokenCount u32
// [4..11]: 8 title token hashes (u32)
// [12..15]: 4 URL/domain token hashes (u32)
const BOOKMARK_STRUCT_U32_COUNT = 16;
const BOOKMARK_STRUCT_BYTE_SIZE = BOOKMARK_STRUCT_U32_COUNT * 4;

/**
 * WGSL Compute Shader Sources
 */
const SCORING_WGSL = /* wgsl */ `
struct QueryParams {
  keywordHashes: array<vec4<u32>, 4>, // up to 16 keyword hashes packed in vec4
  keywordCount: u32,
  afterDate: u32,
  beforeDate: u32,
  flags: u32, // bit 0: hasDateAfter, bit 1: hasDateBefore
}

struct BookmarkFeature {
  id: u32,
  dateAdded: u32,
  titleLen: u32,
  urlLen: u32,
  titleHashes: array<vec4<u32>, 2>, // 8 title token hashes
  urlHashes: vec4<u32>,            // 4 url token hashes
}

struct ScoreResult {
  score: f32,
  index: u32,
}

@group(0) @binding(0) var<uniform> query: QueryParams;
@group(0) @binding(1) var<storage, read> bookmarks: array<BookmarkFeature>;
@group(0) @binding(2) var<storage, read_write> results: array<ScoreResult>;
@group(0) @binding(3) var<uniform> totalCount: u32;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= totalCount) {
    return;
  }

  let bm = bookmarks[idx];

  // Date filtering
  let hasAfter = (query.flags & 1u) != 0u;
  let hasBefore = (query.flags & 2u) != 0u;
  if (hasAfter && bm.dateAdded < query.afterDate) {
    results[idx] = ScoreResult(0.0, idx);
    return;
  }
  if (hasBefore && bm.dateAdded > query.beforeDate) {
    results[idx] = ScoreResult(0.0, idx);
    return;
  }

  var score: f32 = 0.0;
  let numKeywords = min(query.keywordCount, 16u);

  // If no keywords provided, score based on date recency
  if (numKeywords == 0u) {
    let recencyScore = f32(bm.dateAdded) / 1000000.0;
    results[idx] = ScoreResult(recencyScore, idx);
    return;
  }

  var matchedKeywords: u32 = 0u;

  for (var k: u32 = 0u; k < numKeywords; k = k + 1u) {
    let qVecIdx = k / 4u;
    let qElemIdx = k % 4u;
    let qHash = query.keywordHashes[qVecIdx][qElemIdx];
    if (qHash == 0u) {
      continue;
    }

    var kwMatched = false;

    // Check title tokens (weight: 3.0)
    for (var t: u32 = 0u; t < 8u; t = t + 1u) {
      let tVecIdx = t / 4u;
      let tElemIdx = t % 4u;
      let tHash = bm.titleHashes[tVecIdx][tElemIdx];
      if (tHash != 0u && tHash == qHash) {
        score = score + 3.0;
        kwMatched = true;
      }
    }

    // Check URL tokens (weight: 1.5)
    for (var u: u32 = 0u; u < 4u; u = u + 1u) {
      let uHash = bm.urlHashes[u];
      if (uHash != 0u && uHash == qHash) {
        score = score + 1.5;
        kwMatched = true;
      }
    }

    if (kwMatched) {
      matchedKeywords = matchedKeywords + 1u;
    }
  }

  // Bonus for matching all query keywords
  if (matchedKeywords == numKeywords && numKeywords > 1u) {
    score = score * 1.5;
  }

  // Slight recency tie-breaker
  if (score > 0.0) {
    score = score + (f32(bm.dateAdded % 100000u) / 1000000.0);
  }

  results[idx] = ScoreResult(score, idx);
}
`;

const BITONIC_SORT_WGSL = /* wgsl */ `
struct SortParams {
  stage: u32,
  stepOfStage: u32,
  totalCount: u32,
  direction: u32, // 1: descending, 0: ascending
}

struct ScoreResult {
  score: f32,
  index: u32,
}

@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var<storage, read_write> data: array<ScoreResult>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  let pairDistance = 1u << params.stepOfStage;
  let blockWidth   = 2u * pairDistance;

  let leftId = (i / pairDistance) * blockWidth + (i % pairDistance);
  let rightId = leftId + pairDistance;

  if (rightId >= params.totalCount) {
    return;
  }

  let sameDirectionBlock = ((leftId / (1u << (params.stage + 1u))) % 2u) == 0u;
  let isDescending = (params.direction == 1u);
  let shouldBeAscending = select(isDescending, !isDescending, sameDirectionBlock);

  let leftElem = data[leftId];
  let rightElem = data[rightId];

  var shouldSwap: bool;
  if (shouldBeAscending) {
    shouldSwap = leftElem.score > rightElem.score;
  } else {
    shouldSwap = leftElem.score < rightElem.score;
  }

  if (shouldSwap) {
    data[leftId] = rightElem;
    data[rightId] = leftElem;
  }
}
`;

/**
 * Initializes WebGPU Device and creates compute shader pipelines
 */
async function initWebGPU() {
  if (gpuDevice) return { supported: true, device: gpuDevice };
  if (!navigator.gpu) {
    return { supported: false, reason: 'WebGPU not supported in this browser environment.' };
  }

  try {
    gpuAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!gpuAdapter) {
      return { supported: false, reason: 'Failed to acquire WebGPU adapter.' };
    }

    gpuDevice = await gpuAdapter.requestDevice();

    gpuDevice.lost.then((info) => {
      console.warn('WebGPU device was lost:', info);
      gpuDevice = null;
      vramBookmarksBuffer = null;
      vramPipelines = null;
    });

    // Compile compute pipelines
    const scoringModule = gpuDevice.createShaderModule({ code: SCORING_WGSL });
    const sortingModule = gpuDevice.createShaderModule({ code: BITONIC_SORT_WGSL });

    const scoringPipeline = gpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: scoringModule, entryPoint: 'main' }
    });

    const sortingPipeline = gpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: sortingModule, entryPoint: 'main' }
    });

    vramPipelines = { scoringPipeline, sortingPipeline };

    return {
      supported: true,
      adapterInfo: {
        vendor: gpuAdapter.info?.vendor || 'Generic GPU',
        architecture: gpuAdapter.info?.architecture || 'Generic Architecture',
        device: gpuAdapter.info?.device || 'WebGPU Device'
      }
    };
  } catch (err) {
    console.error('Error initializing WebGPU:', err);
    return { supported: false, reason: err.message };
  }
}

/**
 * Synchronizes/allocates persistent VRAM buffer with bookmark feature data
 * @param {ArrayBuffer} rawDataBuffer Binary packed bookmark features
 * @param {number} count Total number of bookmarks
 */
async function syncVramBookmarkIndex(rawDataBuffer, count) {
  const init = await initWebGPU();
  if (!init.supported) throw new Error(init.reason);

  const byteSize = count * BOOKMARK_STRUCT_BYTE_SIZE;
  if (byteSize === 0) {
    vramBookmarkCount = 0;
    return { success: true, count: 0, vramBytes: 0 };
  }

  // Allocate or resize VRAM buffer if capacity is insufficient
  if (!vramBookmarksBuffer || vramBookmarksCapacity < byteSize) {
    if (vramBookmarksBuffer) {
      vramBookmarksBuffer.destroy();
    }
    // Allocate with headroom (power of two or minimum 64KB)
    vramBookmarksCapacity = Math.max(65536, Math.pow(2, Math.ceil(Math.log2(byteSize))));
    vramBookmarksBuffer = gpuDevice.createBuffer({
      size: vramBookmarksCapacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'VRAM_Bookmark_Features_Buffer'
    });
  }

  // Zero-copy transfer data into VRAM buffer
  gpuDevice.queue.writeBuffer(
    vramBookmarksBuffer,
    0,
    rawDataBuffer,
    0,
    byteSize
  );

  vramBookmarkCount = count;
  return {
    success: true,
    count,
    vramBytes: vramBookmarksCapacity,
    allocatedMB: (vramBookmarksCapacity / (1024 * 1024)).toFixed(2)
  };
}

/**
 * Runs parallel scoring and bitonic sorting entirely in VRAM
 * @param {object} queryOptions
 * @returns {Promise<{results: Array<{index: number, score: number}>, durationMs: number}>}
 */
async function runParallelGpuSearchAndSort(queryOptions) {
  const init = await initWebGPU();
  if (!init.supported) throw new Error(init.reason);
  if (!vramBookmarksBuffer || vramBookmarkCount === 0) {
    return { results: [], durationMs: 0 };
  }

  const startTime = performance.now();
  const count = vramBookmarkCount;

  // Round up count to next power of 2 for bitonic sorting
  const paddedCount = Math.max(256, Math.pow(2, Math.ceil(Math.log2(count))));
  const scoreElementByteSize = 8; // f32 score + u32 index = 8 bytes
  const scoreBufferSize = paddedCount * scoreElementByteSize;

  // 1. Create Query Uniform Buffer
  // QueryParams layout:
  // 16 u32 keywordHashes (64 bytes)
  // 1 u32 keywordCount (4 bytes)
  // 1 u32 afterDate (4 bytes)
  // 1 u32 beforeDate (4 bytes)
  // 1 u32 flags (4 bytes)
  const queryUniformData = new Uint32Array(20);
  const keywordHashes = queryOptions.keywordHashes || [];
  for (let i = 0; i < Math.min(16, keywordHashes.length); i++) {
    queryUniformData[i] = keywordHashes[i];
  }
  queryUniformData[16] = keywordHashes.length;
  queryUniformData[17] = queryOptions.afterDateSeconds || 0;
  queryUniformData[18] = queryOptions.beforeDateSeconds || 0;
  let flags = 0;
  if (queryOptions.afterDateSeconds) flags |= 1;
  if (queryOptions.beforeDateSeconds) flags |= 2;
  queryUniformData[19] = flags;

  const queryBuffer = gpuDevice.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  gpuDevice.queue.writeBuffer(queryBuffer, 0, queryUniformData.buffer);

  const totalCountBuffer = gpuDevice.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  gpuDevice.queue.writeBuffer(totalCountBuffer, 0, new Uint32Array([count]));

  // 2. Create VRAM Scores Buffer & Staging Buffer
  const scoresBuffer = gpuDevice.createBuffer({
    size: scoreBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    label: 'VRAM_Scores_Buffer'
  });

  const stagingBuffer = gpuDevice.createBuffer({
    size: scoreBufferSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: 'Staging_Readback_Buffer'
  });

  // 3. Bind and Dispatch Scoring Shader
  const scoringBindGroup = gpuDevice.createBindGroup({
    layout: vramPipelines.scoringPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: queryBuffer } },
      { binding: 1, resource: { buffer: vramBookmarksBuffer } },
      { binding: 2, resource: { buffer: scoresBuffer } },
      { binding: 3, resource: { buffer: totalCountBuffer } }
    ]
  });

  const commandEncoder = gpuDevice.createCommandEncoder();
  const scorePass = commandEncoder.beginComputePass();
  scorePass.setPipeline(vramPipelines.scoringPipeline);
  scorePass.setBindGroup(0, scoringBindGroup);
  scorePass.dispatchWorkgroups(Math.ceil(count / 256));
  scorePass.end();

  // 4. Bitonic Sort Passes in VRAM (Descending Order)
  const numStages = Math.log2(paddedCount);
  const sortParamsBuffer = gpuDevice.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  for (let stage = 0; stage < numStages; stage++) {
    for (let step = stage; step >= 0; step--) {
      // SortParams: stage, stepOfStage, totalCount, direction (1 = descending)
      const sortParams = new Uint32Array([stage, step, paddedCount, 1]);
      gpuDevice.queue.writeBuffer(sortParamsBuffer, 0, sortParams);

      const sortBindGroup = gpuDevice.createBindGroup({
        layout: vramPipelines.sortingPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sortParamsBuffer } },
          { binding: 1, resource: { buffer: scoresBuffer } }
        ]
      });

      const sortPass = commandEncoder.beginComputePass();
      sortPass.setPipeline(vramPipelines.sortingPipeline);
      sortPass.setBindGroup(0, sortBindGroup);
      sortPass.dispatchWorkgroups(Math.ceil((paddedCount / 2) / 256));
      sortPass.end();
    }
  }

  // 5. Copy sorted VRAM scores buffer to mapped readback buffer
  commandEncoder.copyBufferToBuffer(scoresBuffer, 0, stagingBuffer, 0, scoreBufferSize);
  gpuDevice.queue.submit([commandEncoder.finish()]);

  // 6. Asynchronous Map & Zero-Copy Result Read
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const mappedArray = new ArrayBuffer(scoreBufferSize);
  new Uint8Array(mappedArray).set(new Uint8Array(stagingBuffer.getMappedRange()));
  stagingBuffer.unmap();

  // Parse Top-K results
  const topK = queryOptions.topK || 50;
  const floatView = new Float32Array(mappedArray);
  const uintView = new Uint32Array(mappedArray);
  const results = [];

  for (let i = 0; i < Math.min(count, paddedCount); i++) {
    const score = floatView[i * 2];
    const index = uintView[i * 2 + 1];
    if (score > 0 && results.length < topK) {
      results.push({ index, score: parseFloat(score.toFixed(4)) });
    }
  }

  // Clean up transient execution buffers
  queryBuffer.destroy();
  totalCountBuffer.destroy();
  scoresBuffer.destroy();
  sortParamsBuffer.destroy();
  stagingBuffer.destroy();

  const durationMs = parseFloat((performance.now() - startTime).toFixed(2));
  return { results, durationMs, totalProcessed: count };
}

/**
 * Message Dispatcher for Service Worker <-> Offscreen Communication
 */
