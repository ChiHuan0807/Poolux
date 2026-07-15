import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isOffline = mode === 'offline'

  return {
    // Capacitor WebView 需要相对路径
    base: isOffline ? './' : '/',
    build: {
      sourcemap: isOffline ? false : 'hidden',
      outDir: isOffline ? 'dist-offline' : 'dist',
      emptyOutDir: true,
      rollupOptions: isOffline
        ? {
            input: path.resolve(__dirname, 'offline.html'),
          }
        : undefined,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      proxy: {
        // 本地开发：/api 代理到后端，避免直连 3001 失败时误伤调试
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react({
        babel: {
          plugins: isOffline ? [] : ['react-dev-locator'],
        },
      }),
      tsconfigPaths(),
    ],
  }
})
