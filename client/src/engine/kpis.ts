// ─────────────────────────────────────────────────────────────────────────────
// projectKpis — the SINGLE source of cross-module KPIs.
// Pure (no React / DOM / store / localStorage). Given a Project (post-schedule,
// so t.es/ef are populated) and an `asOf` date, it derives every headline metric
// the dashboard, report and progress screens show — so those screens can never
// diverge again (they used to each recompute schedule/progress/cost inline).
//
// Units are kept STRICTLY separate: cost is 천원(thousand won), boq is 원(won).
// EVM is computed in the cost domain (천원) and NEVER mixes in boq. The two are
// only related through a unit-converted "coverage" ratio, not a sum.
//
// zustand v5 note: this returns a NEW object each call, so callers MUST wrap it
// in useMemo(() => projectKpis(project), [project]) and must NOT use it as a
// store selector return (that would churn snapshots → infinite render → blank
// screen, the project's historical #1 trap).
// ─────────────────────────────────────────────────────────────────────────────

import type { ID, Project, Task, Category, ModuleRecord } from '../types/model'
import type { ModuleId } from '../data/modules'
import { dateToDay, toISO } from './dates'

/** 지연 공정 임계값(%p): 실적 − 계획 ≤ 이 값이면 '지연 공정'. 세 화면 공유. */
export const BEHIND_THRESHOLD = -10

export const clampPct = (n: number): number => Math.max(0, Math.min(100, n))
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** 너그러운 숫자 파싱: 천단위 구분기호·공백 제거, NaN→0. 모듈 입력값은 항상 string이고
 *  외부 import/구스키마로 '1,000' 같은 값이 들어올 수 있어 합산 누락을 막는다. */
export const toNum = (s: unknown): number => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── 반환 타입 ────────────────────────────────────────────────────────────────
export interface UpcomingMilestone { id: ID; name: string; startDay: number; dMinus: number; critical: boolean }
export interface ScheduleKpis {
  startDay: number; endDay: number; durationDays: number; months: number
  activities: number; milestoneCount: number; criticalCount: number
  rainyCount: number; linkCount: number; elapsedPct: number
  upcoming: UpcomingMilestone[]
}
export interface ProgressRow {
  id: ID; name: string; categoryId: ID; duration: number
  plannedPct: number; actualPct: number; deltaPct: number; critical: boolean
}
export interface ProgressKpis {
  plannedPct: number; actualPct: number; deltaPct: number
  behindCount: number; doneCount: number; activityCount: number
  rows: ProgressRow[]
}
/** 단위 = 천원. */
export interface CostKpis { hasCost: boolean; budget: number; spent: number; balance: number; burnPct: number; itemCount: number }
/** 단위 = 원(cost와 절대 합산 금지). */
export interface BoqKpis { hasBoq: boolean; total: number; itemCount: number }
/** 공사비(boq, 원→천원 환산) ÷ 공사예산(cost, 천원). 합산이 아닌 커버리지 비율. */
export interface CoverageKpi { available: boolean; pct: number; baseLabel: string }
/** EVM — 금액(bac/pv/ev/ac/sv/cv/eac)은 천원, spi는 무차원. costAvailable=false면 금액 EVM 무효. */
export interface EvmKpis {
  costAvailable: boolean; scheduleAvailable: boolean
  bac: number; pv: number; ev: number; ac: number; sv: number; cv: number
  spi: number; cpi: number; eac: number; vac: number
}
export type AlertSeverity = 'info' | 'warn' | 'danger'
export interface ModuleAlert { module: ModuleId; icon: string; label: string; text: string; count: number; severity: AlertSeverity }
export interface BaselineDrift { capturedAt: string; asOf: string; finishDriftDays: number; startDriftDays: number; slippedCount: number; trackedCount: number }
export interface ProjectKpis {
  asOfISO: string; todayDay: number
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
/** 모든 집계가 같은 공정 집합을 보도록 단일 가시성 술어(차트와 동일 규칙). */
function isVisible(t: Task, catById: Map<ID, Category>, project: Project): boolean {
  const c = catById.get(t.categoryId)
  return !!c && (project.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
}
const recs = (project: Project, id: ModuleId): ModuleRecord[] => project.modules?.[id] ?? []
const sumKey = (rows: ModuleRecord[], key: string): number => rows.reduce((s, r) => s + toNum(r.values[key]), 0)
const countWhere = (rows: ModuleRecord[], key: string, vals: string[]): number =>
  rows.filter((r) => vals.includes(r.values[key])).length

// ── 본체 ─────────────────────────────────────────────────────────────────────
export function projectKpis(project: Project, asOf: Date = new Date()): ProjectKpis {
  const todayDay = dateToDay(project.startDate, asOf)
  const catById = new Map(project.categories.map((c) => [c.id, c]))
  const vis = project.tasks.filter((t) => isVisible(t, catById, project))
  const acts = vis.filter((t) => !t.isMilestone)
  const ms = vis.filter((t) => t.isMilestone)

  // ── schedule ──
  const starts = vis.map((t) => t.es ?? t.start)
  const ends = vis.map((t) => t.ef ?? t.start + t.duration)
  const startDay = starts.length ? Math.min(...starts) : 0
  const endDay = ends.length ? Math.max(...ends) : 0
  const durationDays = endDay - startDay
  const months = Math.round((durationDays / 30.44) * 10) / 10
  const elapsedPct = endDay > startDay ? Math.round(clamp01((todayDay - startDay) / (endDay - startDay)) * 100) : 0
  const criticalCount = vis.filter((t) => t.critical).length
  const upcoming: UpcomingMilestone[] = ms
    .filter((m) => m.start >= todayDay)
    .sort((a, b) => a.start - b.start)
    .slice(0, 5)
    .map((m) => ({ id: m.id, name: m.name, startDay: m.start, dMinus: m.start - todayDay, critical: !!m.critical }))
  const schedule: ScheduleKpis = {
    startDay, endDay, durationDays, months,
    activities: acts.length, milestoneCount: ms.length, criticalCount,
    rainyCount: project.rainySeasons.length, linkCount: project.links.length,
    elapsedPct, upcoming,
  }

  // ── progress (기간 가중) ──
  const rows: ProgressRow[] = acts.map((t) => {
    const start = t.es ?? t.start
    const dur = Math.max(1, t.duration)
    const plannedPct = clampPct(((todayDay - start) / dur) * 100)
    const actualPct = clampPct(t.progress ?? 0)
    return { id: t.id, name: t.name, categoryId: t.categoryId, duration: t.duration, plannedPct, actualPct, deltaPct: actualPct - plannedPct, critical: !!t.critical }
  })
  const totDur = rows.reduce((s, r) => s + Math.max(1, r.duration), 0) || 1
  const plannedAll = rows.reduce((s, r) => s + r.plannedPct * Math.max(1, r.duration), 0) / totDur
  const actualAll = rows.reduce((s, r) => s + r.actualPct * Math.max(1, r.duration), 0) / totDur
  const progress: ProgressKpis = {
    plannedPct: plannedAll, actualPct: actualAll, deltaPct: actualAll - plannedAll,
    behindCount: rows.filter((r) => r.deltaPct <= BEHIND_THRESHOLD).length,
    doneCount: rows.filter((r) => r.actualPct >= 100).length,
    activityCount: rows.length, rows,
  }

  // ── cost(천원) / boq(원) — 단위 분리 ──
  const costRecs = recs(project, 'cost')
  const budget = sumKey(costRecs, 'budget')
  const spent = sumKey(costRecs, 'spent')
  const cost: CostKpis = {
    hasCost: costRecs.length > 0, budget, spent, balance: budget - spent,
    burnPct: budget > 0 ? Math.round((spent / budget) * 100) : 0, itemCount: costRecs.length,
  }
  const boqRecs = recs(project, 'boq')
  const boqTotal = boqRecs.reduce((s, r) => s + toNum(r.values.qty) * toNum(r.values.price), 0)
  const boq: BoqKpis = { hasBoq: boqRecs.length > 0, total: boqTotal, itemCount: boqRecs.length }

  // ── coverage: 공사비(boq 원→천원) vs 공사예산(cost 천원). 공사비 group 있으면 그 예산, 없으면 총예산. ──
  const constructionBudget = costRecs.filter((r) => r.values.group === '공사비').reduce((s, r) => s + toNum(r.values.budget), 0)
  const coverageBase = constructionBudget > 0 ? constructionBudget : budget
  const coverage: CoverageKpi = {
    available: coverageBase > 0 && boq.hasBoq,
    pct: coverageBase > 0 ? Math.round((boqTotal / 1000 / coverageBase) * 100) : 0,
    baseLabel: constructionBudget > 0 ? '공사비 예산' : '총 예산',
  }

  // ── EVM (천원). PV/EV는 기간가중 계획·실적%를 BAC에 곱함. ──
  const bac = budget
  const pv = bac * (plannedAll / 100)
  const ev = bac * (actualAll / 100)
  const ac = spent
  const cpi = ac > 0 ? ev / ac : 0
  const evm: EvmKpis = {
    costAvailable: cost.hasCost,
    scheduleAvailable: plannedAll > 0,
    bac, pv, ev, ac, sv: ev - pv, cv: ev - ac,
    spi: plannedAll > 0 ? actualAll / plannedAll : 0,
    cpi, eac: cpi > 0 ? bac / cpi : 0, vac: cpi > 0 ? bac - bac / cpi : 0,
  }

  // ── module alerts (records가 있는 모듈만, 건수>0) ──
  const alerts: ModuleAlert[] = []
  if (progress.behindCount > 0) alerts.push({ module: 'progress', icon: '📈', label: '지연 공정', text: `계획比 10%p↓ ${progress.behindCount}건`, count: progress.behindCount, severity: 'warn' })
  const riskOpen = countWhere(recs(project, 'risk'), 'status', ['열림', '진행'])
  if (riskOpen > 0) alerts.push({ module: 'risk', icon: '⚠️', label: '리스크·이슈', text: `열림·진행 ${riskOpen}건`, count: riskOpen, severity: 'warn' })
  const qRecs = recs(project, 'quality')
  const ncr = countWhere(qRecs, 'type', ['부적합(NCR)']); const qFail = countWhere(qRecs, 'status', ['불합격'])
  if (ncr + qFail > 0) alerts.push({ module: 'quality', icon: '✅', label: '품질·검측', text: `NCR ${ncr} · 불합격 ${qFail}`, count: ncr + qFail, severity: qFail > 0 ? 'danger' : 'warn' })
  const sRecs = recs(project, 'safety')
  const acc = countWhere(sRecs, 'type', ['사고/아차사고']); const high = countWhere(sRecs, 'level', ['상'])
  if (acc + high > 0) alerts.push({ module: 'safety', icon: '🦺', label: '안전관리', text: `사고 ${acc} · 고위험 ${high}`, count: acc + high, severity: acc > 0 ? 'danger' : 'warn' })
  const permitPend = countWhere(recs(project, 'permit'), 'status', ['준비', '신청', '반려'])
  if (permitPend > 0) alerts.push({ module: 'permit', icon: '📝', label: '인허가', text: `미승인 ${permitPend}건`, count: permitPend, severity: 'warn' })
  const docPend = countWhere(recs(project, 'document'), 'status', ['작성중', '제출', '반려'])
  if (docPend > 0) alerts.push({ module: 'document', icon: '📄', label: '문서·도면', text: `미승인 ${docPend}건`, count: docPend, severity: 'info' })
  const commFail = countWhere(recs(project, 'commissioning'), 'result', ['불합격'])
  if (commFail > 0) alerts.push({ module: 'commissioning', icon: '🏗️', label: '시운전', text: `불합격 ${commFail}건`, count: commFail, severity: 'danger' })
  const sevRank: Record<AlertSeverity, number> = { danger: 0, warn: 1, info: 2 }
  alerts.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.count - a.count)

  // ── baseline drift (없으면 null) ──
  let baseline: BaselineDrift | null = null
  // 다른 공정표 시트에서 박제한 기준선은 task id가 겹치지 않아 표류가 무의미 → 가린다
  // (설계 사업의 예정공정표↔마일스톤 시트). 단일 시트/구버전은 sheetId 없어 항상 매칭.
  const baseSheetMatches = !project.baseline?.sheetId || !project.activeSheet?.id || project.baseline.sheetId === project.activeSheet.id
  if (project.baseline && baseSheetMatches) {
    const baseById = new Map(project.baseline.tasks.map((t) => [t.id, t]))
    let slipped = 0; let tracked = 0
    // 헤드라인 endDay와 동일한 가시성(vis) 집합으로 집계 — 숨김/시운전 공정 혼입 방지.
    for (const t of vis) {
      const b = baseById.get(t.id)
      if (!b) continue
      tracked++
      if ((t.es ?? t.start) - b.start > 0) slipped++
    }
    baseline = {
      capturedAt: project.baseline.capturedAt, asOf: project.baseline.asOf,
      finishDriftDays: endDay - project.baseline.endDay,
      startDriftDays: startDay - project.baseline.startDay,
      slippedCount: slipped, trackedCount: tracked,
    }
  }

  return { asOfISO: toISO(asOf), todayDay, schedule, progress, cost, boq, coverage, evm, alerts, baseline }
}
