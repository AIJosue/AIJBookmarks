import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

// Load model-manager and embedding-engine in Node test environment
const modelManagerCode = fs.readFileSync(path.join(process.cwd(), 'model-manager.js'), 'utf8');
const embeddingEngineCode = fs.readFileSync(path.join(process.cwd(), 'embedding-engine.js'), 'utf8');

// Set up mock browser globals for tests
globalThis.self = globalThis;
const localStorageStore = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (!keys) return Promise.resolve(Object.fromEntries(localStorageStore));
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) {
            if (localStorageStore.has(k)) {
              res[k] = localStorageStore.get(k);
            }
          }
          return Promise.resolve(res);
        }
        if (typeof keys === 'object') {
          const res = { ...keys };
          for (const k of Object.keys(keys)) {
            if (localStorageStore.has(k)) {
              res[k] = localStorageStore.get(k);
            }
          }
          return Promise.resolve(res);
        }
        return Promise.resolve({});
      },
      set: (items) => {
        for (const [k, v] of Object.entries(items)) {
          localStorageStore.set(k, v);
        }
        return Promise.resolve();
      },
      remove: (keys) => {
        if (typeof keys === 'string') keys = [keys];
        for (const k of keys) {
          localStorageStore.delete(k);
        }
        return Promise.resolve();
      }
    }
  },
  runtime: {
    sendMessage: () => Promise.resolve()
  }
};

eval(modelManagerCode);
eval(embeddingEngineCode);

describe('ModelManager (Qwen3 Embedding Model)', () => {
  it('should register Qwen3-Embedding-0.6B (Q5_K_M) with correct Hugging Face URL', () => {
    const model = globalThis.modelManager.getModelConfig('qwen3-embedding-0.6b');
    assert.ok(model, 'Model should exist');
    assert.strictEqual(model.id, 'qwen3-embedding-0.6b');
    assert.strictEqual(model.name, 'Qwen3-Embedding-0.6B (Q5_K_M)');
    assert.strictEqual(model.filename, 'Qwen3-Embedding-0.6B-Q5_K_M.gguf');
    assert.ok(
      model.url.startsWith('https://huggingface.co/PeterAM4/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q5_K_M.gguf'),
      'URL must match Hugging Face path'
    );
    assert.strictEqual(model.architecture, 'qwen3-embedding');
    assert.strictEqual(model.quantization, 'Q5_K_M');
    assert.strictEqual(model.sizeBytes, 444184320);
    assert.strictEqual(model.dimensions, 1024);
  });

  it('should correctly format byte values into readable units', () => {
    const mm = globalThis.modelManager;
    assert.strictEqual(mm.formatBytes(0), '0 B');
    assert.strictEqual(mm.formatBytes(500), '500 B');
    assert.strictEqual(mm.formatBytes(1024), '1.0 KB');
    assert.strictEqual(mm.formatBytes(1048576), '1.0 MB');
    assert.strictEqual(mm.formatBytes(444184320), '423.6 MB');
    assert.strictEqual(mm.formatBytes(1073741824), '1.0 GB');
  });

  it('should report not_downloaded status when model is not cached', async () => {
    const status = await globalThis.modelManager.getStatus('qwen3-embedding-0.6b');
    assert.strictEqual(status.status, 'not_downloaded');
    assert.strictEqual(status.isLoaded, false);
    assert.strictEqual(status.percent, 0);
  });

  it('should support saving model data, loading into memory, and unloading', async () => {
    const mm = globalThis.modelManager;
    const engine = globalThis.embeddingEngine;

    // Create a mock GGUF buffer
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); view.setUint8(1, 0x47); view.setUint8(2, 0x55); view.setUint8(3, 0x46);
    view.setUint32(4, 3, true);
    view.setUint32(8, 1, true); view.setUint32(12, 0, true);
    view.setUint32(16, 1, true); view.setUint32(20, 0, true);

    const mockBlob = {
      size: buffer.byteLength,
      arrayBuffer: () => Promise.resolve(buffer)
    };

    // Save model data
    await mm.saveModelBlob('qwen3-embedding-0.6b', mockBlob);
    assert.strictEqual(await mm.hasModelData('qwen3-embedding-0.6b'), true);

    // Initial status after download is downloaded (unloaded)
    const statusDownloaded = await mm.getStatus('qwen3-embedding-0.6b');
    assert.strictEqual(statusDownloaded.status, 'downloaded');
    assert.strictEqual(statusDownloaded.isLoaded, false);

    // Load model
    const loadRes = await mm.loadModel('qwen3-embedding-0.6b');
    assert.strictEqual(loadRes.success, true);
    assert.strictEqual(loadRes.status, 'loaded');
    assert.strictEqual(mm.isLoaded, true);
    assert.strictEqual(engine.isModelLoaded(), true);

    const statusLoaded = await mm.getStatus('qwen3-embedding-0.6b');
    assert.strictEqual(statusLoaded.status, 'loaded');
    assert.strictEqual(statusLoaded.isLoaded, true);

    // Unload model
    const unloadRes = await mm.unloadModel('qwen3-embedding-0.6b');
    assert.strictEqual(unloadRes.success, true);
    assert.strictEqual(unloadRes.status, 'downloaded');
    assert.strictEqual(mm.isLoaded, false);
    assert.strictEqual(engine.isModelLoaded(), false);

    const statusUnloaded = await mm.getStatus('qwen3-embedding-0.6b');
    assert.strictEqual(statusUnloaded.status, 'downloaded');
    assert.strictEqual(statusUnloaded.isLoaded, false);

    // Delete model
    await mm.deleteModel('qwen3-embedding-0.6b');
    assert.strictEqual(await mm.hasModelData('qwen3-embedding-0.6b'), false);
    const statusDeleted = await mm.getStatus('qwen3-embedding-0.6b');
    assert.strictEqual(statusDeleted.status, 'not_downloaded');
  });

  it('should automatically load model immediately after downloading in startDownload', async () => {
    const mm = globalThis.modelManager;
    const originalFetch = globalThis.fetch;

    // Create a mock GGUF buffer
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); view.setUint8(1, 0x47); view.setUint8(2, 0x55); view.setUint8(3, 0x46);
    view.setUint32(4, 3, true);
    view.setUint32(8, 1, true); view.setUint32(12, 0, true);
    view.setUint32(16, 1, true); view.setUint32(20, 0, true);

    try {
      globalThis.fetch = async () => {
        return new Response(buffer, {
          status: 200,
          headers: { 'Content-Length': String(buffer.byteLength) }
        });
      };

      const startRes = await mm.startDownload('qwen3-embedding-0.6b');
      assert.strictEqual(startRes.status, 'downloading');

      // Wait for background download and auto-load to complete
      while (mm.activeDownloads.has('qwen3-embedding-0.6b')) {
        await new Promise(r => setTimeout(r, 10));
      }

      // Assert it was automatically loaded into memory
      const status = await mm.getStatus('qwen3-embedding-0.6b');
      assert.strictEqual(status.status, 'loaded');
      assert.strictEqual(status.isLoaded, true);
      assert.strictEqual(mm.isLoaded, true);

      // Clean up
      await mm.deleteModel('qwen3-embedding-0.6b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should properly persist custom model settings to chrome.storage.local in registerCustomModel', async () => {
    const mm = globalThis.modelManager;
    const customConfig = {
      url: 'https://huggingface.co/custom/model/resolve/main/custom-model.gguf',
      name: 'Custom-Embedding-0.5B',
      dimensions: 1024,
      quantization: 'Q5_K_M',
      sizeBytes: 450000000
    };

    const registered = await mm.registerCustomModel(customConfig);
    assert.strictEqual(registered.id, 'custom-embedding-model');
    assert.strictEqual(registered.name, 'Custom-Embedding-0.5B');
    assert.strictEqual(registered.url, customConfig.url);
    assert.strictEqual(registered.dimensions, 1024);
    assert.strictEqual(registered.isCustom, true);

    const stored = await globalThis.chrome.storage.local.get(['customEmbeddingModelConfig']);
    assert.ok(stored.customEmbeddingModelConfig);
    assert.strictEqual(stored.customEmbeddingModelConfig.name, 'Custom-Embedding-0.5B');
    assert.strictEqual(stored.customEmbeddingModelConfig.url, customConfig.url);

    const retrieved = mm.getModelConfig('custom-embedding-model');
    assert.strictEqual(retrieved.name, 'Custom-Embedding-0.5B');
  });

  it('should handle custom model configurations and store binary data in startDownload', async () => {
    const mm = globalThis.modelManager;
    const originalFetch = globalThis.fetch;

    // Create a mock GGUF buffer
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); view.setUint8(1, 0x47); view.setUint8(2, 0x55); view.setUint8(3, 0x46); // 'GGUF'
    view.setUint32(4, 3, true);
    view.setUint32(8, 1, true); view.setUint32(12, 0, true);
    view.setUint32(16, 1, true); view.setUint32(20, 0, true);

    try {
      globalThis.fetch = async () => {
        return new Response(buffer, {
          status: 200,
          headers: { 'Content-Length': String(buffer.byteLength) }
        });
      };

      const customConfig = {
        url: 'https://example.com/models/test-custom.gguf',
        name: 'Test-Custom-GGUF',
        dimensions: 1024
      };

      const startRes = await mm.startDownload('custom-embedding-model', customConfig);
      assert.strictEqual(startRes.status, 'downloading');
      assert.strictEqual(startRes.modelId, 'custom-embedding-model');

      // Wait for background download to complete
      while (mm.activeDownloads.has('custom-embedding-model')) {
        await new Promise(r => setTimeout(r, 10));
      }

      assert.strictEqual(await mm.hasModelData('custom-embedding-model'), true);
      const blob = await mm.getModelBlob('custom-embedding-model');
      assert.strictEqual(blob.size, buffer.byteLength);

      const status = await mm.getStatus('custom-embedding-model');
      assert.strictEqual(status.status, 'loaded');
      assert.strictEqual(status.isLoaded, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should function correctly with custom model ID for loadModel and unloadModel', async () => {
    const mm = globalThis.modelManager;
    const engine = globalThis.embeddingEngine;

    // Ensure model is currently loaded
    assert.strictEqual(mm.isLoaded, true);
    assert.strictEqual(engine.isModelLoaded(), true);

    // Unload custom model
    const unloadRes = await mm.unloadModel('custom-embedding-model');
    assert.strictEqual(unloadRes.success, true);
    assert.strictEqual(unloadRes.status, 'downloaded');
    assert.strictEqual(mm.isLoaded, false);
    assert.strictEqual(engine.isModelLoaded(), false);

    const statusUnloaded = await mm.getStatus('custom-embedding-model');
    assert.strictEqual(statusUnloaded.status, 'downloaded');
    assert.strictEqual(statusUnloaded.isLoaded, false);

    // Load custom model
    const loadRes = await mm.loadModel('custom-embedding-model');
    assert.strictEqual(loadRes.success, true);
    assert.strictEqual(loadRes.status, 'loaded');
    assert.strictEqual(mm.isLoaded, true);
    assert.strictEqual(engine.isModelLoaded(), true);

    const statusLoaded = await mm.getStatus('custom-embedding-model');
    assert.strictEqual(statusLoaded.status, 'loaded');
    assert.strictEqual(statusLoaded.isLoaded, true);
  });

  it('should delete custom model binary data, reset local storage keys in deleteModel', async () => {
    const mm = globalThis.modelManager;

    const deleteRes = await mm.deleteModel('custom-embedding-model');
    assert.strictEqual(deleteRes.success, true);

    // Binary data is removed
    assert.strictEqual(await mm.hasModelData('custom-embedding-model'), false);

    // Status is reset to not_downloaded
    const status = await mm.getStatus('custom-embedding-model');
    assert.strictEqual(status.status, 'not_downloaded');
    assert.strictEqual(status.isLoaded, false);

    // In-memory registration removed
    assert.strictEqual(mm.customModels.has('custom-embedding-model'), false);
  });
});

describe('Qwen3EmbeddingEngine & node-llama-cpp', () => {
  it('should parse GGUF header and validate magic bytes', () => {
    const engine = globalThis.embeddingEngine;

    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47);
    view.setUint8(1, 0x47);
    view.setUint8(2, 0x55);
    view.setUint8(3, 0x46);
    view.setUint32(4, 3, true); // version 3
    view.setUint32(8, 10, true); // tensor count
    view.setUint32(12, 0, true);
    view.setUint32(16, 5, true); // metadata count
    view.setUint32(20, 0, true);

    const header = engine.parseGGUFHeader(buffer);
    assert.strictEqual(header.magic, 'GGUF');
    assert.strictEqual(header.version, 3);
    assert.strictEqual(header.tensorCount, 10);
    assert.strictEqual(header.metadataCount, 5);
    assert.strictEqual(header.dimensions, 1024);
    assert.strictEqual(header.architecture, 'qwen3-embedding');
  });

  it('should provide nodeLlamaCppEmbed and embedWithNodeLlamaCpp functions', async () => {
    const engine = globalThis.embeddingEngine;
    assert.strictEqual(typeof globalThis.nodeLlamaCppEmbed, 'function');
    assert.strictEqual(typeof engine.embedWithNodeLlamaCpp, 'function');

    // Without a model path, nodeLlamaCppEmbed returns null gracefully
    const res = await globalThis.nodeLlamaCppEmbed('Test query');
    assert.strictEqual(res, null);

    const res2 = await engine.embedWithNodeLlamaCpp('Test query');
    assert.strictEqual(res2, null);
  });

  it('should generate 1024-dimensional normalized vector embeddings', () => {
    const engine = globalThis.embeddingEngine;
    const vecA = engine.generateEmbedding('Python programming and artificial intelligence');
    const vecB = engine.generateEmbedding('Python programming and artificial intelligence');
    const vecC = engine.generateEmbedding('Cooking pasta tomato sauce dinner recipe');

    assert.strictEqual(vecA.length, 1024);
    const simSame = engine.cosineSimilarity(vecA, vecB);
    const simDiff = engine.cosineSimilarity(vecA, vecC);

    assert.ok(Math.abs(simSame - 1.0) < 1e-4, 'Identical vectors should have similarity ~1.0');
    assert.ok(simDiff < simSame, 'Different topics should have lower similarity than identical');
  });

  it('should classify bookmarks into candidate folders with calibrated probabilities', () => {
    const engine = globalThis.embeddingEngine;
    const folders = [
      'Development/Frontend',
      'Finance & Investments',
      'Cooking & Recipes',
      'Gaming'
    ];

    const bookmark = {
      title: 'Vue.js Frontend Web Development Guide',
      url: 'https://vuejs.org/guide/composition-api'
    };

    const decision = engine.classifyBookmark(bookmark, folders);
    assert.strictEqual(decision.success, true);
    assert.strictEqual(decision.matchedCategory, 'Development/Frontend');
    assert.ok(decision.confidence > 0.40, `Expected confidence > 0.40, got ${decision.confidence}`);
    assert.ok(decision.probabilities['Development/Frontend'] > decision.probabilities['Cooking & Recipes']);

    // Probabilities should sum to approximately 1.0
    const probSum = Object.values(decision.probabilities).reduce((acc, p) => acc + p, 0);
    assert.ok(Math.abs(probSum - 1.0) < 1e-3, `Expected probability sum ~1.0, got ${probSum}`);
  });

  it('should strictly protect system and vendor folders (Mozilla Firefox, Bookmarks Bar)', () => {
    const engine = globalThis.embeddingEngine;
    const folders = [
      'Mozilla Firefox',
      'Bookmarks Bar',
      'Development',
      'Cooking'
    ];

    const bookmark = {
      title: 'React Documentation and Component Lifecycle',
      url: 'https://react.dev'
    };

    const decision = engine.classifyBookmark(bookmark, folders);
    assert.strictEqual(decision.matchedCategory, 'Development');
    assert.notStrictEqual(decision.matchedCategory, 'Mozilla Firefox');
    assert.notStrictEqual(decision.matchedCategory, 'Bookmarks Bar');
  });

  it('should batch classify multiple bookmarks in classifyBookmarks', () => {
    const engine = globalThis.embeddingEngine;
    const folders = ['Development', 'Food & Cooking', 'Finance & Investments'];
    const bookmarks = [
      { id: '1', title: 'React Official Documentation', url: 'https://react.dev' },
      { id: '2', title: 'Chocolate Chip Cookies - Baking Recipes', url: 'https://recipes.com/cookies' },
      { id: '3', title: 'Robinhood - Invest in Stocks & Crypto', url: 'https://robinhood.com' }
    ];

    const results = engine.classifyBookmarks(bookmarks, folders);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].matchedCategory, 'Development');
    assert.strictEqual(results[1].matchedCategory, 'Food & Cooking');
    assert.strictEqual(results[2].matchedCategory, 'Finance & Investments');
  });

  it('should sort bookmarks into folders via sortBookmarksIntoFolders', () => {
    const engine = globalThis.embeddingEngine;
    const folders = ['Tech', 'Kitchen'];
    const bookmarks = [
      { id: '1', title: 'TypeScript Handbook', url: 'https://typescriptlang.org' },
      { id: '2', title: 'Python Docs', url: 'https://python.org' },
      { id: '3', title: 'Homemade Sourdough Bread Recipe', url: 'https://baking.com/sourdough' }
    ];

    const sortedList = engine.sortBookmarksIntoFolders(bookmarks, folders);
    assert.ok(Array.isArray(sortedList));
    assert.strictEqual(sortedList.length, 3);
    assert.strictEqual(sortedList[0].matchedCategory, 'Tech');
    assert.strictEqual(sortedList[1].matchedCategory, 'Tech');
    assert.strictEqual(sortedList[2].matchedCategory, 'Kitchen');
  });

  it('should infer clean categories for bookmarks via inferCategory', () => {
    const engine = globalThis.embeddingEngine;

    const catReact = engine.inferCategory('React Official Documentation https://react.dev');
    assert.strictEqual(catReact, 'Development');

    const catCookie = engine.inferCategory('Chocolate Chip Cookies Sallys Baking Addiction');
    assert.strictEqual(catCookie, 'Food & Cooking');

    const catStocks = engine.inferCategory('Robinhood - Commission-Free Stock Trading & Investing');
    assert.strictEqual(catStocks, 'Finance & Investments');

    const catFigma = engine.inferCategory('Figma: Collaborative Interface Design Tool');
    assert.strictEqual(catFigma, 'Design & Creative');

    const catNews = engine.inferCategory('BBC World News breaking headlines');
    assert.strictEqual(catNews, 'News & Media');
  });

  it('should maintain backward compatibility aliases (qwenEngine, jevEngine)', () => {
    assert.strictEqual(globalThis.embeddingEngine, globalThis.qwenEngine);
    assert.strictEqual(globalThis.embeddingEngine, globalThis.jevEngine);
    assert.strictEqual(globalThis.embeddingEngine, globalThis.lfmEngine);
  });
});

describe('LiquidAI LFM2.5 Instruct Model & Functions', () => {
  it('should register LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M) as non-embedding model with exact URL', () => {
    const mm = globalThis.modelManager;
    const model = mm.getModelConfig('lfm2.5-1.2b-instruct');
    assert.ok(model, 'LiquidAI LFM model must be registered');
    assert.strictEqual(model.id, 'lfm2.5-1.2b-instruct');
    assert.strictEqual(model.name, 'LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M)');
    assert.strictEqual(model.filename, 'LFM2.5-1.2B-Instruct-Q5_K_M.gguf');
    assert.strictEqual(
      model.url,
      'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf'
    );
    assert.strictEqual(model.isInstructModel, true);
    assert.strictEqual(model.isEmbeddingModel, false);
    assert.strictEqual(model.architecture, 'liquid-lfm');
    assert.strictEqual(model.sizeBytes, 843354944);
    assert.strictEqual(model.quantization, 'Q5_K_M');
  });

  it('should provide global functions nodeLlamaCppInstruct, classifyWithLiquidLFM, runLiquidLFM and alias lfmEngine', () => {
    assert.strictEqual(typeof globalThis.nodeLlamaCppInstruct, 'function');
    assert.strictEqual(typeof globalThis.classifyWithLiquidLFM, 'function');
    assert.strictEqual(typeof globalThis.runLiquidLFM, 'function');
    assert.strictEqual(globalThis.lfmEngine, globalThis.embeddingEngine);
  });

  it('should classify bookmarks using classifyWithLiquidLFM into candidate folders', async () => {
    const bookmark = {
      id: 'bm-react',
      title: 'React Documentation and Component Lifecycle',
      url: 'https://react.dev'
    };
    const folders = ['Development', 'Cooking & Recipes', 'Finance & Markets'];
    const res = await globalThis.classifyWithLiquidLFM(bookmark, folders);

    assert.ok(res, 'Classification result should be returned');
    assert.strictEqual(res.matchedCategory, 'Development');
    assert.ok(res.confidence > 0.5, 'Confidence should be high for matching domain & keywords');
    assert.strictEqual(typeof res.probabilities, 'object');
  });

  it('should handle nodeLlamaCppInstruct and runLiquidLFM gracefully when no local path is provided', async () => {
    const res1 = await globalThis.nodeLlamaCppInstruct('Categorize this bookmark: React Dev');
    assert.strictEqual(res1, null);

    const res2 = await globalThis.runLiquidLFM('Categorize this bookmark: React Dev');
    assert.strictEqual(res2, null);
  });

  it('should switch between LiquidAI LFM and Qwen embedding via helper methods', () => {
    const engine = globalThis.embeddingEngine;
    engine.useQwenEmbedding();
    assert.strictEqual(engine.isInstructModel, false);
    assert.strictEqual(engine.modelId, 'qwen3-embedding-0.6b');

    engine.useLiquidLFM();
    assert.strictEqual(engine.isInstructModel, true);
    assert.strictEqual(engine.modelId, 'lfm2.5-1.2b-instruct');
    assert.strictEqual(
      engine.modelUrl,
      'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf'
    );
  });

  it('should parse GGUF header and identify liquid-lfm architecture when loaded', () => {
    const engine = globalThis.embeddingEngine;
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); // G
    view.setUint8(1, 0x47); // G
    view.setUint8(2, 0x55); // U
    view.setUint8(3, 0x46); // F
    view.setUint32(4, 3, true);
    view.setUint32(8, 20, true);
    view.setUint32(16, 12, true);

    const loadRes = engine.loadModel('lfm2.5-1.2b-instruct', buffer);
    assert.strictEqual(loadRes.success, true);
    assert.strictEqual(loadRes.metadata.architecture, 'liquid-lfm');
    assert.strictEqual(engine.isInstructModel, true);

    const unloadRes = engine.unloadModel();
    assert.strictEqual(unloadRes.success, true);
  });
});

describe('MiniCPM5-1B Default LLM Model & Functions', () => {
  it('should register MiniCPM5-1B (Q5_K_M) as default model with exact Hugging Face URL', () => {
    const mm = globalThis.modelManager;
    const model = mm.getModelConfig('minicpm5-1b');
    assert.ok(model, 'MiniCPM5-1B model must be registered');
    assert.strictEqual(model.id, 'minicpm5-1b');
    assert.strictEqual(model.name, 'MiniCPM5-1B (Q5_K_M)');
    assert.strictEqual(model.filename, 'MiniCPM5-1B-Q5_K_M.gguf');
    assert.strictEqual(
      model.url,
      'https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf'
    );
    assert.strictEqual(model.isInstructModel, true);
    assert.strictEqual(model.isLLM, true);
    assert.strictEqual(model.isEmbeddingModel, false);
    assert.strictEqual(model.architecture, 'minicpm');
    assert.strictEqual(model.sizeBytes, 786862688);
    assert.strictEqual(model.quantization, 'Q5_K_M');
    assert.strictEqual(globalThis.DEFAULT_LOCAL_MODEL_ID, 'minicpm5-1b');
    assert.strictEqual(globalThis.DEFAULT_LLM_MODEL_ID, 'minicpm5-1b');
  });

  it('should provide global functions classifyWithMiniCPM, runMiniCPM and alias minicpmEngine', () => {
    assert.strictEqual(typeof globalThis.classifyWithMiniCPM, 'function');
    assert.strictEqual(typeof globalThis.runMiniCPM, 'function');
    assert.strictEqual(globalThis.minicpmEngine, globalThis.embeddingEngine);
  });

  it('should classify bookmarks using classifyWithMiniCPM into candidate folders', async () => {
    const bookmark = {
      id: 'bm-ts',
      title: 'TypeScript Documentation and Types Handbook',
      url: 'https://typescriptlang.org'
    };
    const folders = ['Development', 'Cooking & Recipes', 'Finance & Markets'];
    const res = await globalThis.classifyWithMiniCPM(bookmark, folders);

    assert.ok(res, 'Classification result should be returned');
    assert.strictEqual(res.matchedCategory, 'Development');
    assert.ok(res.confidence > 0.5, 'Confidence should be high for matching domain & keywords');
    assert.strictEqual(typeof res.probabilities, 'object');
  });

  it('should handle runMiniCPM gracefully when no local path is provided', async () => {
    const res = await globalThis.runMiniCPM('Sort this bookmark: TypeScript Docs');
    assert.strictEqual(res, null);
  });

  it('should switch to MiniCPM via helper methods on engine', () => {
    const engine = globalThis.embeddingEngine;
    engine.useMiniCPM();
    assert.strictEqual(engine.isInstructModel, true);
    assert.strictEqual(engine.isLLM, true);
    assert.strictEqual(engine.modelId, 'minicpm5-1b');
    assert.strictEqual(
      engine.modelUrl,
      'https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf'
    );
  });

  it('should parse GGUF header and identify minicpm architecture when loaded', () => {
    const engine = globalThis.embeddingEngine;
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); // G
    view.setUint8(1, 0x47); // G
    view.setUint8(2, 0x55); // U
    view.setUint8(3, 0x46); // F
    view.setUint32(4, 3, true);
    view.setUint32(8, 20, true);
    view.setUint32(16, 12, true);

    const loadRes = engine.loadModel('minicpm5-1b', buffer);
    assert.strictEqual(loadRes.success, true);
    assert.strictEqual(loadRes.metadata.architecture, 'minicpm');
    assert.strictEqual(engine.isInstructModel, true);
    assert.strictEqual(engine.isLLM, true);

    const unloadRes = engine.unloadModel();
    assert.strictEqual(unloadRes.success, true);
  });
});

describe('Custom LLM Model & URL Configuration', () => {
  it('should register custom LLM model configuration via URL in registerCustomLLMModel', async () => {
    const mm = globalThis.modelManager;
    const customConfig = {
      url: 'https://huggingface.co/custom/my-llm/resolve/main/model-q5.gguf',
      name: 'Custom-Llama-1B',
      contextWindow: 16384
    };

    const registered = await mm.registerCustomLLMModel(customConfig);
    assert.strictEqual(registered.id, 'custom-llm-model');
    assert.strictEqual(registered.name, 'Custom-Llama-1B');
    assert.strictEqual(registered.url, customConfig.url);
    assert.strictEqual(registered.isLLM, true);
    assert.strictEqual(registered.isInstructModel, true);
    assert.strictEqual(registered.isEmbeddingModel, false);
    assert.strictEqual(registered.architecture, 'custom-llm');
    assert.strictEqual(registered.contextWindow, 16384);

    const stored = await globalThis.chrome.storage.local.get(['customLLMModelConfig']);
    assert.ok(stored.customLLMModelConfig, 'customLLMModelConfig should be persisted in storage');
    assert.strictEqual(stored.customLLMModelConfig.name, 'Custom-Llama-1B');
    assert.strictEqual(stored.customLLMModelConfig.url, customConfig.url);

    const config = await mm.getCustomLLMConfig();
    assert.strictEqual(config.name, 'Custom-Llama-1B');
    assert.strictEqual(config.url, customConfig.url);
  });

  it('should route isLLM config to registerCustomLLMModel inside registerCustomModel', async () => {
    const mm = globalThis.modelManager;
    const customLLMConfig = {
      url: 'https://huggingface.co/custom/another-llm/resolve/main/another.gguf',
      name: 'Another-Custom-LLM',
      isLLM: true
    };

    const registered = await mm.registerCustomModel(customLLMConfig);
    assert.strictEqual(registered.id, 'custom-llm-model');
    assert.strictEqual(registered.name, 'Another-Custom-LLM');
    assert.strictEqual(registered.isLLM, true);
  });

  it('should provide global functions classifyWithCustomLLM, runCustomLLM, and engine.useCustomLLM', async () => {
    assert.strictEqual(typeof globalThis.classifyWithCustomLLM, 'function');
    assert.strictEqual(typeof globalThis.runCustomLLM, 'function');

    const engine = globalThis.embeddingEngine;
    engine.useCustomLLM({
      url: 'https://huggingface.co/custom/another-llm/resolve/main/another.gguf',
      name: 'Custom-LLM-Active'
    });
    assert.strictEqual(engine.modelId, 'custom-llm-model');
    assert.strictEqual(engine.modelName, 'Custom-LLM-Active');
    assert.strictEqual(engine.isLLM, true);
    assert.strictEqual(engine.isInstructModel, true);

    const bookmark = {
      id: 'bm-custom',
      title: 'Bitcoin and cryptocurrency decentralized finance wallet',
      url: 'https://bitcoin.org'
    };
    const folders = ['Finance & Investments', 'Development', 'Cooking'];
    const decision = await globalThis.classifyWithCustomLLM(bookmark, folders);
    assert.strictEqual(decision.matchedCategory, 'Finance & Investments');
    assert.ok(decision.confidence > 0.5);

    const res = await globalThis.runCustomLLM('Classify test bookmark');
    assert.strictEqual(res, null);
  });

  it('should load and unload custom LLM model buffer in engine', () => {
    const engine = globalThis.embeddingEngine;
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint8(0, 0x47); view.setUint8(1, 0x47); view.setUint8(2, 0x55); view.setUint8(3, 0x46);
    view.setUint32(4, 3, true);
    view.setUint32(8, 15, true);
    view.setUint32(16, 8, true);

    const loadRes = engine.loadModel('custom-llm-model', buffer);
    assert.strictEqual(loadRes.success, true);
    assert.strictEqual(loadRes.metadata.architecture, 'custom-llm');
    assert.strictEqual(engine.isLLM, true);
    assert.strictEqual(engine.isInstructModel, true);

    const unloadRes = engine.unloadModel();
    assert.strictEqual(unloadRes.success, true);
  });

  it('should delete custom LLM model data and remove customLLMModelConfig from storage', async () => {
    const mm = globalThis.modelManager;
    const deleteRes = await mm.deleteModel('custom-llm-model');
    assert.strictEqual(deleteRes.success, true);

    const stored = await globalThis.chrome.storage.local.get(['customLLMModelConfig']);
    assert.strictEqual(stored.customLLMModelConfig, undefined);

    const status = await mm.getStatus('custom-llm-model');
    assert.strictEqual(status.status, 'not_downloaded');
  });
});


describe('EmbeddingGemma-2 Model & Matryoshka Truncation', () => {
  it('should register EmbeddingGemma-2 GGUF embedding model with exact Unsloth URL', () => {
    const mm = globalThis.modelManager;
    const model = mm.getModelConfig('embeddinggemma-2');
    assert.ok(model, 'EmbeddingGemma-2 model must be registered');
    assert.strictEqual(model.id, 'embeddinggemma-2');
    assert.strictEqual(model.name, 'EmbeddingGemma-2 (UD-Q4_K_XL)');
    assert.strictEqual(model.filename, 'embeddinggemma-2-UD-Q4_K_XL.gguf');
    assert.strictEqual(
      model.url,
      'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf'
    );
    assert.strictEqual(model.isInstructModel, false);
    assert.strictEqual(model.isEmbeddingModel, true);
    assert.strictEqual(model.isLLM, false);
    assert.strictEqual(model.architecture, 'embeddinggemma-2');
    assert.strictEqual(model.dimensions, 768);
    assert.strictEqual(model.sizeBytes, 175673856);
  });

  it('should configure engine for EmbeddingGemma-2 with useEmbeddingGemma', () => {
    const engine = globalThis.embeddingEngine;
    engine.useEmbeddingGemma();
    assert.strictEqual(engine.modelId, 'embeddinggemma-2');
    assert.strictEqual(engine.isEmbeddingModel, true);
    assert.strictEqual(engine.isInstructModel, false);
    assert.strictEqual(engine.dimensions, 768);
  });

  it('should truncate 768-dim embedding to 256 dims with L2 re-normalization', () => {
    const engine = globalThis.embeddingEngine;
    engine.useEmbeddingGemma();
    const vec768 = engine.generateEmbedding('Universal embedding vector for retrieval and search');
    assert.strictEqual(vec768.length, 768);

    const vec256 = engine.truncateEmbedding(vec768, 256);
    assert.strictEqual(vec256.length, 256);

    let normSq = 0;
    for (let i = 0; i < vec256.length; i++) normSq += vec256[i] * vec256[i];
    assert.ok(Math.abs(Math.sqrt(normSq) - 1.0) < 1e-4, 'Truncated vector must be L2 re-normalized to 1.0');
  });

  it('should calculate cosine similarity between EmbeddingGemma truncated vectors', () => {
    const engine = globalThis.embeddingEngine;
    engine.useEmbeddingGemma();
    const vecA = engine.truncateEmbedding(engine.generateEmbedding('Python programming tutorial'), 256);
    const vecB = engine.truncateEmbedding(engine.generateEmbedding('Python programming tutorial'), 256);
    const vecC = engine.truncateEmbedding(engine.generateEmbedding('Baking sourdough bread recipe'), 256);

    const simIdentical = engine.cosineSimilarity(vecA, vecB);
    const simDiff = engine.cosineSimilarity(vecA, vecC);

    assert.ok(Math.abs(simIdentical - 1.0) < 1e-4, 'Identical vectors similarity should be ~1.0');
    assert.ok(simDiff < simIdentical, 'Distinct topics should have lower similarity');
  });
});
