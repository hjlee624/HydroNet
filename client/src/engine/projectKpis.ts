// ─────────────────────────────────────────────────────────────────────────────
// projectKpis — 건설사업관리 대시보드·진척·보고서 공용 단일 KPI 셀렉터(순수 함수).
//
// 옛 HydroNET engine/kpis.ts 를 Sequence(공정표 + Project.modules 기록형 모듈)에 맞춰 이식.
// 일정(schedule)은 Sequence 데이터에서, 진척(progress)은 Task.progress에서, 원가(cost)·공사비(boq)·
// EVM·모듈경보는 Project.modules 에서 파생한다. 대시보드·ProgressModule·(향후)보고서가 모두 이
// 하나의 셀렉터를 useMemo(()=>projectKpis(project),[project])로 구독 → 세 화면의 산식이 발산하지 않는다.
//
// 단위: cost는 천원, boq는 원. EVM은 cost 도메인(천원)에서 계산하며 boq와 절대 합산하지 않는다.
// computeSchedule을 내부에서 돌려 es/ef/critical을 스스로 채우므로 입력이 pre-schedule여도 안전.
// ─────────────────────────────────────────────────────────────────────────────

import type { Baseline, Category, ID, ModuleRecord, Project, Task } from '../types/model'
import { dateToDay, toISO } from './dates'
import { computeSchedule } from './scheduling'

/** 지연 공정 임계값(%p): 실적 − 계획 ≤ 이 값이면 '지연 공정'. 세 화면 공유. */
export const BEHIND_THRESHOLD = -10
/**
 * **사업 전체(누계) 지연 경보 임계값(%p)** — BEHIND_THRESHOLD 는 공정 1건 단위 규칙이라
 * "개별 공정은 다 −8%p 인데 사업 전체가 −8%p" 인 상황을 아무도 경보하지 않았다. 기간가중
 * 누계 실적 − 누계 계획 ≤ 이 값이면 사업 단위 경보를 올린다(개별 지연 공정 경보와 별개).
 * 값이 더 엄격한(작은 절댓값) 이유: 누계는 여러 공정이 상쇄된 뒤의 수치라 같은 %p 라도 무겁다.
 */
export const CUMULATIVE_BEHIND_THRESHOLD = -5
/** 주간 집계 창(일) — '지난 7일 / 다음 7일'. */
const WEEK_DAYS = 7

export const clampPct = (n: number): number => Math.max(0, Math.min(100, n))
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const finiteOr = (a: number | undefined, b: number): number =>
  typeof a === 'number' && Number.isFinite(a) ? a : b

/** 너그러운 숫자 파싱 — 천단위 구분기호·공백 제거, NaN→0(모듈 입력값은 항상 string). */
export const toNum = (s: unknown): number => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── 반환 타입 ────────────────────────────────────────────────────────────────
export interface UpcomingMilestone {
  id: ID
  name: string
  startDay: number
  dMinus: number
  critical: boolean
}
export interface SheetSummary {
  id: string
  name: string
  role: string
  active: boolean
  activities: number
  milestones: number
  durationDays: number
}
export type ScheduleStatus = 'empty' | 'not-started' | 'in-progress' | 'overdue'
export interface ScheduleKpis {
  hasData: boolean
  status: ScheduleStatus
  startDay: number
  endDay: number
  durationDays: number
  months: number
  activities: number
  milestoneCount: number
  criticalCount: number
  rainyCount: number
  linkCount: number
  elapsedPct: number
  overdueMilestones: number
  imminentMilestones: number
  upcoming: UpcomingMilestone[]
}
export interface ProgressRow {
  id: ID
  name: string
  categoryId: ID
  duration: number
  plannedPct: number
  actualPct: number
  deltaPct: number
  critical: boolean
  /** 공정 담당자(Task.owner). 주간 공정회의 자료의 책임자 열. */
  owner?: string
  /** 실적 착수일 ISO(미착수면 undefined). */
  actualStart?: string
  /** 실적 완료일 ISO(미완료면 undefined). */
  actualFinish?: string
  /** 계획 착수일(사업 시작 기준 day offset, es 우선). */
  plannedStartDay: number
  /** 계획 종료일(day offset, ef 우선). */
  plannedFinishDay: number
}
export interface ProgressKpis {
  plannedPct: number
  actualPct: number
  deltaPct: number
  behindCount: number
  doneCount: number
  activityCount: number
  /** 계획 착수일이 지났는데 실적 착수일도 없고 진척도 0인 공정 수(미착수 초과). */
  notStartedButDue: number
  /** 계획 종료일이 지났는데 실적 완료일도 없고 진척<100 인 공정 수(미완료 초과). */
  overdueFinish: number
  rows: ProgressRow[]
}
/** 단위 = 천원. */
export interface CostKpis {
  hasCost: boolean
  budget: number
  spent: number
  balance: number
  burnPct: number
  itemCount: number
}
/** 단위 = 원(cost와 절대 합산 금지). */
export interface BoqKpis {
  hasBoq: boolean
  total: number
  itemCount: number
}
/** 공사비(boq 원→천원 환산) ÷ 공사예산(cost 천원). 합산이 아닌 커버리지 비율. */
export interface CoverageKpi {
  available: boolean
  pct: number
  baseLabel: string
}
/** EVM — 금액(bac/pv/ev/ac/sv/cv/eac)은 천원, spi/cpi는 무차원. costAvailable=false면 금액 EVM 무효. */
export interface EvmKpis {
  costAvailable: boolean
  scheduleAvailable: boolean
  bac: number
  pv: number
  ev: number
  ac: number
  sv: number
  cv: number
  spi: number
  cpi: number
  eac: number
  vac: number
}
export type AlertSeverity = 'info' | 'warn' | 'danger'
export interface ModuleAlert {
  module: string
  icon: string
  label: string
  text: string
  count: number
  severity: AlertSeverity
}
export interface BaselineDrift {
  capturedAt: string
  asOf: string
  finishDriftDays: number
  startDriftDays: number
  slippedCount: number
  trackedCount: number
}
export interface ProjectKpis {
  todayDay: number
  schedule: ScheduleKpis
  progress: ProgressKpis
  cost: CostKpis
  boq: BoqKpis
  coverage: CoverageKpi
  evm: EvmKpis
  alerts: ModuleAlert[]
  baseline: BaselineDrift | null
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function isVisible(t: Task, catById: Map<ID, Category>, project: Project): boolean {
  const c = catById.get(t.categoryId)
  return !!c && (project.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
}
const recs = (project: Project, id: string): ModuleRecord[] => project.modules?.[id] ?? []
const sumKey = (rows: ModuleRecord[], key: string): number =>
  rows.reduce((s, r) => s + toNum(r.values[key]), 0)
const countWhere = (rows: ModuleRecord[], key: string, vals: string[]): number =>
  rows.filter((r) => vals.includes(r.values[key])).length

// ── 본체 ─────────────────────────────────────────────────────────────────────
export function projectKpis(project: Project, asOf: Date = new Date()): ProjectKpis {
  const safeLinks = project.links.map((l) => (Number.isFinite(l.lag) ? l : { ...l, lag: 0 }))
  const scheduled = computeSchedule(project.tasks, safeLinks).tasks
  const catById = new Map(project.categories.map((c) => [c.id, c]))
  const vis = scheduled.filter((t) => isVisible(t, catById, project))
  const acts = vis.filter((t) => !t.isMilestone)
  const ms = vis.filter((t) => t.isMilestone)
  const todayDay = dateToDay(project.startDate, asOf)
  const mDay = (m: Task) => finiteOr(m.es, m.start)

  // ── schedule ──
  const starts = vis.map((t) => finiteOr(t.es, t.start))
  const ends = vis.map((t) => finiteOr(t.ef, t.start + t.duration))
  const startDay = starts.length ? Math.min(...starts) : 0
  const endDay = ends.length ? Math.max(...ends) : 0
  const durationDays = Math.max(0, endDay - startDay)
  const months = Math.round((durationDays / 30.44) * 10) / 10
  const elapsedPct =
    endDay > startDay ? Math.round(clamp01((todayDay - startDay) / (endDay - startDay)) * 100) : 0
  const upcoming: UpcomingMilestone[] = ms
    .filter((m) => mDay(m) >= todayDay)
    .sort((a, b) => mDay(a) - mDay(b))
    .slice(0, 6)
    .map((m) => ({
      id: m.id,
      name: m.name.replace(/^◆\s*/, ''),
      startDay: mDay(m),
      dMinus: mDay(m) - todayDay,
      critical: !!m.critical,
    }))
  const status: ScheduleStatus = !vis.length
    ? 'empty'
    : todayDay < startDay
      ? 'not-started'
      : todayDay > endDay
        ? 'overdue'
        : 'in-progress'
  const schedule: ScheduleKpis = {
    hasData: vis.length > 0,
    status,
    startDay,
    endDay,
    durationDays,
    months,
    activities: acts.length,
    milestoneCount: ms.length,
    criticalCount: vis.filter((t) => t.critical).length,
    rainyCount: project.rainySeasons.length,
    linkCount: project.links.length,
    elapsedPct,
    overdueMilestones: ms.filter((m) => mDay(m) < todayDay).length,
    imminentMilestones: upcoming.filter((m) => m.dMinus >= 0 && m.dMinus <= 7).length,
    upcoming,
  }

  // ── progress (기간 가중) ──
  const rows: ProgressRow[] = acts.map((t) => {
    const start = finiteOr(t.es, t.start)
    const dur = Math.max(1, t.duration)
    const plannedPct = clampPct(((todayDay - start) / dur) * 100)
    const actualPct = clampPct(t.progress ?? 0)
    return {
      id: t.id,
      name: t.name,
      categoryId: t.categoryId,
      duration: t.duration,
      plannedPct,
      actualPct,
      deltaPct: actualPct - plannedPct,
      critical: !!t.critical,
      ...(t.owner ? { owner: t.owner } : {}),
      ...(t.actualStart ? { actualStart: t.actualStart } : {}),
      ...(t.actualFinish ? { actualFinish: t.actualFinish } : {}),
      plannedStartDay: start,
      plannedFinishDay: finiteOr(t.ef, t.start + t.duration),
    }
  })
  const totDur = rows.reduce((s, r) => s + Math.max(1, r.duration), 0) || 1
  const plannedAll = rows.reduce((s, r) => s + r.plannedPct * Math.max(1, r.duration), 0) / totDur
  const actualAll = rows.reduce((s, r) => s + r.actualPct * Math.max(1, r.duration), 0) / totDur
  const progress: ProgressKpis = {
    plannedPct: plannedAll,
    actualPct: actualAll,
    deltaPct: actualAll - plannedAll,
    behindCount: rows.filter((r) => r.deltaPct <= BEHIND_THRESHOLD).length,
    doneCount: rows.filter((r) => r.actualPct >= 100).length,
    activityCount: rows.length,
    // 실적 일자 기반 판정 — 진척%가 아니라 '착수/완료를 실제로 찍었는가'를 본다.
    notStartedButDue: rows.filter(
      (r) => r.plannedStartDay < todayDay && !r.actualStart && r.actualPct <= 0,
    ).length,
    overdueFinish: rows.filter(
      (r) => r.plannedFinishDay < todayDay && !r.actualFinish && r.actualPct < 100,
    ).length,
    rows,
  }

  // ── cost(천원) / boq(원) — 단위 분리 ──
  const costRecs = recs(project, 'cost')
  const budget = sumKey(costRecs, 'budget')
  const spent = sumKey(costRecs, 'spent')
  const cost: CostKpis = {
    hasCost: costRecs.length > 0,
    budget,
    spent,
    balance: budget - spent,
    burnPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    itemCount: costRecs.length,
  }
  const boqRecs = recs(project, 'boq')
  const boqTotal = boqRecs.reduce((s, r) => s + toNum(r.values.qty) * toNum(r.values.price), 0)
  const boq: BoqKpis = { hasBoq: boqRecs.length > 0, total: boqTotal, itemCount: boqRecs.length }

  // ── coverage: 공사비(boq 원→천원) vs 공사예산(cost 천원). ──
  const constructionBudget = costRecs
    .filter((r) => r.values.group === '공사비')
    .reduce((s, r) => s + toNum(r.values.budget), 0)
  const coverageBase = constructionBudget > 0 ? constructionBudget : budget
  const coverage: CoverageKpi = {
    available: coverageBase > 0 && boq.hasBoq,
    pct: coverageBase > 0 ? Math.round((boqTotal / 1000 / coverageBase) * 100) : 0,
    baseLabel: constructionBudget > 0 ? '공사비 예산' : '총 예산',
  }

  // ── EVM (천원). PV/EV는 기간가중 계획·실적%를 BAC에 곱함. ──
  const bac = budget
  const ev = bac * (actualAll / 100)
  const ac = spent
  const cpi = ac > 0 ? ev / ac : 0
  const evm: EvmKpis = {
    costAvailable: cost.hasCost,
    scheduleAvailable: plannedAll > 0,
    bac,
    pv: bac * (plannedAll / 100),
    ev,
    ac,
    sv: ev - bac * (plannedAll / 100),
    cv: ev - ac,
    spi: plannedAll > 0 ? actualAll / plannedAll : 0,
    cpi,
    eac: cpi > 0 ? bac / cpi : 0,
    vac: cpi > 0 ? bac - bac / cpi : 0,
  }

  // ── module alerts (records가 있는 모듈만, 건수>0) — 심각도순 정렬 ──
  const alerts: ModuleAlert[] = []
  if (progress.behindCount > 0)
    alerts.push({
      module: 'progress',
      icon: '📈',
      label: '지연 공정',
      text: `계획比 10%p↓ ${progress.behindCount}건`,
      count: progress.behindCount,
      severity: 'warn',
    })
  // 사업 전체(누계) 지연 — 개별 공정 경보와 별개다. 공정 하나하나는 임계 미만이어도 누계가
  // 계획에 뒤처지면 준공이 밀린다. 진행 중(계획 실적이 잡히는) 사업에서만 의미가 있다.
  if (
    progress.activityCount > 0 &&
    plannedAll > 0 &&
    progress.deltaPct <= CUMULATIVE_BEHIND_THRESHOLD
  )
    alerts.push({
      module: 'progress',
      icon: '🚩',
      label: '누계 지연',
      text: `사업 전체 계획比 ${Math.round(progress.deltaPct)}%p (임계 ${CUMULATIVE_BEHIND_THRESHOLD}%p)`,
      count: Math.abs(Math.round(progress.deltaPct)),
      severity: progress.deltaPct <= CUMULATIVE_BEHIND_THRESHOLD * 2 ? 'danger' : 'warn',
    })
  if (progress.overdueFinish > 0)
    alerts.push({
      module: 'progress',
      icon: '⏰',
      label: '미완료 초과',
      text: `계획 종료 경과 ${progress.overdueFinish}건`,
      count: progress.overdueFinish,
      severity: 'warn',
    })
  const riskOpen = countWhere(recs(project, 'risk'), 'status', ['열림', '진행'])
  if (riskOpen > 0)
    alerts.push({
      module: 'risk',
      icon: '⚠️',
      label: '리스크·이슈',
      text: `열림·진행 ${riskOpen}건`,
      count: riskOpen,
      severity: 'warn',
    })
  const qRecs = recs(project, 'quality')
  const ncr = countWhere(qRecs, 'type', ['부적합(NCR)'])
  const qFail = countWhere(qRecs, 'status', ['불합격'])
  if (ncr + qFail > 0)
    alerts.push({
      module: 'quality',
      icon: '✅',
      label: '품질·검측',
      text: `NCR ${ncr} · 불합격 ${qFail}`,
      count: ncr + qFail,
      severity: qFail > 0 ? 'danger' : 'warn',
    })
  const sRecs = recs(project, 'safety')
  const acc = countWhere(sRecs, 'type', ['사고/아차사고'])
  const high = countWhere(sRecs, 'level', ['상'])
  if (acc + high > 0)
    alerts.push({
      module: 'safety',
      icon: '🦺',
      label: '안전관리',
      text: `사고 ${acc} · 고위험 ${high}`,
      count: acc + high,
      severity: acc > 0 ? 'danger' : 'warn',
    })
  const permitPend = countWhere(recs(project, 'permit'), 'status', ['준비', '신청', '반려'])
  if (permitPend > 0)
    alerts.push({
      module: 'permit',
      icon: '📝',
      label: '인허가',
      text: `미승인 ${permitPend}건`,
      count: permitPend,
      severity: 'warn',
    })
  const docPend = countWhere(recs(project, 'document'), 'status', ['작성중', '제출', '반려'])
  if (docPend > 0)
    alerts.push({
      module: 'document',
      icon: '📄',
      label: '문서·도면',
      text: `미승인 ${docPend}건`,
      count: docPend,
      severity: 'info',
    })
  const commFail = countWhere(recs(project, 'commissioning'), 'result', ['불합격'])
  if (commFail > 0)
    alerts.push({
      module: 'commissioning',
      icon: '🏗️',
      label: '시운전',
      text: `불합격 ${commFail}건`,
      count: commFail,
      severity: 'danger',
    })
  const sevRank: Record<AlertSeverity, number> = { danger: 0, warn: 1, info: 2 }
  alerts.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.count - a.count)

  // ── baseline drift (없으면 null · 다른 시트 기준선은 표류 무의미해 가림) ──
  let baseline: BaselineDrift | null = null
  const baseSheetMatches =
    !project.baseline?.sheetId ||
    !project.activeSheet?.id ||
    project.baseline.sheetId === project.activeSheet.id
  if (project.baseline && baseSheetMatches) {
    const baseById = new Map(project.baseline.tasks.map((t) => [t.id, t]))
    let slipped = 0
    let tracked = 0
    for (const t of vis) {
      const b = baseById.get(t.id)
      if (!b) continue
      tracked++
      if (finiteOr(t.es, t.start) - b.start > 0) slipped++
    }
    baseline = {
      capturedAt: project.baseline.capturedAt,
      asOf: project.baseline.asOf,
      finishDriftDays: endDay - project.baseline.endDay,
      startDriftDays: startDay - project.baseline.startDay,
      slippedCount: slipped,
      trackedCount: tracked,
    }
  }

  return { todayDay, schedule, progress, cost, boq, coverage, evm, alerts, baseline }
}

// ── 확정본 비교(F13) ─────────────────────────────────────────────────────────
/** 기준선 대비 한 공정의 차이. 델타가 0인 공정은 행으로 만들지 않는다. */
export interface BaselineDiffRow {
  id: ID
  name: string
  baseStart: number
  baseDuration: number
  curStart: number
  curDuration: number
  /** 현재 시작 − 기준 시작(일). 양수 = 늦어짐. */
  startDeltaDays: number
  /** 현재 종료 − 기준 종료(일). 양수 = 늦어짐. */
  finishDeltaDays: number
}

/**
 * 확정본(기준선) 대비 현재 계획의 **공정별 날짜 차이**. 대시보드의 BaselineDrift 가 사업 단위
 * 요약(준공 표류·지연 건수)이라면 이쪽은 '어느 공정이 며칠 밀렸는가' 를 그대로 보여준다.
 * 기준선에 없는 공정(확정 후 신설)과 차이 0 인 공정은 제외한다.
 */
export function baselineDiff(project: Project, base: Baseline): BaselineDiffRow[] {
  const safeLinks = project.links.map((l) => (Number.isFinite(l.lag) ? l : { ...l, lag: 0 }))
  const scheduled = computeSchedule(project.tasks, safeLinks).tasks
  const baseById = new Map(base.tasks.map((t) => [t.id, t]))
  const out: BaselineDiffRow[] = []
  for (const t of scheduled) {
    const b = baseById.get(t.id)
    if (!b) continue
    const curStart = finiteOr(t.es, t.start)
    const startDeltaDays = curStart - b.start
    const finishDeltaDays = curStart + t.duration - (b.start + b.duration)
    if (startDeltaDays === 0 && finishDeltaDays === 0) continue
    out.push({
      id: t.id,
      name: t.name,
      baseStart: b.start,
      baseDuration: b.duration,
      curStart,
      curDuration: t.duration,
      startDeltaDays,
      finishDeltaDays,
    })
  }
  return out.sort((a, b) => Math.abs(b.finishDeltaDays) - Math.abs(a.finishDeltaDays))
}

// ── 주간 공정회의 자동 집계(F16) ──────────────────────────────────────────────
export interface WeeklyDigest {
  /** 집계 구간 시작(ISO, 오늘 −7일). */
  fromISO: string
  /** 집계 구간 끝(ISO, 오늘). */
  toISO: string
  /** 지난 7일 안에 실적 착수일이 찍힌 공정. */
  started: ProgressRow[]
  /** 지난 7일 안에 실적 완료일이 찍힌 공정. */
  finished: ProgressRow[]
  /** 계획比 임계 이상 지연된 공정(BEHIND_THRESHOLD). */
  behind: ProgressRow[]
  /** 계획 착수일이 오늘~+7일 안인 공정(다음 주 착수 예정). */
  nextWeek: ProgressRow[]
  /** 계획 종료일이 지났는데 완료 실적이 없는 공정. */
  overdue: ProgressRow[]
  /** 임박 마일스톤(기존 schedule.upcoming 재사용). */
  milestones: UpcomingMilestone[]
  /** 사업 전체 누계 계획/실적/편차(%p) — 회의록 머리말 숫자. */
  plannedPct: number
  actualPct: number
  deltaPct: number
}

/**
 * 주간 공정회의 자료 — **별도 수기 집계 없이** 지난주 착수·완료 / 지연 / 다음주 착수 예정을
 * 뽑는다. 내부에서 projectKpis 를 1회만 부르므로 대시보드·진척 화면과 산식이 절대 갈라지지 않는다
 * (이 파일 머리말의 '단일 셀렉터' 원칙). 원본 공정 id 가 그대로 실려 보고 숫자 → 공정 추적이 된다.
 */
export function weeklyDigest(project: Project, asOf: Date = new Date()): WeeklyDigest {
  const k = projectKpis(project, asOf)
  const rows = k.progress.rows
  const today = k.todayDay
  const fromDate = new Date(asOf)
  fromDate.setDate(fromDate.getDate() - WEEK_DAYS)
  const fromISO = toISO(fromDate)
  const toISOStr = toISO(asOf)
  const inWindow = (iso: string | undefined): boolean => !!iso && iso >= fromISO && iso <= toISOStr
  return {
    fromISO,
    toISO: toISOStr,
    started: rows.filter((r) => inWindow(r.actualStart)),
    finished: rows.filter((r) => inWindow(r.actualFinish)),
    behind: rows
      .filter((r) => r.deltaPct <= BEHIND_THRESHOLD)
      .sort((a, b) => a.deltaPct - b.deltaPct),
    nextWeek: rows
      .filter((r) => r.plannedStartDay >= today && r.plannedStartDay <= today + WEEK_DAYS)
      .sort((a, b) => a.plannedStartDay - b.plannedStartDay),
    overdue: rows.filter((r) => r.plannedFinishDay < today && !r.actualFinish && r.actualPct < 100),
    milestones: k.schedule.upcoming,
    plannedPct: k.progress.plannedPct,
    actualPct: k.progress.actualPct,
    deltaPct: k.progress.deltaPct,
  }
}

/** 시트별(예정공정표/마일스톤) 요약 — 활성 시트는 top-level, 나머지는 resident sheet에서. */
export function sheetSummaries(project: Project): SheetSummary[] {
  const naiveDuration = (tasks: Task[]): number => {
    if (!tasks.length) return 0
    const s = Math.min(...tasks.map((t) => t.start))
    const e = Math.max(...tasks.map((t) => t.start + t.duration))
    return Math.max(0, e - s)
  }
  const summarize = (
    id: string,
    name: string,
    role: string,
    active: boolean,
    tasks: Task[],
  ): SheetSummary => ({
    id,
    name,
    role,
    active,
    activities: tasks.filter((t) => !t.isMilestone).length,
    milestones: tasks.filter((t) => t.isMilestone).length,
    durationDays: naiveDuration(tasks),
  })

  const out: SheetSummary[] = []
  if (project.activeSheet) {
    out.push(
      summarize(
        project.activeSheet.id,
        project.activeSheet.name,
        project.activeSheet.role,
        true,
        project.tasks,
      ),
    )
  }
  for (const s of project.sheets ?? []) {
    out.push(summarize(s.id, s.name, s.role, false, s.tasks))
  }
  return out
}
