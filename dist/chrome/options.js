// Default settings
const DEFAULT_SETTINGS = {
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

const CONTEXT_WINDOW_LIMITS = {
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

function isValidGeminiApiKey(apiKey) {
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

async function loadNewFolderLocationOptions(selectedLocation = 'root-bar') {
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
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = folder.path;
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
    if (settings.geminiApiKey) {
      loadGeminiModels(false, settings.geminiModel, false);
    }
    if (settings.googleCloudApiKey) {
      loadGeminiModels(false, settings.googleCloudModel, true);
    }
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

async function loadOpenaiModels(forceRefresh = false, preselectedModel = null) {
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
    if (!apiKey) throw new Error("No API key");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    let models = Array.isArray(data.models) ? data.models : [];

    // Filter to generative models (generateContent)
    models = models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));

    const currentValue = preselectedModel || select.value;
    select.textContent = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = 'custom';
    defaultOption.textContent = '— Custom Model Name —';

    let matched = false;
    for (const m of models) {
      const modelId = m.name.replace('models/', '');
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = m.displayName ? `${m.displayName} (${modelId})` : modelId;
      if (modelId === currentValue) {
        opt.selected = true;
        matched = true;
      }
      select.appendChild(opt);
    }
    
    select.appendChild(defaultOption);

    if (currentValue && !matched) {
      const opt = document.createElement('option');
      opt.value = currentValue;
      opt.textContent = currentValue;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
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
