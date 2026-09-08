// 공기 적정성 엔진 스모크 — `tsx scripts/adequacy-smoke.ts` (또는 npm run smoke:adequacy).
// 검토서 B5 4방식(①산정식 ②표준대비 ③법정 4대구성요소) 결정론 계산을 회귀 검증한다.
// 실패 시 throw → 비정상 종료(CI 게이트).

import { findStandardRate } from '../src/data/standardRates'
import {
  assessConstructionPeriod,
  assessTaskAdequacy,
  assessTasks,
  computeConstructionPeriod,
  findSimilarWorkName,
  networkWorkSpan,
  normWorkName,
  theoreticalWorkdays,
} from '../src/engine/adequacy'
import { compareUnits, normalizeUnit } from '../src/engine/units'
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
  task({
    id: 'A',
    name: '토사(굴삭기 1.0㎥)',
    workCode: 'earthwork-cut-soil',
    quantity: 1040,
    start: 0,
    duration: 2,
  }),
  task({
    id: 'B',
    name: '옹벽',
    workCode: 'retaining-wall-conc',
    quantity: 2,
    start: 2,
    duration: 50,
  }),
  task({ id: 'M', name: '◆ 준공', start: 52, duration: 0, isMilestone: true }),
]
const links: Link[] = [{ id: 'l1', from: 'A', to: 'B', type: 'FS', lag: 0 }]
const rainy: RainySeason[] = [
  {
    id: 'r1',
    label: '우기',
    startMonth: 6,
    startDay: 21,
    endMonth: 9,
    endDay: 20,
    efficiency: 0.5,
  },
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

// ── F04 단위 정규화·차원 검사(engine/units) ─────────────────────────────────
eq(normalizeUnit('m3'), normalizeUnit('㎥'), 'normalizeUnit: m3 = ㎥ (동의표기)')
eq(normalizeUnit('루베'), '㎥', 'normalizeUnit: 루베 → ㎥')
eq(normalizeUnit('M²'), '㎡', 'normalizeUnit: M² → ㎡')
eq(normalizeUnit('span(15m)'), 'span', 'normalizeUnit: 괄호 한정어 분리(span(15m) → span)')
eq(normalizeUnit('  '), undefined, 'normalizeUnit: 공백 → undefined')
eq(compareUnits('ton', '㎥').status, 'mismatch', 'compareUnits: ton vs ㎥ → 불일치(차원 다름)')
eq(compareUnits('m3', '㎥').status, 'match', 'compareUnits: m3 vs ㎥ → 일치')
eq(compareUnits(undefined, '㎥').status, 'missing', 'compareUnits: 단위 미입력 → missing')
eq(compareUnits('㎥', undefined).status, 'no-rate', 'compareUnits: 표준 단위 없음 → no-rate')

// ── F04 회귀: 520 ton 을 520㎥/일 로 나눠 '1일'이 나오던 오답 차단 ──────────────
const wrongUnit = task({
  id: 'u',
  workCode: 'earthwork-cut-soil', // 520㎥/일
  quantity: 520,
  unit: 'ton',
  duration: 1,
})
const ru = assessTaskAdequacy(wrongUnit)
eq(ru.theoretical, null, '단위 불일치(ton vs ㎥) → 이론작업일수 산출 안 함')
eq(ru.verdict, '판정불가', '단위 불일치 → 판정불가(과거: 과다)')
eq(ru.unitCheck.status, 'mismatch', '단위 불일치 → unitCheck.status = mismatch')
assert(
  ru.basis.some((b) => b.includes('단위 불일치')),
  '단위 불일치 사유가 근거에 남음',
)
// 동의표기는 정상 산정
const okUnit = assessTaskAdequacy(
  task({ id: 'u2', workCode: 'earthwork-cut-soil', quantity: 1040, unit: 'm3', duration: 2 }),
)
eq(okUnit.theoretical, 2, '동의표기(m3) → 이론 2일')
eq(okUnit.verdict, '적정', '동의표기(m3) → 적정')
// ② 표준대비 승격도 막는다(틀린 물량으로 '적정'이 나오면 안 됨)
eq(
  assessTaskAdequacy(wrongUnit, { standardDuration: 100 }).verdict,
  '판정불가',
  '단위 불일치 → 표준대비(②) 승격 차단',
)
// 근거 있는 환산은 호출자가 출처와 함께 명시할 때만 적용(내장 계수 없음)
const conv = assessTaskAdequacy(task({ ...wrongUnit, duration: 2 }), {
  unitConversion: { from: 'ton', to: '㎥', factor: 1.6, source: '설계기준 단위중량' },
})
eq(conv.theoretical, 2, '명시 환산(520ton×1.6=832㎥) → 이론 2일')
eq(conv.verdict, '적정', '명시 환산 후 판정 정상화')
assert(
  conv.basis.some((b) => b.includes('출처')),
  '환산 근거에 출처 표기',
)
eq(
  assessTaskAdequacy(task({ ...wrongUnit, duration: 2 }), {
    unitConversion: { from: 'ton', to: '㎥', factor: 1.6, source: '  ' },
  }).verdict,
  '판정불가',
  '출처 없는 환산계수는 무시 → 판정불가 유지',
)
eq(assessTaskAdequacy(wrongUnit).tolerancePct, 15, '허용 편차 기본값 15%(제품 기본값)')
// ③ 총공기 산정에서도 단위 불일치 공종은 물량 산정에서 제외(현 공기로 근사)
const cpUnit = assessConstructionPeriod({ tasks: [task({ ...wrongUnit, duration: 5 })], links: [] })
eq(cpUnit.unitIssueCount, 1, '③ 단위 불일치 공종 1개 집계')
eq(cpUnit.workSum, 5, '③ 단위 불일치 공종은 현 공기(5일)로 근사')

// ── F03 작업량 합계 vs 경과 공기 분리 ────────────────────────────────────────
const par: Task[] = [
  task({ id: 'P1', start: 0, duration: 10 }),
  task({ id: 'P2', start: 0, duration: 10 }),
]
const cpPar = assessConstructionPeriod({ tasks: par, links: [] })
eq(cpPar.criticalCount, 2, '병렬: 주공정 2개')
eq(cpPar.workSum, 20, '병렬: 작업량 합계 = 10+10 = 20일(병렬 포함 총합)')
eq(cpPar.workSpan, 10, '병렬: 경과 작업공기 = 10일(선후행망 최장경로)')
eq(cpPar.parts.work, 10, '병렬: 법정 산정식의 작업일수 항 = 경과 작업공기')
eq(networkWorkSpan(par, []), 10, 'networkWorkSpan: 독립 10일 2개 → 10')
// 직렬(기존 ③ fixture)은 합계 = 최장경로
eq(cp.workSum, 52, '직렬: 작업량 합계 52일')
eq(cp.workSpan, 52, '직렬: 경과 작업공기 52일(= 합계)')
// 길이가 같은 두 경로
const twoPaths: Task[] = [
  task({ id: 'A1', duration: 5 }),
  task({ id: 'A2', duration: 5 }),
  task({ id: 'B1', duration: 4 }),
  task({ id: 'B2', duration: 6 }),
]
const twoLinks: Link[] = [
  { id: 'k1', from: 'A1', to: 'A2', type: 'FS', lag: 0 },
  { id: 'k2', from: 'B1', to: 'B2', type: 'FS', lag: 0 },
]
eq(networkWorkSpan(twoPaths, twoLinks), 10, '복수 경로: 최장경로 10일(합계 20 아님)')
// SS/FF·lag 도 기존 CPM 규칙 그대로 반영
eq(
  networkWorkSpan(
    [task({ id: 'X', duration: 10 }), task({ id: 'Y', duration: 10 })],
    [{ id: 'k3', from: 'X', to: 'Y', type: 'SS', lag: 5 }],
  ),
  15,
  'SS+lag5: 5 + 10 = 15일',
)
eq(
  networkWorkSpan(
    [task({ id: 'X', duration: 10 }), task({ id: 'Y', duration: 4 })],
    [{ id: 'k4', from: 'X', to: 'Y', type: 'FF', lag: 0 }],
  ),
  10,
  'FF lag0: 종료 맞춤 → 10일',
)
eq(networkWorkSpan([], []), 0, 'networkWorkSpan: 공정 없음 → 0')

// ── F03 산정 전제(가정 vs 입력) + 비작업일수 중복 차감 ────────────────────────
assert(cp.assumed, '전제 미입력 → assumed=true(가정 기반 참고값)')
assert(
  cp.basis.some((b) => b.includes('가정 기반 참고값')),
  '근거 첫 줄에 가정 기반 참고값 경고',
)
assert(
  cp.basis.some((b) => b.includes('작업량 합계') && b.includes('경과 작업공기')),
  '근거에 작업량 합계 ≠ 경과 작업공기 명시',
)
assert(
  cp.basis.some((b) => b.includes('제품 기본 허용치')),
  '근거에 ±15% 가 제품 기본값(법정 아님)임을 명시',
)
eq(cp.nonWork.overlap, 0, '공휴일 0 → 중복 차감 0(기존 합계 보존)')
const cpAll = assessConstructionPeriod({
  tasks,
  links,
  rainySeasons: rainy,
  startDate: '2026-01-01',
  prepDays: 10,
  cleanupDays: 10,
  holidayDays: 5,
  weatherDays: 3,
  tolerancePct: 10,
})
eq(cpAll.assumed, false, '전제 전부 입력 → assumed=false')
eq(cpAll.parts.prep, 10, '입력 준비기간 10일 반영')
eq(cpAll.nonWork.weather, 3, '기상 공사불능일수 입력값이 우기밴드 추정을 대체')
assert(cpAll.nonWork.weekend > 0, '기상 입력이어도 주말은 달력에서 계속 계산')
eq(cpAll.assumptions.filter((x) => x.source === 'user').length, 5, '산정 전제 5건 모두 user 출처')
const cpHol = assessConstructionPeriod({
  tasks,
  links,
  rainySeasons: rainy,
  startDate: '2026-01-01',
  holidayDays: 20,
})
assert(cpHol.nonWork.overlap > 0, '공휴일 20일 → 주말·기상과의 중복 차감 발생')
eq(
  cpHol.nonWork.total,
  cpHol.nonWork.weekend + cpHol.nonWork.weather + cpHol.nonWork.holiday - cpHol.nonWork.overlap,
  '비작업일수 = 주말+기상+공휴일−중복',
)

// ── 표준공기 유사 매칭(결정론 토큰 겹침) ─────────────────────────────────────
eq(
  findSimilarWorkName('가물막이 설치', ['상류 가물막이', '본댐 축조'])?.key,
  '상류 가물막이',
  '유사 매칭: 가물막이 설치 ↔ 상류 가물막이',
)
eq(
  findSimilarWorkName('토공 설치', ['옹벽 설치']),
  null,
  '유사 매칭: 일반 토큰(설치)만 겹치면 매칭 안 함',
)
eq(
  findSimilarWorkName('가물막이', ['상류 가물막이', '하류 가물막이']),
  null,
  '유사 매칭: 동점(모호) → 매칭 안 함',
)

import { standardDurationIndex } from '../src/data/facilities'
import { createSampleProject } from '../src/data/sampleProject'
// ── reviewRequest 렌더(④LLM 소비처 배선) — 크래시 없이 법정 근거 섹션 포함 ─────
import { buildReviewRequestMd } from '../src/export/reviewRequest'

const md = buildReviewRequestMd(createSampleProject())
assert(md.includes('공기 적정성 — 법정 산정 근거'), 'reviewRequest: 법정 산정 근거 섹션 포함')
assert(md.includes('이론작업일수(일)'), 'reviewRequest: 이론작업일수 컬럼 포함')
assert(
  md.includes('sequence_review_request: v1'),
  'reviewRequest: front-matter 유지(라운드트립 호환)',
)
assert(
  md.includes('```jsonl') || md.includes('sequence-review'),
  'reviewRequest: 회신 형식 가이드 유지',
)
assert(md.includes('가정 기반 참고값'), 'reviewRequest: 미입력 전제는 가정 기반 참고값으로 표기')
assert(md.includes('작업량 합계'), 'reviewRequest: 작업량 합계와 경과 작업공기를 분리 표기')
assert(md.includes('경과 작업공기'), 'reviewRequest: 경과 작업공기 표기')
assert(md.includes('### 산정 전제'), 'reviewRequest: 산정 전제 섹션 포함')

// ── 허용 편차(±%)가 **공정별 판정까지** 흐르는가 ─────────────────────────────
// 사용자가 산정 전제에 넣은 허용 편차는 ③총공기뿐 아니라 ①②공정별 판정에도 적용돼야 한다.
// 배선이 빠지면 '허용 편차 5%(입력)' 라고 적힌 문서 안에서 +10% 공정이 15% 기준으로 '적정'
// 판정되는 자기모순이 생긴다. 엔진(assessTasks)과 실제 .md 본문 양쪽에서 확인한다.
{
  const tolTask = task({ id: 'tol1', name: '허용편차 시험공정', duration: 11 }) // 표준 10일 대비 +10%
  const tolIdx = new Map<string, number | null>([['허용편차 시험공정', 10]])
  eq(
    assessTasks([tolTask], [], { standardDurationByName: tolIdx }).get('tol1')?.verdict,
    '적정',
    'assessTasks: 기본 허용편차 15% → +10% 공정은 적정',
  )
  const tol5 = assessTasks([tolTask], [], {
    standardDurationByName: tolIdx,
    tolerancePct: 5,
  }).get('tol1')
  eq(tol5?.verdict, '과다', 'assessTasks: 허용편차 5% → +10% 공정은 과다')
  eq(tol5?.tolerancePct, 5, 'assessTasks: 결과에 적용 허용편차가 5로 실려야 함')
}

// 같은 검증을 **실제 검토요청 .md 본문**으로 — 엔진만 고치고 export 배선을 빠뜨리면
// 문서가 '허용 편차 5%(입력)' 라고 써 놓고 표에서는 15% 로 판정하는 모순이 남는다.
{
  const FAC = 'retaining' // 옹벽·보강토 표준 템플릿(표준공기 색인 보유)
  const stdIdx = standardDurationIndex(FAC)
  const anchor = [...stdIdx.entries()].find(
    ([, d]) => typeof d === 'number' && d > 0 && d % 10 === 0,
  )
  assert(!!anchor, 'reviewRequest 허용편차 시험: 10의 배수 표준공기 앵커가 있어야 함')
  const [anchorName, anchorDays] = anchor as [string, number]
  const mkProject = (tolerancePct?: number) => {
    const p = createSampleProject()
    p.facility = FAC
    const target = p.tasks.find((t) => !t.isMilestone)
    assert(!!target, 'reviewRequest 허용편차 시험: 대상 공정이 있어야 함')
    // 표준 대비 정확히 +10% 인 공정 하나를 만든다(①산정식 입력은 비워 ②표준대비로 판정).
    Object.assign(target as Task, {
      name: anchorName,
      duration: Math.round(anchorDays * 1.1),
      workCode: undefined,
      quantity: undefined,
      unit: undefined,
    })
    p.periodInputs = tolerancePct != null ? { tolerancePct } : undefined
    return { project: p, taskId: (target as Task).id }
  }
  const rowOf = (md: string, id: string): string => {
    const row = md.split('\n').find((l) => l.includes(`[[id:${id}]]`))
    assert(!!row, `reviewRequest 허용편차 시험: ${id} 행을 찾지 못함`)
    return row as string
  }
  const loose = mkProject(undefined)
  const looseRow = rowOf(buildReviewRequestMd(loose.project), loose.taskId)
  assert(
    looseRow.includes('| 적정 |'),
    `reviewRequest: 기본 허용편차 15% → +10% 공정은 적정 (행: ${looseRow})`,
  )
  const tight = mkProject(5)
  const tightMd = buildReviewRequestMd(tight.project)
  const tightRow = rowOf(tightMd, tight.taskId)
  assert(
    tightRow.includes('| 과다 |'),
    `reviewRequest: 허용편차 5% → +10% 공정은 과다 (행: ${tightRow})`,
  )
  // 문서가 스스로 모순되지 않는지 — 표 위 안내와 「산정 전제」가 같은 5% 를 말해야 한다.
  assert(
    tightMd.includes('「적정성(법정)」 판정 허용 편차: **±5%** (사용자 입력)'),
    'reviewRequest: 표 상단에 적용 허용 편차를 명시',
  )
  assert(
    tightMd.includes('허용 편차(±%) **5%** (입력'),
    'reviewRequest: 산정 전제의 허용 편차도 동일한 5%(입력)',
  )
}

// ── 근사 앵커(유사 매칭)로 내려간 판정은 판정 칸에도 '≈·근사 앵커' 를 단다 ────────────
// 표준(일) 칸의 '≈' 만 보고 판정은 확정으로 읽는 오독(외부 LLM 포함)을 막기 위한 것.
{
  const p = createSampleProject()
  p.facility = 'retaining'
  const stdIdx = standardDurationIndex('retaining')
  const anchorName = [...stdIdx.entries()].find(([, d]) => typeof d === 'number' && d > 0)?.[0]
  assert(!!anchorName, '근사 앵커 시험: 표준 앵커가 있어야 함')
  const target = p.tasks.find((t) => !t.isMilestone)
  assert(!!target, '근사 앵커 시험: 대상 공정이 있어야 함')
  // 표준 템플릿에 **없는** 이름이지만 토큰이 겹쳐 유사 매칭되는 이름을 붙인다.
  Object.assign(target as Task, {
    name: `${anchorName} 2단계`,
    duration: 999,
    workCode: undefined,
    quantity: undefined,
    unit: undefined,
  })
  const row = buildReviewRequestMd(p)
    .split('\n')
    .find((l) => l.includes(`[[id:${(target as Task).id}]]`))
  assert(!!row, '근사 앵커 시험: 대상 행을 찾지 못함')
  assert(
    (row as string).includes('≈과다') && (row as string).includes('근사 앵커'),
    `reviewRequest: 근사 앵커 판정은 '≈…(근사 앵커)' 로 한정 표기 (행: ${row})`,
  )
}

console.log(`✓ adequacy-smoke: ${checks} checks passed`)
