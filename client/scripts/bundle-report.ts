// 번들 크기 실측(F17) — `tsx scripts/bundle-report.ts` (npm run bundle:report).
// `npm run build` 로 dist 를 만든 뒤 실행한다.
//
// 검토서의 요구는 '쪼개기 전에 재라' 이므로 **여기서 코드 분할을 하지는 않는다.**
// 이 스크립트는 dist/assets 의 raw/gzip 크기를 표로 찍고, 진입 청크(gzip)가 예산을
// 넘으면 종료코드 1 로 알린다. 실제 분할(예: export/exporter.ts 의 정적 jspdf import 를
// 동적으로 돌리기)은 이 숫자가 예산을 넘긴 뒤에 별건으로 판단한다 —
// SINGLE=1 단일 HTML 빌드가 inlineDynamicImports 를 쓰기 때문에 청킹 변경은 위험하다.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** 진입 JS 청크의 gzip 예산(byte). 2026-09-08 실측 기준선(380,604B ≈ 371.7kB)에
 *  약 10% 여유를 둔 값이다 — 즉 '지금보다 눈에 띄게 더 무거워지면' 걸린다.
 *  기준선 수치는 docs/Sequence_지원체계_및_도입효과_측정.md 의 번들 표에 기록되어 있다. */
const ENTRY_GZIP_BUDGET = 420 * 1024

const DIST = join(process.cwd(), 'dist', 'assets')
if (!existsSync(DIST)) {
  console.log(`❌ ${DIST} 가 없습니다 — 먼저 \`npm run build\` 를 실행하세요.`)
  process.exit(1)
}

const kb = (n: number) => `${(n / 1024).toFixed(1)}kB`
const pad = (s: string, n: number) => s.padStart(n)

const files = readdirSync(DIST)
  .filter((f) => statSync(join(DIST, f)).isFile())
  .map((f) => {
    const buf = readFileSync(join(DIST, f))
    return { name: f, raw: buf.length, gzip: gzipSync(buf).length }
  })
  .sort((a, b) => b.raw - a.raw)

// 진입 청크 = index-*.js (vite 기본 이름). 나머지는 비동기/동적 import 청크.
const entry = files.find((f) => /^index-.*\.js$/.test(f.name))

console.log('Sequence 번들 실측 (dist/assets)')
console.log(`  ${pad('raw', 12)} ${pad('gzip', 12)}  파일`)
for (const f of files) {
  const mark = f === entry ? '★ ' : '  '
  console.log(`  ${pad(kb(f.raw), 12)} ${pad(kb(f.gzip), 12)}  ${mark}${f.name}`)
}
const totalRaw = files.reduce((s, f) => s + f.raw, 0)
const totalGzip = files.reduce((s, f) => s + f.gzip, 0)
console.log(`  ${pad(kb(totalRaw), 12)} ${pad(kb(totalGzip), 12)}  = 합계 (${files.length}개)`)
console.log('  ★ = 첫 화면에서 반드시 내려받는 진입 청크')

console.log('')
if (!entry) {
  console.log('❌ 진입 청크(index-*.js)를 찾지 못했습니다 — 빌드 산출물을 확인하세요.')
  process.exit(1)
}
console.log(
  `진입 청크 ${entry.name}: raw ${entry.raw}B / gzip ${entry.gzip}B (예산 ${ENTRY_GZIP_BUDGET}B)`,
)
if (entry.gzip > ENTRY_GZIP_BUDGET) {
  console.log(`❌ 진입 청크 gzip 이 예산을 ${entry.gzip - ENTRY_GZIP_BUDGET}B 초과했습니다.`)
  console.log(
    "   가장 손쉬운 후보: client/src/export/exporter.ts 의 정적 `import { jsPDF } from 'jspdf'` 를 동적 import 로.",
  )
  console.log(
    '   단 SINGLE=1 단일 HTML 빌드(npm run build:single && npm run check:single) 회귀를 반드시 함께 확인할 것.',
  )
  process.exit(1)
}
console.log('✅ BUNDLE OK — 진입 청크가 예산 안이라 지금은 코드 분할이 필요하지 않습니다.')
