// ─────────────────────────────────────────────────────────────────────────────
// CPM (Critical Path Method) engine
//
// Bars are always drawn at `task.start`. The engine derives ES/EF/LS/LF, total
// float and the critical-path flag from the dependency network, and provides
// two mutation helpers:
//   • applyCascade  — push successors forward only when a link is violated
//                     (preserves manual slack). This is the plan's "연쇄 수정".
//   • reschedule    — compact every task to its earliest feasible start.
//
// All functions are pure (return new data) and cycle-safe.
// ─────────────────────────────────────────────────────────────────────────────

import type { ID, Link, Task } from '../types/model'

const EPS = 1e-6

export interface ScheduleResult {
  tasks: Task[]
  projectStartDay: number
  projectEndDay: number
  criticalCount: number
  warnings: string[]
}

interface Graph {
  byId: Map<ID, Task>
  outgoing: Map<ID, Link[]>
  incoming: Map<ID, Link[]>
  order: ID[] // topological order (acyclic subset)
  warnings: string[]
}

function buildGraph(tasks: Task[], links: Link[]): Graph {
  const byId = new Map<ID, Task>()
  const outgoing = new Map<ID, Link[]>()
  const incoming = new Map<ID, Link[]>()
  for (const t of tasks) {
    byId.set(t.id, t)
    outgoing.set(t.id, [])
    incoming.set(t.id, [])
  }
  // Only keep links whose endpoints both exist.
  const valid = links.filter((l) => byId.has(l.from) && byId.has(l.to) && l.from !== l.to)
  for (const l of valid) {
    outgoing.get(l.from)!.push(l)
    incoming.get(l.to)!.push(l)
  }

  // Kahn topological sort; leftover nodes indicate a cycle.
  const indeg = new Map<ID, number>()
  for (const t of tasks) indeg.set(t.id, incoming.get(t.id)!.length)
  const queue: ID[] = []
  for (const [id, d] of indeg) if (d === 0) queue.push(id)
  const order: ID[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const l of outgoing.get(id)!) {
      const d = indeg.get(l.to)! - 1
      indeg.set(l.to, d)
      if (d === 0) queue.push(l.to)
    }
  }

  const warnings: string[] = []
  if (order.length < tasks.length) {
    const cyclic = tasks.filter((t) => !order.includes(t.id)).map((t) => t.name)
    warnings.push(`순환 의존성이 감지되어 일부 연결을 무시했습니다: ${cyclic.join(', ')}`)
    // Append remaining nodes so every task still gets scheduled.
    for (const t of tasks) if (!order.includes(t.id)) order.push(t.id)
  }
  return { byId, outgoing, incoming, order, warnings }
}

/** Earliest start of `succ` implied by one predecessor link. */
function linkEarliestStart(pred: Task, succ: Task, link: Link): number {
  const pes = pred.es ?? pred.start
  const pef = pred.ef ?? pred.start + pred.duration
  switch (link.type) {
    case 'SS': return pes + link.lag
    case 'FF': return pef + link.lag - succ.duration
    case 'SF': return pes + link.lag - succ.duration
    case 'FS':
    default: return pef + link.lag
  }
}

/** Latest finish of `pred` implied by one successor link. */
function linkLatestFinish(succ: Task, pred: Task, link: Link): number {
  const sls = succ.ls ?? succ.start
  const slf = succ.lf ?? succ.start + succ.duration
  switch (link.type) {
    case 'SS': return sls - link.lag + pred.duration
    case 'FF': return slf - link.lag
    case 'SF': return slf - link.lag + pred.duration
    case 'FS':
    default: return sls - link.lag
  }
}

/**
 * Compute the full CPM annotation. Bars stay where the user put them: ES is
 * floored at `task.start`, so a deliberately-late bar keeps its slack and the
 * critical path reflects the actual layout.
 */
export function computeSchedule(tasks: Task[], links: Link[]): ScheduleResult {
  const g = buildGraph(tasks, links)
  const out = tasks.map((t) => ({ ...t }))
  const map = new Map<ID, Task>(out.map((t) => [t.id, t]))

  // ── Forward pass (ES / EF) ──
  for (const id of g.order) {
    const t = map.get(id)!
    let es = t.start
    for (const l of g.incoming.get(id)!) {
      const pred = map.get(l.from)!
      es = Math.max(es, linkEarliestStart(pred, t, l))
    }
    t.es = es
    t.ef = es + t.duration
  }

  const projectStartDay = out.reduce((m, t) => Math.min(m, t.es ?? t.start), Infinity)
  const projectEndDay = out.reduce((m, t) => Math.max(m, t.ef ?? t.start + t.duration), -Infinity)
  const end = isFinite(projectEndDay) ? projectEndDay : 0

  // ── Backward pass (LS / LF) ──
  for (let i = g.order.length - 1; i >= 0; i--) {
    const t = map.get(g.order[i])!
    const succs = g.outgoing.get(t.id)!
    let lf = succs.length === 0 ? Math.max(end, t.ef ?? 0) : Infinity
    for (const l of succs) {
      const succ = map.get(l.to)!
      lf = Math.min(lf, linkLatestFinish(succ, t, l))
    }
    if (!isFinite(lf)) lf = t.ef ?? end
    t.lf = lf
    t.ls = lf - t.duration
    t.totalFloat = (t.ls ?? 0) - (t.es ?? 0)
    t.critical = Math.abs(t.totalFloat) < 0.5 + EPS
  }

  const criticalCount = out.filter((t) => t.critical).length
  return {
    tasks: out,
    projectStartDay: isFinite(projectStartDay) ? projectStartDay : 0,
    projectEndDay: end,
    criticalCount,
    warnings: g.warnings,
  }
}

/**
 * Push successors forward so no link is violated, preserving existing slack.
 * Returns a new task array with adjusted `start` values. Implements the plan's
 * cascade ("선행 공정의 기간이 늘어나면 후행 공정이 자동으로 뒤로 밀린다").
 */
export function applyCascade(tasks: Task[], links: Link[]): { tasks: Task[]; warnings: string[] } {
  const g = buildGraph(tasks, links)
  const out = tasks.map((t) => ({ ...t }))
  const map = new Map<ID, Task>(out.map((t) => [t.id, t]))

  for (const id of g.order) {
    const t = map.get(id)!
    let minStart = t.start
    for (const l of g.incoming.get(id)!) {
      const pred = map.get(l.from)!
      // use up-to-date pred es/ef from current start
      pred.es = pred.start
      pred.ef = pred.start + pred.duration
      minStart = Math.max(minStart, linkEarliestStart(pred, t, l))
    }
    if (minStart > t.start) t.start = Math.round(minStart)
  }
  return { tasks: out, warnings: g.warnings }
}

/**
 * Compact every task to its earliest feasible start (sources keep their own
 * start as an anchor). Aggressive "일정 최적화" / reschedule.
 */
export function reschedule(tasks: Task[], links: Link[]): { tasks: Task[]; warnings: string[] } {
  const g = buildGraph(tasks, links)
  const out = tasks.map((t) => ({ ...t }))
  const map = new Map<ID, Task>(out.map((t) => [t.id, t]))

  for (const id of g.order) {
    const t = map.get(id)!
    const preds = g.incoming.get(id)!
    if (preds.length === 0) {
      t.es = t.start
      t.ef = t.start + t.duration
      continue
    }
    let es = -Infinity
    for (const l of preds) {
      const pred = map.get(l.from)!
      es = Math.max(es, linkEarliestStart(pred, t, l))
    }
    t.start = Math.round(es)
    t.es = es
    t.ef = es + t.duration
  }
  return { tasks: out, warnings: g.warnings }
}

/**
 * Earliest feasible `start` of `toId` implied by ALL of its incoming links
 * (the binding one wins via max), using each predecessor's current `start` as
 * its ES/EF. Returns null when the task has no usable predecessor.
 *
 * Used to SNAP a successor exactly onto its FS/SS/FF/SF + lag relationship the
 * moment a link is created or its lag/type is edited — so changing the lag moves
 * the bar in BOTH directions (the plain cascade only ever pushes forward, which
 * is why reducing a lag never tightened the gap).
 */
export function linkConstrainedStart(tasks: Task[], links: Link[], toId: ID): number | null {
  const byId = new Map<ID, Task>(tasks.map((t) => [t.id, t]))
  const to = byId.get(toId)
  if (!to) return null
  let es = -Infinity
  for (const l of links) {
    if (l.to !== toId || l.from === toId) continue
    const pred = byId.get(l.from)
    if (!pred) continue
    // Anchor the predecessor on its own bar position (start-based ES/EF).
    const p: Task = { ...pred, es: pred.start, ef: pred.start + pred.duration }
    es = Math.max(es, linkEarliestStart(p, to, l))
  }
  return Number.isFinite(es) ? Math.max(0, Math.round(es)) : null
}

/** Convenience: ordered list of task ids on a critical path (for highlighting). */
export function criticalTaskIds(tasks: Task[]): Set<ID> {
  return new Set(tasks.filter((t) => t.critical).map((t) => t.id))
}
