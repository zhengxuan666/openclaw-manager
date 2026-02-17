import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const buildVersion = process.env.BUILD_VERSION || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // 防止 Vite 清除 Rust 错误信息
  clearScreen: false,

  // Tauri 期望使用固定端口，如果端口不可用则失败
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_WEB_API_TARGET || 'http://127.0.0.1:17890',
        changeOrigin: true,
      },
    },
    watch: {
      // 监听 src-tauri 目录变化
      ignored: ['**/src-tauri/**'],
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // 生产构建配置
  build: {
    // Tauri 在 Windows 上使用 Chromium，在 macOS 和 Linux 上使用 WebKit
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // 不压缩以便调试
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // 生成 sourcemap 以便调试
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  // 环境变量
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
});
