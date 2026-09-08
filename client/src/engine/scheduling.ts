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

/**
 * 일정 계산에서 발견된 구조적 문제의 종류. union 이라 확장은 순수 가산.
 *   cycle    — 순환 의존성.
 *   selfLink — 자기 자신을 선행으로 지정한 연결(from === to).
 */
export type ScheduleProblemKind = 'cycle' | 'selfLink'

/**
 * 일정 계산이 발견한 **개별** 문제. 예전에는 "순환이 있다"는 문장 하나만 돌려줬기 때문에
 * ① 순환이 여러 개여도 한 줄로 뭉치고 ② 순환 **하류**의 정상 공정까지 범인으로 지목되고
 * ③ id 가 없어 클릭해 이동할 대상이 없었다. 이제 문제 하나 = 항목 하나이고, 각 항목은
 * 자기 공정 id·연결 id 를 들고 있어 사용자가 목록에서 바로 그 공정/연결로 이동할 수 있다.
 */
export interface ScheduleProblem {
  /** 같은 문제면 항상 같은 값(목록 key·중복 제거용). */
  id: string
  kind: ScheduleProblemKind
  severity: 'error'
  /** 사용자용 한국어 설명. */
  message: string
  /** 문제에 실제로 관여한 공정들(순환 고리의 구성원만 — 하류 공정은 포함하지 않는다). */
  taskIds: ID[]
  /** 고리를 이루는 연결들(하나를 지우면 순환이 풀린다). */
  linkIds: ID[]
}

export interface ScheduleResult {
  tasks: Task[]
  projectStartDay: number
  projectEndDay: number
  criticalCount: number
  warnings: string[]
  /** 미해결 문제 목록. 비어 있지 않으면 이 계산 결과는 '잠정'이다. */
  problems: ScheduleProblem[]
}

interface Graph {
  byId: Map<ID, Task>
  outgoing: Map<ID, Link[]>
  incoming: Map<ID, Link[]>
  order: ID[] // topological order (acyclic subset)
  warnings: string[]
  problems: ScheduleProblem[]
}

/**
 * 강결합요소(SCC) 분해 — Tarjan 알고리즘의 **반복(iterative)** 구현.
 * 공정 1000개 이상인 도면에서도 재귀 스택이 터지지 않도록 명시적 스택을 쓴다.
 * 크기 2 이상인 성분만 돌려준다(자기연결은 buildGraph 에서 이미 걸러진다).
 */
function stronglyConnected(tasks: Task[], outgoing: Map<ID, Link[]>): ID[][] {
  const index = new Map<ID, number>()
  const low = new Map<ID, number>()
  const onStack = new Set<ID>()
  const stack: ID[] = []
  const comps: ID[][] = []
  let counter = 0
  for (const root of tasks) {
    if (index.has(root.id)) continue
    index.set(root.id, counter)
    low.set(root.id, counter)
    counter++
    stack.push(root.id)
    onStack.add(root.id)
    const work: Array<{ id: ID; edge: number }> = [{ id: root.id, edge: 0 }]
    while (work.length) {
      const frame = work[work.length - 1]
      const edges = outgoing.get(frame.id) ?? []
      if (frame.edge < edges.length) {
        const next = edges[frame.edge++].to
        if (!index.has(next)) {
          index.set(next, counter)
          low.set(next, counter)
          counter++
          stack.push(next)
          onStack.add(next)
          work.push({ id: next, edge: 0 })
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(next) ?? 0))
        }
        continue
      }
      const frameLow = low.get(frame.id) ?? 0
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1]
        low.set(parent.id, Math.min(low.get(parent.id) ?? 0, frameLow))
      }
      if (frameLow === index.get(frame.id)) {
        const comp: ID[] = []
        for (;;) {
          const w = stack.pop()
          if (w === undefined) break
          onStack.delete(w)
          comp.push(w)
          if (w === frame.id) break
        }
        if (comp.length >= 2) comps.push(comp.reverse())
      }
    }
  }
  return comps
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
  // 자기연결(from === to)은 계산에서 빼되 **침묵하지 않는다**. 예전엔 여기서 조용히 버려져
  // 위상정렬 부족분에도 잡히지 않았고(자기연결은 순환을 만들지 않는다), 화살표만 그려진 채
  // problems.length===0 · provisional===false · preflight/reviewRequest 는 'final' 이라고
  // 답했다 — JSON 불러오기나 AI 검토 왕복이 {from:'t1',to:'t1'} 를 실어 오면 그대로 통과했다.
  const selfLinks = links.filter((l) => byId.has(l.from) && l.from === l.to)
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
  const problems: ScheduleProblem[] = []
  // 자기연결 하나 = 문제 하나. linkIds 에 그 연결이 실리므로 문제 목록에서 연결 칩을 눌러
  // 곧바로 지울 수 있다(ProblemList → [연결] 탭).
  for (const l of selfLinks) {
    const name = byId.get(l.from)?.name ?? l.from
    const message =
      `자기 자신을 향한 연결 — '${name}' 의 선행이 자기 자신으로 지정되어 있어 ` +
      `일정 계산에서 무시했습니다(연결 1개).`
    problems.push({
      id: `self-link:${l.id}`,
      kind: 'selfLink',
      severity: 'error',
      message,
      taskIds: [l.from],
      linkIds: [l.id],
    })
    warnings.push(message)
  }
  if (order.length < tasks.length) {
    // 순환 하나 = 문제 하나. 순환 밖(하류) 공정은 목록에 넣지 않는다.
    // (아래 폴백 판정은 problems 전체가 아니라 **이 블록에서 만든 순환 문제 수**를 본다 —
    //  자기연결 문제가 이미 목록에 들어 있어도 순환 폴백이 삼켜지지 않게.)
    const cycleProblemsBefore = problems.length
    for (const comp of stronglyConnected(tasks, outgoing)) {
      const member = new Set(comp)
      const names = comp.map((id) => byId.get(id)?.name ?? id)
      const linkIds = valid.filter((l) => member.has(l.from) && member.has(l.to)).map((l) => l.id)
      const message =
        `순환 의존성 — ${names.join(' → ')} 이(가) 서로를 앞뒤로 물고 있어 ` +
        `일부 연결을 무시했습니다(연결 ${linkIds.length}개).`
      problems.push({
        id: `cycle:${[...comp].sort().join('|')}`,
        kind: 'cycle',
        severity: 'error',
        message,
        taskIds: comp,
        linkIds,
      })
      warnings.push(message)
    }
    if (problems.length === cycleProblemsBefore) {
      // 이론상 도달 불가(순환 없이 위상정렬이 짧아질 수 없음) — 그래도 침묵하지 않는다.
      const cyclic = tasks.filter((t) => !order.includes(t.id)).map((t) => t.name)
      warnings.push(`순환 의존성이 감지되어 일부 연결을 무시했습니다: ${cyclic.join(', ')}`)
    }
    // Append remaining nodes so every task still gets scheduled.
    for (const t of tasks) if (!order.includes(t.id)) order.push(t.id)
  }
  return { byId, outgoing, incoming, order, warnings, problems }
}

/** Earliest start of `succ` implied by one predecessor link. */
function linkEarliestStart(pred: Task, succ: Task, link: Link): number {
  const pes = pred.es ?? pred.start
  const pef = pred.ef ?? pred.start + pred.duration
  switch (link.type) {
    case 'SS':
      return pes + link.lag
    case 'FF':
      return pef + link.lag - succ.duration
    case 'SF':
      return pes + link.lag - succ.duration
    case 'FS':
    default:
      return pef + link.lag
  }
}

/** Latest finish of `pred` implied by one successor link. */
function linkLatestFinish(succ: Task, pred: Task, link: Link): number {
  const sls = succ.ls ?? succ.start
  const slf = succ.lf ?? succ.start + succ.duration
  switch (link.type) {
    case 'SS':
      return sls - link.lag + pred.duration
    case 'FF':
      return slf - link.lag
    case 'SF':
      return slf - link.lag + pred.duration
    case 'FS':
    default:
      return sls - link.lag
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
    problems: g.problems,
  }
}

/**
 * Push successors forward so no link is violated, preserving existing slack.
 * Returns a new task array with adjusted `start` values. Implements the plan's
 * cascade ("선행 공정의 기간이 늘어나면 후행 공정이 자동으로 뒤로 밀린다").
 */
export function applyCascade(
  tasks: Task[],
  links: Link[],
): { tasks: Task[]; warnings: string[]; problems: ScheduleProblem[] } {
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
  return { tasks: out, warnings: g.warnings, problems: g.problems }
}

/**
 * Compact every task to its earliest feasible start (sources keep their own
 * start as an anchor). Aggressive "일정 최적화" / reschedule.
 */
export function reschedule(
  tasks: Task[],
  links: Link[],
): { tasks: Task[]; warnings: string[]; problems: ScheduleProblem[] } {
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
  return { tasks: out, warnings: g.warnings, problems: g.problems }
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
  // 링크로 스냅되는 시작도 day 0 이전(음수)을 허용 — 체인 전체가 좌우로 자유 이동.
  return Number.isFinite(es) ? Math.round(es) : null
}

/**
 * Inverse of `linkEarliestStart`: the lag implied by the predecessor's and
 * successor's CURRENT bar positions (start / finish) for a given link type.
 *
 * Used when a bar is DRAGGED so its incoming links' lag follows the new position
 * (position → lag), mirroring `snapSuccessor` (lag → position). Solving
 * `linkEarliestStart(pred, succ, {type, lag}) === succ.start` for lag gives:
 *   FS: succ.start − pred.finish   · SS: succ.start − pred.start
 *   FF: succ.finish − pred.finish  · SF: succ.finish − pred.start
 * so `linkConstrainedStart` with this lag reproduces `succ.start` exactly.
 */
export function linkLagFromPositions(pred: Task, succ: Task, type: Link['type']): number {
  const predRef = type === 'SS' || type === 'SF' ? pred.start : pred.start + pred.duration
  const succRef = type === 'FF' || type === 'SF' ? succ.start + succ.duration : succ.start
  return Math.round(succRef - predRef)
}

/** Convenience: ordered list of task ids on a critical path (for highlighting). */
export function criticalTaskIds(tasks: Task[]): Set<ID> {
  return new Set(tasks.filter((t) => t.critical).map((t) => t.id))
}

// ─────────────────────────────────────────────────────────────────────────────
// 편집 의미론(edit semantics) — 막대를 옮기거나 기간을 바꿀 때 "무엇이 진실인가"
//
//   • 'free'      위치 자유 편집 — 사용자가 놓은 **위치가 진실**. 들어오는 링크의 지연(lag)을
//                 새 위치에서 역산한다(지금까지의 동작, 기본값).
//   • 'keepLinks' 선후행 제약 유지 — 사용자가 넣은 **지연(lag)이 진실**. lag 는 절대 다시 쓰지
//                 않고, 선행 제약이 허용하는 최조기 시작보다 앞으로는 못 가게 막대를 붙잡는다.
//
// previewEdit 는 **커밋 전에** 그 편집이 실제로 무엇을 바꾸는지(시작일·지연·후행 이동·준공)
// 를 순수 함수로 계산한다. 스토어의 커밋 경로와 같은 헬퍼(linkLagFromPositions /
// linkConstrainedStart / applyCascade)를 쓰므로 "사전 표시 = 실제 결과"가 성립한다.
// ─────────────────────────────────────────────────────────────────────────────

export type EditMode = 'free' | 'keepLinks'

/** 하나의 연결에서 지연(lag)이 바뀐 내역. */
export interface EditImpactLag {
  linkId: ID
  fromName: string
  toName: string
  type: Link['type']
  before: number
  after: number
}

/** 이 편집 때문에 함께 밀린 후행 공정. */
export interface EditImpactMove {
  id: ID
  name: string
  before: number
  after: number
}

export interface EditImpact {
  mode: EditMode
  target: {
    id: ID
    name: string
    startBefore: number
    startAfter: number
    durationBefore: number
    durationAfter: number
  }
  /** keepLinks 에서 요청 위치가 선행 제약에 막혀 뒤로 밀린 경우 true. */
  clamped: boolean
  /** 막힌 경우 실제로 허용된 최조기 시작(day). 아니면 null. */
  clampedTo: number | null
  lagChanges: EditImpactLag[]
  successorMoves: EditImpactMove[]
  endBefore: number
  endAfter: number
  /**
   * 이 영향이 봉인된 직후의 **되돌리기 스택 깊이**(UndoManager.undoStack.length).
   * previewEdit 는 채우지 않는다 — 제스처가 히스토리 한 칸으로 봉인된 뒤 화면(ChartCanvas)이
   * 찍어 준다. 카드의 ↩ 되돌리기가 '카드가 설명하는 그 편집'을 되돌리는지 판정하는 근거다.
   */
  historyDepth?: number
}

/**
 * 이 영향 카드의 ↩ 되돌리기를 눌러도 되는가 — 카드가 설명하는 편집이 아직 되돌리기 스택의
 * **맨 위**인가.
 *
 * 회귀 이력: 카드는 제스처가 끝난 시점에 봉인되고 8초를 산다. 그 8초 안에 다른 편집(예: 공정
 * 삭제)이 일어나도 카드는 옛 드래그를 계속 설명했고, ↩ 는 스택 맨 위 = **그 다른 편집**을
 * 되돌렸다. 실측: B 를 20→60 으로 끌고 8초 안에 C 를 삭제한 뒤 ↩ 를 누르면 C 가 되살아나고
 * B.start 는 60 그대로였다 — 설명한 것은 안 되돌리고, 설명하지 않은 것을 조용히 되돌렸다.
 * 그래서 봉인 시점의 스택 깊이를 함께 찍어 두고, 깊이가 달라지면 카드를 내린다.
 * 깊이가 없는 카드(옛 데이터·미기록)는 안전한 쪽 — '되돌릴 수 없음'으로 본다.
 */
export function editImpactUndoable(impact: EditImpact, currentDepth: number): boolean {
  return impact.historyDepth !== undefined && impact.historyDepth === currentDepth
}

/**
 * 편집(시작일/기간 변경)의 영향을 **커밋 전에** 계산한다. 입력 배열은 절대 변형하지 않는다.
 * `autoCascade` 는 스토어의 연쇄 자동 설정과 같은 값을 넘겨야 결과가 실제 커밋과 일치한다.
 * 대상 공정이 없으면 null.
 */
export function previewEdit(
  tasks: Task[],
  links: Link[],
  edit: { id: ID; start?: number; duration?: number },
  mode: EditMode,
  autoCascade: boolean,
): EditImpact | null {
  const targetIndex = tasks.findIndex((t) => t.id === edit.id)
  if (targetIndex < 0) return null
  const before = tasks[targetIndex]

  const nextTasks = tasks.map((t) => ({ ...t }))
  const nextLinks = links.map((l) => ({ ...l }))
  const target = nextTasks[targetIndex]
  if (edit.start !== undefined) target.start = Math.round(edit.start)
  if (edit.duration !== undefined)
    target.duration = Math.max(target.isMilestone ? 0 : 1, Math.round(edit.duration))

  let clamped = false
  let clampedTo: number | null = null
  if (mode === 'keepLinks') {
    // 지연은 손대지 않는다 — 대신 위치를 제약 안으로 되돌린다(수동 여유는 그대로 보존).
    const min = linkConstrainedStart(nextTasks, nextLinks, edit.id)
    if (min != null && target.start < min) {
      target.start = min
      clamped = true
      clampedTo = min
    }
  } else {
    // 위치 자유 편집 — 스토어 relinkIncoming 과 같은 역산.
    for (const l of nextLinks) {
      if (l.to !== edit.id || l.from === edit.id) continue
      const from = nextTasks.find((t) => t.id === l.from)
      if (from) l.lag = linkLagFromPositions(from, target, l.type)
    }
  }

  const settled = autoCascade ? applyCascade(nextTasks, nextLinks).tasks : nextTasks
  const settledById = new Map(settled.map((t) => [t.id, t]))
  const targetAfter = settledById.get(edit.id) ?? target

  const lagChanges: EditImpactLag[] = []
  const nameOf = (id: ID): string => tasks.find((t) => t.id === id)?.name ?? id
  for (let i = 0; i < links.length; i++) {
    const b = links[i]
    const a = nextLinks[i]
    if (a.lag === b.lag) continue
    lagChanges.push({
      linkId: b.id,
      fromName: nameOf(b.from),
      toName: nameOf(b.to),
      type: b.type,
      before: b.lag,
      after: a.lag,
    })
  }

  const successorMoves: EditImpactMove[] = []
  for (const t of tasks) {
    if (t.id === edit.id) continue
    const after = settledById.get(t.id)
    if (after && after.start !== t.start)
      successorMoves.push({ id: t.id, name: t.name, before: t.start, after: after.start })
  }

  return {
    mode,
    target: {
      id: before.id,
      name: before.name,
      startBefore: before.start,
      startAfter: targetAfter.start,
      durationBefore: before.duration,
      durationAfter: targetAfter.duration,
    },
    clamped,
    clampedTo,
    lagChanges,
    successorMoves,
    endBefore: computeSchedule(tasks, links).projectEndDay,
    endAfter: computeSchedule(settled, nextLinks).projectEndDay,
  }
}
