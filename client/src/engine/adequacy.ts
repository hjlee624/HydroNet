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
// 뉴로-심볼릭 경계: ①산정식 ②표준대비 ③법적준수 는 이 엔진(결정론)이 진실을 계산하고,
// ④LLM 은 이 근거를 받아 서술·제안만 한다(엔진이 산정·날짜·주공정의 유일 진실).
// ─────────────────────────────────────────────────────────────────────────────

import type { Task } from '../types/model'
import {
  CONSTRUCTION_PERIOD_FORMULA,
  LEGAL_BASIS,
  WORKDAYS_FORMULA,
  findStandardRate,
  type StandardRate,
} from '../data/standardRates'

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
}

/**
 * 한 공정의 공기 적정성 판정(4방식 통합의 결정론 부분).
 *  ① 산정식  : 이론 작업일수(물량÷1일작업량) vs 현 공기 → 편차·판정
 *  ② 표준대비: 표준 일작업량(부록4) 출처를 근거로 제시(범위 비교의 기반)
 *  ③ 법적준수: 산정기준 고시·조문·공식·주공정선 한정 원칙을 근거로 명시
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

  if (theoretical != null && current > 0) {
    deviationPct = Math.round(((current - theoretical) / theoretical) * 1000) / 10
    if (deviationPct < -tol) verdict = '과소'
    else if (deviationPct > tol) verdict = '과다'
    else verdict = '적정'
  }

  if (rate) {
    const outputLabel =
      rate.dailyOutput != null ? `${rate.dailyOutput}${rate.unit}/일` : `${rate.daysPerUnit}일/${rate.unit}`
    basis.push(`표준 일작업량 · ${rate.work} ${rate.subwork} = ${outputLabel} (${LEGAL_BASIS.guideline} PDF p${rate.page})`)
    if (task.quantity != null && theoretical != null)
      basis.push(`이론 작업일수 = ${task.quantity}${rate.unit} ÷ 표준생산성 = 약 ${theoretical}일`)
  } else if (task.workCode) {
    basis.push('표준 일작업량 DB에 해당 공종코드가 없음 — 커버리지 미구축(발주청 경험치 필요).')
  } else {
    basis.push('물량·공종코드 미입력 — 산정식 판정 불가(물량과 표준 일작업량을 연결하면 자동 판정).')
  }

  basis.push(`근거 법령 · ${LEGAL_BASIS.notice} / ${LEGAL_BASIS.act}`)
  if (!criticalApplicable)
    basis.push('※ 이 공정은 주공정선(critical path)이 아니므로 법정 산정식의 직접 적용 대상은 아니다(참고용).')

  return { verdict, theoretical, current, deviationPct, criticalApplicable, rate, basis, formula: CONSTRUCTION_PERIOD_FORMULA }
}
