import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname),
    plugins: [react()],
    build: {
        outDir: resolve(__dirname, '../dist'),
        emptyOutDir: true,
        sourcemap: true
    },
    server: {
        port: 5174,
        host: '127.0.0.1'
    }
});
