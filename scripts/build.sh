#!/usr/bin/env bash
set -e

TARGET="${1:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

build_chrome() {
  echo "==> Building Chrome extension..."
  mkdir -p "$ROOT_DIR/dist/chrome"
  rm -rf "$ROOT_DIR/dist/chrome/*"
  
  cp "$ROOT_DIR/manifest.json" "$ROOT_DIR/dist/chrome/manifest.json"
  cp "$ROOT_DIR/background.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/model-manager.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/embedding-engine.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/offscreen.html" "$ROOT_DIR/offscreen.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/popup.html" "$ROOT_DIR/popup.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/options.html" "$ROOT_DIR/options.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/health-check.html" "$ROOT_DIR/health-check.js" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/inbox.html" "$ROOT_DIR/inbox.js" "$ROOT_DIR/dist/chrome/"
  cp -r "$ROOT_DIR/icons" "$ROOT_DIR/dist/chrome/"
  cp "$ROOT_DIR/README.md" "$ROOT_DIR/PRIVACY.md" "$ROOT_DIR/dist/chrome/" 2>/dev/null || true

  rm -f "$ROOT_DIR/aijbookmarks-chrome.zip" "$ROOT_DIR/aijbookmarks.zip"
  (cd "$ROOT_DIR/dist/chrome" && zip -r -q "$ROOT_DIR/aijbookmarks-chrome.zip" . -x '*.DS_Store')
  cp "$ROOT_DIR/aijbookmarks-chrome.zip" "$ROOT_DIR/aijbookmarks.zip"
  echo "✓ Built aijbookmarks-chrome.zip and dist/chrome/"
}

build_firefox() {
  echo "==> Building Firefox extension..."
  mkdir -p "$ROOT_DIR/dist/firefox"
  rm -rf "$ROOT_DIR/dist/firefox/*"
  
  cp "$ROOT_DIR/manifest.firefox.json" "$ROOT_DIR/dist/firefox/manifest.json"
  cp "$ROOT_DIR/background.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/model-manager.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/embedding-engine.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/offscreen.html" "$ROOT_DIR/offscreen.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/popup.html" "$ROOT_DIR/popup.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/options.html" "$ROOT_DIR/options.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/health-check.html" "$ROOT_DIR/health-check.js" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/inbox.html" "$ROOT_DIR/inbox.js" "$ROOT_DIR/dist/firefox/"
  cp -r "$ROOT_DIR/icons" "$ROOT_DIR/dist/firefox/"
  cp "$ROOT_DIR/README.md" "$ROOT_DIR/PRIVACY.md" "$ROOT_DIR/FIREFOX.md" "$ROOT_DIR/dist/firefox/" 2>/dev/null || true

  rm -f "$ROOT_DIR/aijbookmarks-firefox.zip"
  (cd "$ROOT_DIR/dist/firefox" && zip -r -q "$ROOT_DIR/aijbookmarks-firefox.zip" . -x '*.DS_Store')
  echo "✓ Built aijbookmarks-firefox.zip and dist/firefox/"
}

case "$TARGET" in
  chrome)
    build_chrome
    ;;
  firefox)
    build_firefox
    ;;
  all|*)
    build_chrome
    build_firefox
    ;;
esac

echo "Done!"
