import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Dev proxy target. Point VITE_PROXY_TARGET at a remote backend (e.g. the
  // production host) in .env.local to work on the UI against a live session.
  const target = loadEnv(mode, process.cwd(), '').VITE_PROXY_TARGET || 'http://localhost:8000'
  const wsTarget = target.replace(/^http/, 'ws')
  return {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target: wsTarget, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  }
})
