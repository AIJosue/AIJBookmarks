# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Lint
npm run lint
npm run lint:fix

# Build extension (creates aijbookmarks.zip, aijbookmarks-chrome.zip, and aijbookmarks-firefox.zip)
npm run build
npm run build:chrome
npm run build:firefox

# Rebuild icons (requires Sharp; run after changing SVG source)
npm run build:icons
```

No test suite is configured.

## Architecture

This is a **Cross-Browser Extension (Chrome & Firefox Manifest v3)** — vanilla JavaScript, no build framework (no Webpack/Vite). The build artifacts are ZIP files for Chrome (`aijbookmarks-chrome.zip`) and Firefox (`aijbookmarks-firefox.zip`).

### Files

| File | Role |
|---|---|
| `background.js` | Service worker / background script — all core logic, AI dispatch, health checks, storage |
| `popup.js` / `popup.html` | Extension popup UI |
| `health-check.js` / `health-check.html` | Link health audit manager & bulk fix tools |
| `options.js` / `options.html` | Settings page |
| `manifest.json` | Extension config for Chrome (Manifest V3) |
| `manifest.firefox.json` | Extension config for Firefox (Manifest V3 with Gecko ID) |

### Data flow

1. User opens popup → `popup.js` reads the active tab URL and sends a `analyzeBookmark` message to the service worker
2. `background.js` receives the message, fetches page HTML, retrieves existing bookmark folder structure, and calls the selected AI provider
3. AI returns a JSON categorization; the service worker creates a Chrome bookmark, optionally saves to Instapaper, creates a Todoist task, or opens Things via `things://` URL scheme
4. Service worker posts result back to popup for display

### AI provider abstraction

Four providers share a single `analyzeBookmark()` code path in `background.js`, with branching on the stored `provider` setting:

- **Anthropic** — Claude models (e.g. `claude-haiku-4-5`)
- **OpenAI & Compatible** — official OpenAI API or custom OpenAI-compatible base URLs (Ollama, LM Studio, Groq, DeepSeek, Together, etc.) with custom model selection
- **Google Gemini** — model configurable in options (e.g. `gemini-3.6-flash`, `gemini-3.7-flash`)
- **OpenRouter** — model selectable from dynamic list fetched at settings load

All API keys and persistent settings are stored in `chrome.storage.sync`. Health check results and live scanning progress are stored in fast in-memory RAM `chrome.storage.session`.

### ESLint style

Flat config (`eslint.config.mjs`): ES2022, single quotes, semicolons, 2-space indent, no trailing spaces.
