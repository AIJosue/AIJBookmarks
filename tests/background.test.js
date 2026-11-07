import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// We need to mock the global fetch and the chrome API since we're running in Node
let fetchHtmlContent;
let isSystemFolder;
let getUserFolders;
let normalizeCategoryToExistingFolders;
let stripRootFolderPrefix;
let handleGetAISuggestionsBatch;
let invalidateBookmarkTreeCache;
let getSortingScopeFolders;
let getUnsortedBookmarks;

beforeEach(async () => {
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} }
    },
    bookmarks: {
      onCreated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onChanged: { addListener: () => {} },
      onMoved: { addListener: () => {} },
      onChildrenReordered: { addListener: () => {} },
      getTree: () => Promise.resolve([])
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      sync: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() }
    },
    contextMenus: {
      create: () => {},
      onClicked: { addListener: () => {} }
    },
    alarms: {
      onAlarm: { addListener: () => {} }
    }
  };

  // Import the background script functions into our test scope
  // We have to read and eval since it's not exported
  const fs = await import('fs');
  const path = await import('path');
  const bgScript = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf8');

  // Use eval to get the function reference
  const moduleScope = eval(`
        (() => {
            ${bgScript}
            return {
              fetchHtmlContent,
              isSystemFolder,
              getUserFolders,
              normalizeCategoryToExistingFolders,
              stripRootFolderPrefix,
              handleGetAISuggestionsBatch,
              invalidateBookmarkTreeCache,
              getSortingScopeFolders,
              getUnsortedBookmarks
            };
        })()
    `);

  fetchHtmlContent = moduleScope.fetchHtmlContent;
  isSystemFolder = moduleScope.isSystemFolder;
  getUserFolders = moduleScope.getUserFolders;
  normalizeCategoryToExistingFolders = moduleScope.normalizeCategoryToExistingFolders;
  stripRootFolderPrefix = moduleScope.stripRootFolderPrefix;
  handleGetAISuggestionsBatch = moduleScope.handleGetAISuggestionsBatch;
  invalidateBookmarkTreeCache = moduleScope.invalidateBookmarkTreeCache;
  getSortingScopeFolders = moduleScope.getSortingScopeFolders;
  getUnsortedBookmarks = moduleScope.getUnsortedBookmarks;
  invalidateBookmarkTreeCache();
});

afterEach(() => {
  delete globalThis.chrome;
  mock.restoreAll();
});

describe('fetchHtmlContent', () => {
  it('should return null when response status is non-200 (e.g. 404)', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    }));

    const consoleErrorMock = mock.method(console, 'error', () => {});
    const consoleLogMock = mock.method(console, 'log', () => {});

    const result = await fetchHtmlContent('http://example.com/not-found');

    assert.strictEqual(result, null);
    assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
    assert.strictEqual(consoleErrorMock.mock.calls[0].arguments[0], 'Failed to fetch URL: 404 Not Found');
    assert.strictEqual(consoleLogMock.mock.calls.length, 1);
  });

  it('should return null when response status is 500', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    }));

    const consoleErrorMock = mock.method(console, 'error', () => {});
    mock.method(console, 'log', () => {});

    const result = await fetchHtmlContent('http://example.com/error');

    assert.strictEqual(result, null);
    assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
    assert.strictEqual(consoleErrorMock.mock.calls[0].arguments[0], 'Failed to fetch URL: 500 Internal Server Error');
  });

  it('should return text content when response status is 200 OK', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>Test Content</html>'
    }));

    const consoleLogMock = mock.method(console, 'log', () => {});
    const consoleErrorMock = mock.method(console, 'error', () => {});

    const result = await fetchHtmlContent('http://example.com/success');

    assert.strictEqual(result, '<html>Test Content</html>');
    assert.strictEqual(consoleLogMock.mock.calls.length, 1);
    assert.strictEqual(consoleErrorMock.mock.calls.length, 0);
  });

  it('should return null when fetch throws an exception', async () => {
    const networkError = new Error('Network Error');
    mock.method(globalThis, 'fetch', async () => {
      throw networkError;
    });

    const consoleLogMock = mock.method(console, 'log', () => {});
    const consoleErrorMock = mock.method(console, 'error', () => {});

    const result = await fetchHtmlContent('http://example.com/network-error');

    assert.strictEqual(result, null);
    assert.strictEqual(consoleLogMock.mock.calls.length, 1);
    assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
    assert.strictEqual(consoleErrorMock.mock.calls[0].arguments[0], 'Error fetching HTML: request failed or timed out');
  });
});

describe('Folder Filtering & Normalization (Mozilla Firefox Protection)', () => {
  it('should identify browser system and vendor folders correctly', () => {
    assert.strictEqual(isSystemFolder('Mozilla Firefox'), true);
    assert.strictEqual(isSystemFolder('mozilla firefox'), true);
    assert.strictEqual(isSystemFolder('Firefox'), true);
    assert.strictEqual(isSystemFolder('Mozilla Firefox/Help and Tutorials'), true);
    assert.strictEqual(isSystemFolder('Mozilla Firefox/Customize Firefox'), true);
    assert.strictEqual(isSystemFolder('Bookmarks Bar'), true);
    assert.strictEqual(isSystemFolder('Bookmarks Toolbar'), true);
    assert.strictEqual(isSystemFolder('Other Bookmarks'), true);
    assert.strictEqual(isSystemFolder('toolbar_____'), true);

    // User folders should NOT be system folders
    assert.strictEqual(isSystemFolder('Development'), false);
    assert.strictEqual(isSystemFolder('Development/Frontend'), false);
    assert.strictEqual(isSystemFolder('Finance & Investments'), false);
    assert.strictEqual(isSystemFolder('Recipes'), false);
    assert.strictEqual(isSystemFolder('Work/Projects'), false);
  });

  it('should filter out system folders in getUserFolders', () => {
    const rawFolders = [
      'Mozilla Firefox',
      'Mozilla Firefox/Help and Tutorials',
      'Development',
      'Finance',
      'Bookmarks Toolbar',
      'Recipes'
    ];
    const userOnly = getUserFolders(rawFolders);
    assert.deepStrictEqual(userOnly, ['Development', 'Finance', 'Recipes']);
  });

  it('should never assign bookmarks to Mozilla Firefox in normalizeCategoryToExistingFolders', () => {
    const existingWithFirefox = [
      'Mozilla Firefox',
      'Mozilla Firefox/Help and Tutorials',
      'Development',
      'Design'
    ];

    // Case 1: Exact match with user folder
    const resDev = normalizeCategoryToExistingFolders('Development', existingWithFirefox, false);
    assert.strictEqual(resDev, 'Development');

    // Case 2: Suggested category matches Mozilla Firefox -> MUST fall back to first user folder
    const resFF = normalizeCategoryToExistingFolders('Mozilla Firefox', existingWithFirefox, false);
    assert.strictEqual(resFF, 'Development');

    // Case 3: Unmatched category -> MUST fall back to first user folder, NOT Mozilla Firefox
    const resUnmatched = normalizeCategoryToExistingFolders('Random Unknown Category', existingWithFirefox, false);
    assert.strictEqual(resUnmatched, 'Development');

    // Case 4: No user folders exist at all -> MUST fall back to Bookmarks Bar, NOT Mozilla Firefox
    const onlyFirefox = ['Mozilla Firefox', 'Mozilla Firefox/Help and Tutorials'];
    const resEmpty = normalizeCategoryToExistingFolders('Something', onlyFirefox, false);
    assert.strictEqual(resEmpty, 'Bookmarks Bar');

    // Case 5: When allowCreateFolders is true and input is Mozilla Firefox -> fallback safely
    const resCreateFF = normalizeCategoryToExistingFolders('Mozilla Firefox', onlyFirefox, true);
    assert.strictEqual(resCreateFF, 'Bookmarks Bar');

    // Case 6: When allowCreateFolders is true and input is valid user folder
    const resCreateValid = normalizeCategoryToExistingFolders('Technology/AI', onlyFirefox, true);
    assert.strictEqual(resCreateValid, 'Technology/AI');

    // Case 7: Preserves existing subfolder paths when selected
    const userFoldersWithSub = ['Work', 'Work/Projects', 'Personal/Finance'];
    const resSub = normalizeCategoryToExistingFolders('Work/Projects', userFoldersWithSub, false);
    assert.strictEqual(resSub, 'Work/Projects');

    // Case 8: Strips root prefix and matches existing subfolder
    const resPrefixedSub = normalizeCategoryToExistingFolders('Bookmarks Bar/Work/Projects', userFoldersWithSub, false);
    assert.strictEqual(resPrefixedSub, 'Work/Projects');

    const resToolbarSub = normalizeCategoryToExistingFolders('Bookmarks Toolbar/Personal/Finance', userFoldersWithSub, false);
    assert.strictEqual(resToolbarSub, 'Personal/Finance');

    // Case 9: Resolves leaf folder name to full existing subfolder path
    const resLeaf = normalizeCategoryToExistingFolders('Finance', userFoldersWithSub, false);
    assert.strictEqual(resLeaf, 'Personal/Finance');
  });

  it('should strip browser root folder prefixes cleanly in stripRootFolderPrefix', () => {
    assert.strictEqual(stripRootFolderPrefix('Bookmarks Bar/Work/Projects'), 'Work/Projects');
    assert.strictEqual(stripRootFolderPrefix('Bookmarks Toolbar/Personal/Finance'), 'Personal/Finance');
    assert.strictEqual(stripRootFolderPrefix('Other Bookmarks/Reading List'), 'Reading List');
    assert.strictEqual(stripRootFolderPrefix('Bookmarks Menu/Tools'), 'Tools');
    assert.strictEqual(stripRootFolderPrefix('Work/Projects'), 'Work/Projects');
    assert.strictEqual(stripRootFolderPrefix(''), '');
  });

  it('should return error when no AI provider credentials are configured in handleGetAISuggestionsBatch', async () => {
    const batch = [
      { id: 'bm1', title: 'Vue.js Component Framework', url: 'https://vuejs.org' }
    ];

    const response = await handleGetAISuggestionsBatch(batch);
    assert.strictEqual(response.success, false);
    assert.ok(response.error.includes('No AI provider configured'));
  });

  it('should apply domain rules without calling AI in handleGetAISuggestionsBatch', async () => {
    globalThis.chrome.storage.sync.get = async () => ({
      sortAllowCreateFolders: true,
      domainRules: [
        { domain: 'github.com', folder: 'Development' }
      ]
    });

    const batch = [
      { id: 'bm1', title: 'GitHub', url: 'https://github.com/torvalds/linux' }
    ];

    const response = await handleGetAISuggestionsBatch(batch);
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.results.length, 1);
    assert.strictEqual(response.results[0].matchedCategory, 'Development');
    assert.strictEqual(response.results[0].fromRule, true);
  });

  it('should include root containers and user subfolders in getSortingScopeFolders without empty lists', async () => {
    globalThis.chrome.bookmarks.getTree = async () => [
      {
        id: 'root________',
        title: '',
        children: [
          {
            id: 'toolbar_____',
            title: 'Bookmarks Toolbar',
            children: [
              { id: 'b1', title: 'GitHub', url: 'https://github.com' },
              { id: 'f1', title: 'Tech', children: [
                { id: 'b2', title: 'React Docs', url: 'https://react.dev' }
              ] }
            ]
          },
          {
            id: 'menu________',
            title: 'Bookmarks Menu',
            children: [
              { id: 'sys_ff', title: 'Mozilla Firefox', children: [] },
              { id: 'b3', title: 'Firefox News', url: 'https://news.ycombinator.com' }
            ]
          },
          {
            id: 'unfiled_____',
            title: 'Other Bookmarks',
            children: []
          }
        ]
      }
    ];
    invalidateBookmarkTreeCache();

    const folders = await getSortingScopeFolders();
    assert.ok(Array.isArray(folders));
    assert.ok(folders.length >= 3, 'Should at least include root containers');

    const toolbar = folders.find(f => f.id === 'toolbar_____');
    assert.ok(toolbar, 'Bookmarks Toolbar must be present');
    assert.strictEqual(toolbar.directBookmarkCount, 1);
    assert.strictEqual(toolbar.isRoot, true);

    const menu = folders.find(f => f.id === 'menu________');
    assert.ok(menu, 'Bookmarks Menu must be present');
    assert.strictEqual(menu.directBookmarkCount, 1);
    assert.strictEqual(menu.isRoot, true);

    const tech = folders.find(f => f.id === 'f1');
    assert.ok(tech, 'Subfolder Tech must be present');
    assert.strictEqual(tech.directBookmarkCount, 1);
    assert.strictEqual(tech.depth, 1);
    assert.strictEqual(tech.isRoot, false);

    // System folder Mozilla Firefox should NOT be included
    const sysFf = folders.find(f => f.title === 'Mozilla Firefox');
    assert.strictEqual(sysFf, undefined, 'Mozilla Firefox should be excluded');
  });

  it('should gracefully handle empty folderId in getUnsortedBookmarks and fetch direct bookmarks when folderId is given', async () => {
    globalThis.chrome.bookmarks.getChildren = async (id) => {
      if (id === 'menu________') {
        return [
          { id: 'b_menu1', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
          { id: 'folder_sub', title: 'Nested', children: [] }
        ];
      }
      return [];
    };
    globalThis.chrome.bookmarks.get = async (id) => {
      if (id === 'menu________') {
        return [{ id: 'menu________', title: 'Bookmarks Menu' }];
      }
      return [];
    };

    // 1. Empty folderId returns noFolderSelected instead of throwing
    const emptyResult = await getUnsortedBookmarks({ type: 'folder', folderId: '' });
    assert.strictEqual(emptyResult.noFolderSelected, true);
    assert.deepStrictEqual(emptyResult.bookmarks, []);

    // 2. Specified folderId fetches its direct bookmarks
    const folderResult = await getUnsortedBookmarks({ type: 'folder', folderId: 'menu________' });
    assert.strictEqual(folderResult.bookmarks.length, 1);
    assert.strictEqual(folderResult.bookmarks[0].id, 'b_menu1');
    assert.strictEqual(folderResult.scopeLabel, 'direct bookmarks in “Bookmarks Menu”');
  });

  it('should return unsupported error cleanly when chrome.bookmarks is unavailable (Firefox Android environment)', async () => {
    const originalGetChildren = globalThis.chrome.bookmarks.getChildren;
    const originalGetTree = globalThis.chrome.bookmarks.getTree;
    try {
      delete globalThis.chrome.bookmarks.getChildren;
      delete globalThis.chrome.bookmarks.getTree;

      const unsorted = await getUnsortedBookmarks({ type: 'roots' });
      assert.strictEqual(unsorted.unsupported, true);
      assert.strictEqual(Array.isArray(unsorted.bookmarks), true);
      assert.strictEqual(unsorted.bookmarks.length, 0);

      const folders = await getSortingScopeFolders();
      assert.strictEqual(Array.isArray(folders), true);
      assert.strictEqual(folders.length, 0);
    } finally {
      globalThis.chrome.bookmarks.getChildren = originalGetChildren;
      globalThis.chrome.bookmarks.getTree = originalGetTree;
    }
  });

  it('should initialize and execute cleanly in Firefox without onChildrenReordered API', async () => {
    delete globalThis.chrome.bookmarks.onChildrenReordered;
    const fs = await import('fs');
    const path = await import('path');
    const bgScript = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf8');

    // Evaluating in Firefox-like environment must not throw TDZ or TypeError
    assert.doesNotThrow(() => {
      const scope = eval(`
        (() => {
          ${bgScript}
          return { isSystemFolder, getUserFolders };
        })()
      `);
      assert.strictEqual(typeof scope.isSystemFolder, 'function');
      assert.strictEqual(scope.isSystemFolder('Mozilla Firefox'), true);
      assert.strictEqual(scope.isSystemFolder('Documents'), false);
    });
  });

  it('should process batch with configured Cloud AI provider', async () => {
    globalThis.chrome.bookmarks.getTree = async () => [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'Bookmarks Bar',
            children: [
              { id: 'f1', parentId: '1', title: 'Tech', children: [] },
              { id: 'f2', parentId: '1', title: 'Kitchen', children: [] }
            ]
          }
        ]
      }
    ];
    invalidateBookmarkTreeCache();

    const originalGetSync = globalThis.chrome.storage.sync.get;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.chrome.storage.sync.get = async () => ({
        aiProvider: 'openai',
        openaiApiKey: 'sk-test-key-12345',
        openaiModel: 'gpt-4o-mini'
      });

      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([{ id: 'b1', matchedCategory: 'Tech' }])
              }
            }
          ]
        })
      });

      const batch = [
        { id: 'b1', title: 'Python Handbook', url: 'https://python.org' }
      ];

      const response = await handleGetAISuggestionsBatch(batch);
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.results.length, 1);
      assert.strictEqual(response.results[0].id, 'b1');
      assert.strictEqual(response.results[0].matchedCategory, 'Tech');
    } finally {
      globalThis.chrome.storage.sync.get = originalGetSync;
      globalThis.fetch = originalFetch;
    }
  });

  it('should call exact configured Gemini model and parse suggestions', async () => {
    globalThis.chrome.bookmarks.getTree = async () => [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'Bookmarks Bar',
            children: [
              { id: 'f1', parentId: '1', title: 'Developer', children: [] }
            ]
          }
        ]
      }
    ];
    invalidateBookmarkTreeCache();

    const originalGetSync = globalThis.chrome.storage.sync.get;
    const originalFetch = globalThis.fetch;
    let requestedUrl = null;
    try {
      globalThis.chrome.storage.sync.get = async () => ({
        aiProvider: 'gemini',
        geminiApiKey: 'AQ-test-key-999',
        geminiModel: 'gemini-2.5-flash'
      });

      globalThis.fetch = async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify([{ id: 'b2', matchedCategory: 'Developer' }]) }
                  ]
                }
              }
            ]
          })
        };
      };

      const batch = [
        { id: 'b2', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' }
      ];

      const response = await handleGetAISuggestionsBatch(batch);
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.results.length, 1);
      assert.strictEqual(response.results[0].id, 'b2');
      assert.strictEqual(response.results[0].matchedCategory, 'Developer');
      assert.ok(requestedUrl.includes('models/gemini-2.5-flash:generateContent'));
    } finally {
      globalThis.chrome.storage.sync.get = originalGetSync;
      globalThis.fetch = originalFetch;
    }
  });
});
