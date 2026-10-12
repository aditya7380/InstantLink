import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-desktop/**', 'node_modules/**', 'release/**', 'desktop/dist/**', 'desktop/dist-electron/**', '**/*.cjs'] },
  js.configs.recommended,
  {
    // Static website: plain browser JavaScript.
    files: ['web/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', URL: 'readonly', URLSearchParams: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // e2e scripts are plain Node ESM; some code inside them runs in the browser page (window/document).
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly', process: 'readonly', fetch: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', window: 'readonly', document: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
