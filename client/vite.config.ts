import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Lightweight config. `base: './'` keeps asset paths relative so the built
// bundle can be loaded straight from the filesystem when later wrapped in
// Electron for offline `.exe` distribution.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4020',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
