import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@oneui/tokens': path.resolve(__dirname, 'src/theme/tokens.js'),
    },
  },
  css: {
    preprocessorOptions: {
      css: {
        additionalData: '@import "@textkernel/oneui/dist/oneui.min.css";\n',
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
