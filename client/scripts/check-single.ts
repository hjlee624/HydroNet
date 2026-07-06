// Smoke-test the BUILT single HTML: load it in jsdom, run its inlined bundle,
// and assert the app actually mounts (no blank page) + the chart SVG renders.
// Run: npx tsx scripts/check-single.ts
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Strip the embedded font base64 (irrelevant to whether the bundle executes/mounts)
// so jsdom isn't overwhelmed by ~19MB of CSS — we still run the real IIFE bundle.
const html = readFileSync(resolve(REPO, 'HydroNet.html'), 'utf8').replace(
  /data:font\/otf;base64,[A-Za-z0-9+/=]+/g,
  'data:font/otf;base64,',
)

const vc = new VirtualConsole()
const errors: string[] = []
vc.on('jsdomError', (e: Error) => errors.push(String(e?.message ?? e)))

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  // http origin: jsdom blocks localStorage on file:// "opaque origins", but REAL
  // browsers DO provide it on file://, so this models the real double-click case.
  url: 'http://localhost/',
  beforeParse(window) {
    // jsdom has no canvas; the app only needs it for raster export, not mount.
    ;(window.HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext =
      () => null
    // Boot straight into the 공정관리(schedule) module so the chart actually renders.
    // The first-entry gate (shell.initialModule) otherwise forces the dashboard until
    // a 사업 단계 is picked, leaving no #hydronet-chart. Mirrors mount-test.ts.
    try {
      window.localStorage.setItem('hydronet:typeChosen', '1')
      window.localStorage.setItem('hydronet:module', 'schedule')
    } catch {
      /* localStorage unavailable → chart assertion will surface it */
    }
  },
})

setTimeout(() => {
  const doc = dom.window.document
  const root = doc.getElementById('root')
  const len = root?.innerHTML.length ?? 0
  const chart = !!doc.getElementById('hydronet-chart')
  const brand = (root?.textContent ?? '').includes('Hydro')
  const fatal = errors.filter((e) => !/getContext|Not implemented|canvas/i.test(e))
  console.log(`#root html length = ${len}`)
  console.log(`  ${chart ? '✓' : '✗'} 차트 SVG 렌더(#hydronet-chart)`)
  console.log(`  ${brand ? '✓' : '✗'} 브랜드/상단바 렌더`)
  console.log(`  ${fatal.length === 0 ? '✓' : '✗'} 치명적 오류 없음 (${fatal.length})`)
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n'))
  const ok = len > 1000 && chart && brand && fatal.length === 0
  console.log(ok ? '\n✅ 단일 HTML 정상 동작' : '\n❌ 문제 있음')
  process.exit(ok ? 0 : 1)
}, 2500)
