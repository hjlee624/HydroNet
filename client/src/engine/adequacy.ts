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

import { dayToDate } from './dates'
import { computeSchedule } from './scheduling'
import type { ID, Link, RainySeason, Task } from '../types/model'
import {
  CONSTRUCTION_PERIOD_FORMULA,
  LEGAL_BASIS,
  NONWORK_FACTORS,
  PERIOD_COMPONENTS,
  WORKDAYS_FORMULA,
  findStandardRate,
  rateOutputLabel,
  rateRevision,
  type StandardRate,
} from '../data/standardRates'

/** 공종명 정규화(마일스톤 ◆ 제거·공백 정리) — 표준 템플릿 색인 매칭용. */
export function normWorkName(s: string): string {
  return s.replace(/^◆\s*/, '').replace(/\s+/g, ' ').trim()
}

/** 편차%를 부호와 함께 표기('+12.3%' · '-8%' · '±0%'). */
function signPct(p: number): string {
  if (p === 0) return '±0%'
  return p > 0 ? `+${p}%` : `${p}%`
}

/** 공사기간 4대 구성요소(일). 법정 산정식의 항. */
export interface ConstructionPeriodParts {
  /** 준비기간 */
  prep: number
  /** 비작업일수(법정공휴일+기상 공사불능일, 중복 제외) */
  nonWork: number
  /** 작업일수(= Σ 주공정 공종 작업일수) */
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
export function theoreticalWorkdays(quantity: number | undefined, rate?: StandardRate): number | null {
  if (rate == null || quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null
  if (rate.dailyOutput != null && rate.dailyOutput > 0) return Math.ceil(quantity / rate.dailyOutput)
  if (rate.daysPerUnit != null && rate.daysPerUnit > 0) return Math.ceil(quantity * rate.daysPerUnit)
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
  /** 근거 문자열(품셈 항목·출처 페이지·법정 조문·공식). 근거 팝업/Inspector에 그대로 노출. */
  basis: string[]
  /** 화면에 그대로 띄우는 법정 공식. */
  formula: string
}

export interface AdequacyOptions {
  /** 적정 허용 편차(±%). 기본 15%. 이 범위 밖이면 과소/과다. */
  tolerancePct?: number
  /** ② 표준 템플릿(시설물 유형)상 같은 이름 공정의 표준 공기(일). 표준대비 판정에 사용. */
  standardDuration?: number
}

/**
 * 한 공정의 공기 적정성 판정(4방식 통합의 결정론 부분).
 *  ① 산정식  : 이론 작업일수(물량÷1일작업량) vs 현 공기 → 편차·판정
 *  ② 표준대비: 표준 템플릿 공기(standardDuration)와 직접 비교 → 편차·판정 승격
 *  ③ 법적준수: 산정기준 고시·조문·공식·주공정선 한정 원칙을 근거로 명시(프로젝트 총량은 assessConstructionPeriod)
 *  ④ LLM     : 위 근거를 컨텍스트로 서술(엔진 밖 — Part A 경로에서 소비)
 */
export function assessTaskAdequacy(task: Task, opts: AdequacyOptions = {}): AdequacyResult {
  const tol = opts.tolerancePct ?? 15
  const rate = findStandardRate(task.workCode)
  const theoretical = theoreticalWorkdays(task.quantity, rate)
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
    if (task.quantity != null && theoretical != null)
      basis.push(`이론 작업일수 = ${task.quantity}${rate.unit} ÷ 표준생산성 = 약 ${theoretical}일`)
  } else if (task.workCode) {
    basis.push('표준 일작업량 DB에 해당 공종코드가 없음 — 커버리지 미구축(발주청 경험치 필요).')
  } else {
    basis.push('물량·공종코드 미입력 — 산정식 판정 불가(물량과 표준 일작업량을 연결하면 자동 판정).')
  }

  // ② 표준 템플릿 대비(시설물 유형 표준 공정 duration 과 직접 비교)
  let standardDeviationPct: number | null = null
  const std = opts.standardDuration
  if (std != null && std > 0 && current > 0) {
    standardDeviationPct = Math.round(((current - std) / std) * 1000) / 10
    basis.push(`표준 템플릿 대비 · 현 ${current}일 vs 표준 ${std}일 (${signPct(standardDeviationPct)})`)
    // 산정식(①)으로 판정 못 했으면 표준대비(②)로 판정을 승격
    if (verdict === '판정불가') {
      if (standardDeviationPct < -tol) verdict = '과소'
      else if (standardDeviationPct > tol) verdict = '과다'
      else verdict = '적정'
    }
  }

  basis.push(`근거 법령 · ${LEGAL_BASIS.notice} / ${LEGAL_BASIS.act}`)
  if (!criticalApplicable)
    basis.push('※ 이 공정은 주공정선(critical path)이 아니므로 법정 산정식의 직접 적용 대상은 아니다(참고용).')

  return {
    verdict,
    theoretical,
    current,
    deviationPct,
    standardDeviationPct,
    criticalApplicable,
    rate,
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
  /** 합계(반올림). */
  total: number
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
  nonWork: NonWorkBreakdown
  basis: string[]
}

export interface ConstructionPeriodOptions {
  tasks: Task[]
  links: Link[]
  rainySeasons?: RainySeason[]
  /** ISO 착수일(day 0). 없으면 주말·기상 비작업일수는 계산하지 못하고 0으로 둔다. */
  startDate?: string
  /** 준비기간(일). 기본 30(통상 1개월, PERIOD_COMPONENTS prep). */
  prepDays?: number
  /** 정리기간(일). 기본 30(통상 1개월, PERIOD_COMPONENTS cleanup). */
  cleanupDays?: number
  /** 법정공휴일수(일) — 부록1(대상 연도)에서 입력. 미상이면 0(임의 생성 금지). */
  holidayDays?: number
  /** 적정 허용 편차(±%). 기본 15%. */
  tolerancePct?: number
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
 *   작업일수 = Σ(주공정 공종 이론작업일수(물량÷생산성); 물량 미입력분은 현 공기로 근사)
 *   비작업일수 = 주말(달력) + 기상 공사불능일(우기 밴드 × (1−효율)) + 법정공휴일수(입력)
 *   총공사기간 = 준비 + 비작업 + 작업 + 정리  (computeConstructionPeriod)
 * 주말·우기밴드·효율은 실제 입력에서 결정론으로 계산 — 값을 지어내지 않는다.
 */
export function assessConstructionPeriod(opts: ConstructionPeriodOptions): ConstructionPeriodAssessment {
  const tol = opts.tolerancePct ?? 15
  const prep = opts.prepDays ?? 30
  const cleanup = opts.cleanupDays ?? 30
  const holiday = opts.holidayDays ?? 0

  const sched = computeSchedule(opts.tasks, opts.links)
  const critical = sched.tasks.filter((t) => t.critical && !t.isMilestone)

  // ── 작업일수(주공정 한정) ──
  let work = 0
  let byQuantity = 0
  for (const t of critical) {
    const rate = findStandardRate(t.workCode)
    const tw = theoreticalWorkdays(t.quantity, rate)
    if (tw != null) {
      work += tw
      byQuantity++
    } else {
      work += t.duration // 물량 미입력분은 현 공기로 근사
    }
  }

  // ── 실제 공기(달력) ──
  const startDay = Number.isFinite(sched.projectStartDay) ? Math.floor(sched.projectStartDay) : 0
  const endDay = Number.isFinite(sched.projectEndDay) ? Math.ceil(sched.projectEndDay) : 0
  const actualSpan = Math.max(0, endDay - startDay)

  // ── 비작업일수(주말 + 기상) : 착수일이 있어야 달력 계산 가능 ──
  let weekend = 0
  let weather = 0
  const bands = opts.rainySeasons ?? []
  if (opts.startDate && actualSpan > 0) {
    for (let d = startDay; d < endDay; d++) {
      const date = dayToDate(opts.startDate, d)
      const dow = date.getDay()
      if (dow === 0 || dow === 6) {
        weekend++
        continue // 주말은 이미 비작업 — 기상 중복 계상 방지
      }
      for (const b of bands) {
        if (inRainyBand(date, b)) {
          const eff = Number.isFinite(b.efficiency) ? Math.min(1, Math.max(0, b.efficiency)) : 1
          weather += 1 - eff
          break // 한 날은 한 번만 계상
        }
      }
    }
  }
  weather = Math.round(weather)
  const nonWorkTotal = weekend + weather + holiday

  const parts: ConstructionPeriodParts = {
    prep,
    nonWork: nonWorkTotal,
    work: Math.round(work),
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

  const basis: string[] = []
  basis.push(`법정 공식 · ${CONSTRUCTION_PERIOD_FORMULA}`)
  basis.push(
    `산정 · 준비 ${prep} + 비작업 ${nonWorkTotal} + 작업 ${parts.work} + 정리 ${cleanup} = ${legalTotal}일 ` +
      `vs 실제 ${actualSpan}일 (${deviationPct != null ? signPct(deviationPct) : '판정불가'})`,
  )
  basis.push(
    `작업일수 · 주공정 ${critical.length}개 중 물량기반 ${byQuantity}개 산정` +
      (byQuantity < critical.length ? `, 나머지 ${critical.length - byQuantity}개는 현 공기로 근사(물량 입력 권장)` : ''),
  )
  basis.push(
    `비작업일수 · 주말 ${weekend} + 기상(우기밴드) ${weather} + 법정공휴일 ${holiday}` +
      (opts.startDate ? '' : ' (착수일 미지정 — 주말·기상 미계산)') +
      (holiday === 0 ? ' · 법정공휴일수는 부록1(대상연도)에서 입력 필요' : ''),
  )
  if (nonWorkRule) basis.push(`비작업일수 근거 · ${nonWorkRule.rule} (가이드라인 p${nonWorkRule.page})`)
  if (prepDef) basis.push(`준비기간 근거 · ${prepDef.def}`)
  if (cleanupDef) basis.push(`정리기간 근거 · ${cleanupDef.def}`)
  basis.push(`근거 법령 · ${LEGAL_BASIS.notice} / ${LEGAL_BASIS.act}`)

  return {
    parts,
    legalTotal,
    actualSpan,
    deviationPct,
    verdict,
    criticalCount: critical.length,
    workByQuantityCount: byQuantity,
    nonWork: { weekend, weather, holiday, total: nonWorkTotal },
    basis,
  }
}
