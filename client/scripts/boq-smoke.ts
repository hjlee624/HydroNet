// BoQ 취입 파서 스모크 — `npm run smoke:boq`. 순수 함수(CSV·헤더검출·행추출·공종코드추천·매핑)
// 회귀 검증. 실패 시 throw → 비정상 종료.

import {
  extractRows,
  matchRowsToTasks,
  parseBoqAoa,
  parseCsv,
  parseQuantity,
  suggestWorkCode,
} from '../src/state/boqImport'
import type { Task } from '../src/types/model'

let checks = 0
function assert(cond: boolean, msg: string): void {
  checks++
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
function eq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// ── parseQuantity ──
eq(parseQuantity('1,234.5 ㎥'), 1234.5, 'parseQuantity: 콤마·단위 제거')
eq(parseQuantity('  520 '), 520, 'parseQuantity: 공백')
eq(parseQuantity('계'), null, 'parseQuantity: 비수치 → null')
eq(parseQuantity(''), null, 'parseQuantity: 빈값 → null')

// ── parseCsv ──
const csv = parseCsv('항목,단위,수량\r\n"토사, 굴착",㎥,"1,040"\n옹벽,span,2\n')
eq(csv.length, 3, 'parseCsv: 3행')
eq(csv[1][0], '토사, 굴착', 'parseCsv: 따옴표 내 콤마 보존')
eq(csv[1][2], '1,040', 'parseCsv: 따옴표 내 콤마 보존(수량)')

// ── parseBoqAoa: 헤더/열 검출 + 행 추출 ──
const aoa = [
  ['공사내역서', '', '', ''],
  ['품명', '규격', '단위', '수량'],
  ['토사 굴착', '굴삭기 1.0㎥', '㎥', '1,040'],
  ['옹벽 콘크리트', 'B=4m', 'span(15m)', '2'],
  ['합계', '', '', '9999'],
]
const res = parseBoqAoa(aoa)
eq(res.headerRowIndex, 1, 'parseBoqAoa: 헤더행 인덱스=1')
eq(res.columns.name, 0, 'parseBoqAoa: name 열=0')
eq(res.columns.unit, 2, 'parseBoqAoa: unit 열=2')
eq(res.columns.qty, 3, 'parseBoqAoa: qty 열=3')
eq(res.rows.length, 2, 'parseBoqAoa: 데이터 2행(합계행 제외)')
eq(res.rows[0].name, '토사 굴착', 'parseBoqAoa: 행0 name')
eq(res.rows[0].quantity, 1040, 'parseBoqAoa: 행0 수량(콤마 파싱)')
eq(res.rows[0].unit, '㎥', 'parseBoqAoa: 행0 단위')

// 헤더 미검출 → rows 빈배열 + 경고(크래시 없음)
const noHeader = parseBoqAoa([['a', 'b'], ['c', 'd']])
eq(noHeader.rows.length, 0, 'parseBoqAoa: 헤더 없으면 rows 빈배열')
assert(noHeader.warnings.length > 0, 'parseBoqAoa: 헤더 없으면 경고')

// 사용자 수동 열지정 재추출
const manual = extractRows(aoa, 1, { name: 0, spec: 1, unit: 2, qty: 3 })
eq(manual.length, 2, 'extractRows: 수동 열지정 2행')

// ── suggestWorkCode ──
eq(
  suggestWorkCode('강관비계 설치', 'H≤10m 쌍줄', '㎡'),
  'temp-scaffold',
  'suggestWorkCode: 강관비계 → temp-scaffold',
)
eq(suggestWorkCode('zzzz qqqq', '', 'xx'), undefined, 'suggestWorkCode: 무의미 입력 → undefined')

// ── matchRowsToTasks ──
const tasks: Task[] = [
  { id: 'A', categoryId: 'c', name: '토사 굴착', start: 0, duration: 2, isMilestone: false },
  { id: 'B', categoryId: 'c', name: '옹벽 콘크리트', start: 2, duration: 50, isMilestone: false },
  { id: 'Z', categoryId: 'c', name: '전혀다른공정XYZ', start: 0, duration: 5, isMilestone: false },
  { id: 'M', categoryId: 'c', name: '◆ 준공', start: 52, duration: 0, isMilestone: true },
]
const { mappings, unmatchedRows } = matchRowsToTasks(res.rows, tasks)
eq(mappings.length, 3, 'matchRowsToTasks: 마일스톤 제외 3개')
const mA = mappings.find((m) => m.taskId === 'A')
assert(!!mA?.row, 'matchRowsToTasks: A 매칭됨')
eq(mA?.quantity, 1040, 'matchRowsToTasks: A 수량 1040')
eq(mA?.unit, '㎥', 'matchRowsToTasks: A 단위 ㎥')
const mZ = mappings.find((m) => m.taskId === 'Z')
eq(mZ?.row, null, 'matchRowsToTasks: Z 미매칭(row=null)')
eq(unmatchedRows.length, 0, 'matchRowsToTasks: 미사용 행 0(2행 모두 매칭)')

console.log(`✓ boq-smoke: ${checks} checks passed`)
