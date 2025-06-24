import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'public/index.html'),
        },
    },
    server: {
        port: 3000,
    },
})
