// /services/moon/frontend/eslint.config.js

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // Ignore build output
  { ignores: ['dist'] },

  // Main JS/JSX config
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Base JS rules
      ...js.configs.recommended.rules,

      // React Hooks best practices
      ...reactHooks.configs.recommended.rules,

      // Allow unused UPPER_CASE vars (e.g., constants, env flags)
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],

      // React Refresh plugin for fast refresh safety
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
];
