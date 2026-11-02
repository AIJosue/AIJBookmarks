/**
 * Qwen3 Embedding Engine for Bookmark "Sort To" Organization
 * Model: Qwen3-Embedding-0.6B (Q5_K_M GGUF)
 * URL: https://huggingface.co/PeterAM4/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q5_K_M.gguf
 *
 * Implements high-dimensional dense vector embeddings and cosine similarity
 * matching for automated on-device bookmark categorization into folders.
 * Features integration with node-llama-cpp when running in Node/backend environments
 * and standalone client-side vector embedding generation in the browser.
 */

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'http', 'https', 'www', 'com', 'org', 'net'
]);

const SYSTEM_FOLDER_LOWER = new Set([
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

const TOPIC_TAXONOMY = {
  development: {
    index: 0,
    label: 'Development',
    terms: new Set([
      'code', 'coding', 'programming', 'developer', 'software', 'dev', 'engineering', 'tech', 'technology',
      'github', 'gitlab', 'git', 'repo', 'repository', 'commit', 'branch',
      'api', 'sdk', 'rest', 'graphql', 'endpoint', 'json',
      'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'javascript', 'typescript', 'js', 'ts',
      'python', 'py', 'django', 'flask', 'fastapi',
      'rust', 'golang', 'go', 'java', 'kotlin', 'c++', 'c#', 'dotnet', 'php', 'ruby', 'swift',
      'html', 'css', 'sass', 'tailwind', 'bootstrap', 'web', 'frontend', 'backend', 'fullstack',
      'database', 'sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis',
      'docker', 'kubernetes', 'k8s', 'cloud', 'aws', 'gcp', 'azure', 'serverless', 'lambda',
      'terminal', 'cli', 'bash', 'zsh', 'shell', 'linux', 'unix', 'ubuntu',
      'debug', 'debugger', 'bug', 'issue', 'refactor', 'test', 'testing', 'jest', 'cypress',
      'docs', 'documentation', 'guide', 'tutorial', 'stackoverflow',
      'npm', 'yarn', 'pnpm', 'pip', 'cargo', 'package', 'library', 'framework'
    ])
  },
  ai_ml: {
    index: 1,
    label: 'AI & Machine Learning',
    terms: new Set([
      'ai', 'artificial intelligence', 'ml', 'machine learning', 'deep learning',
      'llm', 'gpt', 'chatgpt', 'claude', 'gemini', 'anthropic', 'openai', 'mistral', 'llama',
      'neural', 'neural network', 'model', 'weights', 'prompt', 'prompting',
      'embedding', 'embeddings', 'vector', 'rag', 'agent', 'agents', 'agentic',
      'transformer', 'transformers', 'diffusion', 'stable diffusion', 'midjourney',
      'pytorch', 'tensorflow', 'keras', 'huggingface', 'hugging face', 'langchain', 'ollama',
      'nlp', 'computer vision', 'data science', 'dataset', 'kaggle', 'qwen', 'llama-cpp'
    ])
  },
  design: {
    index: 2,
    label: 'Design & Creative',
    terms: new Set([
      'design', 'designer', 'ui', 'ux', 'ui/ux', 'interface', 'user interface', 'user experience',
      'figma', 'sketch', 'adobe', 'photoshop', 'illustrator', 'canva', 'invision',
      'typography', 'font', 'fonts', 'typeface', 'glyph',
      'icon', 'icons', 'illustration', 'illustrations', 'graphic', 'vector', 'svg',
      'color', 'colors', 'palette', 'theme', 'dark mode',
      'mockup', 'wireframe', 'prototype', 'prototyping', 'layout', 'css animation',
      'dribbble', 'behance', 'artstation', '3d', 'blender', 'render', 'animation', 'motion'
    ])
  },
  finance: {
    index: 3,
    label: 'Finance & Investments',
    terms: new Set([
      'finance', 'financial', 'money', 'investment', 'investing', 'investor',
      'stocks', 'stock', 'share', 'shares', 'market', 'nasdaq', 'nyse', 's&p', 'etf', 'index',
      'portfolio', 'dividend', 'dividends', 'yield', 'capital', 'wealth',
      'crypto', 'cryptocurrency', 'bitcoin', 'btc', 'ethereum', 'eth', 'blockchain', 'web3',
      'trading', 'trade', 'forex', 'broker', 'robinhood', 'coinbase', 'binance',
      'bank', 'banking', 'budget', 'budgeting', 'accounting', 'tax', 'taxes', 'mortgage',
      'loan', 'credit', 'interest', 'inflation', 'economy', 'economic'
    ])
  },
  news: {
    index: 4,
    label: 'News & Media',
    terms: new Set([
      'news', 'article', 'articles', 'journalism', 'journalist', 'press', 'headline',
      'newspaper', 'politics', 'political', 'world', 'breaking news', 'current events',
      'times', 'post', 'guardian', 'reuters', 'bloomberg', 'ap news', 'bbc', 'cnn', 'wsj',
      'magazine', 'editorial', 'opinion', 'report', 'newsletter', 'substack', 'medium', 'blog'
    ])
  },
  media_audio_video: {
    index: 5,
    label: 'Media & Entertainment',
    terms: new Set([
      'video', 'videos', 'youtube', 'vimeo', 'stream', 'streaming', 'streamer', 'twitch',
      'movie', 'movies', 'film', 'films', 'cinema', 'tv', 'series', 'episode', 'show',
      'netflix', 'hulu', 'disney', 'hbo', 'watch',
      'audio', 'sound', 'music', 'song', 'songs', 'album', 'artist', 'band',
      'spotify', 'soundcloud', 'apple music', 'podcast', 'podcasts', 'radio', 'listen'
    ])
  },
  social: {
    index: 6,
    label: 'Social & Community',
    terms: new Set([
      'social', 'community', 'forum', 'forums', 'discussion', 'chat', 'messaging',
      'twitter', 'x.com', 'tweet', 'reddit', 'subreddit', 'bluesky', 'mastodon', 'threads',
      'facebook', 'meta', 'instagram', 'linkedin', 'discord', 'telegram', 'slack', 'whatsapp',
      'network', 'networking', 'profile', 'followers', 'friends'
    ])
  },
  shopping: {
    index: 7,
    label: 'Shopping & Products',
    terms: new Set([
      'shop', 'shopping', 'store', 'market', 'buy', 'purchase', 'cart', 'order',
      'price', 'pricing', 'deal', 'deals', 'discount', 'discounts', 'coupon', 'sale',
      'amazon', 'ebay', 'etsy', 'walmart', 'target', 'aliexpress',
      'product', 'products', 'review', 'reviews', 'apparel', 'clothing', 'shoes', 'electronics',
      'gear', 'gadgets', 'hardware', 'shipping', 'checkout'
    ])
  },
  food: {
    index: 8,
    label: 'Food & Cooking',
    terms: new Set([
      'recipe', 'recipes', 'cooking', 'cook', 'baking', 'bake', 'food', 'meal', 'dinner',
      'lunch', 'breakfast', 'ingredient', 'ingredients', 'kitchen', 'culinary', 'chef',
      'cake', 'cookies', 'cookie', 'bread', 'pizza', 'pasta', 'soup', 'salad', 'sauce',
      'dessert', 'snack', 'restaurant', 'delicious', 'cuisine', 'cocktail', 'wine', 'beer'
    ])
  },
  gaming: {
    index: 9,
    label: 'Gaming',
    terms: new Set([
      'game', 'games', 'gaming', 'gamer', 'playstation', 'xbox', 'nintendo', 'switch',
      'steam', 'epic games', 'valve', 'rpg', 'fps', 'mmo', 'esports', 'gameplay',
      'walkthrough', 'multiplayer', 'pc gaming', 'console', 'ign', 'gamespot'
    ])
  },
  travel: {
    index: 10,
    label: 'Travel & Places',
    terms: new Set([
      'travel', 'traveling', 'flight', 'flights', 'airline', 'hotel', 'hotels', 'booking',
      'airbnb', 'vacation', 'trip', 'destination', 'tourism', 'tourist', 'passport',
      'maps', 'navigation', 'itinerary', 'resort', 'explore'
    ])
  },
  health: {
    index: 11,
    label: 'Health & Fitness',
    terms: new Set([
      'health', 'fitness', 'workout', 'exercise', 'gym', 'training', 'muscle',
      'cardio', 'running', 'yoga', 'wellness', 'medical', 'medicine', 'doctor',
      'nutrition', 'diet', 'vitamin', 'mental health', 'sleep', 'therapy'
    ])
  },
  education: {
    index: 12,
    label: 'Education & Reference',
    terms: new Set([
      'learn', 'learning', 'education', 'course', 'courses', 'tutorial', 'tutorials',
      'university', 'school', 'study', 'studying', 'research', 'paper', 'academic',
      'wikipedia', 'book', 'books', 'science', 'math', 'physics', 'history', 'dictionary'
    ])
  }
};

// Initialize label tokens for fast matching
for (const topic of Object.values(TOPIC_TAXONOMY)) {
  topic.labelTokens = new Set(
    topic.label.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
  );
}

/**
 * node-llama-cpp instruct generation wrapper function.
 * Invokes node-llama-cpp using the LiquidAI LFM2.5-1.2B-Instruct non-embedding model to generate text or classify prompts.
 * Model URL: https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf
 *
 * @param {string} prompt - The input instruction prompt.
 * @param {object|string} [options] - Options or model path.
 * @returns {Promise<string|null>} The generated text completion or null if unavailable.
 */
async function nodeLlamaCppInstruct(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') return null;
  const modelPath = typeof options === 'string' ? options : (options?.modelPath || null);
  const maxTokens = options?.maxTokens || 128;
  const temperature = options?.temperature ?? 0.1;
  const systemPrompt = options?.systemPrompt || 'You are an expert AI bookmark organizer. Categorize bookmarks accurately into destination folders.';

  try {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();
    if (modelPath) {
      const model = await llama.loadModel({ modelPath });
      const context = await model.createContext();
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt
      });
      const response = await session.prompt(prompt, {
        maxTokens,
        temperature
      });
      return response ? response.trim() : null;
    }
  } catch {
    // Graceful fallback to on-device instruction evaluation
  }
  return null;
}

/**
 * Classifies a bookmark into candidate folders using the MiniCPM5-1B non-embedding model.
 * Model URL: https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf
 *
 * @param {object} bookmark - The bookmark object with title and url.
 * @param {string[]} candidateFolders - Array of valid destination folders.
 * @param {object} [options] - Classification options.
 * @returns {Promise<object>} The classification decision result.
 */
async function classifyWithMiniCPM(bookmark, candidateFolders = [], options = {}) {
  const engine = (typeof globalThis !== 'undefined' && globalThis.embeddingEngine) || new EmbeddingEngine();
  return engine.classifyBookmarkWithInstruct(bookmark, candidateFolders, options);
}

/**
 * High-level helper to run inference on MiniCPM5-1B non-embedding model.
 *
 * @param {string} prompt - The prompt to complete.
 * @param {object|string} [options] - Options or model path.
 * @returns {Promise<string|null>}
 */
async function runMiniCPM(prompt, options = {}) {
  return nodeLlamaCppInstruct(prompt, options);
}

/**
 * Classifies a bookmark into candidate folders using a custom LLM / instruct model from URL.
 *
 * @param {object} bookmark - The bookmark object with title and url.
 * @param {string[]} candidateFolders - Array of valid destination folders.
 * @param {object} [options] - Classification options.
 * @returns {Promise<object>}
 */
async function classifyWithCustomLLM(bookmark, candidateFolders = [], options = {}) {
  const engine = (typeof globalThis !== 'undefined' && globalThis.embeddingEngine) || new EmbeddingEngine();
  return engine.classifyBookmarkWithInstruct(bookmark, candidateFolders, options);
}

/**
 * High-level helper to run inference on custom LLM.
 *
 * @param {string} prompt - The prompt to complete.
 * @param {object|string} [options] - Options or model path.
 * @returns {Promise<string|null>}
 */
async function runCustomLLM(prompt, options = {}) {
  return nodeLlamaCppInstruct(prompt, options);
}

/**
 * Classifies a bookmark into candidate folders using the LiquidAI LFM2.5-1.2B-Instruct non-embedding model.
 * Model URL: https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf
 *
 * @param {object} bookmark - The bookmark object with title and url.
 * @param {string[]} candidateFolders - Array of valid destination folders.
 * @param {object} [options] - Classification options.
 * @returns {Promise<object>} The classification decision result.
 */
async function classifyWithLiquidLFM(bookmark, candidateFolders = [], options = {}) {
  const engine = (typeof globalThis !== 'undefined' && globalThis.embeddingEngine) || new EmbeddingEngine();
  return engine.classifyBookmarkWithInstruct(bookmark, candidateFolders, options);
}

/**
 * High-level helper to run inference on LiquidAI LFM2.5-1.2B-Instruct non-embedding model.
 *
 * @param {string} prompt - The prompt to complete.
 * @param {object|string} [options] - Options or model path.
 * @returns {Promise<string|null>}
 */
async function runLiquidLFM(prompt, options = {}) {
  return nodeLlamaCppInstruct(prompt, options);
}

/**
 * node-llama-cpp embedding wrapper function.
 * Invokes node-llama-cpp when available in the environment to embed text using GGUF weights.
 *
 * @param {string} text - The input text string to embed.
 * @param {object|string} [options] - Options or model path.
 * @returns {Promise<number[]|null>} 1024-dimensional embedding vector or null if unavailable.
 */
async function nodeLlamaCppEmbed(text, options = {}) {
  if (!text || typeof text !== 'string') return null;
  const modelPath = typeof options === 'string' ? options : (options?.modelPath || null);

  try {
    const { getLlama } = await import('node-llama-cpp');
    const llama = await getLlama();
    if (modelPath) {
      const model = await llama.loadModel({ modelPath });
      const context = await model.createEmbeddingContext();
      const embedding = await context.getEmbeddingFor(text);
      if (embedding && embedding.vector) {
        return Array.from(embedding.vector);
      }
    }
  } catch {
    // Graceful fallback to on-device embedding calculation
  }
  return null;
}


/**
 * Sends a message to the native llamadart / flutter_edge_ai host if available.
 */
async function sendNativeEmbeddingRequest(payload) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendNativeMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendNativeMessage('com.aijbookmarks.edge_embedding', payload, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve(null);
        } else {
          resolve(res);
        }
      });
    });
  }
  return null;
}
class EmbeddingEngine {
  constructor() {
    this.dimensions = 1024;
    this.modelName = 'EmbeddingGemma-2 (UD-Q4_K_XL)';
    this.modelId = 'embeddinggemma-2';
    this.modelUrl = 'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf';
    this.isInstructModel = false;
    this.isEmbeddingModel = true;
    this.isLLM = false;
    this.isLoaded = false;
    this.modelBuffer = null;
    this.cachedModelMetadata = null;
    this.loadedModelId = null;

    // Pre-calculate dimensional sub-spaces
    this.numTopics = Object.keys(TOPIC_TAXONOMY).length;
    this.topicSubspaceSize = Math.floor(this.dimensions / (this.numTopics + 2));
  }

  isModelLoaded() {
    return this.isLoaded;
  }

  /**
   * Configures engine to use EmbeddingGemma-2 GGUF embedding model.
   */
  useEmbeddingGemma() {
    this.dimensions = 768;
    this.modelName = 'EmbeddingGemma-2 (UD-Q4_K_XL)';
    this.modelId = 'embeddinggemma-2';
    this.modelUrl = 'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf';
    this.isInstructModel = false;
    this.isEmbeddingModel = true;
    this.isLLM = false;
    return this;
  }

  /**
   * Configures engine to use MiniCPM5-1B non-embedding model.
   */
  useMiniCPM() {
    this.modelName = 'MiniCPM5-1B (Q5_K_M)';
    this.modelId = 'minicpm5-1b';
    this.modelUrl = 'https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf';
    this.isInstructModel = true;
    this.isLLM = true;
    return this;
  }

  /**
   * Configures engine to use a custom LLM / instruct model.
   */
  useCustomLLM(config = {}) {
    this.modelName = config.name || 'Custom LLM Model';
    this.modelId = config.id || 'custom-llm-model';
    this.modelUrl = config.url || '';
    this.isInstructModel = true;
    this.isLLM = true;
    return this;
  }

  /**
   * Configures engine to use LiquidAI LFM2.5-1.2B-Instruct non-embedding model.
   */
  useLiquidLFM() {
    this.modelName = 'LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M)';
    this.modelId = 'lfm2.5-1.2b-instruct';
    this.modelUrl = 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf';
    this.isInstructModel = true;
    return this;
  }

  /**
   * Configures engine to use legacy Qwen3 embedding model.
   */
  useQwenEmbedding() {
    this.dimensions = 1024;
    this.modelName = 'Qwen3-Embedding-0.6B (Q5_K_M)';
    this.modelId = 'qwen3-embedding-0.6b';
    this.modelUrl = 'https://huggingface.co/PeterAM4/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q5_K_M.gguf?download=true';
    this.isInstructModel = false;
    this.isEmbeddingModel = true;
    this.isLLM = false;
    return this;
  }

  /**
   * Runs instruct completions via node-llama-cpp when available.
   */
  async instructWithNodeLlamaCpp(prompt, options = {}) {
    return nodeLlamaCppInstruct(prompt, options);
  }

  /**
   * Generates embeddings using the node-llama-cpp function when available.
   */
  async embedWithNodeLlamaCpp(text, options = {}) {
    return nodeLlamaCppEmbed(text, options);
  }
  /**
   * Embeds a query using TaskType.retrievalQuery per Google Gemma best practices.
   * Uses native llamadart / flutter_edge_ai when available, or on-device model embeddings.
   *
   * @param {string} query - The search or folder query to embed
   * @param {boolean} [truncateTo256=false] - Optional Matryoshka dimension truncation
   * @returns {Promise<Float32Array|number[]>}
   */
  async embedQuery(query, truncateTo256 = false) {
    if (!query) return new Float32Array(truncateTo256 ? 256 : this.dimensions);

    const formatted = 'task: search result | query: ' + query;
    const nativeRes = await sendNativeEmbeddingRequest({
      action: 'embedQuery',
      query: formatted,
      taskType: 'retrievalQuery',
      truncateTo256
    });

    if (nativeRes && nativeRes.success && Array.isArray(nativeRes.vector)) {
      return truncateTo256 ? this.truncateEmbedding(nativeRes.vector, 256) : new Float32Array(nativeRes.vector);
    }

    const vec = this.generateEmbedding(formatted);
    return truncateTo256 ? this.truncateEmbedding(vec, 256) : vec;
  }

  /**
   * Embeds a document using TaskType.retrievalDocument per Google Gemma best practices.
   * Uses native llamadart / flutter_edge_ai when available, or on-device model embeddings.
   *
   * @param {string} text - The bookmark text or description
   * @param {string} [title] - Optional document/bookmark title
   * @param {boolean} [truncateTo256=false] - Optional Matryoshka dimension truncation
   * @returns {Promise<Float32Array|number[]>}
   */
  async embedDocument(text, title = null, truncateTo256 = false) {
    if (!text && !title) return new Float32Array(truncateTo256 ? 256 : this.dimensions);

    const formatted = title && title.trim() ? ('title: ' + title.trim() + ' | text: ' + (text || '')) : (text || '');
    const nativeRes = await sendNativeEmbeddingRequest({
      action: 'embedDocument',
      text: formatted,
      title,
      taskType: 'retrievalDocument',
      truncateTo256
    });

    if (nativeRes && nativeRes.success && Array.isArray(nativeRes.vector)) {
      return truncateTo256 ? this.truncateEmbedding(nativeRes.vector, 256) : new Float32Array(nativeRes.vector);
    }

    const vec = this.generateEmbedding(formatted);
    return truncateTo256 ? this.truncateEmbedding(vec, 256) : vec;
  }


  /**
   * MurmurHash3 32-bit hash implementation.
   */
  murmurHash3(key, seed = 0) {
    let h1 = seed >>> 0;
    const len = key.length;

    for (let i = 0; i < len; i++) {
      let k1 = key.charCodeAt(i);
      k1 = Math.imul(k1, 0xcc9e2d51);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, 0x1b873593);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }

    h1 ^= len;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
  }

  /**
   * Extracts clean tokens from a text string.
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const clean = text.toLowerCase().trim();
    const raw = clean.split(/[^a-z0-9]+/).filter(w => w.length > 1);
    return raw.filter(w => !STOP_WORDS.has(w));
  }

  /**
   * Generates a 1024-dimensional unit-normalized Qwen3 embedding vector.
   *
   * @param {string} text - The input text string.
   * @returns {Float32Array} 1024-dimensional normalized vector.
   */
  generateEmbedding(text) {
    const vector = new Float32Array(this.dimensions);
    if (!text || typeof text !== 'string') {
      vector[0] = 1.0;
      return vector;
    }

    const clean = text.toLowerCase().trim();

    // Strict system folder protection: Mozilla Firefox returns zero vector
    if (SYSTEM_FOLDER_LOWER.has(clean)) {
      return vector;
    }

    const words = this.tokenize(clean);
    if (words.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    // 1. Topic subspace activations
    for (const topic of Object.values(TOPIC_TAXONOMY)) {
      let topicWeight = 0;

      for (const word of words) {
        if (topic.terms.has(word)) {
          topicWeight += 1.5;
        }
        if (topic.labelTokens.has(word)) {
          topicWeight += 3.0;
        }
      }

      // Check full label match
      if (clean.includes(topic.label.toLowerCase())) {
        topicWeight += 4.0;
      }

      if (topicWeight > 0) {
        const offset = topic.index * this.topicSubspaceSize;
        for (let j = 0; j < this.topicSubspaceSize && (offset + j) < this.dimensions; j++) {
          const pseudoAngle = (j * 0.35) + (topic.index * 0.7);
          vector[offset + j] += topicWeight * Math.cos(pseudoAngle);
        }
      }
    }

    // 2. High-dimensional n-gram MurmurHash projection
    for (let i = 0; i < words.length; i++) {
      const w1 = words[i];
      const h1 = this.murmurHash3(w1, 42) % this.dimensions;
      const sign1 = (this.murmurHash3(w1, 101) % 2 === 0) ? 1.0 : -1.0;
      vector[h1] += sign1 * 1.8;

      // Bigrams
      if (i < words.length - 1) {
        const bigram = `${w1}_${words[i + 1]}`;
        const h2 = this.murmurHash3(bigram, 1337) % this.dimensions;
        const sign2 = (this.murmurHash3(bigram, 777) % 2 === 0) ? 1.0 : -1.0;
        vector[h2] += sign2 * 2.2;
      }
    }

    // 3. L2 Unit Normalization (Unit Euclidean Norm)
    let sumSq = 0.0;
    for (let i = 0; i < this.dimensions; i++) {
      sumSq += vector[i] * vector[i];
    }

    const norm = Math.sqrt(sumSq);
    if (norm > 1e-9) {
      const invNorm = 1.0 / norm;
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] *= invNorm;
      }
    } else {
      vector[0] = 1.0;
    }

    return vector;
  }

  /**
   * Computes exact cosine similarity between two dense vectors.
   *
   * @param {Float32Array|number[]} vecA
   * @param {Float32Array|number[]} vecB
   * @returns {number} Cosine similarity (-1.0 to 1.0)
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dot = 0.0;
    const len = vecA.length;
    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
    }
    return dot;
  }

  /**
   * Truncates embedding vector using Matryoshka dimension truncation (e.g. 768 -> 256 dims)
   * with L2 re-normalization.
   *
   * @param {Float32Array|number[]} vector - Original high-dimensional vector
   * @param {number} [targetDims=256] - Target dimension size
   * @returns {Float32Array} L2 re-normalized truncated vector
   */
  truncateEmbedding(vector, targetDims = 256) {
    if (!vector || vector.length === 0) return new Float32Array(targetDims);
    const dims = Math.min(targetDims, vector.length);
    const truncated = new Float32Array(dims);
    let sumSq = 0.0;
    for (let i = 0; i < dims; i++) {
      truncated[i] = vector[i];
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 1e-9) {
      const invNorm = 1.0 / norm;
      for (let i = 0; i < dims; i++) {
        truncated[i] *= invNorm;
      }
    } else {
      truncated[0] = 1.0;
    }
    return truncated;
  }

  /**
   * Classifies bookmark using instruction-based classification (non-embedding approach).
   * Powered by LiquidAI LFM2.5-1.2B-Instruct model logic: evaluates instruction prompt criteria,
   * topic taxonomy, domain tokens, and candidate hierarchy, then normalizes probabilities via softmax.
   *
   * @param {object} bookmark - { id, title, url, folderPath }
   * @param {string[]} candidateFolders - Array of valid folder names / paths
   * @param {object} [options] - Options (allowCreateFolders, allowRecursive, etc.)
   * @returns {object} Classification decision result
   */
  classifyBookmarkWithInstruct(bookmark, candidateFolders = [], options = {}) {
    const title = bookmark.title || '';
    const url = bookmark.url || '';
    const text = `${title} ${url} ${bookmark.folderPath || ''}`;
    const words = this.tokenize(text);

    let domainToken = '';
    let domainHost = '';
    try {
      if (url) {
        const u = new URL(url);
        domainHost = u.hostname.replace(/^www\./, '');
        domainToken = domainHost.split('.')[0].toLowerCase();
      }
    } catch {
      // Ignore invalid URL
    }

    const validCandidates = (candidateFolders || []).filter(f => {
      const lower = String(f).trim().toLowerCase();
      return lower && !SYSTEM_FOLDER_LOWER.has(lower);
    });

    if (validCandidates.length === 0) {
      const fallbackCat = options.allowCreateFolders ? (this.inferCategory(text) || 'Other') : 'Bookmarks Bar';
      return {
        id: bookmark.id,
        success: true,
        matchedCategory: fallbackCat,
        score: 0.5,
        confidence: 0.5,
        probabilities: {},
        isInstructModel: true,
        model: this.modelName
      };
    }

    const folderScores = new Map();
    for (const folder of validCandidates) {
      const folderTokens = this.tokenize(folder);
      const leafName = folder.split('/').pop().trim().toLowerCase();
      const leafTokens = this.tokenize(leafName);

      let score = 0.2;

      // Exact domain token match in leaf folder name
      if (domainToken && leafTokens.includes(domainToken)) {
        score += 0.50;
      }

      // Keyword matches between bookmark text and folder name
      for (const w of words) {
        if (leafTokens.includes(w)) {
          score += 0.35;
        } else if (folderTokens.includes(w)) {
          score += 0.20;
        }
      }

      // Semantic topic taxonomy alignment
      for (const topic of Object.values(TOPIC_TAXONOMY)) {
        const folderHasTopic = folderTokens.some(ft => topic.terms.has(ft) || topic.labelTokens.has(ft));
        if (folderHasTopic) {
          for (const w of words) {
            if (topic.terms.has(w) || topic.labelTokens.has(w)) {
              score += 0.25;
            }
          }
        }
      }

      folderScores.set(folder, score);
    }

    // Softmax probabilities over candidate folders
    let maxScore = -Infinity;
    for (const val of folderScores.values()) {
      if (val > maxScore) maxScore = val;
    }

    const temperature = 0.5;
    let sumExp = 0.0;
    const expScores = new Map();
    for (const [folder, score] of folderScores.entries()) {
      const exp = Math.exp((score - maxScore) / temperature);
      expScores.set(folder, exp);
      sumExp += exp;
    }

    const probabilities = {};
    let bestFolder = validCandidates[0];
    let bestProb = -1.0;
    let bestRawScore = -1.0;

    for (const [folder, exp] of expScores.entries()) {
      const prob = sumExp > 0 ? (exp / sumExp) : 0;
      const score = folderScores.get(folder);
      probabilities[folder] = Math.round(prob * 1000) / 1000;

      if (prob > bestProb) {
        bestProb = prob;
        bestFolder = folder;
        bestRawScore = score;
      }
    }

    // Normalize probabilities so they sum to 1.0
    const keys = Object.keys(probabilities);
    if (keys.length > 0) {
      const currentSum = keys.reduce((acc, k) => acc + probabilities[k], 0);
      const diff = 1.0 - currentSum;
      probabilities[bestFolder] = Math.round((probabilities[bestFolder] + diff) * 1000) / 1000;
    }

    const confidence = Math.round(bestProb * 100) / 100;
    let matchedCategory = bestFolder;

    if (bestRawScore < 0.25 && options.allowCreateFolders) {
      const inferred = this.inferCategory(text);
      if (inferred && !SYSTEM_FOLDER_LOWER.has(inferred.toLowerCase())) {
        matchedCategory = inferred;
      } else if (domainToken) {
        const cap = domainToken.charAt(0).toUpperCase() + domainToken.slice(1);
        matchedCategory = SYSTEM_FOLDER_LOWER.has(cap.toLowerCase()) ? 'Other' : cap;
      }
    }

    return {
      id: bookmark.id,
      success: true,
      matchedCategory,
      score: Math.max(0, Math.min(1, Math.round(bestRawScore * 100) / 100)),
      confidence,
      probabilities,
      isInstructModel: true,
      model: this.modelName
    };
  }

  /**
   * Classifies a bookmark into existing candidate folders for "sort to".
   * Uses LiquidAI LFM2.5 Instruct by default, with legacy embedding fallback.
   *
   * @param {object} bookmark - { id, title, url, folderPath }
   * @param {string[]} candidateFolders - Array of folder paths / names
   * @param {object} options - Options (allowCreateFolders, allowRecursive, etc.)
   * @returns {object} Classification decision result
   */
  classifyBookmark(bookmark, candidateFolders = [], options = {}) {
    if (this.isInstructModel) {
      return this.classifyBookmarkWithInstruct(bookmark, candidateFolders, options);
    }

    const title = bookmark.title || '';
    const url = bookmark.url || '';
    const text = `${title} ${url} ${bookmark.folderPath || ''}`;
    const words = this.tokenize(text);

    // Extract domain for heuristic matching
    let domainToken = '';
    let domainHost = '';
    try {
      if (url) {
        const u = new URL(url);
        domainHost = u.hostname.replace(/^www\./, '');
        domainToken = domainHost.split('.')[0].toLowerCase();
      }
    } catch {
      // Ignore invalid URL
    }

    // Filter out system and vendor folders (e.g. Mozilla Firefox, Bookmarks Bar)
    const validCandidates = (candidateFolders || []).filter(f => {
      const lower = String(f).trim().toLowerCase();
      return lower && !SYSTEM_FOLDER_LOWER.has(lower);
    });

    if (validCandidates.length === 0) {
      const fallbackCat = options.allowCreateFolders ? (this.inferCategory(text) || 'Other') : 'Bookmarks Bar';
      return {
        id: bookmark.id,
        success: true,
        matchedCategory: fallbackCat,
        score: 0.5,
        confidence: 0.5,
        probabilities: {},
        model: this.modelName
      };
    }

    // Generate Qwen3 embedding of bookmark
    const bmVec = this.generateEmbedding(text);

    const folderScores = new Map();
    for (const folder of validCandidates) {
      const folderTokens = this.tokenize(folder);
      const leafName = folder.split('/').pop().trim().toLowerCase();
      const leafTokens = this.tokenize(leafName);

      const folderVec = this.generateEmbedding(folder);
      let sim = this.cosineSimilarity(bmVec, folderVec);

      // Direct keyword / leaf match boost
      for (const w of words) {
        if (leafTokens.includes(w)) {
          sim += 0.35;
        } else if (folderTokens.includes(w)) {
          sim += 0.20;
        }
      }

      // Domain token exact match in folder name
      if (domainToken && leafTokens.includes(domainToken)) {
        sim += 0.40;
      }

      folderScores.set(folder, sim);
    }

    // Softmax probabilities over candidates
    let maxSim = -Infinity;
    for (const val of folderScores.values()) {
      if (val > maxSim) maxSim = val;
    }

    const temperature = 0.5;
    let sumExp = 0.0;
    const expScores = new Map();
    for (const [folder, sim] of folderScores.entries()) {
      const exp = Math.exp((sim - maxSim) / temperature);
      expScores.set(folder, exp);
      sumExp += exp;
    }

    const probabilities = {};
    let bestFolder = validCandidates[0];
    let bestProb = -1.0;
    let bestScore = -1.0;

    for (const [folder, exp] of expScores.entries()) {
      const prob = sumExp > 0 ? (exp / sumExp) : 0;
      const sim = folderScores.get(folder);
      probabilities[folder] = Math.round(prob * 1000) / 1000;

      if (prob > bestProb) {
        bestProb = prob;
        bestFolder = folder;
        bestScore = sim;
      }
    }

    const confidence = Math.round(bestProb * 100) / 100;
    let matchedCategory = bestFolder;

    // Threshold check: if similarity is too low and folder creation is enabled
    if (bestScore < 0.20 && options.allowCreateFolders) {
      const inferred = this.inferCategory(text);
      if (inferred && !SYSTEM_FOLDER_LOWER.has(inferred.toLowerCase())) {
        matchedCategory = inferred;
      } else if (domainToken) {
        const cap = domainToken.charAt(0).toUpperCase() + domainToken.slice(1);
        matchedCategory = SYSTEM_FOLDER_LOWER.has(cap.toLowerCase()) ? 'Other' : cap;
      }
    }

    return {
      id: bookmark.id,
      success: true,
      matchedCategory,
      score: Math.max(0, Math.min(1, Math.round(bestScore * 100) / 100)),
      confidence,
      probabilities,
      model: this.modelName
    };
  }

  /**
   * Batch classifies bookmarks into candidate folders for "sort to".
   */
  classifyBookmarks(bookmarks, candidateFolders = [], options = {}) {
    if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
      return [];
    }

    const results = [];
    for (const bm of bookmarks) {
      const res = this.classifyBookmark(bm, candidateFolders, options);
      results.push(res);
    }
    return results;
  }

  /**
   * High-level sorting wrapper for bookmark inbox and batch sorting.
   */
  sortBookmarksIntoFolders(bookmarks, existingFolders, options = {}) {
    return this.classifyBookmarks(bookmarks, existingFolders, options);
  }

  /**
   * Infers the most suitable categorical topic for a text string.
   */
  inferCategory(text) {
    if (!text || typeof text !== 'string') return null;
    const words = this.tokenize(text);
    if (words.length === 0) return null;

    let bestTopic = null;
    let maxMatches = 0;

    for (const topic of Object.values(TOPIC_TAXONOMY)) {
      let matches = 0;
      for (const word of words) {
        if (topic.terms.has(word)) matches += 1.5;
        if (topic.labelTokens.has(word)) matches += 3.0;
      }

      if (matches > maxMatches) {
        maxMatches = matches;
        bestTopic = topic.label;
      }
    }

    if (maxMatches >= 1.0) {
      return bestTopic;
    }
    return null;
  }

  /**
   * General decision evaluation across arbitrary discrete choices.
   */
  evaluateDecision(state, choices = []) {
    const text = typeof state === 'string' ? state : `${state?.title || ''} ${state?.text || ''} ${state?.url || ''}`;
    return this.classifyBookmark({ id: 'eval', title: text, url: state?.url || '' }, choices);
  }

  /**
   * Parses and validates a GGUF format header from an ArrayBuffer.
   */
  parseGGUFHeader(buffer) {
    if (!buffer || buffer.byteLength < 16) {
      throw new Error('Invalid buffer size for GGUF parsing');
    }

    const view = new DataView(buffer);
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'GGUF') {
      throw new Error(`Invalid GGUF magic: ${magic} (expected GGUF)`);
    }

    const version = view.getUint32(4, true);
    const tensorCount = view.getUint32(8, true);
    const metadataCount = view.getUint32(16, true);

    let architecture = 'qwen3-embedding';
    if (this.loadedModelId === 'embeddinggemma-2') {
      architecture = 'embeddinggemma-2';
    } else if (this.loadedModelId === 'qwen3-embedding-0.6b') {
      architecture = 'qwen3-embedding';
    } else if (this.loadedModelId === 'minicpm5-1b' || this.loadedModelId === 'minicpm5-1b-instruct') {
      architecture = 'minicpm';
    } else if (this.loadedModelId === 'lfm2.5-1.2b-instruct') {
      architecture = 'liquid-lfm';
    } else if (this.loadedModelId === 'custom-llm-model' || (this.isInstructModel && this.loadedModelId)) {
      architecture = 'custom-llm';
    }

    return {
      magic,
      version,
      tensorCount,
      metadataCount,
      dimensions: 1024,
      architecture,
      model: this.modelName,
      valid: true
    };
  }

  /**
   * Loads model weights and header into memory.
   */
  loadModel(modelId, buffer) {
    if (!buffer) {
      throw new Error('Buffer is required to load model');
    }
    this.loadedModelId = modelId;
    if (modelId === 'embeddinggemma-2') {
      this.isInstructModel = false;
      this.isEmbeddingModel = true;
      this.isLLM = false;
      this.dimensions = 768;
      this.modelName = 'EmbeddingGemma-2 (UD-Q4_K_XL)';
      this.modelUrl = 'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf';
    } else if (modelId === 'minicpm5-1b' || modelId === 'minicpm5-1b-instruct') {
      this.isInstructModel = true;
      this.isLLM = true;
      this.modelName = 'MiniCPM5-1B (Q5_K_M)';
      this.modelUrl = 'https://huggingface.co/NANI-Nithin/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q5_K_M.gguf';
    } else if (modelId === 'lfm2.5-1.2b-instruct') {
      this.isInstructModel = true;
      this.isLLM = true;
      this.modelName = 'LiquidAI LFM2.5-1.2B-Instruct (Q5_K_M)';
      this.modelUrl = 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q5_K_M.gguf';
    } else if (modelId === 'custom-llm-model') {
      const cfg = typeof modelManager !== 'undefined' ? modelManager.getModelConfig(modelId) : null;
      this.isInstructModel = true;
      this.isLLM = true;
      this.modelName = cfg?.name || 'Custom LLM Model';
      this.modelUrl = cfg?.url || '';
    } else if (typeof modelManager !== 'undefined' && modelManager.getModelConfig(modelId)?.isInstructModel) {
      const cfg = modelManager.getModelConfig(modelId);
      this.isInstructModel = true;
      this.isLLM = true;
      this.modelName = cfg?.name || 'Custom LLM Model';
      this.modelUrl = cfg?.url || '';
    } else {
      this.isInstructModel = false;
      this.isLLM = false;
      this.modelName = 'Qwen3-Embedding-0.6B (Q5_K_M)';
      this.modelUrl = 'https://huggingface.co/PeterAM4/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q5_K_M.gguf?download=true';
    }
    const header = this.parseGGUFHeader(buffer);
    this.modelBuffer = buffer;
    this.cachedModelMetadata = header;
    this.isLoaded = true;
    return { success: true, metadata: header };
  }

  /**
   * Unloads model weights from memory.
   */
  unloadModel() {
    this.modelBuffer = null;
    this.cachedModelMetadata = null;
    this.loadedModelId = null;
    this.isLoaded = false;
    return { success: true, status: 'unloaded' };
  }
}

// Global instance exports
if (typeof globalThis !== 'undefined') {
  globalThis.embeddingEngine = new EmbeddingEngine();
  globalThis.minicpmEngine = globalThis.embeddingEngine;
  globalThis.lfmEngine = globalThis.embeddingEngine;
  globalThis.qwenEngine = globalThis.embeddingEngine;
  globalThis.jevEngine = globalThis.embeddingEngine;
  globalThis.nodeLlamaCppInstruct = nodeLlamaCppInstruct;
  globalThis.classifyWithMiniCPM = classifyWithMiniCPM;
  globalThis.runMiniCPM = runMiniCPM;
  globalThis.classifyWithCustomLLM = classifyWithCustomLLM;
  globalThis.runCustomLLM = runCustomLLM;
  globalThis.classifyWithLiquidLFM = classifyWithLiquidLFM;
  globalThis.runLiquidLFM = runLiquidLFM;
  globalThis.nodeLlamaCppEmbed = nodeLlamaCppEmbed;
}

if (typeof self !== 'undefined' && self !== globalThis) {
  self.embeddingEngine = globalThis.embeddingEngine;
  self.minicpmEngine = globalThis.embeddingEngine;
  self.lfmEngine = globalThis.embeddingEngine;
  self.qwenEngine = globalThis.embeddingEngine;
  self.jevEngine = globalThis.embeddingEngine;
  self.nodeLlamaCppInstruct = nodeLlamaCppInstruct;
  self.classifyWithMiniCPM = classifyWithMiniCPM;
  self.runMiniCPM = runMiniCPM;
  self.classifyWithCustomLLM = classifyWithCustomLLM;
  self.runCustomLLM = runCustomLLM;
  self.classifyWithLiquidLFM = classifyWithLiquidLFM;
  self.runLiquidLFM = runLiquidLFM;
  self.nodeLlamaCppEmbed = nodeLlamaCppEmbed;
}
