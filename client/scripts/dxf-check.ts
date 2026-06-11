// Structural sanity check for the DXF exporter (no AutoCAD needed). Verifies the
// group-code/value pairing, section balance, entity counts, and absence of NaN.
// Run: npx tsx scripts/dxf-check.ts
import { writeFileSync } from 'node:fs'
import { createSampleProject } from '../src/data/sampleProject'
import { projectToDxf } from '../src/export/dxf'

let fail = 0
const check = (cond: boolean, label: string) => {
  if (!cond) { fail++; console.log('  ✗ ' + label) } else console.log('  ✓ ' + label)
}

const dxf = projectToDxf(createSampleProject())
writeFileSync('sample.dxf', dxf)
const lines = dxf.split('\n')
const content = lines.slice(0, -1) // drop trailing empty from final '\n'

console.log(`DXF: ${dxf.length} bytes, ${content.length} lines`)
check(content.length % 2 === 0, '코드/값 라인 쌍이 짝수 (group code ↔ value 균형)')
check(content[0] === '0' && content[1] === 'SECTION', '파일이 SECTION으로 시작')
check(content[content.length - 1] === 'EOF', '파일이 EOF로 종료')
check(!dxf.includes('NaN'), 'NaN 없음')
check(!dxf.includes('undefined'), 'undefined 없음')

const count = (t: string) => (dxf.match(new RegExp('^' + t + '$', 'gm')) || []).length
const section = (dxf.match(/^SECTION$/gm) || []).length
const endsec = (dxf.match(/^ENDSEC$/gm) || []).length
check(section === endsec && section === 3, `SECTION/ENDSEC 균형 (${section}/${endsec}, HEADER·TABLES·ENTITIES)`)
check(count('POLYLINE') === count('SEQEND'), `POLYLINE↔SEQEND 균형 (${count('POLYLINE')})`)
check(count('LAYER') >= 17, `LAYER 정의됨 (${count('LAYER')})`)
check(count('TEXT') > 20, `TEXT 엔티티 생성 (${count('TEXT')})`)
check(count('SOLID') > 20, `SOLID(막대/마일스톤/우기/화살촉) 생성 (${count('SOLID')})`)
check(count('LINE') > 20, `LINE(격자/축) 생성 (${count('LINE')})`)

// distinct colour indices (group 62) — lane colours must not all collapse to grey
const colorVals = new Set<string>()
for (let i = 0; i < content.length - 1; i++) {
  if (content[i] === '62') colorVals.add(content[i + 1])
}
check(colorVals.size >= 6, `색상 인덱스 다양성 (distinct 62 = ${colorVals.size}: ${[...colorVals].sort().join(',')})`)

// every group-code line must be an integer
let badCode = 0
for (let i = 0; i < content.length; i += 2) {
  if (!/^-?\d+$/.test(content[i])) { badCode++; if (badCode <= 3) console.log('   bad code @' + i + ': ' + JSON.stringify(content[i])) }
}
check(badCode === 0, '모든 group code 위치가 정수')

console.log(`\n${fail === 0 ? '✅ DXF STRUCT OK' : `❌ ${fail} FAIL`}  (wrote sample.dxf)`)
process.exit(fail === 0 ? 0 : 1)
