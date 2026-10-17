import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The FastAPI backend runs separately on :8000 (see ../backend). Clearing the "US" region
// can take a minute, so the proxy timeouts are generous.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
})
