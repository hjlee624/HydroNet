// ─────────────────────────────────────────────────────────────────────────────
// 공기(공사기간) 적정성 판정 엔진 — 순수 함수
//
// 검토서(docs/Sequence_AI공정표_도메인연동_검토서.html) Part B / B5 의 실체화.
// 법정 산정식(국토부고시 제2024-1021호, 가이드라인 부록4)을 결정론으로 계산한다:
//
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │  공사기간 = 준비기간 + 비작업일수 + 작업일수 + 정리기간                   │  (가이드라인 p17)
//   │  작업일수 = 작업수량 ÷ 1일 작업량(부록4)  ·  주공정선(critical) 공종 한정 │  (가이드라인 p27)
//   └───────────────────────────────────────────────────────────────────────┘
//
// 4방식 통합(검토서 B5):
//   ① 산정식  : 물량 ÷ 1일 작업량 → 이론 작업일수 vs 현 공기(assessTaskAdequacy)
//   ② 표준대비: 시설물 유형 표준 템플릿 공기와 직접 비교(assessTaskAdequacy: standardDuration)
//   ③ 법적준수: 준비+비작업+작업+정리 4대 구성요소 합산 vs 실제 공기(assessConstructionPeriod)
//   ④ LLM     : ①②③ 근거를 컨텍스트로 서술·제안(엔진 밖 — Part A / export·프록시 경로에서 소비)
//
// 뉴로-심볼릭 경계: ①②③ 은 이 엔진(결정론)이 진실을 계산하고, ④LLM 은 그 근거를 받아
// 서술·제안만 한다(엔진이 산정·날짜·주공정의 유일 진실).
// ─────────────────────────────────────────────────────────────────────────────

import {
  CONSTRUCTION_PERIOD_FORMULA,
  findStandardRate,
  LEGAL_BASIS,
  NONWORK_FACTORS,
  PERIOD_COMPONENTS,
  rateOutputLabel,
  rateRevision,
  type StandardRate,
  WORKDAYS_FORMULA,
} from '../data/standardRates'
import type { ID, Link, RainySeason, Task } from '../types/model'
import { dayToDate } from './dates'
import { computeSchedule, reschedule } from './scheduling'
import { compareUnits, conversionApplies, type UnitCheck, type UnitConversion } from './units'

/** 공종명 정규화(마일스톤 ◆ 제거·공백 정리) — 표준 템플릿 색인 매칭용. */
export function normWorkName(s: string): string {
  return s.replace(/^◆\s*/, '').replace(/\s+/g, ' ').trim()
}

/** 공종명 토큰화(소문자·구두점 제거) — BoQ 매핑·표준공기 유사 매칭 공용. */
export function tokenizeWorkName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[()[\]{}<>·,/\\.\-_:;'"]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 1)
}

/** 두 공종명의 토큰 겹침 점수(겹치는 토큰 +2, 정규화 후 완전일치 +6). 결정론 — 학습 모델 없음. */
export function nameMatchScore(a: string, b: string): number {
  const ta = tokenizeWorkName(normWorkName(a))
  const tb = tokenizeWorkName(normWorkName(b))
  if (!ta.length || !tb.length) return 0
  let s = 0
  for (const w of ta) if (tb.includes(w)) s += 2
  if (normWorkName(a) === normWorkName(b)) s += 6
  return s
}

/**
 * 공종명에서 변별력이 없는 일반 토큰 — 유사 매칭에서 제외한다. 이 단어들만 겹치는
 * ('토공 설치' vs '옹벽 설치') 매칭을 막기 위한 것으로, 공종 데이터가 아니라 표기 규칙이다.
 */
const GENERIC_NAME_TOKENS = new Set([
  '설치',
  '공',
  '공사',
  '작업',
  '시공',
  '제작',
  '및',
  '기타',
  '일반',
  '부',
])

/**
 * 이름이 정확히 일치하지 않을 때의 **유사 매칭**(표준공기 앵커 보조) — '가물막이 설치' ↔
 * '상류 가물막이'처럼 수식어가 붙은 경우를 결정론 토큰 겹침으로 잇는다.
 *  · 실질 토큰(일반 토큰 제외)이 최소 1개 겹쳐야 하고,
 *  · 최고 점수 후보가 **유일**해야 한다(동점이면 모호 → null, 억지 매칭 금지).
 * 매칭된 값은 반드시 '유사 매칭'으로 표기해 근사임을 알린다.
 */
export function findSimilarWorkName(
  name: string,
  candidates: Iterable<string>,
): { key: string; score: number } | null {
  const q = tokenizeWorkName(normWorkName(name))
  if (q.length === 0) return null
  let best: { key: string; score: number } | null = null
  let tie = false
  for (const key of candidates) {
    const c = tokenizeWorkName(normWorkName(key))
    let score = 0
    for (const w of q) {
      if (!c.includes(w)) continue
      score += GENERIC_NAME_TOKENS.has(w) ? 0.5 : 2
    }
    if (score < 2) continue // 실질 토큰이 하나도 안 겹치면 매칭하지 않는다
    if (!best || score > best.score) {
      best = { key, score }
      tie = false
    } else if (score === best.score) tie = true
  }
  return best && !tie ? best : null
}

/** 편차%를 부호와 함께 표기('+12.3%' · '-8%' · '±0%'). */
function signPct(p: number): string {
  if (p === 0) return '±0%'
  return p > 0 ? `+${p}%` : `${p}%`
}

// ── 제품 기본 가정값 ──────────────────────────────────────────────────────────
// 아래 세 값은 「산정기준」이 정한 **법정 수치가 아니라 제품 기본 가정값**이다. 사용자가
// 프로젝트 전제(Project.periodInputs)로 입력하지 않았을 때만 쓰이며, 그 경우 산정 결과는
// '가정 기반 참고값'으로 표기된다(assumptions/assumed).
/**
 * 준비기간 기본값(일) — **제품 기본 가정값이다. 가이드라인에 준비기간 일수 규정은 없다.**
 * p17(PERIOD_COMPONENTS 'prep')은 준비기간의 *내용*(설계도서 검토·측량·가설건물·조달 등)만
 * 정의하고 기간을 정하지 않는다. 30일은 통상 1개월이라는 실무 관행을 제품이 채택한 값일 뿐,
 * 법정 수치가 아니므로 근거로 인용하지 말 것.
 */
export const DEFAULT_PREP_DAYS = 30
/**
 * 정리기간 기본값(일) — 가이드라인 p17(PERIOD_COMPONENTS 'cleanup')이 '준공 전 1개월 범위'
 * 라고 문언으로 적은 것을 따른 값. 준비기간과 달리 원문에 기간 표현이 있다.
 */
export const DEFAULT_CLEANUP_DAYS = 30
/** 적정 허용 편차(±%) 기본값 — 제품 기본 허용치(법정 허용치 아님). */
export const DEFAULT_TOLERANCE_PCT = 15

/** 공사기간 4대 구성요소(일). 법정 산정식의 항. */
export interface ConstructionPeriodParts {
  /** 준비기간 */
  prep: number
  /** 비작업일수(법정공휴일+기상 공사불능일, 중복 제외) */
  nonWork: number
  /** 작업일수(= 선후행망 최장경로 '경과 작업공기'. 병렬 공정을 더한 작업량 합계가 아니다) */
  work: number
  /** 정리기간 */
  cleanup: number
}

/**
 * 총공사기간 = 준비기간 + 비작업일수 + 작업일수 + 정리기간 (가이드라인 p17).
 * 네 항을 그대로 더하는, 법정 공식의 코드 표현. 음수 항은 0으로 보정.
 */
export function computeConstructionPeriod(parts: ConstructionPeriodParts): number {
  const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)
  return clamp(parts.prep) + clamp(parts.nonWork) + clamp(parts.work) + clamp(parts.cleanup)
}

/**
 * 이론 작업일수 = 작업수량 ÷ 1일 작업량 (또는 사이클형: 수량 × 단위당소요일).
 * 올림(공정 계획은 정수 일). 입력이 없거나 0 이하면 null.
 */
export function theoreticalWorkdays(
  quantity: number | undefined,
  rate?: StandardRate,
): number | null {
  if (rate == null || quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null
  if (rate.dailyOutput != null && rate.dailyOutput > 0)
    return Math.ceil(quantity / rate.dailyOutput)
  if (rate.daysPerUnit != null && rate.daysPerUnit > 0)
    return Math.ceil(quantity * rate.daysPerUnit)
  return null
}

export type AdequacyVerdict = '적정' | '과소' | '과다' | '판정불가'

export interface AdequacyResult {
  verdict: AdequacyVerdict
  /** 산정식 이론 작업일수(물량÷생산성). 계산 불가 시 null. */
  theoretical: number | null
  /** 현재 공정에 부여된 기간(일). */
  current: number
  /** (현재−이론)/이론 ×100. 양수=과다(여유), 음수=과소(부족). null=계산 불가. */
  deviationPct: number | null
  /** ② 표준 템플릿 대비 (현재−표준)/표준 ×100. 표준공기 없으면 null. */
  standardDeviationPct: number | null
  /** 이 공정이 법정 산정식(주공정선 한정)의 적용 대상인가. */
  criticalApplicable: boolean
  /** 사용된 표준 일작업량(있으면). */
  rate?: StandardRate
  /** 단위(치수) 검사 결과 — 'mismatch' 면 산정식 판정을 하지 않는다(engine/units.ts). */
  unitCheck: UnitCheck
  /** 이 판정에 적용된 허용 편차(±%). 제품 기본값(DEFAULT_TOLERANCE_PCT) 또는 사용자 지정. */
  tolerancePct: number
  /** 근거 문자열(품셈 항목·출처 페이지·법정 조문·공식). 근거 팝업/Inspector에 그대로 노출. */
  basis: string[]
  /** 화면에 그대로 띄우는 법정 공식. */
  formula: string
}

export interface AdequacyOptions {
  /** 적정 허용 편차(±%). 기본 15%(제품 기본값 — 법정 수치 아님). 이 범위 밖이면 과소/과다. */
  tolerancePct?: number
  /** ② 표준 템플릿(시설물 유형)상 같은 이름 공정의 표준 공기(일). 표준대비 판정에 사용. */
  standardDuration?: number
  /**
   * 단위 환산계수 — **호출자가 출처와 함께 명시 전달**할 때만 적용한다(내장 계수 없음).
   * 예: { from: 'ton', to: '㎥', factor: 1.6, source: '설계기준 단위중량' }.
   */
  unitConversion?: UnitConversion
}

/**
 * 산정에 실제로 쓸 물량(표준 단위 기준). 단위 불일치인데 근거 있는 환산이 없으면 null —
 * **여기서 임의 환산을 하지 않는 것이 이 함수의 존재 이유다.**
 */
function usableQuantity(
  quantity: number | undefined,
  check: UnitCheck,
  conv?: UnitConversion,
): { qty: number | null; note?: string } {
  if (quantity == null || !Number.isFinite(quantity)) return { qty: null }
  if (check.status !== 'mismatch') return { qty: quantity }
  if (conversionApplies(conv, check) && conv) {
    const qty = quantity * conv.factor
    return {
      qty,
      note:
        `단위 환산 · ${quantity}${check.taskUnit ?? ''} × ${conv.factor} = ` +
        `${Math.round(qty * 100) / 100}${check.rateUnit ?? ''} (출처: ${conv.source})`,
    }
  }
  return { qty: null }
}

/**
 * 한 공정의 공기 적정성 판정(4방식 통합의 결정론 부분).
 *  ① 산정식  : 이론 작업일수(물량÷1일작업량) vs 현 공기 → 편차·판정
 *  ② 표준대비: 표준 템플릿 공기(standardDuration)와 직접 비교 → 편차·판정 승격
 *  ③ 법적준수: 산정기준 고시·조문·공식·주공정선 한정 원칙을 근거로 명시(프로젝트 총량은 assessConstructionPeriod)
 *  ④ LLM     : 위 근거를 컨텍스트로 서술(엔진 밖 — Part A 경로에서 소비)
 */
export function assessTaskAdequacy(task: Task, opts: AdequacyOptions = {}): AdequacyResult {
  const tol = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT
  const rate = findStandardRate(task.workCode)
  // 단위 게이트 — 물량÷생산성은 두 단위가 같을 때에만 성립한다(engine/units.ts).
  const unitCheck = compareUnits(task.unit, rate?.unit)
  const { qty, note: convNote } = usableQuantity(task.quantity, unitCheck, opts.unitConversion)
  /** 단위 불일치 + 근거 있는 환산 없음 → 산정식·표준대비 모두 판정하지 않는다. */
  const unitBlocked = unitCheck.status === 'mismatch' && qty == null
  const theoretical = unitBlocked ? null : theoreticalWorkdays(qty ?? undefined, rate)
  const current = task.duration
  // 법정 산정식은 주공정선 상 공종에 한정(가이드라인 p27). critical 미계산(undefined) 시엔 일단 대상으로 본다.
  const criticalApplicable = task.critical !== false

  const basis: string[] = []
  basis.push(`법정 공식 · ${CONSTRUCTION_PERIOD_FORMULA}`)
  basis.push(`작업일수 산정 · ${WORKDAYS_FORMULA}`)

  let verdict: AdequacyVerdict = '판정불가'
  let deviationPct: number | null = null

  // ① 산정식(물량÷일작업량)
  if (theoretical != null && current > 0) {
    deviationPct = Math.round(((current - theoretical) / theoretical) * 1000) / 10
    if (deviationPct < -tol) verdict = '과소'
    else if (deviationPct > tol) verdict = '과다'
    else verdict = '적정'
  }

  if (rate) {
    basis.push(
      `표준 일작업량 · ${rate.work} ${rate.subwork} = ${rateOutputLabel(rate)} ` +
        `(${LEGAL_BASIS.guideline} PDF p${rate.page}, 개정 ${rateRevision(rate)})`,
    )
    if (rate.procurementCode) basis.push(`조달청 세부공종분류코드 · ${rate.procurementCode}`)
    if (convNote) basis.push(convNote)
    if (qty != null && theoretical != null)
      basis.push(`이론 작업일수 = ${qty}${rate.unit} ÷ 표준생산성 = 약 ${theoretical}일`)
    // 단위 검사 결과는 항상 근거에 남긴다(불일치는 ⚠, 미입력은 가정 표기).
    if (unitBlocked) basis.push(`⚠ ${unitCheck.message ?? '단위 불일치 — 판정불가'}`)
    else if (unitCheck.message) basis.push(unitCheck.message)
  } else if (task.workCode) {
    basis.push('표준 일작업량 DB에 해당 공종코드가 없음 — 커버리지 미구축(발주청 경험치 필요).')
  } else {
    basis.push(
      '물량·공종코드 미입력 — 산정식 판정 불가(물량과 표준 일작업량을 연결하면 자동 판정).',
    )
  }

  // ② 표준 템플릿 대비(시설물 유형 표준 공정 duration 과 직접 비교)
  let standardDeviationPct: number | null = null
  const std = opts.standardDuration
  if (std != null && std > 0 && current > 0) {
    standardDeviationPct = Math.round(((current - std) / std) * 1000) / 10
    basis.push(
      `표준 템플릿 대비 · 현 ${current}일 vs 표준 ${std}일 (${signPct(standardDeviationPct)})`,
    )
    // 산정식(①)으로 판정 못 했으면 표준대비(②)로 판정을 승격.
    // 단, 단위 불일치로 막힌 공정은 승격하지 않는다 — 물량이 틀린 채 '적정'이 나오면 안 된다.
    if (verdict === '판정불가' && !unitBlocked) {
      if (standardDeviationPct < -tol) verdict = '과소'
      else if (standardDeviationPct > tol) verdict = '과다'
      else verdict = '적정'
    }
  }

  basis.push(`허용 편차 ±${tol}% · 제품 기본 허용치(「산정기준」의 법정 수치가 아님).`)
  basis.push(`근거 법령 · ${LEGAL_BASIS.notice} / ${LEGAL_BASIS.act}`)
  if (!criticalApplicable)
    basis.push(
      '※ 이 공정은 주공정선(critical path)이 아니므로 법정 산정식의 직접 적용 대상은 아니다(참고용).',
    )

  return {
    verdict,
    theoretical,
    current,
    deviationPct,
    standardDeviationPct,
    criticalApplicable,
    rate,
    unitCheck,
    tolerancePct: tol,
    basis,
    formula: CONSTRUCTION_PERIOD_FORMULA,
  }
}

export interface AssessTasksOptions {
  tolerancePct?: number
  /** 공정명(정규화) → 표준 템플릿 공기(일) 색인. facilities.ts 의 standardDurationIndex() 로 생성. */
  standardDurationByName?: Map<string, number | null>
}

/**
 * 프로젝트 전체 공정의 적정성을 CPM 결과와 함께 판정(검토서 아키텍처: 입력=CPM 결과).
 * computeSchedule 로 주공정(critical)을 계산해 각 공정에 반영하므로, 판정에 '주공정선 한정'
 * 원칙(criticalApplicable)이 실제 CPM 결과 기반으로 적용된다. 마일스톤은 제외.
 */
export function assessTasks(
  tasks: Task[],
  links: Link[],
  opts: AssessTasksOptions = {},
): Map<ID, AdequacyResult> {
  const scheduled = computeSchedule(tasks, links).tasks
  const stdIdx = opts.standardDurationByName
  const out = new Map<ID, AdequacyResult>()
  for (const t of scheduled) {
    if (t.isMilestone) continue
    const std = stdIdx?.get(normWorkName(t.name))
    out.set(
      t.id,
      assessTaskAdequacy(t, {
        tolerancePct: opts.tolerancePct,
        standardDuration: typeof std === 'number' ? std : undefined,
      }),
    )
  }
  return out
}

/** 비작업일수 내역(일). */
export interface NonWorkBreakdown {
  /** 주말(토·일) 일수 — 실제 착수일 기준 달력에서 계산. */
  weekend: number
  /** 기상 공사불능일 — 우기(RainySeason) 밴드와 겹치는 평일에 (1−효율)을 적산. */
  weather: number
  /** 법정공휴일수(사용자 입력, 부록1 기준). 미입력 시 0. */
  holiday: number
  /**
   * 중복 차감 — 주말·기상 비작업일과 법정공휴일이 겹치는 일수.
   * 가이드라인 p19 의 C = A×B÷달력일수 **형태**를 빌리되, 원문의 A 는 '기상 작업불가일'만을
   * 가리킨다. 여기서는 주말까지 A 에 넣은 **제품 해석**이다(한국 공휴일은 상당수가 토·일에
   * 겹쳐, A 를 기상으로만 두면 이미 주말로 센 날을 공휴일로 한 번 더 세게 된다).
   */
  overlap: number
  /** 합계(주말+기상+공휴일−중복, 반올림·0 하한). */
  total: number
}

/** 산정 전제의 출처 — 사용자 입력인가, 제품 기본 가정값인가. */
export type AssumptionSource = 'user' | 'default'

/** 총공기 산정에 쓰인 전제 1건(값·출처·설명). 화면·검토요청서에 그대로 나열한다. */
export interface PeriodAssumption {
  key: 'prep' | 'cleanup' | 'holiday' | 'weather' | 'tolerance'
  label: string
  value: number
  source: AssumptionSource
  note: string
}

export interface ConstructionPeriodAssessment {
  parts: ConstructionPeriodParts
  /** computeConstructionPeriod(parts) — 법정 산정 총공사기간(일). */
  legalTotal: number
  /** 실제 공정표 달력 공기(projectEnd − projectStart). */
  actualSpan: number
  /** (실제−법정)/법정 ×100. 음수=실제가 법정 산정보다 짧음(과소), 양수=김(과다). */
  deviationPct: number | null
  verdict: AdequacyVerdict
  /** 주공정 공종 수. */
  criticalCount: number
  /** 그 중 물량÷생산성으로 이론작업일수를 산출한 공종 수(나머지는 현 공기로 근사). */
  workByQuantityCount: number
  /**
   * **작업량 합계**(일) — 주공정 공종 작업일수의 단순 총합. 병렬 공정도 그대로 더하므로
   * 소요 '작업량'이지 흘러가는 시간이 아니다. parts.work(경과 작업공기)와 혼동 금지.
   */
  workSum: number
  /**
   * **경과 작업공기**(일) — 선후행망 최장경로 길이(= parts.work). 병렬 공정은 겹쳐 세지
   * 않는다. 독립 10일 공정 2개면 workSum 20 · workSpan 10.
   */
  workSpan: number
  /** 단위 불일치로 물량 산정에서 제외한 주공정 공종 수(현 공기로 근사). */
  unitIssueCount: number
  /** 산정 전제 목록(준비·정리·공휴일·기상·허용편차)과 그 출처. */
  assumptions: PeriodAssumption[]
  /** 전제 중 하나라도 기본 가정값이면 true — 결과는 '가정 기반 참고값'이다. */
  assumed: boolean
  nonWork: NonWorkBreakdown
  basis: string[]
}

export interface ConstructionPeriodOptions {
  tasks: Task[]
  links: Link[]
  rainySeasons?: RainySeason[]
  /** ISO 착수일(day 0). 없으면 주말·기상 비작업일수는 계산하지 못하고 0으로 둔다. */
  startDate?: string
  /** 준비기간(일). 기본 30 — 제품 기본 가정값(가이드라인에 준비기간 일수 규정 없음). */
  prepDays?: number
  /** 정리기간(일). 기본 30(통상 1개월 — PERIOD_COMPONENTS cleanup 문언 '준공 전 1개월 범위'). */
  cleanupDays?: number
  /** 법정공휴일수(일) — 부록1(대상 연도)에서 입력. 미상이면 0(임의 생성 금지). */
  holidayDays?: number
  /** 기상 공사불능일수(일) — 관측통계 기반 값을 직접 입력하면 우기밴드 추정을 대체한다. */
  weatherDays?: number
  /** 적정 허용 편차(±%). 기본 15%(제품 기본값 — 법정 허용치 아님). */
  tolerancePct?: number
}

/**
 * **경과 작업공기**(일) — 선후행망(FS/SS/FF/SF·lag)을 따라 계산한 최장경로 길이.
 * 모든 공정의 시작을 0으로 정규화한 뒤 기존 reschedule(순수 함수)로 앞당겨 붙여, 병렬
 * 경로를 더하지 않고 실제로 흘러가는 시간만 센다. 기간은 물량기반 이론작업일수를 우선
 * 쓰고(없으면 현 공기), 마일스톤은 0일로 둔다. 새 알고리즘·달력 개념은 도입하지 않는다.
 */
export function networkWorkSpan(tasks: Task[], links: Link[]): number {
  if (tasks.length === 0) return 0
  const normalized = tasks.map((t) => {
    const rate = findStandardRate(t.workCode)
    const check = compareUnits(t.unit, rate?.unit)
    const { qty } = usableQuantity(t.quantity, check)
    const tw = t.isMilestone ? 0 : theoreticalWorkdays(qty ?? undefined, rate)
    return {
      ...t,
      start: 0,
      es: undefined,
      ef: undefined,
      duration: t.isMilestone ? 0 : (tw ?? t.duration),
    }
  })
  const { tasks: packed } = reschedule(normalized, links)
  const s = Math.min(...packed.map((t) => t.es ?? t.start))
  const e = Math.max(...packed.map((t) => t.ef ?? t.start + t.duration))
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0
  return Math.max(0, Math.round(e - s))
}

/** 날짜가 우기 밴드 안인가(월·일 기준, 연 경계 wrap 지원). */
function inRainyBand(date: Date, band: RainySeason): boolean {
  const cur = (date.getMonth() + 1) * 100 + date.getDate()
  const s = band.startMonth * 100 + band.startDay
  const e = band.endMonth * 100 + band.endDay
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e
}

/**
 * ③ 법적준수 — 프로젝트 총공사기간을 법정 4대 구성요소로 산정하고 실제 공기와 비교.
 *   작업량 합계(workSum) = Σ(주공정 공종 이론작업일수) — 병렬 포함 단순 총합(참고 지표)
 *   작업일수(parts.work = workSpan) = 선후행망 최장경로 = **경과 작업공기**
 *   비작업일수 = 주말(달력) + 기상 공사불능일(우기 밴드 또는 입력) + 법정공휴일수 − 중복
 *   총공사기간 = 준비 + 비작업 + 작업 + 정리  (computeConstructionPeriod)
 * 주말·우기밴드·효율은 실제 입력에서 결정론으로 계산 — 값을 지어내지 않는다. 준비·정리·
 * 공휴일·기상·허용편차 중 **입력되지 않은 항목은 기본 가정값**으로 계산하고, 그 사실을
 * assumptions/assumed 로 돌려준다(소비자는 '가정 기반 참고값'으로 표기해야 한다).
 */
export function assessConstructionPeriod(
  opts: ConstructionPeriodOptions,
): ConstructionPeriodAssessment {
  const tol = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT
  const prep = opts.prepDays ?? DEFAULT_PREP_DAYS
  const cleanup = opts.cleanupDays ?? DEFAULT_CLEANUP_DAYS
  const holiday = opts.holidayDays ?? 0

  const sched = computeSchedule(opts.tasks, opts.links)
  const critical = sched.tasks.filter((t) => t.critical && !t.isMilestone)

  // ── 작업량 합계(주공정 한정) — 병렬 포함 단순 총합. 경과 시간이 아니다. ──
  let workSum = 0
  let byQuantity = 0
  let unitIssueCount = 0
  for (const t of critical) {
    const rate = findStandardRate(t.workCode)
    const check = compareUnits(t.unit, rate?.unit)
    const { qty } = usableQuantity(t.quantity, check)
    if (check.status === 'mismatch' && qty == null) unitIssueCount++
    const tw = qty != null ? theoreticalWorkdays(qty, rate) : null
    if (tw != null) {
      workSum += tw
      byQuantity++
    } else {
      workSum += t.duration // 물량 미입력·단위 불일치분은 현 공기로 근사
    }
  }
  // ── 경과 작업공기 — 선후행망 최장경로(병렬을 더하지 않는다) ──
  const workSpan = networkWorkSpan(opts.tasks, opts.links)

  // ── 실제 공기(달력) ──
  const startDay = Number.isFinite(sched.projectStartDay) ? Math.floor(sched.projectStartDay) : 0
  const endDay = Number.isFinite(sched.projectEndDay) ? Math.ceil(sched.projectEndDay) : 0
  const actualSpan = Math.max(0, endDay - startDay)

  // ── 비작업일수(주말 + 기상) : 착수일이 있어야 달력 계산 가능 ──
  let weekend = 0
  let weather = 0
  const bands = opts.rainySeasons ?? []
  // 기상 공사불능일수를 사용자가 직접 입력했으면 우기밴드 추정을 쓰지 않는다(입력 우선).
  const weatherGiven = opts.weatherDays != null && Number.isFinite(opts.weatherDays)
  if (opts.startDate && actualSpan > 0) {
    for (let d = startDay; d < endDay; d++) {
      const date = dayToDate(opts.startDate, d)
      const dow = date.getDay()
      if (dow === 0 || dow === 6) {
        weekend++
        continue // 주말은 이미 비작업 — 기상 중복 계상 방지
      }
      if (weatherGiven) continue
      for (const b of bands) {
        if (inRainyBand(date, b)) {
          const eff = Number.isFinite(b.efficiency) ? Math.min(1, Math.max(0, b.efficiency)) : 1
          weather += 1 - eff
          break // 한 날은 한 번만 계상
        }
      }
    }
  }
  weather = weatherGiven ? Math.max(0, Math.round(opts.weatherDays as number)) : Math.round(weather)
  // 중복 차감 — C = A × B ÷ 달력일수. 식의 형태는 가이드라인 p19 를 따르지만, 원문의 A 는
  // **'기상 작업불가일'만**을 뜻한다. 아래에서 A 에 주말을 함께 넣는 것은 이 제품의 해석이며
  // 가이드라인이 정한 바가 아니다(한국 법정공휴일 상당수가 토·일과 겹쳐, 주말을 빼면 이미
  // 주말로 센 날을 공휴일로 이중 계상하게 된다). 근거 문자열에도 그대로 밝힌다.
  // 공휴일이 0이거나 달력 계산이 불가하면 0(중복 자체가 없다).
  const overlapRaw =
    actualSpan > 0 && holiday > 0 ? ((weekend + weather) * holiday) / actualSpan : 0
  const overlap = Math.min(Math.round(overlapRaw), weekend + weather, holiday)
  const nonWorkTotal = Math.max(0, weekend + weather + holiday - overlap)

  const parts: ConstructionPeriodParts = {
    prep,
    nonWork: nonWorkTotal,
    // 작업일수 항에는 **경과 작업공기**(최장경로)를 넣는다 — 병렬 공정을 더한 작업량 합계를
    // 넣으면 총공기가 부풀려진다(workSum 은 별도 필드로 함께 보고).
    work: workSpan,
    cleanup,
  }
  const legalTotal = computeConstructionPeriod(parts)

  let deviationPct: number | null = null
  let verdict: AdequacyVerdict = '판정불가'
  if (legalTotal > 0 && actualSpan > 0 && critical.length > 0) {
    deviationPct = Math.round(((actualSpan - legalTotal) / legalTotal) * 1000) / 10
    if (deviationPct < -tol) verdict = '과소'
    else if (deviationPct > tol) verdict = '과다'
    else verdict = '적정'
  }

  const prepDef = PERIOD_COMPONENTS.find((p) => p.key === 'prep')
  const cleanupDef = PERIOD_COMPONENTS.find((p) => p.key === 'cleanup')
  const nonWorkRule = NONWORK_FACTORS.find((f) => f.factor === '산정식')

  // ── 산정 전제(사용자 입력 vs 제품 기본 가정값) ──
  const assumptions: PeriodAssumption[] = [
    {
      key: 'prep',
      label: '준비기간',
      value: prep,
      source: opts.prepDays != null ? 'user' : 'default',
      note:
        opts.prepDays != null
          ? '사용자 입력'
          : '제품 기본 가정 30일(통상 1개월) — 가이드라인 p17 은 준비기간의 *내용*만 정의하고 기간을 정하지 않는다. 현장 조건 미확인.',
    },
    {
      key: 'cleanup',
      label: '정리기간',
      value: cleanup,
      source: opts.cleanupDays != null ? 'user' : 'default',
      note:
        opts.cleanupDays != null
          ? '사용자 입력'
          : "통상 1개월 가정 — 가이드라인 p17 정리기간 정의의 '준공 전 1개월 범위' 문언에 따름. 현장 조건 미확인.",
    },
    {
      key: 'holiday',
      label: '법정공휴일수',
      value: holiday,
      source: opts.holidayDays != null ? 'user' : 'default',
      note:
        opts.holidayDays != null
          ? '사용자 입력(부록1 대상연도 기준)'
          : '부록1(대상연도 법정공휴일수) 미입력 — 0일로 가정',
    },
    {
      key: 'weather',
      label: '기상 공사불능일수',
      value: weather,
      source: weatherGiven ? 'user' : 'default',
      note: weatherGiven
        ? '사용자 입력(기상 관측통계 기준)'
        : '우기밴드 × (1−효율) 추정 — 기상 관측통계 미반영',
    },
    {
      key: 'tolerance',
      label: '허용 편차(±%)',
      value: tol,
      source: opts.tolerancePct != null ? 'user' : 'default',
      note:
        opts.tolerancePct != null
          ? '사용자 입력'
          : '「산정기준」의 법정 허용치가 아닌 제품 기본 허용 편차',
    },
  ]
  const assumed = assumptions.some((a) => a.source === 'default')

  const basis: string[] = []
  if (assumed)
    basis.push(
      '※ 가정 기반 참고값 — 미입력 전제(' +
        assumptions
          .filter((a) => a.source === 'default')
          .map((a) => a.label)
          .join('·') +
        ')가 포함되어 확정 판정이 아닙니다.',
    )
  basis.push(`법정 공식 · ${CONSTRUCTION_PERIOD_FORMULA}`)
  basis.push(
    `산정 · 준비 ${prep} + 비작업 ${nonWorkTotal} + 작업 ${parts.work} + 정리 ${cleanup} = ${legalTotal}일 ` +
      `vs 실제 ${actualSpan}일 (${deviationPct != null ? signPct(deviationPct) : '판정불가'})`,
  )
  basis.push(
    `작업일수 · 주공정 ${critical.length}개 중 물량기반 ${byQuantity}개 산정` +
      (byQuantity < critical.length
        ? `, 나머지 ${critical.length - byQuantity}개는 현 공기로 근사(물량 입력 권장)`
        : ''),
  )
  basis.push(
    `작업량 합계 · 주공정 ${critical.length}개 작업일수 총합 ${workSum}일(병렬 포함) ` +
      `≠ 경과 작업공기 ${workSpan}일(선후행망 최장경로) — 총공기 산정에는 경과 작업공기를 쓴다.`,
  )
  if (unitIssueCount > 0)
    basis.push(
      `⚠ 단위 불일치 ${unitIssueCount}개 공종은 물량 산정에서 제외(현 공기로 근사) — 단위를 정정하세요.`,
    )
  basis.push(
    `비작업일수 · 주말 ${weekend} + 기상${weatherGiven ? '(입력)' : '(우기밴드)'} ${weather} + 법정공휴일 ${holiday}` +
      ` − 중복 ${overlap} = ${nonWorkTotal}일` +
      (opts.startDate ? '' : ' (착수일 미지정 — 주말·기상 미계산)') +
      (holiday === 0 ? ' · 법정공휴일수는 부록1(대상연도)에서 입력 필요' : ''),
  )
  basis.push(
    `비작업일수 중복 차감 · ${overlap}일 = (주말 ${weekend} + 기상 ${weather}) × 공휴일 ${holiday} ÷ 달력 ${actualSpan}일(반올림). ` +
      '식의 형태는 가이드라인 p19 의 C = A×B÷달력일수 를 따르되, **원문의 A 는 「기상 작업불가일」만**을 뜻한다. ' +
      '여기에 주말을 함께 넣은 것은 이 제품의 해석이며 가이드라인이 정한 바가 아니다(공휴일이 토·일과 겹치는 날의 이중 계상 방지).',
  )
  if (nonWorkRule)
    basis.push(`비작업일수 근거 · ${nonWorkRule.rule} (가이드라인 p${nonWorkRule.page})`)
  if (prepDef) basis.push(`준비기간 근거 · ${prepDef.def}`)
  if (cleanupDef) basis.push(`정리기간 근거 · ${cleanupDef.def}`)
  basis.push(`허용 편차 ±${tol}% · 제품 기본 허용치(「산정기준」의 법정 수치가 아님).`)
  basis.push(`근거 법령 · ${LEGAL_BASIS.notice} / ${LEGAL_BASIS.act}`)

  return {
    parts,
    legalTotal,
    actualSpan,
    deviationPct,
    verdict,
    criticalCount: critical.length,
    workByQuantityCount: byQuantity,
    workSum: Math.round(workSum),
    workSpan,
    unitIssueCount,
    assumptions,
    assumed,
    nonWork: { weekend, weather, holiday, overlap, total: nonWorkTotal },
    basis,
  }
}
