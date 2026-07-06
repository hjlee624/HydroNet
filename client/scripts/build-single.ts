// Build a fully self-contained single HTML — no server, no external files, no
// install. vite-plugin-singlefile (SINGLE=1) inlines all JS/CSS into one
// index.html; this script then base64-embeds the KoPub OTFs into the @font-face
// rules so the drawing renders in KoPub on ANY PC. Output: <repo>/HydroNet.html
//   • double-click to open; edit + every export (PNG/JPG/PDF/SVG/DXF) work offline
//   • 저장/불러오기는 사용자가 고른 .json 파일로(자동저장 없음, state/fileIO.ts)
// Run: npx tsx scripts/build-single.ts   (or: npm run build:single)
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..') // client/
const REPO = resolve(CLIENT, '..')

const FONTS = ['KoPubWorld Dotum_Pro Medium.otf', 'KoPubWorld Dotum_Pro Bold.otf']
for (const f of FONTS) {
  if (!existsSync(resolve(CLIENT, 'public', 'fonts', f))) {
    console.error(
      `✗ 글꼴 파일이 없습니다: client/public/fonts/${f}\n  (KoPubWorld Dotum_Pro Medium/Bold.otf 를 거기에 두고 다시 실행하세요.)`,
    )
    process.exit(1)
  }
}

console.log('› vite 단일 파일 빌드 (SINGLE=1)…')
execSync('npx vite build', { cwd: CLIENT, env: { ...process.env, SINGLE: '1' }, stdio: 'inherit' })

const htmlPath = resolve(CLIENT, 'dist-single', 'index.html')
let html = readFileSync(htmlPath, 'utf8')

for (const file of FONTS) {
  const b64 = readFileSync(resolve(CLIENT, 'public', 'fonts', file)).toString('base64')
  // vite writes url(./fonts/<file>) with spaces percent-encoded (%20) and no quotes
  // — match either spelling, with or without quotes/prefix.
  const pat = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '(?: |%20)')
  const re = new RegExp(`url\\([^)]*?${pat}[^)]*?\\)`, 'g')
  const refs = (html.match(re) || []).length
  html = html.replace(re, `url("data:font/otf;base64,${b64}")`)
  console.log(
    `› 글꼴 내장: ${file} — ${Math.round(b64.length / 1024)}KB(base64), 참조 ${refs}곳 치환`,
  )
  if (refs === 0) {
    console.error(`✗ ${file}: @font-face url 을 찾지 못해 내장 실패`)
    process.exit(1)
  }
}

// Make the inline entry a CLASSIC script at the END of <body>:
//  • classic (not type=module) → no ES-module CORS block on a bare file://
//  • inline classic scripts run IMMEDIATELY (not deferred), so it must sit AFTER
//    #root or createRoot() throws (React #299). Moving it to body-end fixes both.
// The bundle is IIFE (vite.config format:iife) so it is valid as a classic script.
const m = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/i)
if (!m) {
  console.error('✗ 진입 스크립트를 찾지 못함')
  process.exit(1)
}
if (/^\s*import[\s({]/.test(m[1].trim())) {
  console.error('✗ 번들이 ES 모듈 형식(IIFE 아님) — vite.config의 format:iife 확인.')
  process.exit(1)
}
// Function replacements so `$` sequences in the minified bundle aren't treated
// as String.replace special patterns (which would corrupt the code → SyntaxError).
html = html.replace(m[0], () => '')
html = html.replace(/<\/body>/i, () => `<script>${m[1]}</script></body>`)

// Self-containment sanity check (only flag REAL external asset references — a
// `src=` substring inside the bundled JS is not one).
const external = [
  { name: 'external <script src=…js>', re: /<script[^>]*\bsrc=["'][^"']*\.js["']/i },
  { name: 'external <link …css>', re: /<link[^>]*href=["'][^"']*\.css["']/i },
  { name: 'unembedded url(…otf)', re: /url\([^)]*\.otf/i },
]
const remaining = external.filter((e) => e.re.test(html))
if (remaining.length) {
  console.error('✗ 외부 참조가 남음:', remaining.map((e) => e.name).join(', '))
  process.exit(1)
}
console.log('› 외부 자산 참조 없음 — 완전 self-contained ✓')

const out = resolve(REPO, 'HydroNet.html')
writeFileSync(out, html)
console.log(`✓ 생성: ${out}  (${(html.length / 1024 / 1024).toFixed(1)} MB)`)
console.log(
  '  더블클릭으로 실행 — 편집·모든 출력 가능(오프라인), 저장/불러오기는 원하는 .json 파일로(수동).',
)
