import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    needsInterop: ['react-simple-code-editor'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        // Long-running design jobs use SSE; default proxy timeout is ~2 minutes.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
