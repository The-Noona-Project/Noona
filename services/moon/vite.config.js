import vue from '@vitejs/plugin-vue';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    // 👇 THIS is the correct setting for SPA routing
    historyApiFallback: true
  }
});
