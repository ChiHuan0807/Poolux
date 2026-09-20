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
      // 生产构建不输出 source map：dist 会被直接放到网站根目录，
      // 隐藏的 .map 只是不带 sourceMappingURL 注释，文件本身仍可被下载，
      // 等于把前端源码公开（FigmaLanding 的 map 就有 2MB+）。需要时再临时打开。
      sourcemap: false,
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
