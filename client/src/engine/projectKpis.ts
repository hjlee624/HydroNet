// ─────────────────────────────────────────────────────────────────────────────
// projectKpis — 프로젝트 총괄 대시보드용 일정 KPI 셀렉터(순수 함수).
//
// 예전 HydroNET 대시보드(engine/kpis.ts)의 일정 파트를 Sequence(공정표 전용,
// 원가·진척·EVM 모듈 없음)에 맞춰 이식·정리했다. 원가/EVM/모듈경보 등 CM 데이터에
// 의존하던 존은 제외하고, Sequence가 실제로 가진 일정 데이터에서만 파생한다.
//
// React/DOM/store 비의존. 호출부는 useMemo(() => projectKpis(project), [project]).
// computeSchedule을 내부에서 돌려 es/ef/critical을 스스로 채우므로 입력 project가
// 이미 스케줄링됐는지와 무관하게 안전하다.
// ─────────────────────────────────────────────────────────────────────────────

import type { ID, Project, Task } from '../types/model'
import { dateToDay } from './dates'
import { computeSchedule } from './scheduling'

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
  todayDay: number
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

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
/** 유한한 수면 그 값을, 아니면(undefined/NaN) 폴백. 레거시 저장분의 결측 필드 방어. */
const finiteOr = (a: number | undefined, b: number): number =>
  typeof a === 'number' && Number.isFinite(a) ? a : b

/** 차트와 동일한 가시성 규칙 — 숨김·시운전(옵션 off) 공정을 집계에서 제외. */
function makeVisiblePredicate(project: Project): (t: Task) => boolean {
  const catById = new Map(project.categories.map((c) => [c.id, c]))
  return (t) => {
    const c = catById.get(t.categoryId)
    return !!c && (project.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
  }
}

export function projectKpis(project: Project, asOf: Date = new Date()): ScheduleKpis {
  // 스케줄을 직접 계산해 es/ef/critical을 확보(입력이 pre-schedule여도 안전).
  // 링크 lag 결측(레거시 임포트)이 forward pass를 NaN으로 오염시키지 않게 방어.
  const safeLinks = project.links.map((l) => (Number.isFinite(l.lag) ? l : { ...l, lag: 0 }))
  const scheduled = computeSchedule(project.tasks, safeLinks).tasks
  const isVisible = makeVisiblePredicate(project)
  const vis = scheduled.filter(isVisible)
  const acts = vis.filter((t) => !t.isMilestone)
  const ms = vis.filter((t) => t.isMilestone)
  const todayDay = dateToDay(project.startDate, asOf)
  const mDay = (m: Task) => finiteOr(m.es, m.start)

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

  return {
    hasData: vis.length > 0,
    status,
    todayDay,
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
