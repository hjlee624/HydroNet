// 공기 적정성 엔진 스모크 — `tsx scripts/adequacy-smoke.ts` (또는 npm run smoke:adequacy).
// 검토서 B5 4방식(①산정식 ②표준대비 ③법정 4대구성요소) 결정론 계산을 회귀 검증한다.
// 실패 시 throw → 비정상 종료(CI 게이트).

import {
  assessConstructionPeriod,
  assessTaskAdequacy,
  assessTasks,
  computeConstructionPeriod,
  normWorkName,
  theoreticalWorkdays,
} from '../src/engine/adequacy'
import { findStandardRate } from '../src/data/standardRates'
import type { Link, RainySeason, Task } from '../src/types/model'

let checks = 0
function assert(cond: boolean, msg: string): void {
  checks++
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
function eq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, `${msg} — expected ${String(b)}, got ${String(a)}`)
}

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  categoryId: 'c1',
  name: over.name ?? over.id,
  start: 0,
  duration: 0,
  isMilestone: false,
  ...over,
})

// ── ① 산정식: 물량 ÷ 1일 작업량 ──────────────────────────────────────────────
const cut = findStandardRate('earthwork-cut-soil') // dailyOutput 520 ㎥/일
assert(!!cut, 'earthwork-cut-soil rate exists')
eq(theoreticalWorkdays(1040, cut), 2, 'theoretical dailyOutput: 1040㎥ ÷ 520 = 2일')
eq(theoreticalWorkdays(521, cut), 2, 'theoretical dailyOutput: 올림(521÷520=1.001→2)')
const span = findStandardRate('retaining-wall-conc') // daysPerUnit 25 일/span
assert(!!span, 'retaining-wall-conc rate exists')
eq(theoreticalWorkdays(2, span), 50, 'theoretical daysPerUnit: 2 × 25 = 50일')
eq(theoreticalWorkdays(0, cut), null, 'theoretical: 0 수량 → null')
eq(theoreticalWorkdays(100, undefined), null, 'theoretical: rate 없음 → null')

// ── assessTaskAdequacy ①: 적정/과소/과다 경계(±15%) ──────────────────────────
const base = { id: 't', workCode: 'earthwork-cut-soil', quantity: 1040 } // 이론 2일
eq(assessTaskAdequacy(task({ ...base, duration: 2 })).verdict, '적정', '편차 0% → 적정')
eq(assessTaskAdequacy(task({ ...base, duration: 5 })).verdict, '과다', '편차 +150% → 과다')
eq(assessTaskAdequacy(task({ ...base, duration: 1 })).verdict, '과소', '편차 -50% → 과소')
const r0 = assessTaskAdequacy(task({ ...base, duration: 2 }))
eq(r0.theoretical, 2, 'result.theoretical = 2')
eq(r0.deviationPct, 0, 'result.deviationPct = 0')
assert(
  r0.basis.some((b) => b.includes('개정')),
  'basis 에 개정일 표기 포함',
)

// ── assessTaskAdequacy ②: 표준 템플릿 대비 판정 승격(산정식 불가 시) ───────────
const s1 = assessTaskAdequacy(task({ id: 's', duration: 100 }), { standardDuration: 100 })
eq(s1.verdict, '적정', '표준대비 0% → 적정(②로 승격)')
eq(s1.standardDeviationPct, 0, '표준편차 0%')
const s2 = assessTaskAdequacy(task({ id: 's', duration: 130 }), { standardDuration: 100 })
eq(s2.verdict, '과다', '표준대비 +30% → 과다')
const s3 = assessTaskAdequacy(task({ id: 's', duration: 100 }))
eq(s3.verdict, '판정불가', '물량·표준 모두 없음 → 판정불가')

// ── computeConstructionPeriod: 4항 합산 + 음수 클램프 ────────────────────────
eq(
  computeConstructionPeriod({ prep: 30, nonWork: 100, work: 200, cleanup: 30 }),
  360,
  'computeConstructionPeriod = 30+100+200+30 = 360',
)
eq(
  computeConstructionPeriod({ prep: -5, nonWork: 0, work: 50, cleanup: 0 }),
  50,
  'computeConstructionPeriod: 음수 prep → 0 클램프',
)

// ── ③ assessConstructionPeriod: computeConstructionPeriod 실호출 + 주말/우기 ──
const tasks: Task[] = [
  task({ id: 'A', name: '토사(굴삭기 1.0㎥)', workCode: 'earthwork-cut-soil', quantity: 1040, start: 0, duration: 2 }),
  task({ id: 'B', name: '옹벽', workCode: 'retaining-wall-conc', quantity: 2, start: 2, duration: 50 }),
  task({ id: 'M', name: '◆ 준공', start: 52, duration: 0, isMilestone: true }),
]
const links: Link[] = [{ id: 'l1', from: 'A', to: 'B', type: 'FS', lag: 0 }]
const rainy: RainySeason[] = [
  { id: 'r1', label: '우기', startMonth: 6, startDay: 21, endMonth: 9, endDay: 20, efficiency: 0.5 },
]
const cp = assessConstructionPeriod({ tasks, links, rainySeasons: rainy, startDate: '2026-01-01' })
eq(cp.parts.work, 52, '③ 작업일수 = 이론 2 + 50 = 52(주공정 한정)')
eq(cp.workByQuantityCount, 2, '③ 물량기반 산정 공종 2개')
eq(cp.criticalCount, 2, '③ 주공정 공종 2개(마일스톤 제외)')
eq(
  cp.legalTotal,
  computeConstructionPeriod(cp.parts),
  '③ legalTotal 이 computeConstructionPeriod(parts) 와 일치(실제 호출됨)',
)
eq(cp.parts.prep, 30, '③ 준비기간 기본 30')
eq(cp.parts.cleanup, 30, '③ 정리기간 기본 30')
assert(cp.nonWork.weekend > 0, '③ 주말 비작업일수 > 0(달력 계산됨)')
eq(cp.nonWork.total, cp.parts.nonWork, '③ 비작업일수 합계 = parts.nonWork')
eq(cp.actualSpan, 52, '③ 실제 공기(달력) = 52')
eq(cp.verdict, '과소', '③ 실제(52) < 법정(112+) → 과소')
// 착수일 미지정 시 주말·기상 0(크래시 없음)
const cpNoDate = assessConstructionPeriod({ tasks, links })
eq(cpNoDate.nonWork.weekend, 0, '③ 착수일 없으면 주말 0')
eq(cpNoDate.nonWork.weather, 0, '③ 착수일 없으면 기상 0')

// ── assessTasks: CPM 결과로 주공정 한정 + 마일스톤 제외 ──────────────────────
const m = assessTasks(tasks, links, { standardDurationByName: new Map([['옹벽', 40]]) })
eq(m.size, 2, 'assessTasks: 공정 2개(마일스톤 제외)')
assert(m.get('A')?.criticalApplicable === true, 'assessTasks: A 는 주공정(criticalApplicable)')
eq(m.get('B')?.standardDeviationPct, 25, 'assessTasks: B 표준대비 (50-40)/40 = +25%')
eq(normWorkName('◆  옹벽  공'), '옹벽 공', 'normWorkName: ◆·공백 정규화')

// ── reviewRequest 렌더(④LLM 소비처 배선) — 크래시 없이 법정 근거 섹션 포함 ─────
import { buildReviewRequestMd } from '../src/export/reviewRequest'
import { createSampleProject } from '../src/data/sampleProject'
const md = buildReviewRequestMd(createSampleProject())
assert(md.includes('공기 적정성 — 법정 산정 근거'), 'reviewRequest: 법정 산정 근거 섹션 포함')
assert(md.includes('이론작업일수(일)'), 'reviewRequest: 이론작업일수 컬럼 포함')
assert(md.includes('sequence_review_request: v1'), 'reviewRequest: front-matter 유지(라운드트립 호환)')
assert(md.includes('```jsonl') || md.includes('sequence-review'), 'reviewRequest: 회신 형식 가이드 유지')

console.log(`✓ adequacy-smoke: ${checks} checks passed`)
