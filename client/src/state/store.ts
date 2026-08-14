// ─────────────────────────────────────────────────────────────────────────────
// Central editor store (zustand). Holds the project, selection, undo/redo
// history and view zoom, and exposes every mutation as an action. Scheduling
// fields (es/ef/critical…) are recomputed after each change so the canvas and
// the critical-path highlight stay in sync. 저장은 자동이 아니라 사용자가 "저장"을
// 누를 때만 파일로 저장된다(state/fileIO.ts) — 편집은 dirty 플래그로만 표시.
// ─────────────────────────────────────────────────────────────────────────────

import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { createSampleProject } from '../data/sampleProject'
import { daysInMonth, doyToMonthDay, monthDayToDoy } from '../engine/dates'
import { fitToPaperView } from '../engine/layout'
import { paperMm } from '../engine/paper'
import {
  applyCascade,
  computeSchedule,
  linkConstrainedStart,
  linkLagFromPositions,
  reschedule,
} from '../engine/scheduling'
import { DEFAULT_PALETTE } from '../styles/theme'
import type {
  Category,
  ID,
  Link,
  LinkType,
  LogoItem,
  PaperSettings,
  Project,
  RainySeason,
  Task,
  TextRole,
  TextStyle,
  ViewSettings,
} from '../types/model'
import { PALETTE_MAX } from '../types/model'
import {
  activateProjectCrdtRuntime,
  applyProjectToYDoc,
  createProjectCrdtRuntime,
  createUnseededProjectCrdtRuntime,
  LOCAL_ORIGIN,
  type ProjectCrdtRuntime,
  projectFromYDoc,
  projectYDocIsEmpty,
  SEED_ORIGIN,
  seedProjectYDocIfEmpty,
  UNTRACKED_ORIGIN,
} from './crdt'
import { saveProjectToFile } from './fileIO'
import { logInfo, logWarn } from './logger'

interface LinkingState {
  fromId: ID
  pointer: { x: number; y: number } | null
}

/** Canvas interaction tool (Photoshop-style): edit = normal, zoom = wheel-zoom
 *  at cursor, pan = drag-to-scroll. Esc returns to edit. */
export type NavMode = 'edit' | 'zoom' | 'pan'

/** Transient view filter — show only the matching subset (de-clutters a busy chart). */
export interface ViewFilter {
  /** Only 주공정(critical) activities. */
  critical: boolean
  /** Only milestones. */
  milestone: boolean
  /** Substring match on the activity/milestone name (case-insensitive). */
  query: string
}
/** Bar colouring scheme: by 공종 lane colour, or critical-path emphasis (rest muted). */
export type ColorMode = 'category' | 'critical'
/** Progressive disclosure: 'simple' hides advanced controls, 'pro' shows everything. */
export type UiMode = 'simple' | 'pro'
/** 오른쪽 속성 패널의 활성 탭(요구사항 3: 도면·프로젝트 / 텍스트 / 공정 / 연결). */
export type InspectorTab = 'project' | 'text' | 'task' | 'link'

const FILTER_OFF: ViewFilter = { critical: false, milestone: false, query: '' }
export const filterActive = (f: ViewFilter): boolean =>
  f.critical || f.milestone || f.query.trim() !== ''

/** localStorage helpers for sticky UI prefs (guarded for non-browser test runs). */
function lsGet(key: string, fallback: string): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

// P1 이전 버전의 전체-project localStorage 캐시는 신규 Y.Doc의 1회 마이그레이션
// seed로만 읽는다. 이후 편집 영속은 y-indexeddb가 담당하며 여기에 다시 쓰지 않는다.
const LEGACY_AUTOSAVE_KEY = 'sequence:autosave'

function loadLegacyAutosave(): Project | null {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as { project?: unknown }
    const p = obj?.project as Project | undefined
    if (!p || !Array.isArray(p.tasks) || !Array.isArray(p.categories)) return null
    return p
  } catch {
    return null
  }
}

/** One task whose start moved during a 재계산 / 일정 정렬 pass. */
export interface RecalcChange {
  id: ID
  name: string
  oldStart: number
  newStart: number
  deltaDays: number
}

/** 복사한 공종 묶음 — 공종 + 그 공정 + (양 끝이 묶음 안에 있는) 내부 연결.
 *  Ctrl+C로 채우고 Ctrl+V(pasteCategories)로 새 id를 부여해 붙여넣는다. */
export interface CategoryClipboard {
  categories: Category[]
  tasks: Task[]
  links: Link[]
}

/** Summary of what a reschedule/cascade changed, shown in the 재계산 popup. */
export interface RecalcReport {
  kind: 'reschedule' | 'cascade'
  changes: RecalcChange[]
  totalMoved: number
  /** Project start date (ISO) so the modal can render absolute dates. */
  startDate: string
}

interface SelectionSnapshot {
  selectedTaskId: ID | null
  selectedTaskIds: ID[]
  selectedLinkId: ID | null
  selectedCategoryId: ID | null
  selectedCategoryIds: ID[]
  selectedTextRole: TextRole | null
  inspectorTab: InspectorTab
}

interface UndoStackItemLike {
  meta: Map<unknown, unknown>
}

export interface EditorState {
  project: Project
  selectedTaskId: ID | null
  /** 다중 선택된 공정 id들. 단일 선택이면 [그 id], 미선택이면 []. 막대 강조에 사용하고,
   *  2개 이상이면 그중 하나를 드래그할 때 수평으로 함께 이동한다. */
  selectedTaskIds: ID[]
  selectedLinkId: ID | null
  selectedCategoryId: ID | null
  /** 다중 선택된 공종 id(표시 순서). 단일 선택이면 [그 id], 미선택이면 []. */
  selectedCategoryIds: ID[]
  /** Ctrl+C로 복사한 공종 묶음(없으면 null). */
  categoryClipboard: CategoryClipboard | null
  /** When set, the inspector shows the text-style editor for this role. */
  selectedTextRole: TextRole | null
  /** 오른쪽 속성 패널 활성 탭(요구사항 3). 차트에서 공정/연결/글자를 클릭하면 자동 전환된다. */
  inspectorTab: InspectorTab
  linking: LinkingState | null
  zoom: number
  /** Active canvas tool (edit / zoom / pan). */
  navMode: NavMode
  /** Transient subset filter for the chart + sidebar. */
  filter: ViewFilter
  /** Bar colour scheme. */
  colorMode: ColorMode
  /** Simple / pro UI (progressive disclosure). */
  uiMode: UiMode
  autoCascade: boolean
  /** 조회 전용(입장했으나 편집 권한 없음). true면 모든 변경(commit)이 차단된다. */
  readOnly: boolean
  dirty: boolean
  warnings: string[]
  /** Last reschedule/cascade diff; non-null drives the 재계산 popup. */
  recalcReport: RecalcReport | null
  past: Project[]
  future: Project[]
  canUndo: boolean
  canRedo: boolean

  // lifecycle
  setProject: (p: Project) => void
  /**
   * Load a .json into the CURRENT project/room, keeping its id. In a collaborative
   * session this overwrites the shared Y.Doc content (syncs to teammates) instead of
   * swapping the runtime to the file's id — which the CollaborationBridge would revert.
   */
  importProjectContent: (p: Project) => void
  /** Attach provider/IndexedDB state without independently importing a JSON seed. */
  openCollaborativeProject: (projectId: string, name?: string) => void
  newProject: () => void
  loadSample: () => void
  /** Switch the active 공정표 시트(예정공정표 ↔ 마일스톤) within the 사업. */
  switchSheet: (id: ID) => void
  /** Rename a 공정표 시트(탭 더블클릭). 활성 시트면 activeSheet도 갱신. */
  renameSheet: (id: ID, name: string) => void

  // tasks
  /** 공정 추가. opts.afterId가 있으면 그 공정 바로 다음에 끼워 넣는다(사이드바 행별 ➕ 삽입). */
  addTask: (categoryId: ID, partial?: Partial<Task>, opts?: { afterId?: ID }) => ID
  updateTask: (id: ID, patch: Partial<Task>, opts?: { history?: boolean }) => void
  /** 여러 공정 색상을 한 번에 지정(다중 선택 색 변경). ids가 1개면 그 하나만. */
  setTasksColor: (ids: ID[], color: string, opts?: { history?: boolean }) => void
  /** 세부공종(WBS 2단계) 일괄 이름변경 — 한 공종 안에서 subName===oldSub 인 공정들의 subName을
   *  newSub로 바꾼다(사이드바 세부공종 헤더 더블클릭). 빈 문자열 newSub = 세부공종 해제(직속). */
  renameSubName: (categoryId: ID, oldSub: string, newSub: string) => void
  setTaskStartLive: (id: ID, startDay: number) => void
  setTaskSpanLive: (id: ID, startDay: number, duration: number) => void
  deleteTask: (id: ID) => void
  toggleMilestone: (id: ID) => void
  /** DUMMY(가상/연결) 공정 표시 토글 — 막대를 공종색 60% 투명으로 렌더(우클릭/인스펙터). */
  toggleDummy: (id: ID) => void
  /** 다중 선택된 공정들을 한 번에 수평 이동(라이브 드래그). gesture는 이미 스냅샷됨. */
  setTasksStartLive: (moves: Array<{ id: ID; start: number }>) => void
  /** 공정을 다른 줄(row)로 보낸다 — 차트 세로 드래그 + 사이드바 드롭. `anchorId` 공정의 줄에 합치거나
   *  (merge) 그 위/아래(above/below)에 새 줄을 만든다. 같은 줄의 공정들은 시작일 순으로
   *  옆으로 배치돼 한 패키지를 한 줄로 표현할 수 있다(굴착→축조→…). */
  moveTaskToRow: (
    id: ID,
    targetCategoryId: ID,
    anchorId: ID | null,
    mode: 'merge' | 'above' | 'below',
    opts?: { history?: boolean },
  ) => void
  // categories
  addCategory: (partial?: Partial<Category>) => ID
  updateCategory: (id: ID, patch: Partial<Category>) => void
  /** 공종 색상 변경 — 그 공종에 속한 모든 공정의 색 override를 지워 새 공종색을 따르게 한다
   *  (사이드바 색상 스와치, 하위 공정 색도 함께 변경). */
  setCategoryColor: (id: ID, color: string) => void
  deleteCategory: (id: ID) => void
  toggleCollapse: (id: ID) => void
  moveCategory: (id: ID, dir: -1 | 1) => void
  /** 공종 드래그 재배치 — `beforeId` 앞으로(null = 맨 끝) 옮기고 order를 0..n-1로 재부여. */
  reorderCategory: (id: ID, beforeId: ID | null) => void
  /** 여러 공종을 한 번에 재배치 — 선택된 공종들을 상대순서 유지한 채 `beforeId` 앞으로
   *  (null = 맨 끝) 옮긴다(Shift 다중선택 드래그). */
  reorderCategories: (ids: ID[], beforeId: ID | null) => void

  // ON/OFF chart visibility
  toggleCategoryVisible: (id: ID) => void
  toggleTaskVisible: (id: ID) => void
  setAllVisible: (visible: boolean) => void

  // links
  startLinking: (fromId: ID) => void
  updateLinkingPointer: (x: number, y: number) => void
  completeLinking: (toId: ID, type?: LinkType) => void
  cancelLinking: () => void
  addLink: (from: ID, to: ID, type?: LinkType, lag?: number) => void
  updateLink: (id: ID, patch: Partial<Link>) => void
  deleteLink: (id: ID) => void

  // project-level
  setPaper: (patch: Partial<PaperSettings>) => void
  setView: (patch: Partial<ViewSettings>) => void
  /** Adjust the view density so the chart fills the current paper with no
   *  export margin (matches content aspect ratio to the sheet). */
  fitToPaper: () => void
  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'startDate'>>) => void
  toggleCommissioning: () => void
  toggleTitle: () => void
  /** 예정공정표↔마일스톤 연동 토글(요구사항 4) — 마일스톤 시트에서만 의미가 있다. */
  toggleMirrorPlan: () => void
  /** 미러로 표시된 예정 공정을 '마일스톤에서만' 숨김/표시 토글(예정 원본은 불변). */
  toggleMirrorHidden: (id: ID) => void
  addLogo: (src: string, w?: number, h?: number) => void
  setLogoSize: (index: number, w: number, h: number) => void
  moveLogo: (index: number, dir: -1 | 1) => void
  removeLogo: (index: number) => void
  setRainySeason: (
    patch: Partial<
      Pick<RainySeason, 'startMonth' | 'startDay' | 'endMonth' | 'endDay' | 'label' | 'efficiency'>
    >,
  ) => void
  clearRainySeasons: () => void

  // typography
  setTextStyle: (role: TextRole, patch: Partial<TextStyle>) => void
  resetTextStyle: (role: TextRole) => void

  // favourite-colour palette (즐겨찾기)
  addPaletteColor: (color: string) => void
  removePaletteColor: (index: number) => void

  // scheduling
  recompute: () => void
  cascadeNow: () => void
  rescheduleNow: () => void
  setAutoCascade: (v: boolean) => void
  closeRecalcReport: () => void

  // selection / view
  selectTask: (id: ID | null) => void
  /** 공정 다중 선택을 토글(Ctrl/⌘+클릭) — id를 누적/해제한다. */
  toggleTaskSelection: (id: ID) => void
  /** 공정 다중 선택을 통째로 설정(표시 순서). */
  selectTasks: (ids: ID[]) => void
  selectLink: (id: ID | null) => void
  selectCategory: (id: ID | null) => void
  /** 다중 선택 설정(ids는 표시 순서, anchor는 Shift 범위선택의 기준 공종). */
  selectCategories: (ids: ID[], anchor: ID | null) => void
  /** 선택한 공종들(+공정+내부연결)을 클립보드에 복사(Ctrl+C). */
  copyCategories: (ids: ID[]) => void
  /** 클립보드의 공종들을 새 id로 맨 끝에 붙여넣기(Ctrl+V). */
  pasteCategories: () => void
  selectTextRole: (role: TextRole | null) => void
  /** 오른쪽 속성 패널 탭 수동 전환(요구사항 3). */
  setInspectorTab: (tab: InspectorTab) => void
  setZoom: (z: number) => void
  setNavMode: (m: NavMode) => void
  setFilter: (patch: Partial<ViewFilter>) => void
  clearFilter: () => void
  setColorMode: (m: ColorMode) => void
  setUiMode: (m: UiMode) => void
  /** 조회 전용 모드 토글(협업 입장 시 편집권한에 따라 CollaborationBridge가 설정). */
  setReadOnly: (v: boolean) => void

  // history & persistence
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
}

// ── helpers ──
const clone = <T>(o: T): T =>
  typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o))

/** Migrate logos that may be plain strings (older schema) into LogoItem[]. */
function normalizeLogos(logos: unknown): LogoItem[] {
  if (!Array.isArray(logos)) return []
  return logos
    .map((l): LogoItem | null => {
      if (typeof l === 'string') return { src: l, w: 168, h: 60 }
      if (l && typeof l === 'object' && typeof (l as LogoItem).src === 'string') {
        const o = l as Partial<LogoItem>
        return { src: o.src as string, w: Number(o.w) || 168, h: Number(o.h) || 60 }
      }
      return null
    })
    .filter((l): l is LogoItem => l !== null)
}

/** Backfill fields that may be missing on older saved projects. */
// 레거시 subName(이름 기반 세부공종 라벨) → 안정적인 parentId(상위 공정 task id) 이관.
// subName S: 같은 공종에 이름 S인 (부모 후보) 평면 공정이 있으면 그 공정을 상위로, 없으면 상위
// 공정 task를 새로 만들어 세부공정을 그 아래에 붙인다. 이름/순서가 바뀌어도 안 흔들린다.
export function migrateSubNameToParentId(tasks: Task[]): Task[] {
  if (!tasks.some((t) => (t.subName ?? '').trim() && !t.parentId)) return tasks
  const out = tasks.map((t) => ({ ...t }))
  const created: Task[] = []
  const byCat = new Map<ID, Task[]>()
  for (const t of out) {
    const arr = byCat.get(t.categoryId)
    if (arr) arr.push(t)
    else byCat.set(t.categoryId, [t])
  }
  for (const [catId, arr] of byCat) {
    const subs = [...new Set(arr.map((t) => (t.subName ?? '').trim()).filter((s) => s !== ''))]
    for (const s of subs) {
      const children = arr.filter((t) => (t.subName ?? '').trim() === s)
      let parent = arr.find((t) => t.name === s && !(t.subName ?? '').trim() && !t.parentId)
      if (!parent) {
        const start = Math.min(...children.map((c) => c.start))
        const end = Math.max(...children.map((c) => c.start + c.duration))
        parent = {
          id: `t-${nanoid(8)}`,
          categoryId: catId,
          name: s,
          start,
          duration: Math.max(1, end - start),
          isMilestone: false,
        }
        created.push(parent)
      }
      for (const c of children) {
        c.parentId = parent.id
        c.subName = undefined
      }
    }
  }
  if (!created.length) return out
  // 새로 만든 상위 공정을 첫 자식 앞에 끼워 배열 순서를 자연스럽게 유지(렌더는 parentId 기준이라
  // 순서와 무관하지만 저장 파일이 읽기 좋게).
  const result: Task[] = []
  const inserted = new Set<ID>()
  for (const t of out) {
    if (t.parentId) {
      const p = created.find((c) => c.id === t.parentId)
      if (p && !inserted.has(p.id)) {
        inserted.add(p.id)
        result.push(p)
      }
    }
    result.push(t)
  }
  return result
}

/**
 * Legacy load adapter: expand `subName` groups into explicit parent tasks exactly once,
 * at an import boundary (file load / initial sample). It must never run on the Y.Doc→view
 * derive path: `migrateSubNameToParentId` mints `nanoid` parent ids, and two collaborating
 * peers deriving the same server state would each invent *different* ids, so the shared
 * document would never converge. `layout.ts` renders raw `subName` natively, so leaving
 * server-authoritative tasks unmigrated is safe.
 */
function migrateProject(project: Project): Project {
  const input = project.tasks ?? []
  const tasks = migrateSubNameToParentId(input)
  return tasks === input ? project : { ...project, tasks }
}

function normalize(project: Project): Project {
  const palette =
    Array.isArray(project.palette) && project.palette.length
      ? project.palette.slice(0, PALETTE_MAX)
      : [...DEFAULT_PALETTE]
  return {
    ...project,
    kind: project.kind ?? 'construction',
    tasks: project.tasks ?? [],
    branding: { logos: normalizeLogos(project.branding?.logos) },
    rainySeasons: (project.rainySeasons ?? []).map((r) => ({
      ...r,
      startDay: r.startDay ?? 1,
      endDay: r.endDay ?? daysInMonth(2001, (r.endMonth ?? 9) - 1),
    })),
    palette,
    view: ((v) => ({
      pxPerDay: v.pxPerDay ?? 1.5,
      rowHeight: v.rowHeight ?? 46,
      labelWidth: v.labelWidth ?? 150,
      headerHeight: v.headerHeight ?? 56,
      scale: v.scale ?? 'month',
      showCriticalPath: v.showCriticalPath ?? true,
      showFloat: v.showFloat ?? false,
      showGrid: v.showGrid ?? true,
      showTitle: v.showTitle !== false,
      fontScale: v.fontScale ?? 1,
      textStyles: v.textStyles ?? {},
      // 왼쪽 공정명 표(공종 하위) — 기본 ON(구버전 프로젝트도 켜짐). 끄면 기존(막대 위 이름)으로.
      taskColumn: v.taskColumn ?? true,
      // 표시 기간 override + 예정↔마일스톤 연동 상태(저장/불러오기 보존 — 옵션이라 없으면 undefined).
      displayStart: v.displayStart,
      displayEnd: v.displayEnd,
      mirrorPlan: v.mirrorPlan,
      mirrorHidden: v.mirrorHidden,
      // 공사기간 구분선 — 연도(세로+제목가로) 기본 ON·2.5px, 월(세로) 기본 ON·1px. 각각 인스펙터 조절.
      showYearLine: v.showYearLine !== false,
      yearLineWidth: v.yearLineWidth ?? 2.5,
      // 월 구분선 기본값은 구버전의 showGrid를 승계(격자 끄고 저장했던 도면은 월선도 꺼진 채 유지).
      showMonthLine: v.showMonthLine ?? v.showGrid ?? true,
      monthLineWidth: v.monthLineWidth ?? 1,
    }))(project.view ?? ({} as Partial<ViewSettings>)),
  }
}

function withSchedule(project: Project): { project: Project; warnings: string[] } {
  const result = computeSchedule(project.tasks, project.links)
  const byId = new Map(result.tasks.map((t) => [t.id, t]))
  const tasks = project.tasks.map((t) => {
    const c = byId.get(t.id)
    if (!c) return t
    // Honour a manual 주공정 override for the displayed critical flag; the CPM
    // values (es/ef/float) still come from the computed schedule.
    const critical = t.forceCritical === undefined ? c.critical : t.forceCritical
    return { ...t, es: c.es, ef: c.ef, ls: c.ls, lf: c.lf, totalFloat: c.totalFloat, critical }
  })
  return { project: { ...project, tasks }, warnings: result.warnings }
}

/** Diff the task starts before/after a schedule mutation into a popup report. */
function buildRecalcReport(
  kind: RecalcReport['kind'],
  before: Map<ID, number>,
  after: Project,
): RecalcReport {
  const changes: RecalcChange[] = []
  for (const t of after.tasks) {
    const old = before.get(t.id)
    if (old === undefined || old === t.start) continue
    changes.push({
      id: t.id,
      name: t.name,
      oldStart: old,
      newStart: t.start,
      deltaDays: t.start - old,
    })
  }
  changes.sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays))
  return { kind, changes, totalMoved: changes.length, startDate: after.startDate }
}

/** Move 후행 공정 `toId` onto the exact start implied by its incoming
 *  FS/SS/FF/SF + lag links (양방향 스냅). No-op when it has no predecessor. */
function snapSuccessor(p: Project, toId: ID): void {
  const s = linkConstrainedStart(p.tasks, p.links, toId)
  if (s == null) return
  const t = p.tasks.find((x) => x.id === toId)
  if (t) t.start = s
}

/** 위치 → 지연(lag) 역산: 막대(`toId`)를 옮기면 그 막대로 들어오는(incoming) 링크들의
 *  지연을 새 위치(선행/후행의 실제 start·finish)에 맞춰 갱신한다. snapSuccessor(지연→위치)의
 *  역방향으로, 드래그와 지연 입력이 서로 반영되게 한다. 선행이 함께 이동하면 갭이 보존돼 lag
 *  불변. 이후 cascade는 이 lag를 기준으로 하므로 옮긴 막대는 제자리에 남고, 하류만 밀린다. */
function relinkIncoming(p: Project, toId: ID): void {
  const to = p.tasks.find((t) => t.id === toId)
  if (!to) return
  for (const l of p.links) {
    if (l.to !== toId || l.from === toId) continue
    const from = p.tasks.find((t) => t.id === l.from)
    if (from) l.lag = linkLagFromPositions(from, to, l.type)
  }
}

const FRACTION_EPSILON = 1e-9

function fractionalMidpoint(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  if (after - before <= FRACTION_EPSILON) return null
  const value = before + (after - before) / 2
  return value > before && value < after ? value : null
}

/** Assign one fractional key per moved item; returns false only when space is exhausted. */
function assignFractionalBlock<T>(
  items: T[],
  before: number | undefined,
  after: number | undefined,
  assign: (item: T, value: number) => void,
): boolean {
  if (!items.length) return true
  if (before !== undefined && after !== undefined) {
    const step = (after - before) / (items.length + 1)
    if (step <= FRACTION_EPSILON) return false
    items.forEach((item, index) => {
      assign(item, before + step * (index + 1))
    })
    return true
  }
  if (before === undefined && after !== undefined) {
    items.forEach((item, index) => {
      assign(item, after - (items.length - index))
    })
    return true
  }
  const start = (before ?? -1) + 1
  items.forEach((item, index) => {
    assign(item, start + index)
  })
  return true
}

function moveTaskFractionally(
  project: Project,
  id: ID,
  targetCategoryId: ID,
  anchorId: ID | null,
  mode: 'merge' | 'above' | 'below',
): void {
  const moving = project.tasks.find((task) => task.id === id)
  if (!moving) return
  moving.categoryId = targetCategoryId
  const lane = project.tasks.filter(
    (task) => task.categoryId === targetCategoryId && task.id !== id,
  )
  let auto = 0
  const rowOf = new Map<ID, number>()
  for (const task of lane) rowOf.set(task.id, typeof task.row === 'number' ? task.row : auto++)
  let rows = [...new Set(lane.map((task) => rowOf.get(task.id) ?? 0))].sort((a, b) => a - b)
  let anchorIndex = anchorId == null ? -1 : rows.indexOf(rowOf.get(anchorId) ?? Number.NaN)

  if (mode === 'merge' && anchorIndex >= 0) {
    const anchorRow = rows[anchorIndex]
    const overlaps = lane
      .filter((task) => rowOf.get(task.id) === anchorRow)
      .some(
        (task) =>
          task.start < moving.start + moving.duration && moving.start < task.start + task.duration,
      )
    if (!overlaps) moving.row = anchorRow
    else mode = 'below'
  }

  if (mode !== 'merge' || anchorIndex < 0) {
    let insertion = anchorIndex < 0 ? rows.length : anchorIndex + (mode === 'below' ? 1 : 0)
    let before = insertion > 0 ? rows[insertion - 1] : undefined
    let after = insertion < rows.length ? rows[insertion] : undefined
    let row = fractionalMidpoint(before, after)
    if (row === null) {
      // Precision exhaustion is exceptional: rebalance only this target lane.
      rows.forEach((oldRow, index) => {
        const nextRow = (index + 1) * 1024
        lane.forEach((task) => {
          if (rowOf.get(task.id) === oldRow) task.row = nextRow
        })
      })
      rows = rows.map((_, index) => (index + 1) * 1024)
      anchorIndex =
        anchorId == null ? -1 : rows.indexOf(lane.find((t) => t.id === anchorId)?.row ?? Number.NaN)
      insertion = anchorIndex < 0 ? rows.length : anchorIndex + (mode === 'below' ? 1 : 0)
      before = insertion > 0 ? rows[insertion - 1] : undefined
      after = insertion < rows.length ? rows[insertion] : undefined
      row = fractionalMidpoint(before, after)
    }
    moving.row = row ?? (before ?? 0) + 1
  }

  const oldIndex = project.tasks.findIndex((task) => task.id === id)
  if (oldIndex >= 0) project.tasks.splice(oldIndex, 1)
  const anchorIndexInTasks = anchorId ? project.tasks.findIndex((task) => task.id === anchorId) : -1
  const insertAt =
    anchorIndexInTasks < 0 ? project.tasks.length : anchorIndexInTasks + (mode === 'above' ? 0 : 1)
  project.tasks.splice(insertAt, 0, moving)
}

function reorderCategoriesFractionally(project: Project, ids: ID[], beforeId: ID | null): void {
  const selected = new Set(ids)
  const sorted = [...project.categories].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  const moving = sorted.filter((category) => selected.has(category.id))
  if (!moving.length) return
  const remaining = sorted.filter((category) => !selected.has(category.id))
  let insertion = remaining.length
  if (beforeId) {
    const requestedIndex = sorted.findIndex((category) => category.id === beforeId)
    const anchor = sorted
      .slice(Math.max(0, requestedIndex))
      .find((category) => !selected.has(category.id))
    const anchorIndex = anchor ? remaining.findIndex((category) => category.id === anchor.id) : -1
    if (anchorIndex >= 0) insertion = anchorIndex
  }

  let before = insertion > 0 ? remaining[insertion - 1].order : undefined
  let after = insertion < remaining.length ? remaining[insertion].order : undefined
  if (
    !assignFractionalBlock(moving, before, after, (category, order) => (category.order = order))
  ) {
    // Rebalance only this category list when fractional precision is exhausted.
    remaining.forEach((category, index) => {
      category.order = (index + 1) * 1024
    })
    before = insertion > 0 ? remaining[insertion - 1].order : undefined
    after = insertion < remaining.length ? remaining[insertion].order : undefined
    assignFractionalBlock(moving, before, after, (category, order) => (category.order = order))
  }
}

/**
 * How a fresh runtime reconciles with an already-persisted IndexedDB document for
 * the same project id. 'seed' (startup/collab) lets the persisted/server doc win;
 * 'replace' (explicit file load / new / sample) overwrites it with the given project.
 */
type HydrationAuthority = 'seed' | 'replace'

export const useEditor = create<EditorState>()((set, get) => {
  const legacySeed = loadLegacyAutosave()
  const initialNormalized = normalize(migrateProject(legacySeed ?? createSampleProject()))
  let runtime: ProjectCrdtRuntime = createProjectCrdtRuntime(initialNormalized)
  let activeSheetId = initialNormalized.activeSheet?.id
  let observing = true
  let runtimeReady = runtime.persistence === null
  let gestureActive = false
  let scheduleDerivation: 'cascade' | 'reschedule' | null = null
  let authoritativeShadow = initialNormalized
  let pendingWrites: Array<{
    mutate: (project: Project) => void
    origin: unknown
    updatedAt: string
    cascade: boolean
  }> = []

  const deriveProject = (authoritative: Project): { project: Project; warnings: string[] } => {
    let derived = authoritative
    if (scheduleDerivation === 'cascade') {
      derived = { ...derived, tasks: applyCascade(derived.tasks, derived.links).tasks }
    } else if (scheduleDerivation === 'reschedule') {
      derived = { ...derived, tasks: reschedule(derived.tasks, derived.links).tasks }
    }
    return withSchedule(derived)
  }

  const readRuntimeProject = (): { project: Project; warnings: string[] } => {
    authoritativeShadow = normalize(projectFromYDoc(runtime.doc, activeSheetId))
    return deriveProject(authoritativeShadow)
  }

  const syncDerivedView = (dirty = true): void => {
    if (!observing || !runtimeReady) return
    const scheduled = readRuntimeProject()
    if (scheduled.warnings.length) {
      scheduled.warnings.forEach((warning) => {
        logWarn(warning)
      })
    }
    set({ project: scheduled.project, warnings: scheduled.warnings, dirty })
  }

  function finishRuntimeHydration(
    target: ProjectCrdtRuntime,
    dirty: boolean,
    authority: HydrationAuthority = 'seed',
  ): void {
    if (runtime !== target) return
    observing = false
    if (authority === 'replace') {
      // An explicit local load/import/new is authoritative: overwrite any stale
      // IndexedDB-persisted document for this project id. Otherwise re-importing a
      // project you had previously edited reverts to the cached CRDT doc and the
      // loaded .json never reaches the render view. SEED_ORIGIN keeps this write
      // out of undo history while still persisting to IndexedDB.
      applyProjectToYDoc(target.doc, authoritativeShadow, SEED_ORIGIN)
    } else {
      // Empty rooms are seeded only after IndexedDB and the provider (when used)
      // have both had their first chance to supply authority.
      seedProjectYDocIfEmpty(target.doc, authoritativeShadow)
    }
    runtimeReady = true
    authoritativeShadow = normalize(projectFromYDoc(target.doc, activeSheetId))
    for (const pending of pendingWrites) {
      const replay = clone(authoritativeShadow)
      replay.meta = { ...replay.meta, updatedAt: pending.updatedAt }
      pending.mutate(replay)
      authoritativeShadow = replay
      if (pending.cascade) scheduleDerivation = 'cascade'
      applyProjectToYDoc(target.doc, replay, pending.origin)
    }
    pendingWrites = []
    observing = true
    syncDerivedView(dirty)
  }

  const observeRoot = (): (() => void) => {
    const listener = (): void => {
      syncDerivedView(true)
    }
    const observed = [
      runtime.types.meta,
      runtime.types.view,
      runtime.types.paper,
      runtime.types.branding,
      runtime.types.palette,
      runtime.types.categories,
      runtime.types.tasks,
      runtime.types.links,
      runtime.types.rainySeasons,
      runtime.types.sheets,
    ]
    observed.forEach((type) => {
      type.observeDeep(listener)
    })
    return () => {
      observed.forEach((type) => {
        type.unobserveDeep(listener)
      })
    }
  }
  let unobserveRoot = observeRoot()
  activateProjectCrdtRuntime(runtime)

  const selectionBeforeKey = 'sequence:selection-before'
  const selectionAfterKey = 'sequence:selection-after'
  const captureSelection = (): SelectionSnapshot => {
    const state = get()
    return {
      selectedTaskId: state.selectedTaskId,
      selectedTaskIds: [...state.selectedTaskIds],
      selectedLinkId: state.selectedLinkId,
      selectedCategoryId: state.selectedCategoryId,
      selectedCategoryIds: [...state.selectedCategoryIds],
      selectedTextRole: state.selectedTextRole,
      inspectorTab: state.inspectorTab,
    }
  }
  const restoreSelection = (selection: SelectionSnapshot | undefined): void => {
    if (!selection) return
    set({ ...selection })
  }
  const bindUndoManager = (target: ProjectCrdtRuntime): (() => void) => {
    const refresh = (): void => {
      if (runtime !== target) return
      set({
        canUndo: target.undoManager.undoStack.length > 0,
        canRedo: target.undoManager.redoStack.length > 0,
      })
    }
    const onAdded = (event: {
      stackItem: UndoStackItemLike
      origin: unknown
      type: 'undo' | 'redo'
    }) => {
      if (
        event.type === 'undo' &&
        event.origin === LOCAL_ORIGIN &&
        !event.stackItem.meta.has(selectionBeforeKey)
      ) {
        event.stackItem.meta.set(selectionBeforeKey, captureSelection())
      }
      refresh()
    }
    target.undoManager.on('stack-item-added', onAdded)
    target.undoManager.on('stack-item-updated', onAdded)
    target.undoManager.on('stack-item-popped', refresh)
    target.undoManager.on('stack-cleared', refresh)
    return () => {
      target.undoManager.off('stack-item-added', onAdded)
      target.undoManager.off('stack-item-updated', onAdded)
      target.undoManager.off('stack-item-popped', refresh)
      target.undoManager.off('stack-cleared', refresh)
    }
  }
  let unbindUndoManager = bindUndoManager(runtime)

  const armRuntimeReady = (
    target: ProjectCrdtRuntime,
    dirty: boolean,
    authority: HydrationAuthority = 'seed',
  ): void => {
    void target.hydrated.then(() => {
      if (runtime !== target) return
      finishRuntimeHydration(target, dirty, authority)
    })
  }

  const replaceRuntime = (
    project: Project,
    dirty: boolean,
    replacement?: ProjectCrdtRuntime,
    authority: HydrationAuthority = 'seed',
  ): void => {
    const normalized = normalize(migrateProject(project))
    const previous = runtime
    observing = false
    unobserveRoot()
    unbindUndoManager()
    runtime = replacement ?? createProjectCrdtRuntime(normalized)
    activeSheetId = normalized.activeSheet?.id
    runtimeReady = !projectYDocIsEmpty(runtime.types)
    gestureActive = false
    scheduleDerivation = null
    authoritativeShadow = normalized
    pendingWrites = []
    unobserveRoot = observeRoot()
    unbindUndoManager = bindUndoManager(runtime)
    activateProjectCrdtRuntime(runtime)
    previous.destroy()
    observing = true
    const scheduled = runtimeReady ? readRuntimeProject() : deriveProject(normalized)
    set({
      project: scheduled.project,
      warnings: scheduled.warnings,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      dirty,
    })
    armRuntimeReady(runtime, dirty, authority)
  }

  /** Apply a mutation to the Y.Doc truth, then derive the zustand render view. */
  function commit(
    mutate: (p: Project) => void,
    opts: { history?: boolean; cascade?: boolean; origin?: unknown } = {},
  ) {
    const { history = true, cascade = false } = opts
    // 조회 전용(편집 권한 없음)이면 어떤 변경도 적용하지 않는다.
    if (get().readOnly) return
    const state = get()
    const draft = clone(authoritativeShadow)
    const updatedAt = new Date().toISOString()
    draft.meta = { ...draft.meta, updatedAt }
    mutate(draft)
    authoritativeShadow = draft
    if (cascade && state.autoCascade) scheduleDerivation = 'cascade'

    if (history) {
      runtime.undoManager.stopCapturing()
      gestureActive = false
    }
    const origin = opts.origin ?? (history || gestureActive ? LOCAL_ORIGIN : UNTRACKED_ORIGIN)
    if (runtimeReady) applyProjectToYDoc(runtime.doc, draft, origin)
    else pendingWrites.push({ mutate, origin, updatedAt, cascade: cascade && state.autoCascade })

    if (runtimeReady) syncDerivedView(true)
    else {
      const scheduled = deriveProject(authoritativeShadow)
      set({ project: scheduled.project, warnings: scheduled.warnings, dirty: true })
    }
  }

  // 재시작 시 마지막 작업 복원 — localStorage 캐시가 있으면 그걸, 없으면 샘플로 시작.
  const initial = runtimeReady
    ? readRuntimeProject().project
    : deriveProject(initialNormalized).project
  const initialDirty = false
  armRuntimeReady(runtime, initialDirty)

  return {
    project: initial,
    selectedTaskId: null,
    selectedTaskIds: [],
    selectedLinkId: null,
    selectedCategoryId: null,
    selectedCategoryIds: [],
    categoryClipboard: null,
    selectedTextRole: null,
    inspectorTab: 'project',
    linking: null,
    zoom: 1,
    navMode: 'edit',
    filter: { ...FILTER_OFF },
    colorMode: lsGet('sequence:colorMode', 'category') as ColorMode,
    // 간단/전문가 토글 제거(2026-06-22) → 항상 전체 기능 노출. 과거 'simple'이
    // localStorage에 남아 기능이 숨겨진 채 갇히지 않도록 'pro'로 고정한다.
    uiMode: 'pro' as UiMode,
    autoCascade: true,
    readOnly: false,
    dirty: initialDirty,
    warnings: [],
    recalcReport: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    setProject: (p) => replaceRuntime(p, false, undefined, 'replace'),
    importProjectContent: (p) => {
      // Keep the current room id so the CollaborationBridge does not treat this as a
      // different project and revert us. The loaded content becomes the room's truth
      // and — with an active provider — syncs to every teammate.
      const currentId = get().project.id
      const incoming = normalize(migrateProject({ ...clone(p), id: currentId }))
      activeSheetId = incoming.activeSheet?.id
      runtime.undoManager.stopCapturing()
      gestureActive = false
      scheduleDerivation = null
      authoritativeShadow = incoming
      if (runtimeReady) {
        applyProjectToYDoc(runtime.doc, incoming, LOCAL_ORIGIN)
        syncDerivedView(true)
      } else {
        // Import issued before hydration finished: force the loaded content to win
        // once the room is ready (overwrite, not seed-if-empty).
        pendingWrites.push({
          mutate: (draft) => {
            const bag = draft as unknown as Record<string, unknown>
            for (const key of Object.keys(bag)) delete bag[key]
            Object.assign(bag, clone(incoming))
          },
          origin: LOCAL_ORIGIN,
          updatedAt: incoming.meta.updatedAt,
          cascade: false,
        })
        const scheduled = deriveProject(incoming)
        set({ project: scheduled.project, warnings: scheduled.warnings, dirty: true })
      }
      set({
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedLinkId: null,
        selectedCategoryId: null,
        selectedCategoryIds: [],
        selectedTextRole: null,
      })
      logInfo('불러온 파일을 현재 프로젝트에 적용했습니다.')
    },
    openCollaborativeProject: (projectId, name = '협업 프로젝트') => {
      const placeholder = normalize(createSampleProject())
      placeholder.id = projectId
      placeholder.name = name
      placeholder.categories = []
      placeholder.tasks = []
      placeholder.links = []
      placeholder.rainySeasons = []
      placeholder.sheets = undefined
      placeholder.activeSheet = undefined
      const collaborative = createUnseededProjectCrdtRuntime(projectId)
      replaceRuntime(placeholder, false, collaborative)
      set({
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedLinkId: null,
        selectedCategoryId: null,
        selectedCategoryIds: [],
      })
    },
    newProject: () => {
      const blank = createSampleProject()
      blank.id = `proj-${nanoid(8)}`
      blank.name = '새 프로젝트'
      blank.tasks = []
      blank.links = []
      replaceRuntime(blank, true, undefined, 'replace')
      set({ selectedTaskId: null })
      logInfo('새 프로젝트를 생성했습니다.')
    },
    loadSample: () => {
      replaceRuntime(createSampleProject(), false, undefined, 'replace')
      set({ selectedTaskId: null })
      logInfo('샘플 프로젝트를 불러왔습니다.')
    },
    switchSheet: (id) => {
      const p = get().project
      if (!p.sheets || !p.activeSheet || id === p.activeSheet.id) return
      const target = p.sheets.find((s) => s.id === id)
      if (!target) return
      activeSheetId = id
      runtime.undoManager.clear()
      const scheduled = readRuntimeProject()
      set({
        project: scheduled.project,
        warnings: scheduled.warnings,
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedLinkId: null,
        selectedTextRole: null,
      })
      logInfo(`공정표 전환: ${target.name}`)
    },
    renameSheet: (id, name) => {
      const v = name.trim()
      if (!v) return
      commit(
        (p) => {
          if (p.activeSheet?.id === id) p.activeSheet = { ...p.activeSheet, name: v }
          const s = p.sheets?.find((x) => x.id === id)
          if (s) s.name = v
        },
        { history: false },
      )
    },

    addTask: (categoryId, partial, opts) => {
      const id = `t-${nanoid(8)}`
      commit((p) => {
        const maxEnd = p.tasks
          .filter((t) => t.categoryId === categoryId)
          .reduce((m, t) => Math.max(m, t.start + t.duration), 0)
        // afterId가 주어지면 그 공정 **바로 다음** 위치에 끼워 넣는다(사이드바 행별 ➕ 삽입).
        // 삽입 시 시작일은 기준 공정과 같게 둬 새 항목이 그 근처에 뜨게 한다(맨 아래로 튀지 않음).
        const anchorIdx = opts?.afterId ? p.tasks.findIndex((t) => t.id === opts.afterId) : -1
        const anchor = anchorIdx >= 0 ? p.tasks[anchorIdx] : undefined
        const task: Task = {
          id,
          categoryId,
          name: partial?.name ?? '새 공정',
          start: partial?.start ?? (anchor ? anchor.start : maxEnd),
          duration: partial?.duration ?? 30,
          isMilestone: partial?.isMilestone ?? false,
          ...partial,
        }
        if (anchor) p.tasks.splice(anchorIdx + 1, 0, task)
        else p.tasks.push(task)
      })
      set({ selectedTaskId: id, selectedLinkId: null })
      return id
    },
    updateTask: (id, patch, opts) => {
      const affectsSchedule = 'start' in patch || 'duration' in patch
      // Live-ish edits (free-text subName, color-picker drag) pass history:false to
      // avoid flooding the undo stack with one entry per keystroke / drag step.
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t) Object.assign(t, patch)
          // 위치(시작·기간)를 바꾸면 incoming 링크 지연을 새 위치에 맞춰 역산(위치↔지연 상호작용).
          if (affectsSchedule) relinkIncoming(p, id)
        },
        { cascade: affectsSchedule, history: opts?.history ?? true },
      )
    },
    setTasksColor: (ids, color, opts) => {
      const set = new Set(ids)
      commit(
        (p) => {
          for (const t of p.tasks) if (set.has(t.id)) t.color = color
        },
        { history: opts?.history ?? true },
      )
    },
    renameSubName: (categoryId, oldSub, newSub) => {
      const next = newSub.trim()
      commit((p) => {
        for (const t of p.tasks) {
          if (t.categoryId === categoryId && (t.subName ?? '') === oldSub) {
            if (next) t.subName = next
            else t.subName = undefined
          }
        }
      })
    },
    setTaskStartLive: (id, startDay) => {
      // No history push (gesture already snapshotted); cascade respected. 옮긴 막대의
      // incoming 링크 지연을 새 위치로 역산해 위치↔지연이 항상 일치하게 한다.
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          // 시작일은 프로젝트 시작(day 0) 이전(음수)도 허용 — 공사기간 좌우 자유 이동.
          if (t) t.start = Math.round(startDay)
          relinkIncoming(p, id)
        },
        { history: false, cascade: true },
      )
    },
    setTasksStartLive: (moves) => {
      // 다중 선택 공정을 한 제스처로 동시 수평 이동(cascade 1회). gesture 스냅샷은 호출 측.
      commit(
        (p) => {
          for (const m of moves) {
            const t = p.tasks.find((x) => x.id === m.id)
            if (t) t.start = Math.round(m.start) // day 0 이전(음수) 허용 — 자유 이동
          }
          // 모든 start 반영 후 지연 역산 — 같은 선택 안의 선후행은 갭 보존(lag 불변).
          for (const m of moves) relinkIncoming(p, m.id)
        },
        { history: false, cascade: true },
      )
    },
    setTaskSpanLive: (id, startDay, duration) => {
      // Live edge-resize of a bar (start + duration). Gesture already snapshotted.
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t && !t.isMilestone) {
            t.start = Math.round(startDay) // day 0 이전(음수) 허용 — 자유 이동
            t.duration = Math.max(1, Math.round(duration))
            relinkIncoming(p, id)
          }
        },
        { history: false, cascade: true },
      )
    },
    deleteTask: (id) => {
      const removed = new Set<ID>([id])
      commit((p) => {
        // 상위 공정을 지우면 그 아래 세부공정(parentId=이 공정 id)도 함께 지운다 — 안 그러면
        // 상위만 사라지고 세부공정이 부모 없는 채로 남는다. id 기준이라 이름 충돌과 무관.
        for (const c of p.tasks) if (c.parentId === id) removed.add(c.id)
        p.tasks = p.tasks.filter((x) => !removed.has(x.id))
        p.links = p.links.filter((l) => !removed.has(l.from) && !removed.has(l.to))
      })
      set((s) => ({
        selectedTaskId: s.selectedTaskId && removed.has(s.selectedTaskId) ? null : s.selectedTaskId,
        selectedTaskIds: s.selectedTaskIds.filter((x) => !removed.has(x)),
      }))
    },
    toggleMilestone: (id) => {
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t) {
            t.isMilestone = !t.isMilestone
            if (t.isMilestone) t.duration = 0
            else if (t.duration === 0) t.duration = 30
          }
        },
        { cascade: true },
      )
    },
    toggleDummy: (id) =>
      commit((p) => {
        const t = p.tasks.find((x) => x.id === id)
        if (t) t.isDummy = !t.isDummy
      }),
    moveTaskToRow: (id, targetCategoryId, anchorId, mode, opts) => {
      commit((project) => moveTaskFractionally(project, id, targetCategoryId, anchorId, mode), {
        history: opts?.history ?? true,
        cascade: false,
      })
      set({ selectedTaskId: id, selectedLinkId: null })
    },
    addCategory: (partial) => {
      const id = `c-${nanoid(8)}`
      commit((p) => {
        p.categories.push({
          id,
          name: partial?.name ?? '새 공종',
          color: partial?.color ?? '#7C93A8',
          collapsed: false,
          order: p.categories.length,
          ...partial,
        })
      })
      set({ selectedCategoryId: id, selectedCategoryIds: [id] })
      return id
    },
    updateCategory: (id, patch) =>
      commit((p) => {
        const c = p.categories.find((x) => x.id === id)
        if (c) Object.assign(c, patch)
      }),
    setCategoryColor: (id, color) =>
      commit(
        (p) => {
          const c = p.categories.find((x) => x.id === id)
          if (!c) return
          c.color = color
          // 하위 공정의 개별 색 override 제거 → 전부 새 공종색을 따른다(요구: 다 바뀌게).
          for (const t of p.tasks) if (t.categoryId === id) t.color = undefined
        },
        { history: false },
      ),
    deleteCategory: (id) => {
      commit((p) => {
        p.categories = p.categories.filter((c) => c.id !== id)
        const removed = new Set(p.tasks.filter((t) => t.categoryId === id).map((t) => t.id))
        p.tasks = p.tasks.filter((t) => t.categoryId !== id)
        p.links = p.links.filter((l) => !removed.has(l.from) && !removed.has(l.to))
      })
      // 삭제된 공종 id가 다중선택에 잔존하지 않도록 정리(deleteTask/deleteLink와 동일 위생).
      set((s) => {
        const ids = s.selectedCategoryIds.filter((x) => x !== id)
        return {
          selectedCategoryIds: ids,
          selectedCategoryId:
            s.selectedCategoryId === id ? (ids[ids.length - 1] ?? null) : s.selectedCategoryId,
        }
      })
    },
    toggleCollapse: (id) =>
      commit(
        (p) => {
          const c = p.categories.find((x) => x.id === id)
          if (c) c.collapsed = !c.collapsed
        },
        { history: false },
      ),
    moveCategory: (id, dir) =>
      commit((p) => {
        const sorted = [...p.categories].sort((a, b) => a.order - b.order)
        const idx = sorted.findIndex((c) => c.id === id)
        const swap = idx + dir
        if (idx < 0 || swap < 0 || swap >= sorted.length) return
        const beforeId = dir < 0 ? sorted[swap].id : (sorted[idx + 2]?.id ?? null)
        reorderCategoriesFractionally(p, [id], beforeId)
      }),
    reorderCategory: (id, beforeId) => {
      if (beforeId === id) return // 자기 자신 앞으로 = 무동작
      commit((p) => reorderCategoriesFractionally(p, [id], beforeId))
      set({ selectedCategoryId: id, selectedCategoryIds: [id] })
    },
    reorderCategories: (ids, beforeId) => {
      const idset = new Set(ids)
      if (idset.size <= 1) {
        get().reorderCategory(ids[0], beforeId)
        return
      }
      commit((p) => reorderCategoriesFractionally(p, ids, beforeId))
      set({ selectedCategoryIds: ids, selectedCategoryId: ids[ids.length - 1] ?? null })
    },

    toggleCategoryVisible: (id) =>
      commit(
        (p) => {
          const c = p.categories.find((x) => x.id === id)
          if (!c) return
          c.hidden = !c.hidden
          // Turning a lane ON also reveals its activities, so a 공종 switched back on
          // (e.g. after 전체 OFF) never renders as an empty lane. The 공종 switch thus
          // acts as the master for its own tasks.
          if (!c.hidden) for (const t of p.tasks) if (t.categoryId === id) t.hidden = false
        },
        { history: false },
      ),
    toggleTaskVisible: (id) =>
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t) t.hidden = !t.hidden
        },
        { history: false },
      ),
    setAllVisible: (visible) =>
      commit(
        (p) => {
          const hidden = !visible
          for (const c of p.categories) c.hidden = hidden
          for (const t of p.tasks) t.hidden = hidden
        },
        { history: false },
      ),

    startLinking: (fromId) => set({ linking: { fromId, pointer: null }, selectedTaskId: fromId }),
    updateLinkingPointer: (x, y) =>
      set((s) => (s.linking ? { linking: { ...s.linking, pointer: { x, y } } } : {})),
    completeLinking: (toId, type = 'FS') => {
      const linking = get().linking
      if (linking && linking.fromId !== toId) get().addLink(linking.fromId, toId, type)
      set({ linking: null })
    },
    cancelLinking: () => set({ linking: null }),
    addLink: (from, to, type = 'FS', lag = 0) => {
      const exists = get().project.links.some((l) => l.from === from && l.to === to)
      if (exists) {
        logWarn('이미 동일한 연결이 존재합니다.')
        return
      }
      const id = `l-${nanoid(8)}`
      commit(
        (p) => {
          const successor = p.tasks.find((t) => t.id === to)
          const predecessor = p.tasks.find((t) => t.id === from)
          if (successor && predecessor) {
            // 이 링크를 포함해서 후행 공정이 있어야 할 이론적 시작일 계산
            const existingIncoming = p.links.filter((l) => l.to === to)
            const tempLinks = [...existingIncoming, { id, from, to, type, lag: 0 }]
            const theoreticalStart = linkConstrainedStart(p.tasks, tempLinks, to)

            // 후행 공정의 현재 시작일이 이론적 시작일보다 늦은 경우,
            // 그 차이만큼을 lag로 자동 설정 (공정 막대는 그대로 유지)
            if (theoreticalStart != null && successor.start > theoreticalStart) {
              lag = successor.start - theoreticalStart
            }
          }
          p.links.push({ id, from, to, type, lag })
          // snapSuccessor 호출 제거: 후행 공정 위치를 그대로 유지
        },
        { cascade: true },
      )
      set({ selectedLinkId: id })
    },
    updateLink: (id, patch) => {
      // lag/type 변경은 후행 공정 위치를 양방향으로 다시 맞춘다(스냅). style 등
      // 비-일정 변경은 일정·재계산을 건드리지 않는다.
      const moves = 'lag' in patch || 'type' in patch
      commit(
        (p) => {
          const l = p.links.find((x) => x.id === id)
          if (!l) return
          Object.assign(l, patch)
          if (moves) snapSuccessor(p, l.to)
        },
        { cascade: moves },
      )
    },
    deleteLink: (id) => {
      commit((p) => {
        p.links = p.links.filter((l) => l.id !== id)
      })
      set((s) => ({ selectedLinkId: s.selectedLinkId === id ? null : s.selectedLinkId }))
    },

    setPaper: (patch) =>
      commit(
        (p) => {
          p.paper = { ...p.paper, ...patch }
        },
        { history: false },
      ),
    setView: (patch) =>
      commit(
        (p) => {
          p.view = { ...p.view, ...patch }
        },
        { history: false },
      ),
    fitToPaper: () => {
      const p = get().project
      const { w, h } = paperMm(p.paper.size, p.paper.orientation)
      const patch = fitToPaperView(p, w, h)
      if (
        patch.pxPerDay === undefined &&
        patch.rowHeight === undefined &&
        patch.fontScale === undefined
      ) {
        logInfo('이미 용지 비율·글자 크기에 맞춰져 있습니다.')
        return
      }
      commit(
        (d) => {
          d.view = { ...d.view, ...patch }
        },
        { history: false },
      )
      logInfo('현재 용지 규격에 맞춰 여백 없이 채우고 글자 크기를 조정했습니다.')
    },
    // history:false — 이름/시작일은 자유텍스트 입력(키 입력마다 undo 누적 방지, subName/색
    // 편집과 동일 정책). startDate는 day-offset 기준이라 CPM에 영향 없음.
    setProjectMeta: (patch) =>
      commit(
        (p) => {
          Object.assign(p, patch)
        },
        { history: false },
      ),
    toggleCommissioning: () =>
      commit((p) => {
        p.commissioningEnabled = !p.commissioningEnabled
      }),
    toggleTitle: () =>
      commit(
        (p) => {
          p.view.showTitle = p.view.showTitle === false
        },
        { history: false },
      ),
    toggleMirrorPlan: () =>
      commit(
        (p) => {
          p.view = { ...p.view, mirrorPlan: !p.view.mirrorPlan }
        },
        { history: false },
      ),
    toggleMirrorHidden: (id) =>
      commit(
        (p) => {
          const cur = new Set(p.view.mirrorHidden ?? [])
          if (cur.has(id)) cur.delete(id)
          else cur.add(id)
          p.view = { ...p.view, mirrorHidden: [...cur] }
        },
        { history: false },
      ),
    addLogo: (src, w = 168, h = 60) =>
      commit((p) => {
        if (!p.branding) p.branding = { logos: [] }
        p.branding.logos.push({ src, w, h })
      }),
    setLogoSize: (index, w, h) =>
      commit(
        (p) => {
          const lg = p.branding?.logos?.[index]
          if (lg) {
            lg.w = Math.max(32, Math.round(w))
            lg.h = Math.max(16, Math.round(h))
          }
        },
        { history: false },
      ),
    moveLogo: (index, dir) =>
      commit((p) => {
        const arr = p.branding?.logos
        if (!arr) return
        const j = index + dir
        if (j < 0 || j >= arr.length) return
        const tmp = arr[index]
        arr[index] = arr[j]
        arr[j] = tmp
      }),
    removeLogo: (index) =>
      commit((p) => {
        if (p.branding?.logos) p.branding.logos.splice(index, 1)
      }),
    setRainySeason: (patch) =>
      commit(
        (p) => {
          const base: RainySeason = p.rainySeasons[0] ?? {
            id: 'rs-1',
            label: '우기',
            startMonth: 6,
            startDay: 1,
            endMonth: 9,
            endDay: 30,
            efficiency: 0.7,
          }
          const next = { ...base, ...patch }
          // Keep the window non-wrapping (start on/before end by day-of-year): whichever
          // edge the patch moved is clamped against the other, so it can never invert
          // or collapse into a full-year band. Days are capped to the month length.
          next.startDay = Math.min(next.startDay, daysInMonth(2001, next.startMonth - 1))
          next.endDay = Math.min(next.endDay, daysInMonth(2001, next.endMonth - 1))
          const sDoy = monthDayToDoy(next.startMonth, next.startDay)
          const eDoy = monthDayToDoy(next.endMonth, next.endDay)
          if (sDoy > eDoy) {
            if ('startMonth' in patch || 'startDay' in patch) {
              const c = doyToMonthDay(eDoy)
              next.startMonth = c.month
              next.startDay = c.day
            } else {
              const c = doyToMonthDay(sDoy)
              next.endMonth = c.month
              next.endDay = c.day
            }
          }
          p.rainySeasons = [next]
        },
        { history: false },
      ),
    clearRainySeasons: () =>
      commit(
        (p) => {
          p.rainySeasons = []
        },
        { history: false },
      ),

    setTextStyle: (role, patch) =>
      commit(
        (p) => {
          const next = { ...(p.view.textStyles ?? {}) }
          next[role] = { ...(next[role] ?? {}), ...patch }
          p.view = { ...p.view, textStyles: next }
        },
        { history: false },
      ),
    resetTextStyle: (role) =>
      commit(
        (p) => {
          if (!p.view.textStyles) return
          const next = { ...p.view.textStyles }
          delete next[role]
          p.view = { ...p.view, textStyles: next }
        },
        { history: false },
      ),

    addPaletteColor: (color) =>
      commit(
        (p) => {
          const c = (color || '').trim()
          if (!c) return
          const cur = p.palette ?? []
          if (cur.some((x) => x.toLowerCase() === c.toLowerCase())) return
          if (cur.length >= PALETTE_MAX) return // never exceed 10
          p.palette = [...cur, c]
        },
        { history: false },
      ),
    removePaletteColor: (index) =>
      commit(
        (p) => {
          if (!p.palette) return
          p.palette = p.palette.filter((_, i) => i !== index)
        },
        { history: false },
      ),

    recompute: () => set((s) => ({ project: withSchedule(s.project).project })),
    cascadeNow: () => {
      const before = new Map(get().project.tasks.map((t) => [t.id, t.start]))
      scheduleDerivation = 'cascade'
      const scheduled = deriveProject(authoritativeShadow)
      set({ project: scheduled.project, warnings: scheduled.warnings })
      set({ recalcReport: buildRecalcReport('cascade', before, get().project) })
      logInfo('연쇄 일정 정렬을 적용했습니다.')
    },
    rescheduleNow: () => {
      const before = new Map(get().project.tasks.map((t) => [t.id, t.start]))
      scheduleDerivation = 'reschedule'
      const scheduled = deriveProject(authoritativeShadow)
      set({ project: scheduled.project, warnings: scheduled.warnings })
      set({ recalcReport: buildRecalcReport('reschedule', before, get().project) })
      logInfo('전체 일정을 최조기(最早期)로 재계산했습니다.')
    },
    setAutoCascade: (v) => {
      if (!v && scheduleDerivation === 'cascade') scheduleDerivation = null
      const scheduled = deriveProject(authoritativeShadow)
      set({ autoCascade: v, project: scheduled.project, warnings: scheduled.warnings })
    },
    closeRecalcReport: () => set({ recalcReport: null }),

    selectTask: (id) =>
      set({
        selectedTaskId: id,
        selectedTaskIds: id ? [id] : [],
        selectedLinkId: null,
        selectedTextRole: null,
        ...(id ? { inspectorTab: 'task' as InspectorTab } : {}),
      }),
    toggleTaskSelection: (id) =>
      set((s) => {
        const has = s.selectedTaskIds.includes(id)
        const ids = has ? s.selectedTaskIds.filter((x) => x !== id) : [...s.selectedTaskIds, id]
        return {
          selectedTaskIds: ids,
          selectedTaskId: ids.length ? ids[ids.length - 1] : null,
          selectedLinkId: null,
          selectedTextRole: null,
          inspectorTab: (ids.length ? 'task' : s.inspectorTab) as InspectorTab,
        }
      }),
    selectTasks: (ids) =>
      set({
        selectedTaskIds: [...ids],
        selectedTaskId: ids.length ? ids[ids.length - 1] : null,
        selectedLinkId: null,
        selectedTextRole: null,
        ...(ids.length ? { inspectorTab: 'task' as InspectorTab } : {}),
      }),
    selectLink: (id) =>
      set({
        selectedLinkId: id,
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedTextRole: null,
        ...(id ? { inspectorTab: 'link' as InspectorTab } : {}),
      }),
    selectCategory: (id) => set({ selectedCategoryId: id, selectedCategoryIds: id ? [id] : [] }),
    selectCategories: (ids, anchor) =>
      set({ selectedCategoryIds: ids, selectedCategoryId: anchor }),
    copyCategories: (ids) => {
      const p = get().project
      const idset = new Set(ids)
      const categories = p.categories.filter((c) => idset.has(c.id))
      if (!categories.length) return
      const tasks = p.tasks.filter((t) => idset.has(t.categoryId))
      const taskIds = new Set(tasks.map((t) => t.id))
      const links = p.links.filter((l) => taskIds.has(l.from) && taskIds.has(l.to))
      set({
        categoryClipboard: {
          categories: clone(categories),
          tasks: clone(tasks),
          links: clone(links),
        },
      })
      logInfo(`공종 ${categories.length}개를 복사했습니다.`)
    },
    pasteCategories: () => {
      const clip = get().categoryClipboard
      if (!clip?.categories.length) return
      // 붙여넣기 기준 = 현재 선택된 공종 바로 뒤(없으면 맨 끝). 무조건 맨 아래로 붙던 동작 교체.
      const anchorId = get().selectedCategoryId
      const newIds: ID[] = []
      commit((p) => {
        const catMap = new Map<ID, ID>() // 원본 공종 id → 새 id
        const taskMap = new Map<ID, ID>() // 원본 공정 id → 새 id (내부 연결 재배선용)
        const newCats: Category[] = []
        for (const c of clip.categories) {
          const nid = `c-${nanoid(8)}`
          catMap.set(c.id, nid)
          newIds.push(nid)
          newCats.push({ ...clone(c), id: nid, order: 0 }) // order는 아래에서 일괄 재부여
        }
        // 1차: 모든 공정에 새 id를 부여해 taskMap을 먼저 채운다(세부공정 parentId 재매핑용 —
        //      세부공정이 배열상 상위 공정보다 먼저 올 수 있어 2패스 필요).
        const pasted: Task[] = []
        for (const t of clip.tasks) {
          const cat = catMap.get(t.categoryId)
          if (!cat) continue
          const nid = `t-${nanoid(8)}`
          taskMap.set(t.id, nid)
          pasted.push({ ...clone(t), id: nid, categoryId: cat })
        }
        // 2차: 세부공정의 상위 공정 참조(parentId)를 새 id로 재배선한 뒤 삽입한다.
        //      (재매핑 누락 시 세부공정이 원본 상위 공정을 가리켜 하위 공정·세부공정이 깨졌음.)
        //      복사 묶음 밖을 가리키면(정상적으론 없음) 세부공정 관계를 해제한다.
        for (const nt of pasted) {
          if (nt.parentId) nt.parentId = taskMap.get(nt.parentId)
          p.tasks.push(nt)
        }
        for (const l of clip.links) {
          const from = taskMap.get(l.from),
            to = taskMap.get(l.to)
          if (from && to) p.links.push({ ...clone(l), id: `l-${nanoid(8)}`, from, to })
        }
        // 선택된 공종 바로 뒤에 삽입한 뒤 order를 0..n-1로 재부여.
        const sorted = [...p.categories].sort((a, b) => a.order - b.order)
        let insertAt = sorted.length
        if (anchorId) {
          const ai = sorted.findIndex((c) => c.id === anchorId)
          if (ai >= 0) insertAt = ai + 1
        }
        sorted.splice(insertAt, 0, ...newCats)
        sorted.forEach((c, i) => {
          c.order = i
        })
        p.categories = sorted
      })
      set({ selectedCategoryIds: newIds, selectedCategoryId: newIds[newIds.length - 1] ?? null })
      logInfo(`공종 ${clip.categories.length}개를 붙여넣었습니다.`)
    },
    selectTextRole: (role) =>
      set({
        selectedTextRole: role,
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedLinkId: null,
        ...(role ? { inspectorTab: 'text' as InspectorTab } : {}),
      }),
    setInspectorTab: (tab) => set({ inspectorTab: tab }),
    setZoom: (z) => set({ zoom: Math.min(6, Math.max(0.25, z)) }),
    setNavMode: (m) => set({ navMode: m }),
    setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
    clearFilter: () => set({ filter: { ...FILTER_OFF } }),
    setColorMode: (m) => {
      lsSet('sequence:colorMode', m)
      set({ colorMode: m })
    },
    setUiMode: (m) => {
      lsSet('sequence:uiMode', m)
      set({ uiMode: m })
    },
    setReadOnly: (v) => set({ readOnly: v }),

    beginGesture: () => {
      runtime.undoManager.stopCapturing()
      gestureActive = true
    },
    endGesture: () => {
      if (!gestureActive) return
      runtime.undoManager.stopCapturing()
      gestureActive = false
    },
    undo: () => {
      if (!runtimeReady) return
      runtime.undoManager.stopCapturing()
      gestureActive = false
      const stackItem = runtime.undoManager.undoStack[runtime.undoManager.undoStack.length - 1]
      if (stackItem && !stackItem.meta.has(selectionAfterKey)) {
        stackItem.meta.set(selectionAfterKey, captureSelection())
      }
      runtime.undoManager.undo()
      restoreSelection(stackItem?.meta.get(selectionBeforeKey) as SelectionSnapshot | undefined)
      syncDerivedView(true)
    },
    redo: () => {
      if (!runtimeReady) return
      runtime.undoManager.stopCapturing()
      gestureActive = false
      const stackItem = runtime.undoManager.redoStack[runtime.undoManager.redoStack.length - 1]
      runtime.undoManager.redo()
      restoreSelection(stackItem?.meta.get(selectionAfterKey) as SelectionSnapshot | undefined)
      syncDerivedView(true)
    },

    // 사용자가 명시적으로 "저장"을 누르거나 Ctrl+S 했을 때만 동작 — 사용자가 고른
    // 경로의 .json으로 저장한다(state/fileIO.ts). 자동저장은 없다.
    save: async () => {
      try {
        const snapshot = runtimeReady ? projectFromYDoc(runtime.doc, activeSheetId) : get().project
        const ok = await saveProjectToFile(snapshot)
        if (ok) set({ dirty: false }) // 사용자가 취소하면 dirty 유지
      } catch (e) {
        logWarn('저장 실패', e)
      }
    },
  }
})
