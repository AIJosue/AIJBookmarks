
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

/**
 * Known browser vendor/system folder names that should never be used as sorting destinations
 * or suggested targets for user bookmarks.
 */
const SYSTEM_FOLDER_NAMES = new Set([
  'mozilla firefox',
  'firefox',
  'help and tutorials',
  'customize firefox',
  'bookmarks bar',
  'bookmarks toolbar',
  'other bookmarks',
  'bookmarks menu',
  'mobile bookmarks',
  'unfiled bookmarks',
  'managed bookmarks',
  'root',
  'toolbar_____',
  'unfiled_____',
  'menu________',
  'mobile______'
]);

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

function getProtectedRootIds() {
  return new Set([
    String(BOOKMARK_ROOT_IDS.ROOT || '0'),
    String(BOOKMARK_ROOT_IDS.BAR || '1'),
    String(BOOKMARK_ROOT_IDS.OTHER || '2'),
    String(BOOKMARK_ROOT_IDS.MENU || 'menu________'),
    String(BOOKMARK_ROOT_IDS.MOBILE || '3'),
    '0', '1', '2', '3',
    'root________', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______'
  ].filter(Boolean));
}

// Listen for messages from popup and health-check page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const actionsWithResponse = [
    'analyzeBookmark', 'runHealthCheck', 'getHealthCheckData', 'applyHealthFix',
    'applyBulkFix', 'dismissHealthIssue', 'setupHealthCheckAlarm',
    'checkAIConfig', 'undoBookmark',
    'getUnsortedBookmarks', 'getSortingScopeFolders', 'getExistingFolders', 'getAISuggestion', 'getAISuggestionsBatch', 'cancelBatchAnalysis', 'getFolderOrganizationData', 'generateFolderOrganizationPlan', 'applyFolderOrganizationPlan', 'getCleanupPreview', 'applyCleanup', 'moveBookmarks', 'deleteBookmarks'
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
      case 'checkAIConfig': {
        const { hasAI, provider, settings } = await getAIConfig();
        let model = '';
        if (provider === 'openai') {
          model = settings.openaiCustomModel?.trim() || settings.openaiModel || 'gpt-4o-mini';
        } else if (provider === 'openrouter') {
          model = settings.openrouterModel || 'anthropic/claude-3.5-haiku';
        } else if (provider === 'gemini') {
          model = settings.geminiModel || 'gemini-2.5-flash';
        } else if (provider === 'google-cloud') {
          model = settings.googleCloudModel || 'gemini-2.5-flash';
        } else {
          model = settings.anthropicModel || 'claude-3-5-haiku-20241022';
        }
        sendResponse({
          hasAI,
          hasCloudAI: hasAI,
          cloudProvider: provider,
          cloudModel: model
        });
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
        if (!chrome.bookmarks?.getTree) {
          sendResponse({
            success: false,
            unsupported: true,
            folders: [],
            error: 'Firefox for Android does not support the WebExtensions Bookmarks API (Mozilla Bug 1796596).'
          });
          break;
        }
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
const textDecoder = new TextDecoder();

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
  if (!chrome.bookmarks?.getTree) {
    return { folders: [], folderPathMap: {}, allBookmarks: [] };
  }
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
  const rootIds = getProtectedRootIds();

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
if (chrome.bookmarks?.onCreated) {
  chrome.bookmarks.onCreated.addListener(invalidateBookmarkTreeCache);
  chrome.bookmarks.onRemoved?.addListener(invalidateBookmarkTreeCache);
  chrome.bookmarks.onChanged?.addListener(invalidateBookmarkTreeCache);
  chrome.bookmarks.onMoved?.addListener(invalidateBookmarkTreeCache);
  if (chrome.bookmarks['onChildrenReordered']) {
    chrome.bookmarks['onChildrenReordered'].addListener(invalidateBookmarkTreeCache);
  }
}

/**
 * Checks whether a folder path refers to a default browser system or vendor folder.
 */
function isSystemFolder(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') return true;
  const clean = folderPath.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!clean) return true;
  if (SYSTEM_FOLDER_NAMES.has(clean)) return true;
  const segments = clean.split('/').map(s => s.trim()).filter(Boolean);
  if (segments.length > 0 && (segments[0] === 'mozilla firefox' || segments[0] === 'firefox')) {
    return true;
  }
  if (segments.every(seg => SYSTEM_FOLDER_NAMES.has(seg))) {
    return true;
  }
  return false;
}

/**
 * Filters an array of folder paths, excluding system and browser vendor folders.
 */
function getUserFolders(folders) {
  if (!Array.isArray(folders)) return [];
  return folders.filter(f => !isSystemFolder(f));
}

/**
 * Scans the user's bookmark tree and extracts all folder paths, excluding browser system folders.
 * @returns {Promise<string[]>} Array of folder paths (e.g., "Work/Projects/Web")
 */
async function getExistingBookmarkFolders() {
  const { folders } = await getBookmarkTreeData();
  return getUserFolders(folders);
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
 * Extracts the final answer text from a Gemini generateContent response.
 * Skips reasoning ("thought") parts and reports blocked/truncated generations clearly.
 */
function extractGeminiText(data, label) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const answerParts = parts.filter(p => !p.thought);
  const text = answerParts.map(p => p.text || '').join('\n').trim();
  const reason = candidate?.finishReason;
  if (!text) {
    console.error(`No content in ${label} response:`, JSON.stringify(data));
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`${label} blocked the prompt (${data.promptFeedback.blockReason}).`);
    }
    if (reason === 'MAX_TOKENS') {
      throw new Error(`${label} ran out of output tokens before producing an answer (model reasoning used the budget). Try a smaller batch size.`);
    }
    throw new Error(`No content in ${label} response${reason ? ` (finishReason: ${reason})` : ''}`);
  }
  return text;
}

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
    const providerNames = {
      anthropic: 'Anthropic Claude',
      openai: 'OpenAI / Compatible',
      openrouter: 'OpenRouter',
      gemini: 'Google Gemini',
      'google-cloud': 'Google Cloud'
    };
    const providerName = providerNames[activeProvider] || (activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1));
    return `${providerName} API error: ${status}${short ? ` - ${short}` : ''}`;
  }

  function normalizeGeminiModel(model) {
    return (model || '').replace(/^models\//, '').trim();
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
      const baseUrl = rawBaseUrl.replace(/\/+$/, '');
      const openaiModel = settings.openaiCustomModel?.trim() || settings.openaiModel || 'gpt-4o-mini';
      const requestBody = {
        model: openaiModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      };
      if (openaiModel.startsWith('o1') || openaiModel.startsWith('o3') || openaiModel.startsWith('o4')) {
        delete requestBody.max_tokens;
        requestBody.max_completion_tokens = maxTokens;
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      if (settings.openaiApiKey && settings.openaiApiKey.trim()) {
        headers['Authorization'] = `Bearer ${settings.openaiApiKey.trim()}`;
      }

      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!response.ok && response.status === 400) {
          const errText = await response.clone().text();
          if (errText.includes('max_completion_tokens') && requestBody.max_tokens) {
            delete requestBody.max_tokens;
            requestBody.max_completion_tokens = maxTokens;
            response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal: controller.signal
            });
          } else if (errText.includes('max_tokens') && requestBody.max_completion_tokens) {
            delete requestBody.max_completion_tokens;
            requestBody.max_tokens = maxTokens;
            response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal: controller.signal
            });
          }
        }
      } catch (error) {
        console.error('Error calling OpenAI / Compatible API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`OpenAI API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
        }
        throw new Error(`Failed to call OpenAI API (${settings.openaiBaseUrl || 'https://api.openai.com/v1'}): ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API error:', response.status, errorText);
        throw new Error(formatProviderApiError('openai', response.status, errorText));
      }

      const message = await response.json();
      const choice = message.choices?.[0];
      const responseText = choice?.message?.content || choice?.text;
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
      const openrouterModel = settings.openrouterModel?.trim() || 'anthropic/claude-3.5-haiku';
      const requestBody = {
        model: openrouterModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      };
      let response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openrouterApiKey.trim()}`,
            'HTTP-Referer': 'https://github.com/aijbookmarks',
            'X-Title': 'AIJbookmarks'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } catch (error) {
        console.error('Error calling OpenRouter API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`OpenRouter API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
        }
        throw new Error(`Failed to call OpenRouter API: ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouter API error:', response.status, errorText);
        throw new Error(formatProviderApiError('openrouter', response.status, errorText));
      }

      const message = await response.json();
      const choice = message.choices?.[0];
      const responseText = choice?.message?.content || choice?.text;
      if (!responseText) {
        console.error('No content in OpenRouter response:', JSON.stringify(message));
        throw new Error('No content in OpenRouter response');
      }
      const inputTokens = message.usage?.prompt_tokens ?? estimateTokensFromText(prompt);
      const outputTokens = message.usage?.completion_tokens ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else if (provider === 'google-cloud') {
      const rawApiKey = typeof settings.googleCloudApiKey === 'string' ? settings.googleCloudApiKey.trim() : '';
      if (!rawApiKey) {
        throw new Error('Google Cloud API key not configured. Please configure it in Extension Settings.');
      }
      const model = String(settings.googleCloudModel || '').replace(/^models\//, '').trim() || 'gemini-2.5-flash';
      let response;
      try {
        response = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': rawApiKey
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        });
      } catch (error) {
        console.error('Error calling Google Cloud API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`Google Cloud API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
        }
        throw new Error(`Failed to call Google Cloud API: ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Cloud API error:', response.status, errorText);
        throw new Error(formatProviderApiError('google-cloud', response.status, errorText));
      }

      const data = await response.json();
      const responseText = extractGeminiText(data, 'Google Cloud');
      const inputTokens = data.usageMetadata?.promptTokenCount ?? estimateTokensFromText(prompt);
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else if (provider === 'gemini') {
      const geminiKey = typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '';
      if (!geminiKey) {
        throw new Error('Gemini API key not configured. Please configure it in Extension Settings.');
      }
      const model = normalizeGeminiModel(settings.geminiModel) || 'gemini-2.5-flash';
      let response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiKey
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        });
      } catch (error) {
        console.error('Error calling Gemini API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`Gemini API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
        }
        throw new Error(`Failed to call Gemini API: ${error.message}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        throw new Error(formatProviderApiError('gemini', response.status, errorText));
      }

      const data = await response.json();
      const responseText = extractGeminiText(data, 'Gemini');
      const inputTokens = data.usageMetadata?.promptTokenCount ?? estimateTokensFromText(prompt);
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokensFromText(responseText);
      return { responseText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
    } else {
      if (!settings.anthropicApiKey || !settings.anthropicApiKey.trim()) {
        throw new Error('Anthropic Claude API key is not configured. Please open Extension Settings to enter your API key.');
      }
      const anthropicModel = (settings.anthropicModel || '').trim() || 'claude-3-5-haiku-20241022';
      let response;
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
      } catch (error) {
        console.error('Error calling Anthropic API:', error);
        if (error.name === 'AbortError') {
          throw new Error(`Anthropic API request timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
        }
        throw new Error(`Failed to call Anthropic API: ${error.message}`);
      }

      if (!response || !response.ok) {
        const errorText = await response.text();
        console.error('Anthropic API error:', response?.status, errorText);
        throw new Error(formatProviderApiError('anthropic', response?.status || 500, errorText));
      }

      const message = await response.json();
      const textBlocks = (message.content || []).filter(block => block.type === 'text');
      const responseText = textBlocks.map(b => b.text).join('\n').trim();
      if (!responseText) {
        console.error('No text content in Claude response. Response:', JSON.stringify(message.content));
        throw new Error('No text content in Claude response');
      }
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

  const result = extractJsonPayload(responseText, 'object');
  if (!result) {
    console.error('Could not find JSON in AI response. Response text:', responseText);
    throw new Error('Could not find valid JSON object in AI response');
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
      anthropicModel: '',
      openaiApiKey: '',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: '',
      openaiCustomModel: '',
      openrouterApiKey: '',
      openrouterModel: '',
      geminiApiKey: '',
      geminiModel: '',
      googleCloudApiKey: '',
      googleCloudModel: '',
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
      if (chrome.bookmarks?.create) {
        const categoryPath = analysis.matchedCategory || 'Other';
        bookmarkId = await createBookmarkInCategory(url, analysis.title || title, categoryPath);
        bookmarkCreated = true;
      } else {
        console.warn('Bookmarks API not supported on this platform (Firefox for Android). Skipped local bookmark creation.');
      }
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
 * Helper to strip root container prefixes ("Bookmarks Bar/", "Bookmarks Toolbar/", "Other Bookmarks/", etc.)
 * from a category or folder path to yield its clean canonical relative path.
 */
function stripRootFolderPrefix(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') return '';
  let clean = folderPath.trim().replace(/^\/+|\/+$/g, '');
  const rootPrefixes = [
    'bookmarks bar/', 'bookmarks bar /', 'bookmarks toolbar/', 'bookmarks toolbar /', 'toolbar/', 'bookmarks/',
    'other bookmarks/', 'other bookmarks /', 'unfiled bookmarks/', 'unfiled/', 'other/',
    'bookmarks menu/', 'bookmarks menu /', 'menu/',
    'mobile bookmarks/', 'mobile bookmarks /', 'mobile/'
  ];
  for (const prefix of rootPrefixes) {
    if (clean.toLowerCase().startsWith(prefix)) {
      clean = clean.slice(prefix.length).trim().replace(/^\/+|\/+$/g, '');
      break;
    }
  }
  return clean;
}

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

  // 1. If categoryPath is already a valid existing folder ID directly, return it
  if (categoryPath) {
    try {
      const [existingNode] = await chrome.bookmarks.get(String(categoryPath));
      if (existingNode && !existingNode.url) {
        return String(existingNode.id);
      }
    } catch {
      // Continue to path resolution
    }
  }

  // 2. If categoryPath matches an already existing folder, return its ID directly without creating duplicates
  const existingFolderId = await findExistingFolderId(categoryPath);
  if (existingFolderId) {
    const isExplicitRoot = categoryPath === BOOKMARK_ROOT_IDS.BAR || categoryPath === BOOKMARK_ROOT_IDS.OTHER || categoryPath === BOOKMARK_ROOT_IDS.MENU || categoryPath === BOOKMARK_ROOT_IDS.MOBILE || ['bookmarks bar', 'bookmarks toolbar', 'bookmarks menu', 'other bookmarks'].includes(String(categoryPath).trim().toLowerCase());
    if (existingFolderId !== BOOKMARK_ROOT_IDS.BAR && existingFolderId !== BOOKMARK_ROOT_IDS.OTHER && existingFolderId !== BOOKMARK_ROOT_IDS.MENU) {
      return existingFolderId;
    }
    if (isExplicitRoot) {
      return existingFolderId;
    }
  }

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

  // Strip any root prefixes so we don't create folders like "Bookmarks Bar" inside baseParentId
  const strippedPath = stripRootFolderPrefix(categoryPath);
  let segments = String(strippedPath || '').split('/').map(c => c.trim()).filter(c => c.length > 0 && !isSystemFolder(c));
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

  // 1. Check if rawPath is already a valid existing folder ID directly
  if (folderPathMap[rawPath] || rawPath === BOOKMARK_ROOT_IDS.BAR || rawPath === BOOKMARK_ROOT_IDS.OTHER || rawPath === BOOKMARK_ROOT_IDS.MENU || rawPath === BOOKMARK_ROOT_IDS.MOBILE) {
    return rawPath;
  }
  try {
    const [existingNode] = await chrome.bookmarks.get(rawPath);
    if (existingNode && !existingNode.url) {
      return String(existingNode.id);
    }
  } catch {
    // Continue
  }

  // Build normalized lookup maps: normalizedPath -> folderId
  const normalizedMap = new Map();
  for (const [id, path] of Object.entries(folderPathMap)) {
    normalizedMap.set(path.trim().toLowerCase(), id);
  }

  // Strip leading/trailing slashes
  const cleanPath = rawPath.replace(/^\/+|\/+$/g, '').trim();
  const lowerClean = cleanPath.toLowerCase();

  // 2. Direct check or lowercase check
  if (normalizedMap.has(lowerClean)) {
    return normalizedMap.get(lowerClean);
  }

  // 3. Strip root prefixes (e.g. "Bookmarks Bar/Work/Projects" -> "work/projects")
  const stripped = stripRootFolderPrefix(cleanPath).toLowerCase();
  if (stripped && normalizedMap.has(stripped)) {
    return normalizedMap.get(stripped);
  }

  // 4. Root container direct names
  if (['bookmarks bar', 'bookmarks', 'bookmarks toolbar', 'toolbar'].includes(lowerClean)) return BOOKMARK_ROOT_IDS.BAR;
  if (['other bookmarks', 'other', 'unfiled bookmarks', 'unfiled'].includes(lowerClean)) return BOOKMARK_ROOT_IDS.OTHER;
  if (['bookmarks menu', 'menu'].includes(lowerClean)) return BOOKMARK_ROOT_IDS.MENU || BOOKMARK_ROOT_IDS.BAR;

  // 5. Match leaf subfolder names (e.g. "Projects" matching "Work/Projects")
  const leafCandidates = [];
  for (const [id, path] of Object.entries(folderPathMap)) {
    const parts = path.trim().toLowerCase().split('/');
    if (parts[parts.length - 1] === stripped || parts[parts.length - 1] === lowerClean) {
      leafCandidates.push(id);
    }
  }
  if (leafCandidates.length === 1) {
    return leafCandidates[0];
  }

  // 6. Try matching parent segments from longest to shortest
  const segments = (stripped || cleanPath).split('/').map(s => s.trim()).filter(Boolean);
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
  const userFolders = getUserFolders(existingFolders);
  const fallbackFolder = userFolders[0] || 'Bookmarks Bar';

  const rawTrimmed = (suggestedCategory || '').trim().replace(/^\/+|\/+$/g, '');
  if (!rawTrimmed) return fallbackFolder;

  // Strip any root container prefixes
  const stripped = stripRootFolderPrefix(rawTrimmed);
  const trimmed = stripped || rawTrimmed;

  // Never route bookmarks into browser vendor/system folders
  if (isSystemFolder(trimmed) || isSystemFolder(rawTrimmed)) {
    return fallbackFolder;
  }

  // Check if it already matches an existing user folder (full subfolder path)
  const lower = trimmed.toLowerCase();
  const exactMatch = userFolders.find(f => f.toLowerCase() === lower);
  if (exactMatch) return exactMatch;

  // Check if it matches an existing leaf folder name (e.g. "Projects" -> "Work/Projects")
  const leafMatch = userFolders.find(f => {
    const parts = f.toLowerCase().split('/');
    return parts[parts.length - 1] === lower;
  });
  if (leafMatch) return leafMatch;

  if (allowCreateFolders) {
    const allowRecursive = options?.allowRecursive !== false;
    if (!allowRecursive && trimmed.includes('/')) {
      const firstSegment = trimmed.split('/')[0].trim();
      if (isSystemFolder(firstSegment)) return fallbackFolder;
      return firstSegment || trimmed;
    }
    return trimmed;
  }

  if (userFolders.length === 0) return fallbackFolder;

  // Try matching parent segments in user folders
  const segments = trimmed.split('/').map(s => s.trim()).filter(Boolean);
  while (segments.length > 1) {
    segments.pop();
    const parent = segments.join('/').toLowerCase();
    const parentMatch = userFolders.find(f => f.toLowerCase() === parent);
    if (parentMatch) return parentMatch;
  }

  // Try segment or significant word match in user folders
  const words = lower.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  if (words.length > 0) {
    const wordMatch = userFolders.find(f => {
      const fLower = f.toLowerCase();
      const fSegments = fLower.split('/').map(s => s.trim());
      return fSegments.some(seg => words.includes(seg) || (seg.length >= 3 && lower.includes(seg)));
    });
    if (wordMatch) return wordMatch;
  }

  // Fallback to first user folder or Bookmarks Bar, NEVER a system folder
  return fallbackFolder;
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
  if (!chrome.bookmarks?.getChildren) {
    return {
      bookmarks: [],
      scopeLabel: 'Bookmarks are not supported on Firefox for Android',
      unsupported: true,
      error: 'Firefox for Android does not support the WebExtensions Bookmarks API (Mozilla Bug 1796596). Please sync your bookmarks with Firefox Desktop via Firefox Sync to use AI bookmark sorting.'
    };
  }
  await initializeRootIds();
  if (scope?.type === 'folder') {
    const folderId = String(scope.folderId || '');
    if (!folderId) {
      return {
        bookmarks: [],
        scopeLabel: 'None selected',
        noFolderSelected: true
      };
    }
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
    scopeLabel: 'direct bookmarks in your Bookmarks Toolbar, Menu, and Other Bookmarks'
  };
}

/**
 * Returns all user folders and major root containers for the explicit sorting-scope picker.
 * IDs, not paths, are used when sorting to avoid ambiguity between folders with the same name.
 */
async function getSortingScopeFolders() {
  if (!chrome.bookmarks?.getTree) {
    return [];
  }
  await initializeRootIds();
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const rootNode = tree?.[0];
  if (!rootNode) return folders;

  function getRootLabel(nodeId, title) {
    const sId = String(nodeId);
    if (sId === String(BOOKMARK_ROOT_IDS.BAR) || sId === '1' || sId === 'toolbar_____') return 'Bookmarks Toolbar';
    if (sId === String(BOOKMARK_ROOT_IDS.OTHER) || sId === '2' || sId === 'unfiled_____') return 'Other Bookmarks';
    if (sId === String(BOOKMARK_ROOT_IDS.MENU) || sId === 'menu________') return 'Bookmarks Menu';
    if (sId === String(BOOKMARK_ROOT_IDS.MOBILE) || sId === '3' || sId === 'mobile______') return 'Mobile Bookmarks';
    return title || 'Bookmarks';
  }

  const rootChildren = rootNode.children || [];
  for (const rootChild of rootChildren) {
    if (rootChild.url) continue;
    const rootId = String(rootChild.id);
    const rootLabel = getRootLabel(rootId, rootChild.title);
    const directBookmarks = (rootChild.children || []).filter(c => Boolean(c.url));

    // Always include top-level root containers so users can sort direct bookmarks in Toolbar, Menu, Other!
    folders.push({
      id: rootId,
      title: rootLabel,
      path: rootLabel,
      rootName: rootLabel,
      depth: 0,
      isRoot: true,
      directBookmarkCount: directBookmarks.length
    });

    // Walk subfolders recursively
    function walkSubfolders(children, parentPath, depth) {
      for (const node of children || []) {
        if (node.url) continue;
        const title = node.title || 'Untitled folder';
        const canonicalPath = `${parentPath}/${title}`;
        if (isSystemFolder(canonicalPath) || isSystemFolder(title)) continue;

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
          walkSubfolders(node.children, canonicalPath, depth + 1);
        }
      }
    }

    if (rootChild.children && rootChild.children.length > 0) {
      walkSubfolders(rootChild.children, rootLabel, 1);
    }
  }

  // Sort root containers in logical order first, then subfolders alphabetically
  const rootOrder = ['Bookmarks Toolbar', 'Bookmarks Bar', 'Bookmarks Menu', 'Other Bookmarks', 'Mobile Bookmarks'];
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
  if (expectedType === 'array') {
    // Salvage complete objects from a truncated array (e.g. output cut off mid-response).
    const start = text.indexOf('[');
    if (start >= 0) {
      const objs = [];
      let depth = 0, objStart = -1, inStr = false, esc = false;
      for (let i = start + 1; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') { if (depth++ === 0) objStart = i; }
        else if (ch === '}' && --depth === 0 && objStart >= 0) {
          try { objs.push(JSON.parse(text.slice(objStart, i + 1))); } catch { /* skip malformed object */ }
          objStart = -1;
        }
      }
      if (objs.length) return objs;
    }
  }
  return null;
}

async function handleGetAISuggestion({ url, title }) {
  const { settings, provider, hasAI } = await getAIConfig();
  const ruleFolder = matchesDomainRule(url, settings.domainRules || []);
  if (ruleFolder) {
    return { success: true, matchedCategory: ruleFolder };
  }

  if (!hasAI) {
    return {
      success: false,
      error: 'No AI provider configured. Please configure an API key (Gemini, Claude, OpenAI, or OpenRouter) in Settings.'
    };
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

  if (!hasAI) {
    return {
      success: false,
      error: 'No AI provider configured. Please configure an API key (Gemini, Claude, OpenAI, or OpenRouter) in Settings.'
    };
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

  const userFolders = getUserFolders(existingFolders);

  if (!allowCreateFolders) {
    if (userFolders.length > 0) {
      folderListText = userFolders.slice(0, 300).join('\n');
      promptInstructions = `You are sorting bookmarks into existing user folders. You MUST ONLY choose from the list of Existing Folders below. Do NOT invent new folders, do NOT modify folder names, and do NOT create category paths that are not in the list. Under NO circumstances should you place bookmarks into browser vendor folders like "Mozilla Firefox" or default browser system folders.

Existing Folders:
${folderListText}`;
    } else {
      promptInstructions = 'No custom bookmark folders exist. Assign every bookmark to "Bookmarks Bar". Do NOT create new folders.';
    }
  } else {
    let locationNote = '';
    if (newFolderLocation === 'root-other') {
      locationNote = ' Any new folders will be placed in "Other Bookmarks".';
    } else if (newFolderLocation && newFolderLocation !== 'root-bar') {
      const locFolder = userFolders.find(f => f.includes(newFolderLocation)) || newFolderLocation;
      locationNote = ` Any new folders will be placed inside folder "${locFolder}".`;
    }

    const recursiveNote = allowRecursive
      ? 'You may suggest nested subfolder paths (e.g. "Work/Development") when appropriate.'
      : 'Do NOT suggest nested multi-level folder paths (e.g. do NOT output "A/B/C"). Suggest ONLY single-level concise folder names (e.g. "Development", "Finance", "News").';

    if (userFolders.length > 0) {
      folderListText = userFolders.slice(0, 300).join('\n');
      promptInstructions = `Choose the single best folder category for each bookmark. Use an existing folder from the list below when it is a good fit; otherwise you may suggest a new concise folder name.${locationNote} ${recursiveNote} NEVER place bookmarks into browser vendor folders like "Mozilla Firefox".

Existing Folders:
${folderListText}`;
    } else {
      promptInstructions = `For each bookmark, suggest a concise category name (e.g. "Development", "Design", "News", "Shopping", "Finance").${locationNote} ${recursiveNote} NEVER place bookmarks into browser vendor folders like "Mozilla Firefox".`;
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
  const rootIds = getProtectedRootIds();

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
  const rootIds = getProtectedRootIds();

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
  const protectedIds = getProtectedRootIds();
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
  const protectedIds = getProtectedRootIds();

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
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.contextMenus?.create) {
    chrome.contextMenus.create({
      id: 'aijbookmarks',
      title: 'Analyze and Bookmark with AI',
      contexts: ['page']
    });
  }
  // Set up health check alarm based on saved settings
  setupHealthCheckAlarm().catch(console.error);
});

// Handle context menu clicks
if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === 'aijbookmarks') {
      if (chrome.action?.openPopup) {
        chrome.action.openPopup().catch(() => {});
      }
    }
  });
}

// Run periodic health check when alarm fires
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bookmarkHealthCheck') {
    runHealthCheck().catch(console.error);
  }
});

// ============================================================
// AI Batch Utilities
// ============================================================

/**
 * Gets AI provider settings and validates credentials.
 * @returns {Promise<{settings: object, provider: string, hasAI: boolean}>}
 */
async function getAIConfig() {
  const defaults = {
    aiProvider: 'anthropic',
    anthropicApiKey: '',
    anthropicModel: '',
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: '',
    openaiCustomModel: '',
    modelContextWindow: 131072,
    openrouterApiKey: '',
    openrouterModel: '',
    geminiApiKey: '',
    geminiModel: '',
    googleCloudApiKey: '',
    googleCloudModel: '',
    domainRules: [],
    sortAllowCreateFolders: false,
    sortNewFolderLocation: 'root-bar',
    sortAllowRecursiveFolders: false,
    sortBatchSize: 100,
    sortBatchConcurrency: 4
  };

  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(defaults).catch(() => ({})),
    chrome.storage.local.get(defaults).catch(() => ({}))
  ]);
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

    if (!response || response.status >= 400) {
      abortResponseBody(response);
      response = await fetchWithTimeout(bookmark.url, 'GET', TIMEOUT_MS);
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
  if (!chrome.bookmarks?.getTree) {
    return {
      success: false,
      unsupported: true,
      error: 'Firefox for Android does not support the WebExtensions Bookmarks API (Mozilla Bug 1796596). Please use Firefox Desktop to audit bookmarks.'
    };
  }
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
  } catch {
    // Best-effort cleanup; ignore storage errors.
  }
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
