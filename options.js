// Default settings
const DEFAULT_SETTINGS = {
  aiProvider: 'anthropic',
  anthropicApiKey: '',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: '',
  openaiCustomModel: '',
  modelContextWindow: 131072,
  openrouterApiKey: '',
  openrouterModel: '',
  geminiApiKey: '',
  geminiModel: 'gemini-3.6-flash',
  googleCloudApiKey: '',
  googleCloudModel: 'gemini-3.7-flash',
  localModelContext: 8192,
  instapaperUsername: '',
  instapaperPassword: '',
  todoistApiToken: '',
  instapaperEnabled: false,
  todoistEnabled: false,
  thingsEnabled: false,
  domainRules: [],
  readwiseEnabled: false,
  readwiseAccessToken: '',
  raindropEnabled: false,
  raindropAccessToken: '',
  healthCheckEnabled: false,
  healthCheckInterval: 'weekly',
  healthCheckStaleDays: 365,
  healthCheckTypes: { dead: true, domainGone: true, redirects: true, stale: true, titleChanged: true },
  healthCheckRunOnOpen: true,
  instapaperCheckedByDefault: false,
  todoistCheckedByDefault: false,
  thingsCheckedByDefault: false,
  readwiseCheckedByDefault: false,
  raindropCheckedByDefault: false,
  sortBatchSize: 100,
  sortBatchConcurrency: 4
};

const BINARY_CONTEXT_STEPS = [
  { value: 4096, label: '4K (4,096 tokens)' },
  { value: 8192, label: '8K (8,192 tokens)' },
  { value: 16384, label: '16K (16,384 tokens)' },
  { value: 32768, label: '32K (32,768 tokens)' },
  { value: 65536, label: '64K (65,536 tokens)' },
  { value: 131072, label: '128K (131,072 tokens)' },
  { value: 262144, label: '256K (262,144 tokens)' },
  { value: 524288, label: '512K (524,288 tokens)' },
  { value: 1048576, label: '1M (1,048,576 tokens)' },
  { value: 2097152, label: '2M (2,097,152 tokens)' }
];

function snapToNearestBinaryContext(value) {
  const num = parseInt(value, 10);
  if (isNaN(num)) return 131072;
  let closest = BINARY_CONTEXT_STEPS[0];
  let minDiff = Math.abs(num - closest.value);
  for (const step of BINARY_CONTEXT_STEPS) {
    const diff = Math.abs(num - step.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = step;
    }
  }
  return closest.value;
}

function getBinaryStepIndex(value) {
  const snapped = snapToNearestBinaryContext(value);
  const idx = BINARY_CONTEXT_STEPS.findIndex(s => s.value === snapped);
  return idx >= 0 ? idx : 5;
}

function clampSortBatchSize(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return 100;
  return Math.max(5, Math.min(100, num));
}

function clampSortBatchConcurrency(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return 4;
  return Math.max(1, Math.min(10, num));
}

let currentProvider = 'anthropic';
let domainRules = [];

const CONTEXT_WINDOW_PRESETS = {
  anthropic: [
    { value: 262144, label: 'Recommended (256k)' },
    { value: 131072, label: 'Standard (128k)' },
    { value: 1048576, label: '1M Context' }
  ],
  openai: [
    { value: 131072, label: 'Recommended (128k)' },
    { value: 262144, label: 'Large (256k)' },
    { value: 1048576, label: '1M Context' }
  ],
  openrouter: [
    { value: 131072, label: 'Recommended (128k)' },
    { value: 262144, label: 'Large (256k)' },
    { value: 1048576, label: '1M Context' }
  ],
  gemini: [
    { value: 1048576, label: 'Recommended (1M)' },
    { value: 131072, label: 'Standard (128k)' },
    { value: 262144, label: 'Large (256k)' },
    { value: 2097152, label: '2M Context' }
  ]
};

const FALLBACK_PRESETS = [
  { value: 131072, label: 'Standard (128k)' },
  { value: 262144, label: 'Large (256k)' },
  { value: 1048576, label: '1M Context' }
];

const _CONTEXT_WINDOW_LIMITS = {
  min: 4096,
  max: 2097152,
  fallback: 131072
};

const SEMANTIC_BATCH_ESTIMATE = {
  defaultProfile: {
    inputBudgetRatio: 0.75,
    reservedTokens: 2500,
    fixedPromptTokens: 250,
    defaultIntentTokens: 12,
    estimatedTokensPerBookmark: 60
  },
  providerProfiles: {
    anthropic: {
      inputBudgetRatio: 0.72,
      reservedTokens: 3000,
      fixedPromptTokens: 280,
      defaultIntentTokens: 12,
      estimatedTokensPerBookmark: 62
    },
    openai: {
      inputBudgetRatio: 0.75,
      reservedTokens: 2500,
      fixedPromptTokens: 250,
      defaultIntentTokens: 12,
      estimatedTokensPerBookmark: 58
    },
    openrouter: {
      inputBudgetRatio: 0.74,
      reservedTokens: 2600,
      fixedPromptTokens: 260,
      defaultIntentTokens: 12,
      estimatedTokensPerBookmark: 60
    },
    gemini: {
      inputBudgetRatio: 0.8,
      reservedTokens: 3000,
      fixedPromptTokens: 240,
      defaultIntentTokens: 12,
      estimatedTokensPerBookmark: 54
    }
  },
  sampleCandidateCounts: [200, 600, 1200]
};

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', () => {
  // Navigation tab switching
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(item.dataset.section).classList.add('active');
      if (item.dataset.section === 'section-rules') {
        loadFolderSuggestions();
      }
      if (item.dataset.section === 'section-local-models') {
        refreshEmbeddingModelUI();
        refreshCustomLLMUI();
        refreshCustomModelUI();
      }
    });
  });

  // Health check interval tabs
  document.querySelectorAll('.interval-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.interval-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      triggerAutoSave();
    });
  });

  document.getElementById('healthCheckEnabled').addEventListener('change', () => {
    const enabled = document.getElementById('healthCheckEnabled').checked;
    document.getElementById('intervalGroup').style.opacity = enabled ? '1' : '0.4';
    document.getElementById('staleGroup').style.opacity = enabled ? '1' : '0.4';
    document.getElementById('checkTypesGroup').style.opacity = enabled ? '1' : '0.4';
  });

  const dependencyPairs = [
    ['instapaperEnabled', 'instapaperCheckedByDefaultGroup'],
    ['todoistEnabled', 'todoistCheckedByDefaultGroup'],
    ['thingsEnabled', 'thingsCheckedByDefaultGroup'],
    ['readwiseEnabled', 'readwiseCheckedByDefaultGroup'],
    ['raindropEnabled', 'raindropCheckedByDefaultGroup']
  ];
  dependencyPairs.forEach(([enabledId]) => {
    const enabledInput = document.getElementById(enabledId);
    if (enabledInput) {
      enabledInput.addEventListener('change', () => {
        syncToggleDependencies();
      });
    }
  });

  loadSettings();
  loadFolderSuggestions();
  initLocalEmbeddingModelUI();


  // Provider tab switching
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentProvider = tab.dataset.provider;
      updateProviderUI(currentProvider);
      triggerAutoSave();
    });
  });

  document.getElementById('loadModelsBtn').addEventListener('click', () => loadOpenRouterModels(null, true));
  document.getElementById('loadOpenaiModelsBtn')?.addEventListener('click', () => loadOpenaiModels(true));
  document.getElementById('loadGeminiModelsBtn')?.addEventListener('click', () => loadGeminiModels(true, null, false));
  document.getElementById('loadGoogleCloudModelsBtn')?.addEventListener('click', () => loadGeminiModels(true, null, true));
  document.getElementById('openaiModel')?.addEventListener('change', (e) => {
    const customGroup = document.getElementById('openaiCustomModelGroup');
    if (customGroup) {
      customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    }
    triggerAutoSave();
  });
  document.getElementById('openaiCustomModel')?.addEventListener('input', () => {
    triggerAutoSave();
  });
  document.getElementById('openaiBaseUrl')?.addEventListener('input', () => {
    triggerAutoSave();
  });

  const presetSelect = document.getElementById('modelContextWindowPreset');
  const windowInput = document.getElementById('modelContextWindow');
  const slider = document.getElementById('contextWindowSlider');
  const valueDisplay = document.getElementById('contextWindowValueDisplay');

  if (slider && windowInput) {
    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value, 10) || 0;
      const step = BINARY_CONTEXT_STEPS[idx] || BINARY_CONTEXT_STEPS[5];
      windowInput.value = step.value;
      if (valueDisplay) valueDisplay.textContent = step.label;
      syncContextWindowPresetFromInput(currentProvider);
      updateContextWindowEstimate();
      updateSliderTicksHighlight(idx);
    });

    slider.addEventListener('change', () => {
      triggerAutoSave();
    });
  }

  document.querySelectorAll('.slider-ticks span').forEach(span => {
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => {
      const idx = parseInt(span.dataset.index, 10);
      if (!isNaN(idx) && slider && windowInput) {
        slider.value = idx;
        const step = BINARY_CONTEXT_STEPS[idx] || BINARY_CONTEXT_STEPS[5];
        windowInput.value = step.value;
        if (valueDisplay) valueDisplay.textContent = step.label;
        syncContextWindowPresetFromInput(currentProvider);
        updateContextWindowEstimate();
        updateSliderTicksHighlight(idx);
        triggerAutoSave();
      }
    });
  });

  if (presetSelect && windowInput && slider) {
    presetSelect.addEventListener('change', () => {
      if (presetSelect.value === 'custom') return;
      const val = snapToNearestBinaryContext(presetSelect.value);
      windowInput.value = val;
      const idx = getBinaryStepIndex(val);
      slider.value = idx;
      if (valueDisplay) valueDisplay.textContent = BINARY_CONTEXT_STEPS[idx].label;
      updateContextWindowEstimate();
      updateSliderTicksHighlight(idx);
      triggerAutoSave();
    });
  }

  const addRule = async () => {
    const domainInput = document.getElementById('newRuleDomain');
    const folderInput = document.getElementById('newRuleFolder');
    const domain = domainInput.value.trim();
    const folder = folderInput.value.trim();
    if (!domain || !folder) return;
    domainRules.push({ domain, folder });
    renderDomainRules();
    domainInput.value = '';
    folderInput.value = '';
    await saveSettings(); // Save immediately when a rule is added
  };

  document.getElementById('addRuleBtn').addEventListener('click', addRule);

  const newRuleDomainEl = document.getElementById('newRuleDomain');
  if (newRuleDomainEl) {
    newRuleDomainEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('newRuleFolder')?.focus();
      }
    });
  }

  const newRuleFolderEl = document.getElementById('newRuleFolder');
  if (newRuleFolderEl) {
    newRuleFolderEl.addEventListener('focus', () => {
      loadFolderSuggestions();
    });
    newRuleFolderEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRule();
      }
    });
  }

  // Debounced auto-save triggers on form changes
  const form = document.getElementById('settingsForm');
  form.addEventListener('input', (e) => {
    if (e.target.type === 'password' || e.target.type === 'text' || e.target.tagName === 'TEXTAREA') {
      triggerAutoSave();
    }
  });
  form.addEventListener('change', (e) => {
    // Only trigger auto-save if it's not a text input (since input event handles that)
    if (e.target.type !== 'password' && e.target.type !== 'text' && e.target.tagName !== 'TEXTAREA') {
      triggerAutoSave();
    }
  });

  form.addEventListener('submit', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    saveSettings();
  });
});

let autoSaveTimeout = null;
function triggerAutoSave() {
  showStatus('Saving changes...', 'loading');
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(async () => {
    await saveSettings();
  }, 1200);
}

function _isValidGeminiApiKey(apiKey) {
  if (!apiKey) {
    return false;
  }
  // Google now issues AQ.-prefixed keys; keep legacy AIza keys for backward compatibility.
  return apiKey.startsWith('AQ.') || apiKey.startsWith('AIza');
}

function updateProviderUI(provider) {
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.provider === provider);
  });
  document.getElementById('anthropicSection').style.display = provider === 'anthropic' ? 'block' : 'none';
  document.getElementById('openaiSection').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('openrouterSection').style.display = provider === 'openrouter' ? 'block' : 'none';
  document.getElementById('geminiSection').style.display = provider === 'gemini' ? 'block' : 'none';
  document.getElementById('googleCloudSection').style.display = provider === 'google-cloud' ? 'block' : 'none';

  const providerNames = {
    anthropic: 'Anthropic Claude',
    openai: 'OpenAI / Compatible',
    openrouter: 'OpenRouter',
    gemini: 'Google Gemini',
    'google-cloud': 'Google Cloud Gemini'
  };
  const badge = document.getElementById('activeProviderBadge');
  if (badge) {
    badge.textContent = providerNames[provider] || provider;
  }

  renderContextWindowPresets(provider);
  syncContextWindowPresetFromInput(provider);
  updateContextWindowEstimate();
}

function getContextWindowPresets(provider) {
  return CONTEXT_WINDOW_PRESETS[provider] || FALLBACK_PRESETS;
}

function renderContextWindowPresets(provider) {
  const presetSelect = document.getElementById('modelContextWindowPreset');
  if (!presetSelect) return;

  const presets = getContextWindowPresets(provider);
  presetSelect.textContent = '';

  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = String(preset.value);
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  }

  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Custom';
  presetSelect.appendChild(customOption);
}

function syncContextWindowPresetFromInput(provider) {
  const presetSelect = document.getElementById('modelContextWindowPreset');
  const windowInput = document.getElementById('modelContextWindow');
  const slider = document.getElementById('contextWindowSlider');
  const valueDisplay = document.getElementById('contextWindowValueDisplay');
  if (!presetSelect || !windowInput) return;

  const value = snapToNearestBinaryContext(windowInput.value);
  const presets = getContextWindowPresets(provider);
  const match = presets.find(p => p.value === value);
  presetSelect.value = match ? String(match.value) : 'custom';

  const stepIdx = getBinaryStepIndex(value);
  if (slider && parseInt(slider.value, 10) !== stepIdx) {
    slider.value = stepIdx;
  }
  if (valueDisplay) {
    valueDisplay.textContent = BINARY_CONTEXT_STEPS[stepIdx].label;
  }
  updateSliderTicksHighlight(stepIdx);
}

function updateSliderTicksHighlight(activeIndex) {
  document.querySelectorAll('.slider-ticks span').forEach((span, idx) => {
    if (idx === activeIndex) {
      span.style.color = '#1a73e8';
      span.style.fontWeight = '700';
    } else {
      span.style.color = '#5f6368';
      span.style.fontWeight = 'normal';
    }
  });
}

function sanitizeContextWindowTokens(value) {
  return snapToNearestBinaryContext(value);
}

function getEstimateProfile(provider) {
  return SEMANTIC_BATCH_ESTIMATE.providerProfiles[provider] || SEMANTIC_BATCH_ESTIMATE.defaultProfile;
}

function estimateBookmarksPerRequest(contextWindowTokens, provider) {
  const profile = getEstimateProfile(provider);
  const budget = Math.max(
    2000,
    Math.floor(contextWindowTokens * profile.inputBudgetRatio)
      - profile.reservedTokens
      - profile.fixedPromptTokens
      - profile.defaultIntentTokens
  );
  const perRequest = Math.floor(budget / profile.estimatedTokensPerBookmark);
  return Math.max(1, perRequest);
}

function updateContextWindowEstimate() {
  const estimateEl = document.getElementById('contextWindowEstimate');
  const windowInput = document.getElementById('modelContextWindow');
  if (!estimateEl || !windowInput) return;

  const contextWindow = sanitizeContextWindowTokens(windowInput.value);
  const perRequest = estimateBookmarksPerRequest(contextWindow, currentProvider);
  const examples = SEMANTIC_BATCH_ESTIMATE.sampleCandidateCounts
    .map(total => `${total} bookmarks -> ~${Math.ceil(total / perRequest)} request${Math.ceil(total / perRequest) === 1 ? '' : 's'}`)
    .join(', ');

  estimateEl.textContent = `Estimated capacity: ~${perRequest} bookmarks/request. Example consolidation: ${examples}.`;
}

function renderDomainRules() {
  const list = document.getElementById('domainRulesList');
  list.textContent = '';
  if (domainRules.length === 0) return;
  domainRules.forEach((rule, idx) => {
    const item = document.createElement('div');
    item.className = 'rule-item';

    const domainEl = document.createElement('span');
    domainEl.className = 'rule-domain';
    domainEl.textContent = rule.domain;

    const arrow = document.createElement('span');
    arrow.className = 'rule-arrow';
    arrow.textContent = '→';

    const folderEl = document.createElement('span');
    folderEl.className = 'rule-folder';
    folderEl.textContent = rule.folder;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove rule';
    removeBtn.addEventListener('click', async () => {
      domainRules.splice(idx, 1);
      renderDomainRules();
      await saveSettings(); // Save immediately when a rule is removed
    });

    item.appendChild(domainEl);
    item.appendChild(arrow);
    item.appendChild(folderEl);
    item.appendChild(removeBtn);
    list.appendChild(item);
  });
}

function extractFolderPathsFromTree(tree) {
  const folders = [];
  const rootIds = new Set(['0', 'root________', '1', '2', '3', 'toolbar_____', 'unfiled_____', 'menu________', 'mobile______']);
  function traverse(nodes, path = '') {
    for (const node of nodes || []) {
      if (node.url) continue;
      const nodeId = String(node.id || '');
      const parentId = node.parentId != null ? String(node.parentId) : null;
      if (parentId == null || parentId === '0' || parentId === 'root________' || rootIds.has(nodeId)) {
        if (node.children) traverse(node.children, '');
        continue;
      }
      const currentPath = path ? `${path}/${node.title}` : node.title;
      if (node.title) {
        folders.push(currentPath);
      }
      if (node.children) {
        traverse(node.children, currentPath);
      }
    }
  }
  traverse(tree);
  return folders;
}

function populateFolderDatalist(datalist, folders) {
  if (!datalist) return;
  datalist.textContent = '';
  const rawList = (folders || []).map(f => (typeof f === 'string' ? f : f?.path || f?.title || '')).filter(Boolean);
  const uniqueFolders = [...new Set(rawList)].sort((a, b) => a.localeCompare(b));
  for (const folder of uniqueFolders) {
    const opt = document.createElement('option');
    opt.value = folder;
    datalist.appendChild(opt);
  }
}

async function loadFolderSuggestions() {
  const datalist = document.getElementById('ruleFolderSuggestions');
  if (!datalist) return;

  try {
    let folders = [];
    const response = await chrome.runtime.sendMessage({ action: 'getExistingFolders' });
    if (response?.success && Array.isArray(response.folders)) {
      folders = response.folders;
    } else if (chrome.bookmarks?.getTree) {
      const tree = await chrome.bookmarks.getTree();
      folders = extractFolderPathsFromTree(tree);
    }
    populateFolderDatalist(datalist, folders);
  } catch (error) {
    console.warn('Could not load folder suggestions via background message:', error);
    if (chrome.bookmarks?.getTree) {
      try {
        const tree = await chrome.bookmarks.getTree();
        const folders = extractFolderPathsFromTree(tree);
        populateFolderDatalist(datalist, folders);
      } catch (err) {
        console.warn('Fallback folder scan failed:', err);
      }
    }
  }
}

async function _loadNewFolderLocationOptions(selectedLocation = 'root-bar') {
  const select = document.getElementById('sortNewFolderLocation');
  if (!select) return;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSortingScopeFolders' });
    select.textContent = '';

    const optBar = document.createElement('option');
    optBar.value = 'root-bar';
    optBar.textContent = 'Bookmarks Bar / Toolbar (Default)';
    select.appendChild(optBar);

    const optOther = document.createElement('option');
    optOther.value = 'root-other';
    optOther.textContent = 'Other Bookmarks / Unfiled';
    select.appendChild(optOther);

    const optMenu = document.createElement('option');
    optMenu.value = 'root-menu';
    optMenu.textContent = 'Bookmarks Menu';
    select.appendChild(optMenu);

    for (const folder of response?.folders || []) {
      if (folder.isRoot) continue;
      const opt = document.createElement('option');
      opt.value = folder.id;
      const indent = folder.depth > 0 ? '  ↳ '.padStart(folder.depth * 2 + 3, ' ') : '';
      opt.textContent = `${folder.rootName ? `[${folder.rootName}] ` : ''}${indent}${folder.path}`;
      select.appendChild(opt);
    }

    if (selectedLocation) {
      select.value = selectedLocation;
    }
  } catch (e) {
    console.error('Error loading folder locations:', e);
  }
}


function ensureSelectHasValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (select && value) {
    const hasOption = Array.from(select.options).some(opt => opt.value === value);
    if (hasOption) {
      select.value = value;
    } else {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
    }
  }
}

async function loadSettings() {
  try {
    const syncSettings = await chrome.storage.sync.get(DEFAULT_SETTINGS).catch(() => ({}));
    const localSettings = await chrome.storage.local.get(DEFAULT_SETTINGS).catch(() => ({}));
    const settings = { ...DEFAULT_SETTINGS, ...localSettings, ...syncSettings };

    currentProvider = settings.aiProvider || 'anthropic';
    updateProviderUI(currentProvider);

    document.getElementById('anthropicApiKey').value = settings.anthropicApiKey || '';
    if (document.getElementById('openaiBaseUrl')) {
      document.getElementById('openaiBaseUrl').value = settings.openaiBaseUrl || 'https://api.openai.com/v1';
    }
    document.getElementById('openaiApiKey').value = settings.openaiApiKey || '';
    let openaiModel = settings.openaiModel || '';
    // Clear out previously auto-saved gpt-4o default if no API key is set
    if (openaiModel === 'gpt-4o' && !settings.openaiApiKey) {
      openaiModel = '';
    }
    const openaiCustomModel = settings.openaiCustomModel || '';
    const openaiSelect = document.getElementById('openaiModel');
    const customGroup = document.getElementById('openaiCustomModelGroup');

    if (document.getElementById('openaiCustomModel')) {
      document.getElementById('openaiCustomModel').value = openaiCustomModel || (openaiModel !== 'custom' ? openaiModel : '');
    }

    if (openaiSelect) {
      const hasOption = Array.from(openaiSelect.options).some(opt => opt.value === openaiModel);
      if (hasOption) {
        openaiSelect.value = openaiModel;
        if (customGroup) customGroup.style.display = openaiModel === 'custom' ? 'block' : 'none';
      } else {
        const opt = document.createElement('option');
        opt.value = openaiModel;
        opt.textContent = openaiModel;
        opt.selected = true;
        openaiSelect.insertBefore(opt, openaiSelect.firstChild);
        if (customGroup) customGroup.style.display = 'none';
      }
    }

    ensureSelectHasValue('openrouterModel', settings.openrouterModel);
    ensureSelectHasValue('geminiModel', settings.geminiModel || 'gemini-3.6-flash');
    ensureSelectHasValue('googleCloudModel', settings.googleCloudModel || 'gemini-3.7-flash');

    const modelContextVal = snapToNearestBinaryContext(settings.modelContextWindow || 131072);
    document.getElementById('modelContextWindow').value = modelContextVal;
    const sliderEl = document.getElementById('contextWindowSlider');
    const valueDisplayEl = document.getElementById('contextWindowValueDisplay');
    const stepIdx = getBinaryStepIndex(modelContextVal);
    if (sliderEl) sliderEl.value = stepIdx;
    if (valueDisplayEl) valueDisplayEl.textContent = BINARY_CONTEXT_STEPS[stepIdx].label;
    renderContextWindowPresets(currentProvider);
    syncContextWindowPresetFromInput(currentProvider);
    updateContextWindowEstimate();
    document.getElementById('openrouterApiKey').value = settings.openrouterApiKey || '';
    document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';
    document.getElementById('googleCloudApiKey').value = settings.googleCloudApiKey || '';
    document.getElementById('instapaperUsername').value = settings.instapaperUsername || '';
    document.getElementById('instapaperPassword').value = settings.instapaperPassword || '';
    document.getElementById('todoistApiToken').value = settings.todoistApiToken || '';
    document.getElementById('instapaperEnabled').checked = settings.instapaperEnabled === true;
    document.getElementById('todoistEnabled').checked = settings.todoistEnabled !== false;
    document.getElementById('thingsEnabled').checked = settings.thingsEnabled !== false;
    document.getElementById('readwiseEnabled').checked = settings.readwiseEnabled === true;
    document.getElementById('readwiseAccessToken').value = settings.readwiseAccessToken || '';
    document.getElementById('raindropEnabled').checked = settings.raindropEnabled === true;
    document.getElementById('raindropAccessToken').value = settings.raindropAccessToken || '';
    document.getElementById('instapaperCheckedByDefault').checked = settings.instapaperCheckedByDefault === true;
    document.getElementById('todoistCheckedByDefault').checked = settings.todoistCheckedByDefault === true;
    document.getElementById('thingsCheckedByDefault').checked = settings.thingsCheckedByDefault === true;
    document.getElementById('readwiseCheckedByDefault').checked = settings.readwiseCheckedByDefault === true;
    document.getElementById('raindropCheckedByDefault').checked = settings.raindropCheckedByDefault === true;
    const sortBatchSizeEl = document.getElementById('sortBatchSize');
    if (sortBatchSizeEl) {
      sortBatchSizeEl.value = clampSortBatchSize(settings.sortBatchSize || 100);
    }
    const sortBatchConcurrencyEl = document.getElementById('sortBatchConcurrency');
    if (sortBatchConcurrencyEl) {
      sortBatchConcurrencyEl.value = clampSortBatchConcurrency(settings.sortBatchConcurrency || 4);
    }

    document.getElementById('healthCheckEnabled').checked = settings.healthCheckEnabled === true;
    if (document.getElementById('healthCheckStaleDays')) {
      document.getElementById('healthCheckStaleDays').value = settings.healthCheckStaleDays || 365;
    }
    document.querySelectorAll('.interval-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.interval === (settings.healthCheckInterval || 'weekly'));
    });

    // trigger initial visibility
    const enabled = settings.healthCheckEnabled === true;
    if (document.getElementById('intervalGroup')) document.getElementById('intervalGroup').style.opacity = enabled ? '1' : '0.4';
    if (document.getElementById('staleGroup')) document.getElementById('staleGroup').style.opacity = enabled ? '1' : '0.4';
    if (document.getElementById('checkTypesGroup')) document.getElementById('checkTypesGroup').style.opacity = enabled ? '1' : '0.4';

    const types = settings.healthCheckTypes || { dead: true, redirects: true, stale: true };
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = value;
    };
    setChecked('checkDead', types.dead !== false);
    setChecked('checkDomainGone', types.domainGone !== false);
    setChecked('checkRedirects', types.redirects !== false);
    setChecked('checkStale', types.stale !== false);
    setChecked('checkTitleChanged', types.titleChanged !== false);
    setChecked('healthCheckRunOnOpen', settings.healthCheckRunOnOpen === true);

    domainRules = Array.isArray(settings.domainRules) ? settings.domainRules : [];
    renderDomainRules();

    syncToggleDependencies();

    if (settings.openrouterApiKey) {
      loadOpenRouterModels(settings.openrouterModel);
    }
    if (settings.openaiApiKey || (settings.openaiBaseUrl && !settings.openaiBaseUrl.includes('api.openai.com'))) {
      loadOpenaiModels(false, settings.openaiModel);
    }
    if (settings.geminiApiKey) {
      loadGeminiModels(false, settings.geminiModel, false);
    }
    if (settings.googleCloudApiKey) {
      loadGeminiModels(false, settings.googleCloudModel, true);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings: ' + error.message, 'error');
  }
}

async function saveSettings() {
  const anthropicApiKey = document.getElementById('anthropicApiKey').value.trim();
  const openaiApiKey = document.getElementById('openaiApiKey').value.trim();
  const openaiBaseUrl = document.getElementById('openaiBaseUrl')?.value.trim() || 'https://api.openai.com/v1';
  const openaiModel = document.getElementById('openaiModel').value;
  const openaiCustomModel = document.getElementById('openaiCustomModel')?.value.trim() || '';
  const modelContextWindow = sanitizeContextWindowTokens(document.getElementById('modelContextWindow').value);
  const openrouterApiKey = document.getElementById('openrouterApiKey').value.trim();
  const openrouterModel = document.getElementById('openrouterModel').value;
  const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
  const geminiModel = document.getElementById('geminiModel').value;
  const googleCloudApiKey = document.getElementById('googleCloudApiKey').value.trim();
  const googleCloudModel = document.getElementById('googleCloudModel').value;
  const instapaperUsername = document.getElementById('instapaperUsername').value.trim();
  const instapaperPassword = document.getElementById('instapaperPassword').value;
  const todoistApiToken = document.getElementById('todoistApiToken').value.trim();

  // Validate based on selected provider
  if (currentProvider === 'openrouter' && openrouterApiKey && !openrouterModel) {
    showStatus('Please select an OpenRouter model', 'error');
    return;
  }

  const instapaperEnabled = document.getElementById('instapaperEnabled').checked;
  const todoistEnabled = document.getElementById('todoistEnabled').checked;
  const thingsEnabled = document.getElementById('thingsEnabled').checked;
  const readwiseEnabled = document.getElementById('readwiseEnabled').checked;
  const readwiseAccessToken = document.getElementById('readwiseAccessToken').value.trim();
  const raindropEnabled = document.getElementById('raindropEnabled').checked;
  const raindropAccessToken = document.getElementById('raindropAccessToken').value.trim();
  const instapaperCheckedByDefault = document.getElementById('instapaperCheckedByDefault').checked;
  const todoistCheckedByDefault = document.getElementById('todoistCheckedByDefault').checked;
  const thingsCheckedByDefault = document.getElementById('thingsCheckedByDefault').checked;
  const readwiseCheckedByDefault = document.getElementById('readwiseCheckedByDefault').checked;
  const raindropCheckedByDefault = document.getElementById('raindropCheckedByDefault').checked;
  const healthCheckEnabled = document.getElementById('healthCheckEnabled').checked;
  const healthCheckStaleDays = parseInt(document.getElementById('healthCheckStaleDays')?.value, 10) || 365;
  const activeTab = document.querySelector('.interval-tab.active');
  const healthCheckInterval = activeTab ? activeTab.dataset.interval : 'weekly';
  const healthCheckTypes = {
    dead: document.getElementById('checkDead')?.checked !== false,
    domainGone: document.getElementById('checkDomainGone')?.checked !== false,
    redirects: document.getElementById('checkRedirects')?.checked !== false,
    stale: document.getElementById('checkStale')?.checked !== false,
    titleChanged: document.getElementById('checkTitleChanged')?.checked !== false
  };
  const sortBatchSize = clampSortBatchSize(document.getElementById('sortBatchSize')?.value);
  const sortBatchConcurrency = clampSortBatchConcurrency(document.getElementById('sortBatchConcurrency')?.value);
  const healthCheckRunOnOpen = document.getElementById('healthCheckRunOnOpen').checked;

  const settingsToSave = {
    aiProvider: currentProvider,
    anthropicApiKey,
    openaiApiKey,
    openaiBaseUrl,
    openaiModel,
    openaiCustomModel,
    modelContextWindow,
    openrouterApiKey,
    openrouterModel,
    geminiApiKey,
    geminiModel,
    googleCloudApiKey,
    googleCloudModel,
    instapaperUsername,
    instapaperPassword,
    todoistApiToken,
    instapaperEnabled,
    todoistEnabled,
    thingsEnabled,
    domainRules,
    readwiseEnabled,
    readwiseAccessToken,
    raindropEnabled,
    raindropAccessToken,
    instapaperCheckedByDefault,
    todoistCheckedByDefault,
    thingsCheckedByDefault,
    readwiseCheckedByDefault,
    raindropCheckedByDefault,
    healthCheckEnabled,
    healthCheckInterval,
    healthCheckStaleDays,
    healthCheckTypes,
    healthCheckRunOnOpen,
    sortBatchSize,
    sortBatchConcurrency
  };

  try {
    await Promise.allSettled([
      chrome.storage.sync?.set ? chrome.storage.sync.set(settingsToSave) : Promise.resolve(),
      chrome.storage.local?.set ? chrome.storage.local.set(settingsToSave) : Promise.resolve()
    ]);

    // Also set the alarm in background for health checks
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'setupHealthCheckAlarm' }).catch(() => {});
    }

    showStatus('Settings saved successfully!', 'success');
    setTimeout(hideStatus, 3000);
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings: ' + error.message, 'error');
  }
}

async function loadOpenRouterModels(preselectedModel = null, forceRefresh = false) {
  const apiKey = document.getElementById('openrouterApiKey').value.trim();
  const select = document.getElementById('openrouterModel');
  const btn = document.getElementById('loadModelsBtn');

  btn.textContent = 'Loading...';
  btn.disabled = true;
  select.disabled = true;

  try {
    let models = null;
    if (!forceRefresh && chrome.storage?.session) {
      try {
        const cached = await chrome.storage.session.get('openrouterModelsCache');
        if (Array.isArray(cached?.openrouterModelsCache) && cached.openrouterModelsCache.length > 0) {
          models = cached.openrouterModelsCache;
        }
      } catch {}
    }

    if (!models) {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch('https://openrouter.ai/api/v1/models', { headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      models = data.data || [];

      // Sort models by name
      models.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

      if (chrome.storage?.session) {
        chrome.storage.session.set({ openrouterModelsCache: models }).catch(() => {});
      }
    }

    const currentValue = preselectedModel || select.value;
    select.textContent = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a model...';
    select.appendChild(defaultOption);

    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      if (currentValue && model.id === currentValue) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    showStatus(`Loaded ${models.length} models`, 'success');
    setTimeout(hideStatus, 3000);
  } catch (error) {
    showStatus('Error loading models: ' + error.message, 'error');
  } finally {
    btn.textContent = 'Load Models';
    btn.disabled = false;
    select.disabled = false;
  }
}

async function loadOpenaiModels(_forceRefresh = false, preselectedModel = null) {
  const btn = document.getElementById('loadOpenaiModelsBtn');
  const select = document.getElementById('openaiModel');
  const apiKey = document.getElementById('openaiApiKey').value.trim();
  const rawBaseUrl = document.getElementById('openaiBaseUrl')?.value?.trim() || 'https://api.openai.com/v1';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  if (btn) {
    btn.textContent = 'Loading…';
    btn.disabled = true;
  }
  select.disabled = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    let models = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data) ? data : []));

    // Sort models
    models.sort((a, b) => {
      const idA = typeof a === 'string' ? a : (a.id || a.name || '');
      const idB = typeof b === 'string' ? b : (b.id || b.name || '');
      return idA.localeCompare(idB);
    });

    const currentValue = preselectedModel || select.value;
    select.textContent = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a model...';
    select.appendChild(defaultOption);

    let matched = false;
    for (const m of models) {
      const id = typeof m === 'string' ? m : (m.id || m.name);
      if (!id) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = (typeof m === 'object' && m.name && m.name !== id) ? `${m.name} (${id})` : id;
      if (currentValue && id === currentValue) {
        option.selected = true;
        matched = true;
      }
      select.appendChild(option);
    }

    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = '— Custom Model Name —';
    if (!matched && currentValue && currentValue !== 'custom') {
      const customValOption = document.createElement('option');
      customValOption.value = currentValue;
      customValOption.textContent = currentValue;
      customValOption.selected = true;
      select.insertBefore(customValOption, select.firstChild.nextSibling);
    }
    select.appendChild(customOption);

    showStatus(`Loaded ${models.length} models from endpoint`, 'success');
    setTimeout(hideStatus, 3000);
  } catch (error) {
    showStatus(`Error loading models from ${baseUrl}: ` + error.message, 'error');
  } finally {
    if (btn) {
      btn.textContent = 'Fetch Models';
      btn.disabled = false;
    }
    select.disabled = false;
  }
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type} visible`;
}

function hideStatus() {
  const statusDiv = document.getElementById('status');
  statusDiv.classList.remove('visible');
}

function syncToggleDependencies() {
  const dependencyPairs = [
    ['instapaperEnabled', 'instapaperCheckedByDefaultGroup'],
    ['todoistEnabled', 'todoistCheckedByDefaultGroup'],
    ['thingsEnabled', 'thingsCheckedByDefaultGroup'],
    ['readwiseEnabled', 'readwiseCheckedByDefaultGroup'],
    ['raindropEnabled', 'raindropCheckedByDefaultGroup']
  ];
  dependencyPairs.forEach(([enabledId, dependentGroupId]) => {
    const enabledInput = document.getElementById(enabledId);
    const dependentGroup = document.getElementById(dependentGroupId);
    if (enabledInput && dependentGroup) {
      const isChecked = enabledInput.checked;
      dependentGroup.style.opacity = isChecked ? '1' : '0.4';
      const checkbox = dependentGroup.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.disabled = !isChecked;
      }
    }
  });
}

async function loadGeminiModels(forceRefresh = false, preselectedModel = null, isGoogleCloud = false) {
  const btnId = isGoogleCloud ? 'loadGoogleCloudModelsBtn' : 'loadGeminiModelsBtn';
  const selectId = isGoogleCloud ? 'googleCloudModel' : 'geminiModel';
  const keyId = isGoogleCloud ? 'googleCloudApiKey' : 'geminiApiKey';

  const btn = document.getElementById(btnId);
  const select = document.getElementById(selectId);
  const apiKey = document.getElementById(keyId).value.trim();

  if (!apiKey && forceRefresh) {
    showStatus('Please enter an API key first to fetch models.', 'error');
    return;
  }

  if (btn) {
    btn.textContent = 'Loading…';
    btn.disabled = true;
  }
  select.disabled = true;

  try {
    if (!apiKey) throw new Error('No API key');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    let models = Array.isArray(data.models) ? data.models : [];

    // Filter to generative models (generateContent)
    models = models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));

    const currentValue = preselectedModel || select.value;

    if (models.length === 0) throw new Error('No models available');
    select.textContent = '';

    // List only models the API reports as available. Fall back to first if saved one is gone.
    const ids = models.map(m => m.name.replace('models/', ''));
    const selectedId = ids.includes(currentValue) ? currentValue : ids[0];
    models.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = ids[i];
      opt.textContent = m.displayName ? `${m.displayName} (${ids[i]})` : ids[i];
      opt.selected = ids[i] === selectedId;
      select.appendChild(opt);
    });
    if (forceRefresh) {
      showStatus(`Loaded ${models.length} available models.`, 'success');
    }
  } catch (error) {
    console.error('Error fetching models:', error);
    if (forceRefresh) {
      showStatus('Failed to load models. Check your API key.', 'error');
    }
  } finally {
    if (btn) {
      btn.textContent = 'Fetch Models';
      btn.disabled = false;
    }
    select.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Jev Decision Model Controllers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function showModelProgress(percent, statsText) {
  const container = document.getElementById('modelProgressContainer');
  const bar = document.getElementById('modelProgressBar');
  const percentText = document.getElementById('modelProgressPercent');
  const stats = document.getElementById('modelProgressStats');

  if (container) container.style.display = 'block';
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (stats && statsText) stats.textContent = statsText;
}

function showModelError(msg) {
  const box = document.getElementById('modelErrorBox');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  }
}

async function refreshEmbeddingModelUI() {
  const badge = document.getElementById('modelStatusBadge');
  const indicator = document.getElementById('modelLoadedIndicator');
  const btnDownload = document.getElementById('btnDownloadModel');
  const btnCancel = document.getElementById('btnCancelModelDownload');
  const btnLoad = document.getElementById('btnLoadModel');
  const btnUnload = document.getElementById('btnUnloadModel');
  const btnDelete = document.getElementById('btnDeleteModel');
  const btnTest = document.getElementById('btnTestModel');
  const progressContainer = document.getElementById('modelProgressContainer');
  const errorBox = document.getElementById('modelErrorBox');
  const hint = document.getElementById('modelStatusHint');

  if (!badge) return;

  try {
    const status = await chrome.runtime.sendMessage({ action: 'getEmbeddingModelStatus', modelId: 'embeddinggemma-2' });
    if (!status) return;

    if (errorBox) {
      if (status.status === 'error' && status.error) {
        errorBox.textContent = `Download error: ${status.error}`;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    if (status.status === 'loaded') {
      if (indicator) indicator.style.display = 'inline-block';
      badge.textContent = 'Loaded & Active';
      badge.style.background = '#e6f4ea';
      badge.style.color = '#137333';
      if (hint) hint.textContent = 'EmbeddingGemma-2 embedding model is loaded in memory. Ready for instant offline vector embeddings, similarity search, and bookmark sorting.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'inline-block';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'inline-block';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloaded') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Downloaded (Unloaded)';
      badge.style.background = '#fef7e0';
      badge.style.color = '#b06000';
      if (hint) hint.textContent = 'Model is saved locally. Click "Load Model" to load it into memory for bookmark sorting.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'inline-block';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'loading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Loading into memory...';
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Reading EmbeddingGemma-2 model weights from storage into memory...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) {
        btnLoad.style.display = 'inline-block';
        btnLoad.disabled = true;
      }
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = `Downloading (${status.percent}%)`;
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Downloading EmbeddingGemma-2 GGUF weights from Hugging Face...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'inline-block';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';

      showModelProgress(status.percent, `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)} • ${status.speed} • ETA: ${status.eta}`);
    } else {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Not Downloaded (Available on demand)';
      badge.style.background = '#f1f3f4';
      badge.style.color = '#5f6368';
      if (hint) hint.textContent = 'Download EmbeddingGemma-2 (UD-Q4_K_XL, ~168 MB) to enable private offline vector embedding and bookmark sorting.';

      if (btnDownload) btnDownload.style.display = 'inline-flex';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    }
  } catch (err) {
    console.error('Error refreshing embedding model status:', err);
  }
}

function showCustomLLMProgress(percent, statsText) {
  const container = document.getElementById('customLLMProgressContainer');
  const bar = document.getElementById('customLLMProgressBar');
  const percentText = document.getElementById('customLLMProgressPercent');
  const stats = document.getElementById('customLLMProgressStats');

  if (container) container.style.display = 'block';
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (stats && statsText) stats.textContent = statsText;
}

function showCustomLLMError(msg) {
  const box = document.getElementById('customLLMErrorBox');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  }
}

async function refreshCustomLLMUI() {
  const badge = document.getElementById('customLLMStatusBadge');
  const title = document.getElementById('customLLMTitle');
  const sizeBadge = document.getElementById('customLLMSizeBadge');
  const btnDownload = document.getElementById('btnDownloadCustomLLM');
  const btnCancel = document.getElementById('btnCancelCustomLLMDownload');
  const btnLoad = document.getElementById('btnLoadCustomLLM');
  const btnUnload = document.getElementById('btnUnloadCustomLLM');
  const btnDelete = document.getElementById('btnDeleteCustomLLM');
  const btnTest = document.getElementById('btnTestCustomLLM');
  const progressContainer = document.getElementById('customLLMProgressContainer');
  const errorBox = document.getElementById('customLLMErrorBox');
  const hint = document.getElementById('customLLMStatusHint');
  const urlInput = document.getElementById('customLLMUrl');
  const nameInput = document.getElementById('customLLMName');
  const contextInput = document.getElementById('customLLMContext');

  if (!badge) return;

  try {
    const configRes = await chrome.runtime.sendMessage({ action: 'getCustomLLMConfig' }).catch(() => null);
    const config = configRes?.config;

    if (config) {
      if (title && config.name) title.textContent = config.name;
      if (sizeBadge && config.sizeDisplay) sizeBadge.textContent = config.sizeDisplay;
      if (urlInput && !urlInput.value && config.url) urlInput.value = config.url;
      if (nameInput && !nameInput.value && config.name) nameInput.value = config.name;
      if (contextInput && config.contextWindow) contextInput.value = config.contextWindow;
    } else {
      if (title) title.textContent = 'Custom On-Device LLM (URL)';
      if (sizeBadge) sizeBadge.textContent = 'Custom URL';
    }

    const status = await chrome.runtime.sendMessage({
      action: 'getLLMModelStatus',
      modelId: 'custom-llm-model'
    }).catch(() => null);
    if (!status) return;

    if (errorBox) {
      if (status.status === 'error' && status.error) {
        errorBox.textContent = `Download error: ${status.error}`;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    if (status.status === 'loaded') {
      if (indicator) indicator.style.display = 'inline-block';
      badge.textContent = 'Loaded & Active';
      badge.style.background = '#e6f4ea';
      badge.style.color = '#137333';
      if (hint) hint.textContent = 'Custom LLM is loaded in memory and actively used for bookmark sorting.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'inline-block';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'inline-block';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloaded') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Downloaded (Unloaded)';
      badge.style.background = '#fef7e0';
      badge.style.color = '#b06000';
      if (hint) hint.textContent = 'Custom LLM is saved locally. Click "Load Model" to use it.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'inline-block';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'loading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Loading into memory...';
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Reading custom LLM weights from storage into memory...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) {
        btnLoad.style.display = 'inline-block';
        btnLoad.disabled = true;
      }
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = `Downloading (${status.percent}%)`;
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Downloading custom GGUF LLM...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'inline-block';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';

      showCustomLLMProgress(status.percent, `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)} • ${status.speed} • ETA: ${status.eta}`);
    } else {
      badge.textContent = 'Not Downloaded';
      badge.style.background = '#f1f3f4';
      badge.style.color = '#5f6368';
      if (hint) hint.textContent = 'Enter a valid URL to download and use a custom GGUF LLM.';

      if (btnDownload) btnDownload.style.display = 'inline-flex';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    }
  } catch (err) {
    console.error('Error refreshing custom LLM status:', err);
  }
}

function showCustomModelProgress(percent, statsText) {
  const container = document.getElementById('customModelProgressContainer');
  const bar = document.getElementById('customModelProgressBar');
  const percentText = document.getElementById('customModelProgressPercent');
  const stats = document.getElementById('customModelProgressStats');

  if (container) container.style.display = 'block';
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (stats && statsText) stats.textContent = statsText;
}

function showCustomModelError(msg) {
  const box = document.getElementById('customModelErrorBox');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  }
}

async function refreshCustomModelUI() {
  const badge = document.getElementById('customModelStatusBadge');
  const title = document.getElementById('customModelTitle');
  const dimsBadge = document.getElementById('customModelDimsBadge');
  const sizeBadge = document.getElementById('customModelSizeBadge');
  const btnDownload = document.getElementById('btnDownloadCustomModel');
  const btnCancel = document.getElementById('btnCancelCustomModelDownload');
  const btnLoad = document.getElementById('btnLoadCustomModel');
  const btnUnload = document.getElementById('btnUnloadCustomModel');
  const btnDelete = document.getElementById('btnDeleteCustomModel');
  const btnTest = document.getElementById('btnTestCustomModel');
  const progressContainer = document.getElementById('customModelProgressContainer');
  const errorBox = document.getElementById('customModelErrorBox');
  const hint = document.getElementById('customModelStatusHint');
  const urlInput = document.getElementById('customModelUrl');
  const nameInput = document.getElementById('customModelName');
  const dimsInput = document.getElementById('customModelDimensions');

  if (!badge) return;

  try {
    const configRes = await chrome.runtime.sendMessage({ action: 'getCustomModelConfig' }).catch(() => null);
    const config = configRes?.config;

    if (config) {
      if (title && config.name) title.textContent = config.name;
      if (dimsBadge && config.dimensions) dimsBadge.textContent = `${config.dimensions} Dimensions`;
      if (sizeBadge && config.sizeDisplay) sizeBadge.textContent = config.sizeDisplay;
      if (urlInput && !urlInput.value && config.url) urlInput.value = config.url;
      if (nameInput && !nameInput.value && config.name) nameInput.value = config.name;
      if (dimsInput && config.dimensions) dimsInput.value = config.dimensions;
    } else {
      if (title) title.textContent = 'Custom Embedding Model';
      if (dimsBadge) dimsBadge.textContent = '1024 Dimensions';
      if (sizeBadge) sizeBadge.textContent = 'Custom URL';
    }

    const status = await chrome.runtime.sendMessage({
      action: 'getEmbeddingModelStatus',
      modelId: 'custom-embedding-model'
    }).catch(() => null);
    if (!status) return;

    if (errorBox) {
      if (status.status === 'error' && status.error) {
        errorBox.textContent = `Download error: ${status.error}`;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    if (status.status === 'loaded') {
      if (indicator) indicator.style.display = 'inline-block';
      badge.textContent = 'Loaded & Active';
      badge.style.background = '#e6f4ea';
      badge.style.color = '#137333';
      if (hint) hint.textContent = 'Custom model is loaded in memory and actively used for bookmark sorting.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'inline-block';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'inline-block';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloaded') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Downloaded (Unloaded)';
      badge.style.background = '#fef7e0';
      badge.style.color = '#b06000';
      if (hint) hint.textContent = 'Custom model is saved locally. Click "Load Model" to use it.';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'inline-block';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'inline-block';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'loading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = 'Loading into memory...';
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Reading custom model weights from storage into memory...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) {
        btnLoad.style.display = 'inline-block';
        btnLoad.disabled = true;
      }
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    } else if (status.status === 'downloading') {
      if (indicator) indicator.style.display = 'none';
      badge.textContent = `Downloading (${status.percent}%)`;
      badge.style.background = '#e8f0fe';
      badge.style.color = '#1a73e8';
      if (hint) hint.textContent = 'Downloading custom GGUF model...';

      if (btnDownload) btnDownload.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'inline-block';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';

      showCustomModelProgress(status.percent, `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)} • ${status.speed} • ETA: ${status.eta}`);
    } else {
      badge.textContent = 'Not Downloaded';
      badge.style.background = '#f1f3f4';
      badge.style.color = '#5f6368';
      if (hint) hint.textContent = 'Enter a valid URL to download and use a custom GGUF embedding model.';

      if (btnDownload) btnDownload.style.display = 'inline-flex';
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnLoad) btnLoad.style.display = 'none';
      if (btnUnload) btnUnload.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';
      if (btnTest) btnTest.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    }
  } catch (err) {
    console.error('Error refreshing custom model status:', err);
  }
}

function initCustomEmbeddingModelUI() {
  const btnDownload = document.getElementById('btnDownloadCustomModel');
  const btnCancel = document.getElementById('btnCancelCustomModelDownload');
  const btnLoad = document.getElementById('btnLoadCustomModel');
  const btnUnload = document.getElementById('btnUnloadCustomModel');
  const btnDelete = document.getElementById('btnDeleteCustomModel');
  const btnTest = document.getElementById('btnTestCustomModel');
  const urlInput = document.getElementById('customModelUrl');
  const nameInput = document.getElementById('customModelName');
  const dimsInput = document.getElementById('customModelDimensions');
  const errorBox = document.getElementById('customModelErrorBox');

  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      const url = urlInput?.value?.trim() || '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        showCustomModelError('Please enter a valid HTTP or HTTPS URL to the GGUF model.');
        return;
      }

      const name = nameInput?.value?.trim() || '';
      const dimensions = parseInt(dimsInput?.value, 10) || 1024;

      if (errorBox) errorBox.style.display = 'none';
      btnDownload.disabled = true;
      showCustomModelProgress(0, 'Starting download...');

      try {
        const res = await chrome.runtime.sendMessage({
          action: 'startJevModelDownload',
          modelId: 'custom-embedding-model',
          customModel: {
            url,
            name,
            dimensions
          }
        });
        if (res && res.status === 'error') {
          showCustomModelError(res.error || 'Failed to start download');
        }
      } catch (err) {
        showCustomModelError('Failed to start download: ' + err.message);
      } finally {
        btnDownload.disabled = false;
        refreshCustomModelUI();
      }
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', async () => {
      btnCancel.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          action: 'cancelJevModelDownload',
          modelId: 'custom-embedding-model'
        });
      } catch (err) {
        showCustomModelError('Failed to cancel download: ' + err.message);
      } finally {
        btnCancel.disabled = false;
        refreshCustomModelUI();
      }
    });
  }

  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      btnLoad.disabled = true;
      btnLoad.textContent = 'Loading...';
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'loadJevModel',
          modelId: 'custom-embedding-model'
        });
        if (!res?.success) throw new Error(res?.error || 'Failed to load custom model');
        showStatus('Custom model loaded into memory successfully!', 'success');
      } catch (err) {
        showCustomModelError('Failed to load custom model: ' + err.message);
      } finally {
        btnLoad.disabled = false;
        btnLoad.textContent = 'Load Model';
        refreshCustomModelUI();
      }
    });
  }

  if (btnUnload) {
    btnUnload.addEventListener('click', async () => {
      btnUnload.disabled = true;
      btnUnload.textContent = 'Unloading...';
      try {
        await chrome.runtime.sendMessage({
          action: 'unloadJevModel',
          modelId: 'custom-embedding-model'
        });
        showStatus('Custom model unloaded from memory.', 'info');
      } catch (err) {
        showCustomModelError('Failed to unload custom model: ' + err.message);
      } finally {
        btnUnload.disabled = false;
        btnUnload.textContent = 'Unload Model';
        refreshCustomModelUI();
      }
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      btnTest.disabled = true;
      btnTest.textContent = 'Testing...';
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'testEmbeddingModel',
          modelId: 'custom-embedding-model'
        });
        if (res && res.success) {
          const dims = res.vectorDimensions || 1024;
          showStatus(`Custom model verified! Classified test bookmark into "${res.matchedCategory}" (${dims}-dim vector generated).`, 'success');
        } else {
          showStatus('Test failed: ' + (res ? res.error : 'Unknown error'), 'error');
        }
      } catch (err) {
        showStatus('Test error: ' + err.message, 'error');
      } finally {
        btnTest.disabled = false;
        btnTest.textContent = 'Test Custom Model';
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete the custom embedding model from storage?')) {
        return;
      }
      btnDelete.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          action: 'deleteEmbeddingModel',
          modelId: 'custom-embedding-model'
        });
      } catch (err) {
        showCustomModelError('Failed to delete custom model: ' + err.message);
      } finally {
        btnDelete.disabled = false;
        refreshCustomModelUI();
      }
    });
  }
}

function initCustomLLMUI() {
  const btnDownload = document.getElementById('btnDownloadCustomLLM');
  const btnCancel = document.getElementById('btnCancelCustomLLMDownload');
  const btnLoad = document.getElementById('btnLoadCustomLLM');
  const btnUnload = document.getElementById('btnUnloadCustomLLM');
  const btnDelete = document.getElementById('btnDeleteCustomLLM');
  const btnTest = document.getElementById('btnTestCustomLLM');
  const urlInput = document.getElementById('customLLMUrl');
  const nameInput = document.getElementById('customLLMName');
  const contextInput = document.getElementById('customLLMContext');
  const errorBox = document.getElementById('customLLMErrorBox');

  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      const url = urlInput?.value?.trim() || '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        showCustomLLMError('Please enter a valid HTTP or HTTPS URL to the GGUF model.');
        return;
      }

      const name = nameInput?.value?.trim() || '';
      const contextWindow = parseInt(contextInput?.value, 10) || 32768;

      if (errorBox) errorBox.style.display = 'none';
      btnDownload.disabled = true;
      showCustomLLMProgress(0, 'Starting download...');

      try {
        const res = await chrome.runtime.sendMessage({
          action: 'startLLMModelDownload',
          modelId: 'custom-llm-model',
          customModel: {
            url,
            name,
            contextWindow,
            isLLM: true,
            isInstructModel: true,
            isEmbeddingModel: false,
            architecture: 'custom-llm'
          }
        });
        if (res && res.status === 'error') {
          showCustomLLMError(res.error || 'Failed to start download');
        }
      } catch (err) {
        showCustomLLMError('Failed to start download: ' + err.message);
      } finally {
        btnDownload.disabled = false;
        refreshCustomLLMUI();
      }
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', async () => {
      btnCancel.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          action: 'cancelLLMModelDownload',
          modelId: 'custom-llm-model'
        });
      } catch (err) {
        showCustomLLMError('Failed to cancel download: ' + err.message);
      } finally {
        btnCancel.disabled = false;
        refreshCustomLLMUI();
      }
    });
  }

  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      btnLoad.disabled = true;
      btnLoad.textContent = 'Loading...';
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'loadLLMModel',
          modelId: 'custom-llm-model'
        });
        if (!res?.success) throw new Error(res?.error || 'Failed to load custom LLM');
        showStatus('Custom LLM loaded into memory successfully!', 'success');
      } catch (err) {
        showCustomLLMError('Failed to load custom LLM: ' + err.message);
      } finally {
        btnLoad.disabled = false;
        btnLoad.textContent = 'Load Model';
        refreshCustomLLMUI();
      }
    });
  }

  if (btnUnload) {
    btnUnload.addEventListener('click', async () => {
      btnUnload.disabled = true;
      btnUnload.textContent = 'Unloading...';
      try {
        await chrome.runtime.sendMessage({
          action: 'unloadLLMModel',
          modelId: 'custom-llm-model'
        });
        showStatus('Custom LLM unloaded from memory.', 'info');
      } catch (err) {
        showCustomLLMError('Failed to unload custom LLM: ' + err.message);
      } finally {
        btnUnload.disabled = false;
        btnUnload.textContent = 'Unload Model';
        refreshCustomLLMUI();
      }
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      btnTest.disabled = true;
      btnTest.textContent = 'Testing...';
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'testLLMModel',
          modelId: 'custom-llm-model'
        });
        if (res && res.success) {
          const conf = Math.round((res.confidence || 0.95) * 100);
          showStatus(`Custom LLM verified! Classified test bookmark into "${res.matchedCategory}" (${conf}% confidence).`, 'success');
        } else {
          showStatus('Test failed: ' + (res ? res.error : 'Unknown error'), 'error');
        }
      } catch (err) {
        showStatus('Test error: ' + err.message, 'error');
      } finally {
        btnTest.disabled = false;
        btnTest.textContent = 'Test Custom LLM';
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete the custom LLM from storage?')) {
        return;
      }
      btnDelete.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          action: 'deleteLLMModel',
          modelId: 'custom-llm-model'
        });
      } catch (err) {
        showCustomLLMError('Failed to delete custom LLM: ' + err.message);
      } finally {
        btnDelete.disabled = false;
        refreshCustomLLMUI();
      }
    });
  }
}

function initLocalEmbeddingModelUI() {
  // Local Model Context Slider (powers of 2 from 2K to 64K)
  const LOCAL_CONTEXT_STEPS = [
    { value: 2048, label: '2K (2,048 tokens)' },
    { value: 4096, label: '4K (4,096 tokens)' },
    { value: 8192, label: '8K (8,192 tokens)' },
    { value: 16384, label: '16K (16,384 tokens)' },
    { value: 32768, label: '32K (32,768 tokens)' },
    { value: 65536, label: '64K (65,536 tokens)' }
  ];

  const localSlider = document.getElementById('localModelContextSlider');
  const localDisplay = document.getElementById('localContextValueDisplay');

  if (localSlider && localDisplay) {
    chrome.storage.sync.get({ localModelContext: 8192 }).then((data) => {
      const savedVal = data.localModelContext || 8192;
      let stepIdx = LOCAL_CONTEXT_STEPS.findIndex(s => s.value === savedVal);
      if (stepIdx === -1) stepIdx = 2; // Default 8K
      localSlider.value = stepIdx;
      localDisplay.textContent = LOCAL_CONTEXT_STEPS[stepIdx].label;
    }).catch(() => {});

    localSlider.addEventListener('input', () => {
      const idx = parseInt(localSlider.value, 10) || 0;
      const step = LOCAL_CONTEXT_STEPS[idx] || LOCAL_CONTEXT_STEPS[2];
      localDisplay.textContent = step.label;
    });

    localSlider.addEventListener('change', () => {
      const idx = parseInt(localSlider.value, 10) || 0;
      const step = LOCAL_CONTEXT_STEPS[idx] || LOCAL_CONTEXT_STEPS[2];
      chrome.storage.sync.set({ localModelContext: step.value }).catch(() => {});
    });
  }

  initCustomLLMUI();
  initCustomEmbeddingModelUI();
  const btnDownload = document.getElementById('btnDownloadModel');
  const btnCancel = document.getElementById('btnCancelModelDownload');
  const btnLoad = document.getElementById('btnLoadModel');
  const btnUnload = document.getElementById('btnUnloadModel');
  const btnDelete = document.getElementById('btnDeleteModel');
  const btnTest = document.getElementById('btnTestModel');

  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      btnDownload.disabled = true;
      showModelProgress(0, 'Starting download...');
      try {
        await chrome.runtime.sendMessage({ action: 'startEmbeddingModelDownload', modelId: 'embeddinggemma-2' });
      } catch (err) {
        showModelError('Failed to start download: ' + err.message);
      } finally {
        btnDownload.disabled = false;
        refreshEmbeddingModelUI();
      }
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', async () => {
      btnCancel.disabled = true;
      try {
        await chrome.runtime.sendMessage({ action: 'cancelEmbeddingModelDownload', modelId: 'embeddinggemma-2' });
      } catch (err) {
        showModelError('Failed to cancel download: ' + err.message);
      } finally {
        btnCancel.disabled = false;
        refreshEmbeddingModelUI();
      }
    });
  }

  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      btnLoad.disabled = true;
      btnLoad.textContent = 'Loading...';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'loadEmbeddingModel', modelId: 'embeddinggemma-2' });
        if (!res?.success) throw new Error(res?.error || 'Failed to load model');
        showStatus('Model loaded into memory successfully!', 'success');
      } catch (err) {
        showModelError('Failed to load model: ' + err.message);
      } finally {
        btnLoad.disabled = false;
        btnLoad.textContent = 'Load Model';
        refreshEmbeddingModelUI();
      }
    });
  }

  if (btnUnload) {
    btnUnload.addEventListener('click', async () => {
      btnUnload.disabled = true;
      btnUnload.textContent = 'Unloading...';
      try {
        await chrome.runtime.sendMessage({ action: 'unloadEmbeddingModel', modelId: 'embeddinggemma-2' });
        showStatus('Model unloaded from memory.', 'info');
      } catch (err) {
        showModelError('Failed to unload model: ' + err.message);
      } finally {
        btnUnload.disabled = false;
        btnUnload.textContent = 'Unload Model';
        refreshEmbeddingModelUI();
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete the local EmbeddingGemma-2 model (~168 MB) from storage?')) {
        return;
      }
      btnDelete.disabled = true;
      try {
        await chrome.runtime.sendMessage({ action: 'deleteEmbeddingModel', modelId: 'embeddinggemma-2' });
      } catch (err) {
        showModelError('Failed to delete model: ' + err.message);
      } finally {
        btnDelete.disabled = false;
        refreshEmbeddingModelUI();
      }
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      btnTest.disabled = true;
      btnTest.textContent = 'Testing...';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'testMiniCPMModel' });
        if (res && res.success) {
          const conf = Math.round((res.confidence || 0.95) * 100);
          showStatus(`EmbeddingGemma model verified! Classified test bookmark into "${res.matchedCategory}" (${conf}% confidence).`, 'success');
        } else {
          showStatus('Test failed: ' + (res ? res.error : 'Unknown error'), 'error');
        }
      } catch (err) {
        showStatus('Test error: ' + err.message, 'error');
      } finally {
        btnTest.disabled = false;
        btnTest.textContent = 'Test EmbeddingGemma Model';
      }
    });
  }

  // Listen for background progress messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'llmModelProgress' || message.action === 'jevModelProgress' || message.action === 'embeddingModelProgress') {
      const prog = message.progress;
      if (message.modelId === 'custom-llm-model') {
        showCustomLLMProgress(prog.percent, `${formatBytes(prog.downloadedBytes)} / ${formatBytes(prog.totalBytes)} • ${prog.speed} • ETA: ${prog.eta}`);
      } else if (message.modelId === 'custom-embedding-model') {
        showCustomModelProgress(prog.percent, `${formatBytes(prog.downloadedBytes)} / ${formatBytes(prog.totalBytes)} • ${prog.speed} • ETA: ${prog.eta}`);
      } else {
        showModelProgress(prog.percent, `${formatBytes(prog.downloadedBytes)} / ${formatBytes(prog.totalBytes)} • ${prog.speed} • ETA: ${prog.eta}`);
      }
    } else if (message.action === 'llmModelStatusChanged' || message.action === 'jevModelStatusChanged' || message.action === 'embeddingModelStatusChanged') {
      refreshEmbeddingModelUI();
      refreshCustomLLMUI();
      refreshCustomModelUI();
    }
  });

  refreshEmbeddingModelUI();
  refreshCustomLLMUI();
  refreshCustomModelUI();
}
