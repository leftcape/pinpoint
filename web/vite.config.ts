import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El front habla con el backend FastAPI. En dev, proxyeamos /api al server local.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
  },
})
