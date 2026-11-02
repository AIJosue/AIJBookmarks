/**
 * Model Manager for Local Models
 * Primary Default: MiniCPM5-1B (Q5_K_M GGUF) - Non-embedding Instruct / LLM Model
 * URL: https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf
 * Alternate: LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M GGUF)
 * Legacy/Alternate: Qwen3-Embedding-0.6B (Q5_K_M GGUF)
 * Supports downloading and running Custom LLM and Custom Embedding models via URL.
 * Handles downloading, caching, deletion, auto-loading, and status checking for on-device models.
 * Powered by node-llama-cpp for offline bookmark sorting and classification.
 */

const EMBEDDINGGEMMA_MODELS = {
  'embeddinggemma-2': {
    id: 'embeddinggemma-2',
    name: 'EmbeddingGemma-2 (UD-Q4_K_XL)',
    filename: 'embeddinggemma-2-UD-Q4_K_XL.gguf',
    url: 'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf',
    sizeBytes: 175673856,
    sizeDisplay: '168 MB',
    format: 'GGUF',
    quantization: 'UD-Q4_K_XL',
    type: 'embedding-model',
    isInstructModel: false,
    isEmbeddingModel: true,
    isLLM: false,
    architecture: 'embeddinggemma-2',
    dimensions: 768,
    contextWindow: 8192,
    description: 'Universal Unsloth EmbeddingGemma-2 GGUF embedding model (UD-Q4_K_XL, ~168 MB). Engineered for on-device dense vector embeddings, cosine similarity, and Matryoshka dimension truncation (768 to 256 dims).'
  }
};

const MINICPM_MODELS = {
  ...EMBEDDINGGEMMA_MODELS,
  'minicpm5-1b': {
    id: 'minicpm5-1b',
    name: 'MiniCPM5-1B (Q5_K_M)',
    filename: 'MiniCPM5-1B-Q5_K_M.gguf',
    url: 'https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf',
    sizeBytes: 786862688,
    sizeDisplay: '787 MB',
    format: 'GGUF',
    quantization: 'Q5_K_M',
    type: 'instruct-model',
    isInstructModel: true,
    isEmbeddingModel: false,
    isLLM: true,
    architecture: 'minicpm',
    contextWindow: 32768,
    description: 'MiniCPM5 1.0B LLM / Instruct model quantized to Q5_K_M format. High-efficiency on-device neural language model engineered for intelligent bookmark sorting and categorization via node-llama-cpp.'
  }
};

const LIQUID_LFM_MODELS = {
  'lfm2.5-1.2b-instruct': {
    id: 'lfm2.5-1.2b-instruct',
    name: 'LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M)',
    filename: 'LFM2.5-1.2B-Instruct-Q5_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf',
    sizeBytes: 843354944,
    sizeDisplay: '843 MB',
    format: 'GGUF',
    quantization: 'Q5_K_M',
    type: 'instruct-model',
    isInstructModel: true,
    isEmbeddingModel: false,
    isLLM: true,
    architecture: 'liquid-lfm',
    contextWindow: 32768,
    description: 'Liquid AI LFM2.5 1.2B Instruct model (non-embedding) quantized to Q5_K_M format. High-efficiency on-device neural model engineered for instruction-following bookmark sorting and categorization via node-llama-cpp.'
  }
};

const QWEN_MODELS = {
  ...MINICPM_MODELS,
  ...LIQUID_LFM_MODELS,
  'qwen3-embedding-0.6b': {
    id: 'qwen3-embedding-0.6b',
    name: 'Qwen3-Embedding-0.6B (Q5_K_M)',
    filename: 'Qwen3-Embedding-0.6B-Q5_K_M.gguf',
    url: 'https://huggingface.co/PeterAM4/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q5_K_M.gguf?download=true',
    sizeBytes: 444184320,
    sizeDisplay: '444 MB',
    format: 'GGUF',
    quantization: 'Q5_K_M',
    type: 'embedding-model',
    isInstructModel: false,
    isEmbeddingModel: true,
    isLLM: false,
    architecture: 'qwen3-embedding',
    dimensions: 1024,
    contextWindow: 32768,
    description: 'Qwen3 0.6B embedding model quantized to Q5_K_M format. Legacy vector embedding model.'
  }
};

const DEFAULT_LOCAL_MODEL_ID = 'minicpm5-1b';
const DEFAULT_LLM_MODEL_ID = 'minicpm5-1b';
const DEFAULT_QWEN_MODEL_ID = 'qwen3-embedding-0.6b';
const DEFAULT_EMBEDDING_MODEL_ID = 'embeddinggemma-2';
const DEFAULT_EMBEDDINGGEMMA_MODEL_ID = 'embeddinggemma-2';
const CUSTOM_LLM_MODEL_ID = 'custom-llm-model';
const CUSTOM_EMBEDDING_MODEL_ID = 'custom-embedding-model';

// Aliases for seamless backward compatibility
const EMBEDDING_MODELS = {
  ...EMBEDDINGGEMMA_MODELS,
  ...QWEN_MODELS,
  'minicpm5-1b-instruct': MINICPM_MODELS['minicpm5-1b'],
  'clef-flash': MINICPM_MODELS['minicpm5-1b']
};
const JEV_MODELS = EMBEDDING_MODELS;
const DEFAULT_JEV_MODEL_ID = DEFAULT_EMBEDDING_MODEL_ID;
const CUSTOM_JEV_MODEL_ID = CUSTOM_EMBEDDING_MODEL_ID;
const MODEL_CACHE_NAME = 'aijbookmarks-models-v1';
const MODEL_DB_NAME = 'aijbookmarks-models-db';
const MODEL_STORE_NAME = 'models';

// In-memory fallback for environments where IndexedDB is unavailable (e.g. Node test runner)
const inMemoryModelStore = new Map();

class ModelManager {
  constructor() {
    this.activeDownloads = new Map();
    this.downloadProgress = new Map();
    this.customModels = new Map();
    this.isLoaded = false;
    this.isLoading = false;
    this.loadedModelId = null;
    this.dbPromise = null;
    this.loadStoredCustomModelConfig().catch(() => {});
  }

  /**
   * Loads any previously configured custom models (LLM and embedding) from chrome.storage.local.
   */
  async loadStoredCustomModelConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const stored = await chrome.storage.local.get([
          'customLLMModelConfig',
          'customEmbeddingModelConfig',
          'customJevModelConfig'
        ]);
        if (stored.customLLMModelConfig) {
          const cfg = stored.customLLMModelConfig;
          this.customModels.set(cfg.id || CUSTOM_LLM_MODEL_ID, cfg);
        }
        if (stored.customEmbeddingModelConfig) {
          const cfg = stored.customEmbeddingModelConfig;
          this.customModels.set(cfg.id || CUSTOM_EMBEDDING_MODEL_ID, cfg);
        } else if (stored.customJevModelConfig) {
          const cfg = stored.customJevModelConfig;
          this.customModels.set(cfg.id || CUSTOM_EMBEDDING_MODEL_ID, cfg);
        }
        return {
          llmConfig: stored.customLLMModelConfig || null,
          embeddingConfig: stored.customEmbeddingModelConfig || stored.customJevModelConfig || null
        };
      } catch {
        // Ignore storage access error
      }
    }
    return null;
  }

  /**
   * Registers or updates a custom LLM / instruct model configuration from a URL.
   */
  async registerCustomLLMModel(config) {
    if (!config || !config.url) {
      throw new Error('A valid LLM download URL is required.');
    }
    const id = config.id || CUSTOM_LLM_MODEL_ID;
    let filename = config.filename;
    if (!filename) {
      try {
        const u = new URL(config.url);
        const pathSegments = u.pathname.split('/').filter(Boolean);
        filename = pathSegments.pop() || 'custom-llm.gguf';
        filename = filename.split('?')[0];
      } catch {
        filename = 'custom-llm.gguf';
      }
    }
    const modelConfig = {
      id,
      name: config.name || filename.replace(/\.gguf$/i, '') || 'Custom LLM Model',
      filename,
      url: config.url.trim(),
      sizeBytes: config.sizeBytes || 0,
      sizeDisplay: config.sizeDisplay || (config.sizeBytes ? this.formatBytes(config.sizeBytes) : 'Custom URL'),
      format: 'GGUF',
      quantization: config.quantization || 'Custom',
      type: 'instruct-model',
      isInstructModel: true,
      isEmbeddingModel: false,
      isLLM: true,
      architecture: config.architecture || 'custom-llm',
      contextWindow: parseInt(config.contextWindow, 10) || 32768,
      description: config.description || `Custom GGUF LLM instruct model from ${config.url}`,
      isCustom: true
    };

    this.customModels.set(id, modelConfig);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        customLLMModelConfig: modelConfig
      });
    }

    return modelConfig;
  }

  /**
   * Registers or updates a custom model configuration.
   * Automatically branches to registerCustomLLMModel when configured as an instruct/LLM model.
   */
  async registerCustomModel(config) {
    if (!config || !config.url) {
      throw new Error('A valid model download URL is required.');
    }
    if (config.isLLM || config.type === 'instruct-model' || config.modelType === 'llm' || config.id === CUSTOM_LLM_MODEL_ID) {
      return this.registerCustomLLMModel(config);
    }
    const id = config.id || CUSTOM_EMBEDDING_MODEL_ID;
    let filename = config.filename;
    if (!filename) {
      try {
        const u = new URL(config.url);
        const pathSegments = u.pathname.split('/').filter(Boolean);
        filename = pathSegments.pop() || 'custom-model.gguf';
        filename = filename.split('?')[0];
      } catch {
        filename = 'custom-model.gguf';
      }
    }
    const modelConfig = {
      id,
      name: config.name || filename.replace(/\.gguf$/i, '') || 'Custom Embedding Model',
      filename,
      url: config.url.trim(),
      sizeBytes: config.sizeBytes || 0,
      sizeDisplay: config.sizeDisplay || (config.sizeBytes ? this.formatBytes(config.sizeBytes) : 'Custom'),
      format: 'GGUF',
      quantization: config.quantization || 'Custom',
      type: 'embedding-model',
      isInstructModel: false,
      isEmbeddingModel: true,
      isLLM: false,
      dimensions: parseInt(config.dimensions, 10) || 1024,
      contextWindow: parseInt(config.contextWindow, 10) || 32768,
      description: config.description || `Custom GGUF embedding model from ${config.url}`,
      isCustom: true
    };

    this.customModels.set(id, modelConfig);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        customJevModelConfig: modelConfig,
        customEmbeddingModelConfig: modelConfig
      });
    }

    return modelConfig;
  }

  /**
   * Returns metadata for all supported and registered custom models.
   */
  getAvailableModels() {
    return [...Object.values(EMBEDDING_MODELS), ...this.customModels.values()];
  }

  /**
   * Retrieves a specific model definition (built-in or custom).
   */
  getModelConfig(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    if (MINICPM_MODELS[modelId]) {
      return MINICPM_MODELS[modelId];
    }
    if (EMBEDDING_MODELS[modelId]) {
      return EMBEDDING_MODELS[modelId];
    }
    if (this.customModels.has(modelId)) {
      return this.customModels.get(modelId);
    }
    if (modelId === CUSTOM_LLM_MODEL_ID && this.customModels.has(CUSTOM_LLM_MODEL_ID)) {
      return this.customModels.get(CUSTOM_LLM_MODEL_ID);
    }
    if (modelId === CUSTOM_EMBEDDING_MODEL_ID && this.customModels.has(CUSTOM_EMBEDDING_MODEL_ID)) {
      return this.customModels.get(CUSTOM_EMBEDDING_MODEL_ID);
    }
    if (modelId === CUSTOM_EMBEDDING_MODEL_ID && this.customModels.size > 0) {
      return this.customModels.values().next().value;
    }
    return MINICPM_MODELS[DEFAULT_LOCAL_MODEL_ID] || EMBEDDING_MODELS[DEFAULT_LOCAL_MODEL_ID];
  }

  /**
   * Retrieves the MiniCPM5-1B (Q5_K_M) model configuration.
   */
  getEmbeddingGemmaModel() {
    return this.getModelConfig('embeddinggemma-2');
  }

  async useEmbeddingGemmaModel() {
    return this.loadModel('embeddinggemma-2');
  }

  getMiniCPMModel() {
    return this.getModelConfig('embeddinggemma-2');
  }

  /**
   * Sets and loads the model as active.
   */
  async useMiniCPMModel() {
    return this.loadModel('embeddinggemma-2');
  }

  /**
   * Retrieves custom LLM configuration from memory if registered.
   */
  getCustomLLMConfig() {
    return this.customModels.get(CUSTOM_LLM_MODEL_ID) || null;
  }

  /**
   * Retrieves the LiquidAI LFM2.5-1.2B-Instruct non-embedding model configuration.
   */
  getLiquidLFMModel() {
    return this.getModelConfig('lfm2.5-1.2b-instruct');
  }

  /**
   * Sets and loads the LiquidAI LFM2.5-1.2B-Instruct model as active.
   */
  async useLiquidLFMModel() {
    return this.loadModel('lfm2.5-1.2b-instruct');
  }

  /**
   * Formats bytes into human-readable string.
   */
  formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /**
   * Opens or initializes the IndexedDB database for model blob storage.
   */
  async getDB() {
    if (typeof indexedDB === 'undefined') return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(MODEL_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
          db.createObjectStore(MODEL_STORE_NAME, { keyPath: 'modelId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('Could not open IndexedDB for model storage:', req.error);
        resolve(null);
      };
    });

    return this.dbPromise;
  }

  /**
   * Saves model blob to IndexedDB (or in-memory store if IDB unavailable).
   */
  async saveModelBlob(modelId, blob) {
    const db = await this.getDB();
    if (!db) {
      inMemoryModelStore.set(modelId, blob);
      return true;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(MODEL_STORE_NAME, 'readwrite');
        const store = tx.objectStore(MODEL_STORE_NAME);
        const req = store.put({
          modelId,
          blob,
          size: blob.size,
          updatedAt: Date.now()
        });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Checks if model binary data exists in IndexedDB or memory.
   */
  async hasModelData(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    const db = await this.getDB();
    if (!db) {
      return inMemoryModelStore.has(modelId);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(MODEL_STORE_NAME, 'readonly');
        const store = tx.objectStore(MODEL_STORE_NAME);
        const req = store.get(modelId);
        req.onsuccess = () => resolve(Boolean(req.result && req.result.blob));
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Retrieves the stored Blob for a model.
   */
  async getModelBlob(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    const db = await this.getDB();
    if (!db) {
      const blob = inMemoryModelStore.get(modelId);
      if (!blob) throw new Error(`Model ${modelId} not found in memory store`);
      return blob;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(MODEL_STORE_NAME, 'readonly');
        const store = tx.objectStore(MODEL_STORE_NAME);
        const req = store.get(modelId);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            resolve(req.result.blob);
          } else {
            reject(new Error(`Model ${modelId} not found in IndexedDB`));
          }
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Retrieves the raw ArrayBuffer of the downloaded model.
   */
  async getModelBuffer(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    const blob = await this.getModelBlob(modelId);
    if (blob.arrayBuffer) {
      return await blob.arrayBuffer();
    }
    // Fallback if blob is already ArrayBuffer
    if (blob instanceof ArrayBuffer) {
      return blob;
    }
    return new Response(blob).arrayBuffer();
  }

  /**
   * Deletes model binary data from IndexedDB and memory.
   */
  async deleteModelData(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    inMemoryModelStore.delete(modelId);
    const db = await this.getDB();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(MODEL_STORE_NAME, 'readwrite');
          const store = tx.objectStore(MODEL_STORE_NAME);
          const req = store.delete(modelId);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }

    // Try deleting from CacheStorage if present
    try {
      if (typeof caches !== 'undefined') {
        const model = this.getModelConfig(modelId);
        const cache = await caches.open(MODEL_CACHE_NAME);
        await cache.delete(model.url);
      }
    } catch {
      // Ignore cache deletion error
    }
  }

  /**
   * Checks current download and readiness status of a model.
   * Possible states: 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'loaded' | 'error'
   */
  async getStatus(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    await this.loadStoredCustomModelConfig();
    const model = this.getModelConfig(modelId);

    // 1. Actively downloading
    if (this.activeDownloads.has(modelId)) {
      const prog = this.downloadProgress.get(modelId) || {};
      return {
        modelId,
        model,
        status: 'downloading',
        isLoaded: false,
        percent: prog.percent || 0,
        downloadedBytes: prog.downloadedBytes || 0,
        totalBytes: prog.totalBytes || model.sizeBytes,
        speed: prog.speed || '0 KB/s',
        eta: prog.eta || '--',
        error: null
      };
    }

    // 2. Actively loading into memory
    if (this.isLoading && this.loadedModelId === modelId) {
      return {
        modelId,
        model,
        status: 'loading',
        isLoaded: false,
        percent: 100,
        downloadedBytes: model.sizeBytes,
        totalBytes: model.sizeBytes,
        error: null
      };
    }

    // 3. Check storage and IndexedDB for download presence
    let isDownloaded = false;
    let storedSize = model.sizeBytes;
    let downloadedAt = null;
    let storedLoaded = false;
    let stored = null;

    try {
      stored = await chrome.storage.local.get([
        'embeddingModelStatus',
        'embeddingModelLoaded',
        'embeddingModelId',
        'embeddingModelSize',
        'embeddingModelDownloadedAt',
        'embeddingModelError'
      ]);

      if (stored.embeddingModelError && stored.embeddingModelStatus === 'error') {
        return {
          modelId,
          model,
          status: 'error',
          isLoaded: false,
          percent: 0,
          downloadedBytes: 0,
          totalBytes: model.sizeBytes,
          error: stored.embeddingModelError
        };
      }

      if (stored.embeddingModelId === modelId &&
          (stored.embeddingModelStatus === 'downloaded' || stored.embeddingModelStatus === 'loaded')) {
        isDownloaded = true;
        storedLoaded = Boolean(stored.embeddingModelLoaded || stored.embeddingModelStatus === 'loaded');
        if (stored.embeddingModelSize) storedSize = stored.embeddingModelSize;
        if (stored.embeddingModelDownloadedAt) downloadedAt = stored.embeddingModelDownloadedAt;
      }
    } catch {
      // Ignore storage error
    }

    // Also check IndexedDB / memory data
    if (!isDownloaded) {
      isDownloaded = await this.hasModelData(modelId);
    }

    if (isDownloaded) {
      const isLoaded = (this.isLoaded && this.loadedModelId === modelId) || (storedLoaded && stored?.embeddingModelId === modelId);
      return {
        modelId,
        model,
        status: isLoaded ? 'loaded' : 'downloaded',
        isLoaded,
        percent: 100,
        downloadedBytes: storedSize,
        totalBytes: storedSize,
        downloadedAt,
        error: null
      };
    }

    return {
      modelId,
      model,
      status: 'not_downloaded',
      isLoaded: false,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: model.sizeBytes,
      error: null
    };
  }

  /**
   * Loads downloaded model weights into memory.
   */
  async loadModel(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    const current = await this.getStatus(modelId);
    if (current.status === 'not_downloaded' || current.status === 'downloading') {
      throw new Error('Cannot load model: model is not yet downloaded.');
    }

    if (this.isLoaded && this.loadedModelId === modelId) {
      return { success: true, status: 'loaded', alreadyLoaded: true };
    }

    this.isLoading = true;
    this.loadedModelId = modelId;
    this.broadcastStatusChange(modelId, 'loading');

    try {
      console.log(`Loading model ${modelId} into memory...`);
      const buffer = await this.getModelBuffer(modelId);

      const engine = (typeof globalThis !== 'undefined' && globalThis.jevEngine) ||
        (typeof globalThis !== 'undefined' && globalThis.embeddingEngine) ||
        (typeof embeddingEngine !== 'undefined' ? embeddingEngine : null);
      if (engine && typeof engine.loadModel === 'function') {
        engine.loadModel(modelId, buffer);
      }

      this.isLoaded = true;
      this.isLoading = false;

      await chrome.storage.local.set({
        embeddingModelStatus: 'loaded',
        embeddingModelLoaded: true,
        embeddingModelId: modelId
      });

      this.broadcastStatusChange(modelId, 'loaded');
      return { success: true, status: 'loaded' };
    } catch (err) {
      this.isLoading = false;
      this.isLoaded = false;
      console.error(`Failed to load model ${modelId}:`, err);
      this.broadcastStatusChange(modelId, 'downloaded', err.message);
      throw err;
    }
  }

  /**
   * Unloads model weights from memory.
   */
  async unloadModel(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    const engine = (typeof globalThis !== 'undefined' && globalThis.jevEngine) ||
      (typeof globalThis !== 'undefined' && globalThis.embeddingEngine) ||
      (typeof embeddingEngine !== 'undefined' ? embeddingEngine : null);
    if (engine && typeof engine.unloadModel === 'function') {
      engine.unloadModel();
    }

    this.isLoaded = false;
    this.isLoading = false;
    this.loadedModelId = null;

    await chrome.storage.local.set({
      embeddingModelStatus: 'downloaded',
      embeddingModelLoaded: false,
      embeddingModelId: modelId
    });

    this.broadcastStatusChange(modelId, 'downloaded');
    return { success: true, status: 'downloaded' };
  }

  /**
   * Initiates chunked streaming download of the model on demand.
   * Supports both built-in models and custom models via customConfig object.
   */
  async startDownload(modelId = DEFAULT_LOCAL_MODEL_ID, customConfig = null) {
    if (customConfig && customConfig.url) {
      const isLLM = customConfig.isLLM ?? (customConfig.type === 'instruct-model' || customConfig.modelType === 'llm' || modelId === CUSTOM_LLM_MODEL_ID);
      const defaultId = isLLM ? CUSTOM_LLM_MODEL_ID : CUSTOM_EMBEDDING_MODEL_ID;
      const reg = await this.registerCustomModel({ ...customConfig, id: modelId || defaultId });
      modelId = reg.id;
    }

    const model = this.getModelConfig(modelId);

    // If already downloading, return current status
    if (this.activeDownloads.has(modelId)) {
      return this.getStatus(modelId);
    }

    const currentStatus = await this.getStatus(modelId);
    if (currentStatus.status === 'downloaded' || currentStatus.status === 'loaded') {
      return currentStatus;
    }

    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    const progressInfo = {
      modelId,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: model.sizeBytes,
      speed: '0 KB/s',
      eta: '--'
    };
    this.downloadProgress.set(modelId, progressInfo);

    await chrome.storage.local.set({
      embeddingModelStatus: 'downloading',
      embeddingModelLoaded: false,
      embeddingModelId: modelId,
      embeddingModelError: null
    });

    this.broadcastStatusChange(modelId, 'downloading');

    (async () => {
      let lastTime = performance.now();
      let lastBytes = 0;

      try {
        console.log(`Starting download of ${model.name} from:`, model.url);
        const response = await fetch(model.url, {
          signal: controller.signal,
          redirect: 'follow',
          mode: 'cors'
        });

        if (!response.ok) {
          throw new Error(`Download HTTP error ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get('Content-Length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : model.sizeBytes;
        progressInfo.totalBytes = totalBytes;

        const reader = response.body.getReader();
        const chunks = [];
        let downloadedBytes = 0;
        let lastBroadcastTime = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          downloadedBytes += value.byteLength;

          const now = performance.now();
          // Throttle progress updates to UI every 200ms
          if (now - lastBroadcastTime >= 200) {
            const elapsedSinceLastSec = (now - lastTime) / 1000;
            const bytesSinceLast = downloadedBytes - lastBytes;
            const speedBps = elapsedSinceLastSec > 0 ? (bytesSinceLast / elapsedSinceLastSec) : 0;
            const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
            const etaSec = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;

            const percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));

            progressInfo.percent = percent;
            progressInfo.downloadedBytes = downloadedBytes;
            progressInfo.speed = `${this.formatBytes(speedBps)}/s`;
            progressInfo.eta = etaSec > 60 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : `${etaSec}s`;

            this.broadcastProgress(modelId, progressInfo);

            lastBroadcastTime = now;
            lastTime = now;
            lastBytes = downloadedBytes;
          }
        }

        // Combine chunks into a single Blob
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        console.log(`Download complete! Storing ${this.formatBytes(blob.size)} into IndexedDB...`);

        // Validate GGUF header if format is GGUF
        if (blob.size >= 4) {
          try {
            const magicBuf = await blob.slice(0, 4).arrayBuffer();
            const magicView = new Uint8Array(magicBuf);
            const magicStr = String.fromCharCode(...magicView);
            if (magicStr === 'GGUF') {
              console.log(`Verified GGUF magic header for ${modelId}`);
            } else {
              console.warn(`File does not start with GGUF magic bytes (got "${magicStr}"). Proceeding with storage.`);
            }
          } catch (magicErr) {
            console.warn('Could not verify GGUF header:', magicErr);
          }
        }

        // Store into IndexedDB
        await this.saveModelBlob(modelId, blob);

        // Update custom model metadata with exact downloaded size
        if (this.customModels.has(modelId)) {
          const cfg = this.customModels.get(modelId);
          cfg.sizeBytes = blob.size;
          cfg.sizeDisplay = this.formatBytes(blob.size);
          this.customModels.set(modelId, cfg);
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            if (modelId === CUSTOM_LLM_MODEL_ID || cfg.isLLM) {
              await chrome.storage.local.set({ customLLMModelConfig: cfg }).catch(() => {});
            } else {
              await chrome.storage.local.set({ customEmbeddingModelConfig: cfg }).catch(() => {});
            }
          }
        }

        // Optional secondary cache using valid https:// URL
        if (typeof caches !== 'undefined' && model.url.startsWith('https://')) {
          try {
            const cache = await caches.open(MODEL_CACHE_NAME);
            const cachedResponse = new Response(blob, {
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(blob.size),
                'X-Model-Id': modelId,
                'X-Downloaded-At': new Date().toISOString()
              }
            });
            await cache.put(model.url, cachedResponse);
          } catch (cacheErr) {
            console.warn('Optional CacheStorage fallback skipped:', cacheErr);
          }
        }

        this.activeDownloads.delete(modelId);
        this.downloadProgress.delete(modelId);

        await chrome.storage.local.set({
          embeddingModelStatus: 'downloaded',
          embeddingModelLoaded: false,
          embeddingModelId: modelId,
          embeddingModelFilename: model.filename,
          embeddingModelDownloadedAt: Date.now(),
          embeddingModelSize: blob.size,
          useLocalEmbeddings: true,
          embeddingModelError: null
        });

        // Automatically load into memory upon download completion
        try {
          await this.loadModel(modelId);
        } catch (loadErr) {
          console.warn('Auto-load after download skipped/failed:', loadErr);
          this.broadcastStatusChange(modelId, 'downloaded');
        }
      } catch (err) {
        this.activeDownloads.delete(modelId);
        this.downloadProgress.delete(modelId);

        if (err.name === 'AbortError') {
          console.log('Download cancelled by user.');
          await chrome.storage.local.set({
            embeddingModelStatus: 'not_downloaded',
            embeddingModelLoaded: false,
            embeddingModelError: null
          });
          this.broadcastStatusChange(modelId, 'not_downloaded');
        } else {
          console.error('Download failed:', err);
          await chrome.storage.local.set({
            embeddingModelStatus: 'error',
            embeddingModelLoaded: false,
            embeddingModelError: err.message
          });
          this.broadcastStatusChange(modelId, 'error', err.message);
        }
      }
    })();

    return {
      modelId,
      model,
      status: 'downloading',
      isLoaded: false,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: model.sizeBytes,
      speed: 'Connecting...',
      eta: '--'
    };
  }

  /**
   * Cancels an in-progress download.
   */
  async cancelDownload(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    if (this.activeDownloads.has(modelId)) {
      const controller = this.activeDownloads.get(modelId);
      controller.abort();
      this.activeDownloads.delete(modelId);
      this.downloadProgress.delete(modelId);
    }

    await chrome.storage.local.set({
      embeddingModelStatus: 'not_downloaded',
      embeddingModelLoaded: false,
      embeddingModelError: null
    });

    this.broadcastStatusChange(modelId, 'not_downloaded');
    return { success: true };
  }

  /**
   * Deletes model from storage and resets configuration.
   */
  async deleteModel(modelId = DEFAULT_EMBEDDING_MODEL_ID) {
    await this.cancelDownload(modelId);
    if (this.loadedModelId === modelId) {
      await this.unloadModel(modelId);
    }
    await this.deleteModelData(modelId);

    const stored = await chrome.storage?.local?.get(['embeddingModelId']).catch(() => ({}));
    if (!stored || stored.embeddingModelId === modelId) {
      await chrome.storage.local.remove([
        'embeddingModelStatus',
        'embeddingModelLoaded',
        'embeddingModelId',
        'embeddingModelFilename',
        'embeddingModelDownloadedAt',
        'embeddingModelSize',
        'useLocalEmbeddings',
        'embeddingModelError'
      ]).catch(() => {});
    }

    if (this.customModels.has(modelId)) {
      this.customModels.delete(modelId);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        if (modelId === CUSTOM_LLM_MODEL_ID) {
          await chrome.storage.local.remove(['customLLMModelConfig']).catch(() => {});
        } else {
          await chrome.storage.local.remove(['customEmbeddingModelConfig', 'customJevModelConfig']).catch(() => {});
        }
      }
    }

    this.broadcastStatusChange(modelId, 'not_downloaded');
    return { success: true };
  }

  /**
   * Broadcasts download progress to open UI pages.
   */
  broadcastProgress(modelId, progress) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'llmModelProgress',
        modelId,
        progress
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'jevModelProgress',
        modelId,
        progress
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'embeddingModelProgress',
        modelId,
        progress
      }).catch(() => {});
    }
  }

  /**
   * Broadcasts model status changes (e.g. downloaded, loaded, deleted, error).
   */
  broadcastStatusChange(modelId, status, error = null) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'llmModelStatusChanged',
        modelId,
        status,
        error
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'jevModelStatusChanged',
        modelId,
        status,
        error
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'embeddingModelStatusChanged',
        modelId,
        status,
        error
      }).catch(() => {});
    }
  }
}

// Global instance
const modelManager = new ModelManager();
if (typeof self !== 'undefined') {
  self.modelManager = modelManager;
  self.EMBEDDINGGEMMA_MODELS = EMBEDDINGGEMMA_MODELS;
  self.DEFAULT_EMBEDDINGGEMMA_MODEL_ID = DEFAULT_EMBEDDINGGEMMA_MODEL_ID;
  self.MINICPM_MODELS = MINICPM_MODELS;
  self.LIQUID_LFM_MODELS = LIQUID_LFM_MODELS;
  self.DEFAULT_LOCAL_MODEL_ID = DEFAULT_LOCAL_MODEL_ID;
  self.DEFAULT_LLM_MODEL_ID = DEFAULT_LLM_MODEL_ID;
  self.CUSTOM_LLM_MODEL_ID = CUSTOM_LLM_MODEL_ID;
  self.QWEN_MODELS = QWEN_MODELS;
  self.DEFAULT_QWEN_MODEL_ID = DEFAULT_QWEN_MODEL_ID;
  self.JEV_MODELS = JEV_MODELS;
  self.DEFAULT_JEV_MODEL_ID = DEFAULT_JEV_MODEL_ID;
  self.CUSTOM_JEV_MODEL_ID = CUSTOM_JEV_MODEL_ID;
  self.EMBEDDING_MODELS = EMBEDDING_MODELS;
  self.DEFAULT_EMBEDDING_MODEL_ID = DEFAULT_EMBEDDING_MODEL_ID;
  self.CUSTOM_EMBEDDING_MODEL_ID = CUSTOM_EMBEDDING_MODEL_ID;
}
if (typeof globalThis !== 'undefined') {
  globalThis.modelManager = modelManager;
  globalThis.EMBEDDINGGEMMA_MODELS = EMBEDDINGGEMMA_MODELS;
  globalThis.DEFAULT_EMBEDDINGGEMMA_MODEL_ID = DEFAULT_EMBEDDINGGEMMA_MODEL_ID;
  globalThis.MINICPM_MODELS = MINICPM_MODELS;
  globalThis.LIQUID_LFM_MODELS = LIQUID_LFM_MODELS;
  globalThis.DEFAULT_LOCAL_MODEL_ID = DEFAULT_LOCAL_MODEL_ID;
  globalThis.DEFAULT_LLM_MODEL_ID = DEFAULT_LLM_MODEL_ID;
  globalThis.CUSTOM_LLM_MODEL_ID = CUSTOM_LLM_MODEL_ID;
  globalThis.QWEN_MODELS = QWEN_MODELS;
  globalThis.DEFAULT_QWEN_MODEL_ID = DEFAULT_QWEN_MODEL_ID;
  globalThis.JEV_MODELS = JEV_MODELS;
  globalThis.DEFAULT_JEV_MODEL_ID = DEFAULT_JEV_MODEL_ID;
  globalThis.CUSTOM_JEV_MODEL_ID = CUSTOM_JEV_MODEL_ID;
  globalThis.EMBEDDING_MODELS = EMBEDDING_MODELS;
  globalThis.DEFAULT_EMBEDDING_MODEL_ID = DEFAULT_EMBEDDING_MODEL_ID;
  globalThis.CUSTOM_EMBEDDING_MODEL_ID = CUSTOM_EMBEDDING_MODEL_ID;
}

