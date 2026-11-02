export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'dist/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        chrome: 'readonly',
        self: 'readonly',
        globalThis: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        btoa: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        importScripts: 'readonly',
        DOMParser: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        parseInt: 'readonly',
        caches: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        Blob: 'readonly',
        Float32Array: 'readonly',
        Uint8Array: 'readonly',
        Uint32Array: 'readonly',
        ArrayBuffer: 'readonly',
        performance: 'readonly',
        indexedDB: 'readonly',
        GPUBufferUsage: 'readonly',
        GPUMapMode: 'readonly',
        modelManager: 'readonly',
        embeddingEngine: 'readonly',
        jevEngine: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'indent': ['error', 2],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', {
        anonymous: 'never',
        named: 'never',
        asyncArrow: 'always'
      }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        globalThis: 'readonly'
      }
    }
  }
];
