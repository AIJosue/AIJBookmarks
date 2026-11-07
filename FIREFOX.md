# AIJbookmarks for Mozilla Firefox

**AIJbookmarks** provides 100% 1-to-1 feature parity on Mozilla Firefox, utilizing Firefox Manifest V3 with full support for AI categorization, automated inbox sorting, link health checking, local Jev decision models, and read-it-later integrations.

---

## 🚀 Quick Start & Testing in Firefox

### Loading as a Temporary Extension

1. Build or locate the Firefox package:
   ```bash
   npm run build:firefox
   # or run ./scripts/build.sh firefox
   ```
   This generates:
   - `aijbookmarks-firefox.zip` (for distribution / AMO submission)
   - `dist/firefox/` (unpacked directory for local testing)

2. Open Firefox and navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```

3. Click **"Load Temporary Add-on…"**.

4. Select either:
   - `dist/firefox/manifest.json` (or any file inside `dist/firefox/`), OR
   - `aijbookmarks-firefox.zip`

5. The AIJbookmarks icon will appear in your Firefox toolbar. Click it to begin organizing bookmarks!

---

## 📋 1-to-1 Feature Parity Checklist

| Feature | Chrome | Firefox | Notes |
|---|:---:|:---:|---|
| **AI Providers** (Anthropic Claude, OpenAI, Gemini, OpenRouter, Custom Ollama/LM Studio) | ✅ | ✅ | Shared unified AI dispatch pipeline |
| **Bookmark Tree & Root Support** | ✅ | ✅ | Automatically recognizes `Bookmarks Toolbar` (`toolbar_____`), `Other Bookmarks` (`unfiled_____`), and `Bookmarks Menu` (`menu________`) |
| **Instant Popup Categorization** | ✅ | ✅ | Fetches page metadata and classifies into hierarchical folders |
| **Inbox & Mass Auto-Sorting** | ✅ | ✅ | Sorts unsorted bookmarks sitting in Toolbar, Unfiled, or Menu roots |
| **Folder Organization Planner** | ✅ | ✅ | Merges duplicates and reorganizes folders with safety checks |
| **Health Check Auditor** | ✅ | ✅ | Parallel 404, redirect, and dead-link detection with auto-fix |
| **Local EmbeddingGemma-2 Embedding Model** | ✅ | ✅ | On-device EmbeddingGemma-2 (UD-Q4_K_XL) model powered by node-llama-cpp |
| **Third-Party Integrations** | ✅ | ✅ | Instapaper, Todoist, and Things 3 URL schemes |
| **Encrypted Sync Storage** | ✅ | ✅ | Cross-device API key and setting persistence via `browser.storage.sync` |

---

## 💻 Supported Platforms: Desktop Only

> [!IMPORTANT]
> **AIJbookmarks officially supports Firefox Desktop and Chrome Desktop only.**
> Firefox for Android is explicitly not supported. Mozilla's mobile engine (GeckoView / Firefox for Android) does not implement the WebExtensions Bookmarks API (`browser.bookmarks` / `chrome.bookmarks`, tracked under Mozilla Bugzilla [Bug 1796596](https://bugzilla.mozilla.org/show_bug.cgi?id=1796596)).
> 
> To organize bookmarks created on mobile, enable **Firefox Sync** to sync them to Firefox Desktop (under "Mobile Bookmarks"), where AIJbookmarks provides full AI organization and management.

---

## 🛠️ Building & Packaging

```bash
# Build both Chrome and Firefox release packages
npm run build

# Build Firefox package only
npm run build:firefox

# Build Chrome package only
npm run build:chrome
```

### Manifest Details (Firefox MV3)

- **ID**: `aijbookmarks@AIJosue`
- **Background**: Event-driven background script (`background.js`) via `"background": { "scripts": ["background.js"] }`
- **Permissions**: `bookmarks`, `activeTab`, `storage`, `contextMenus`, `alarms`
- **Minimum Firefox Version**: 109.0+

---

## 📦 Submitting to Mozilla Add-ons (AMO)

1. Run `npm run build:firefox` to generate `aijbookmarks-firefox.zip`.
2. Visit [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/).
3. Submit `aijbookmarks-firefox.zip` as a new extension or new version.
