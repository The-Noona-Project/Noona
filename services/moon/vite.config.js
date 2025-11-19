import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import postcssNested from 'postcss-nested';
import { defineConfig } from 'vite';

import ampersandModifiersPlugin from './postcss/ampersandModifiers.js';
import charsetCleanupPlugin from './postcss/charsetCleanup.js';

const ONEUI_VIRTUAL_ID = 'virtual:oneui-styles.css';
const RESOLVED_ONEUI_VIRTUAL_ID = `\0${ONEUI_VIRTUAL_ID}`;
const ONEUI_SOURCE_PATH = path.resolve(
  __dirname,
  'node_modules/@textkernel/oneui/dist/oneui.min.css',
);
const CHARSET_STATEMENT_REGEX = /@charset[^;]+;/gi;

function loadOneUiStyles() {
  const fileContents = fs.readFileSync(ONEUI_SOURCE_PATH, 'utf8');
  return fileContents.replace(CHARSET_STATEMENT_REGEX, '');
}

function oneUiCssPlugin() {
  return {
    name: 'oneui-css-virtual-module',
    resolveId(id) {
      if (id === ONEUI_VIRTUAL_ID) {
        return RESOLVED_ONEUI_VIRTUAL_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_ONEUI_VIRTUAL_ID) {
        this.addWatchFile?.(ONEUI_SOURCE_PATH);
        return loadOneUiStyles();
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [oneUiCssPlugin(), react()],
  resolve: {
    alias: {
      '@oneui/tokens': path.resolve(__dirname, 'src/theme/tokens.js'),
    },
  },
  css: {
    postcss: {
      plugins: [charsetCleanupPlugin(), ampersandModifiersPlugin(), postcssNested()],
    },
    preprocessorOptions: {
      css: {
        additionalData: `@import "${ONEUI_VIRTUAL_ID}";\n`,
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3004',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
