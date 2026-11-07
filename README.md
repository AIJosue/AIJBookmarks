<div align="center">
  <img src="icons/icon128.png" alt="AIJbookmarks Logo" width="100" height="100">
  <h1>AIJbookmarks</h1>
  <p><strong>Intelligent AI-powered bookmark organizer, on-device EmbeddingGemma-2 embedding model sorting, and link health dashboard for Google Chrome Desktop & Mozilla Firefox Desktop.</strong></p>
</div>

---

## 🌟 Why AIJbookmarks?

Saving bookmarks is easy—finding them and keeping them organized is hard. **AIJbookmarks** automatically sorts your links into intuitive folders using your favorite AI model or the on-device EmbeddingGemma-2 embedding model, and keeps your library clean and healthy by detecting dead links, redirects, and duplicates.

---

## 🚀 Quick Start in 3 Steps

### 1. Install the Extension

#### Google Chrome
1. Download or clone this repository.
2. In Google Chrome, go to `chrome://extensions/`.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extension folder.

#### Mozilla Firefox
1. Build the Firefox bundle with `npm run build:firefox` (or `./scripts/build.sh firefox`).
2. In Mozilla Firefox, navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json` (or `aijbookmarks-firefox.zip`).
4. See [FIREFOX.md](FIREFOX.md) for full Firefox documentation.

### 2. Connect Your AI Provider
1. Click the **AIJbookmarks** icon in your Chrome toolbar (pin it for convenience!).
2. Click **Extension Settings** at the bottom of the popup.
3. Choose your preferred AI provider:
   - **Local EmbeddingGemma-2 Embedding Model** (EmbeddingGemma-2 (UD-Q4_K_XL) on-device via node-llama-cpp — no API keys required!)
   - **Anthropic Claude** (e.g. Claude 3.5 Haiku / Sonnet)
   - **OpenAI & Compatible** (ChatGPT, Ollama, LM Studio, Groq, DeepSeek, Together, etc.)
   - **Google Gemini** (e.g. Gemini 2.5 Flash, Gemini 3 Flash)
   - **OpenRouter** (access hundreds of open and closed models)
4. Enter your API key (or local endpoint URL) and click **Save**.

### 3. Bookmark Any Page
1. While on any webpage, open the AIJbookmarks popup.
2. Click **Analyze & Save**.
3. The AI reads the page title and content, selects or creates the most relevant category folder, and saves it cleanly into your Chrome bookmarks bar!

---

## ✨ Features

### 🤖 Smart AI Categorization
- Automatically matches pages against your existing bookmark folders.
- **Custom Folder Rules**: Set domain rules to always file specific sites (e.g., `github.com` → `Development/Repositories`).
- **Controlled Folder Creation**: Decide whether the AI can create new folders, specify a dedicated parent folder for new categories, and toggle recursive folder depth to prevent runaway subfolder trees.

### 🧠 Local EmbeddingGemma-2 Embedding Model (node-llama-cpp)
- **Zero-Latency Offline Sorting**: Runs Google's EmbeddingGemma-2 (UD-Q4_K_XL GGUF) directly on-device using node-llama-cpp and high-performance vector embeddings.
- **1024-Dimensional Semantic Routing**: Evaluates folder candidates and produces cosine similarity distributions to sort bookmarks into matching folders.
- **Custom Model URL Support**: Easily point to any custom GGUF embedding model URL besides EmbeddingGemma-2.
- **Complete Privacy**: Works 100% locally on-device without API keys, cloud subscriptions, or external servers.

### 🩺 Bookmark Health Check & Maintenance
A unified link audit dashboard (open via Extension Popup → **Health Check**):
- 🔴 **Dead Links**: Detects broken URLs (HTTP 404, 410, 5xx) and unreachable domains.
- 🟠 **Redirects**: Highlights moved pages with a 1-click **Fix all redirects** button.
- 🔵 **Stale Bookmarks**: Discovers bookmarks you haven't opened in months or years.
- 🟣 **Duplicate Detection**: Finds duplicate URLs scattered across different folders and removes extras with one click.
- ⚪ **Empty Folders**: Cleans up unused and empty folders (with automatic protection for Chrome's built-in system roots).
- 🟢 **Healthy Links**: Real-time counter of working bookmarks.
- 🛡️ **Bot & Cloudflare Shield**: Detects anti-bot barriers (Cloudflare, Datadome, Akamai) without false dead link warnings.
- ⚡ **Fast In-Memory RAM Storage**: Scan results are stored in RAM (`chrome.storage.session`) for instant performance and automatically clear when you close your browser.

### 🔗 Multi-Service Integrations
- **Instapaper**: Send articles directly to your Instapaper reading queue.
- **Todoist**: Create actionable follow-up tasks from bookmarked pages.
- **Things (macOS/iOS)**: Add to-dos via the native `things://` scheme—no API key needed.
- **Readwise & Raindrop.io**: Sync bookmarks with your personal knowledge base.

---

## ⚙️ AI Provider Setup Guide

| Provider | Supported Models | Setup Instructions |
| :--- | :--- | :--- |
| **Anthropic (Claude)** | Claude 3.5 Haiku, Sonnet, Opus | Get an API key from [Anthropic Console](https://console.anthropic.com/). Keys start with `sk-ant-`. |
| **OpenAI (ChatGPT)** | Dynamically fetched via API (e.g. GPT-5.6, o3) | Get an API key from [OpenAI Platform](https://platform.openai.com/). Click **Load Models** to populate the dropdown. |
| **Local / Custom LLMs** | Ollama, LM Studio, Groq, DeepSeek, Together | Enter your custom base URL (e.g. `http://localhost:11434/v1` for Ollama) and click **Load Models**. |
| **Google Gemini** | Gemini 3.6 Flash, Gemini 3.7 Flash | Get an API key from [Google AI Studio](https://aistudio.google.com/). Keys start with `AQ.` or `AIza`. |
| **OpenRouter** | 200+ models from Claude, Meta, Mistral, etc. | Get an API key from [OpenRouter](https://openrouter.ai/keys). Click **Load Models** to pick any available model. |

---

## 🔒 Privacy & Permissions

AIJbookmarks respects your privacy. All bookmark analysis and health audits happen directly in your browser:
- **bookmarks**: Read, create, and organize your bookmark folders.
- **activeTab**: Reads the current tab's URL and title only when you open the popup.
- **storage**: Securely stores your preferences and API keys in Chrome sync storage.
- **contextMenus**: Provides optional right-click bookmark shortcuts.
- **alarms**: Supports optional scheduled health checks.

Your data is never tracked, stored on third-party servers, or shared with anyone other than the AI provider you configure.

---

## ❓ Frequently Asked Questions (FAQ)

<details>
<summary><strong>Is Firefox for Android supported?</strong></summary>
No. Mozilla's mobile engine (GeckoView / Firefox for Android) does not implement the WebExtensions Bookmarks API (tracked under Mozilla Bugzilla <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1796596" target="_blank">Bug 1796596</a>). To organize mobile bookmarks, enable <strong>Firefox Sync</strong> to sync them to Firefox Desktop (under "Mobile Bookmarks"), where AIJbookmarks can organize and sort them automatically.
</details>

<details>
<summary><strong>Where are my bookmarks saved?</strong></summary>
All bookmarks are saved directly into your native Google Chrome bookmarks bar and folders. You can access and manage them via Chrome's Bookmark Manager (<code>Ctrl+Shift+O</code> or <code>Cmd+Option+B</code>).
</details>

<details>
<summary><strong>Can I use a free or local AI model?</strong></summary>
Yes! You can connect local inference engines like <strong>Ollama</strong> or <strong>LM Studio</strong> completely free with zero subscription costs. Set the provider to OpenAI, change the Base URL to your local server (e.g. <code>http://localhost:11434/v1</code>), and click <strong>Fetch Models</strong>.
</details>

<details>
<summary><strong>Will deleting empty folders delete my Bookmarks Bar or Other Bookmarks?</strong></summary>
No. Built-in Chrome root folders (such as <em>Bookmarks bar</em>, <em>Other bookmarks</em>, and <em>Mobile bookmarks</em>) are strictly protected and will never be deleted.
</details>

<details>
<summary><strong>Are my Health Check scan results saved permanently?</strong></summary>
Health check results are kept in fast in-memory RAM during your session for instant responsiveness. When you close Chrome, the temporary results clear automatically.
</details>

---

## 🛠️ Development & Contributing

### Build Commands
```bash
# Lint code
npm run lint

# Build extension ZIP
npm run build

# Rebuild icon assets
npm run build:icons
```

---

## 📄 License

Owned and maintained by AIJosue. This project is going in an entirely new direction.