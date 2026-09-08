import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `base: './'` keeps asset paths relative so the bundle can load straight from
// the filesystem (Electron / single-file offline build).
//
// SINGLE=1 → inline ALL JS/CSS into one self-contained dist-single/index.html;
// scripts/build-single.ts then base64-embeds the KoPub fonts and writes the
// final Sequence.html (double-click to use, fully offline).
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const single = env.SINGLE === '1'

export default defineConfig({
  base: './',
  // 배포 형태를 런타임 코드에 주입(F05). 'standalone' = 서버가 아예 없는 오프라인 단독 HTML,
  // 'server' = 사내 서버 대상 배포(= /api/health 실패를 '장애'로 다뤄 안내해야 하는 배포).
  // dev 서버에도 동일하게 적용된다. define 이 없는 실행 환경(tsx 스모크 등)은 authStore 가
  // 방어적으로 'standalone' 으로 읽는다.
  define: {
    __SEQUENCE_DEPLOY__: JSON.stringify(single ? 'standalone' : 'server'),
  },
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  server: {
    // 5173은 SYNC-BUILD(apps/web)가 점유 — Sequence dev 클라는 5273 고정.
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
