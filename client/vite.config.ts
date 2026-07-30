import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `base: './'` keeps asset paths relative so the bundle can load straight from
// the filesystem (Electron / single-file offline build).
//
// SINGLE=1 → inline ALL JS/CSS into one self-contained dist-single/index.html;
// scripts/build-single.ts then base64-embeds the KoPub fonts and writes the
// final HydroNet.html (double-click to use, fully offline).
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const single = env.SINGLE === '1'

export default defineConfig({
  base: './',
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  server: {
    // 5173은 SYNC-BUILD(apps/web)가 점유 — HydroNet dev 클라는 5273 고정.
    // strictPort: 포트가 막혀 있으면 조용히 5274로 밀리지 말고 즉시 실패.
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4020',
    },
  },
  build: {
    outDir: single ? 'dist-single' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // Single-file: emit ONE classic (IIFE) script so the inlined HTML runs from
    // a bare file:// (double-click) — ES-module scripts are CORS-restricted there.
    ...(single && {
      rollupOptions: { output: { format: 'iife' as const, inlineDynamicImports: true } },
    }),
  },
})
