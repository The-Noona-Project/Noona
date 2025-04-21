// /services/moon/frontend/vite.config.js

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// Ensure __dirname in ESM context
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  root: __dirname, // use absolute path for root
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../backend/public'), // build output goes into backend/public
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // optional, for cleaner imports like @/App
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
