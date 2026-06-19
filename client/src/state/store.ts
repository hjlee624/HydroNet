// ─────────────────────────────────────────────────────────────────────────────
// Central editor store (zustand). Holds the project, selection, undo/redo
// history and view zoom, and exposes every mutation as an action. Scheduling
// fields (es/ef/critical…) are recomputed after each change so the canvas and
// the critical-path highlight stay in sync. 저장은 자동이 아니라 사용자가 "저장"을
// 누를 때만 파일로 저장된다(state/fileIO.ts) — 편집은 dirty 플래그로만 표시.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Category, ID, Link, LinkType, LogoItem, PaperSettings, Project, RainySeason, Sheet, Task, TextRole, TextStyle, ViewSettings,
} from '../types/model'
import { PALETTE_MAX } from '../types/model'
import { applyCascade, computeSchedule, reschedule } from '../engine/scheduling'
import { fitToPaperView } from '../engine/layout'
import { paperMm } from '../engine/paper'
import { daysInMonth, doyToMonthDay, monthDayToDoy, toISO } from '../engine/dates'
import { createSampleProject } from '../data/sampleProject'
import { DEFAULT_PALETTE } from '../styles/theme'
import { saveProjectToFile } from './fileIO'
import { logInfo, logWarn } from './logger'

const HISTORY_LIMIT = 50

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

const FILTER_OFF: ViewFilter = { critical: false, milestone: false, query: '' }
export const filterActive = (f: ViewFilter): boolean => f.critical || f.milestone || f.query.trim() !== ''

/** localStorage helpers for sticky UI prefs (guarded for non-browser test runs). */
function lsGet(key: string, fallback: string): string {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || fallback } catch { return fallback }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) } catch { /* ignore */ }
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

export interface EditorState {
  project: Project
  selectedTaskId: ID | null
  selectedLinkId: ID | null
  selectedCategoryId: ID | null
  /** 다중 선택된 공종 id(표시 순서). 단일 선택이면 [그 id], 미선택이면 []. */
  selectedCategoryIds: ID[]
  /** Ctrl+C로 복사한 공종 묶음(없으면 null). */
  categoryClipboard: CategoryClipboard | null
  /** When set, the inspector shows the text-style editor for this role. */
  selectedTextRole: TextRole | null
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
  dirty: boolean
  warnings: string[]
  /** Last reschedule/cascade diff; non-null drives the 재계산 popup. */
  recalcReport: RecalcReport | null
  past: Project[]
  future: Project[]

  // lifecycle
  setProject: (p: Project) => void
  newProject: () => void
  loadSample: () => void
  /** Switch the active 공정표 시트(예정공정표 ↔ 마일스톤) within the 사업. */
  switchSheet: (id: ID) => void

  // tasks
  addTask: (categoryId: ID, partial?: Partial<Task>) => ID
  updateTask: (id: ID, patch: Partial<Task>, opts?: { history?: boolean }) => void
  setTaskStartLive: (id: ID, startDay: number) => void
  setTaskSpanLive: (id: ID, startDay: number, duration: number) => void
  deleteTask: (id: ID) => void
  toggleMilestone: (id: ID) => void
  /** Move a task to a 공종 and insert it right before `beforeId` (null = end of
   *  that lane). Drives sidebar + chart drag-to-reorder; the array order is the
   *  single source of truth both views render in. */
  reorderTask: (id: ID, targetCategoryId: ID, beforeId: ID | null, opts?: { history?: boolean }) => void
  /** 실적 진척률(0–100) 설정 — 진척·실적 모듈. */
  setTaskProgress: (id: ID, progress: number) => void

  // package modules (품질·안전·문서·원가 등 기록형 모듈)
  addModuleRecord: (moduleId: string, values?: Record<string, string>) => ID
  updateModuleRecord: (moduleId: string, id: ID, values: Record<string, string>) => void
  deleteModuleRecord: (moduleId: string, id: ID) => void

  // baseline (기준선) — 현재 일정을 박제해 이후 표류를 측정(대시보드 EVM 연계)
  captureBaseline: () => void
  clearBaseline: () => void

  // categories
  addCategory: (partial?: Partial<Category>) => ID
  updateCategory: (id: ID, patch: Partial<Category>) => void
  deleteCategory: (id: ID) => void
  toggleCollapse: (id: ID) => void
  moveCategory: (id: ID, dir: -1 | 1) => void
  /** 공종 드래그 재배치 — `beforeId` 앞으로(null = 맨 끝) 옮기고 order를 0..n-1로 재부여. */
  reorderCategory: (id: ID, beforeId: ID | null) => void

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
  addLogo: (src: string, w?: number, h?: number) => void
  setLogoSize: (index: number, w: number, h: number) => void
  moveLogo: (index: number, dir: -1 | 1) => void
  removeLogo: (index: number) => void
  setRainySeason: (patch: Partial<Pick<RainySeason, 'startMonth' | 'startDay' | 'endMonth' | 'endDay' | 'label' | 'efficiency'>>) => void
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
  selectLink: (id: ID | null) => void
  selectCategory: (id: ID | null) => void
  /** 다중 선택 설정(ids는 표시 순서, anchor는 Shift 범위선택의 기준 공종). */
  selectCategories: (ids: ID[], anchor: ID | null) => void
  /** 선택한 공종들(+공정+내부연결)을 클립보드에 복사(Ctrl+C). */
  copyCategories: (ids: ID[]) => void
  /** 클립보드의 공종들을 새 id로 맨 끝에 붙여넣기(Ctrl+V). */
  pasteCategories: () => void
  selectTextRole: (role: TextRole | null) => void
  setZoom: (z: number) => void
  setNavMode: (m: NavMode) => void
  setFilter: (patch: Partial<ViewFilter>) => void
  clearFilter: () => void
  setColorMode: (m: ColorMode) => void
  setUiMode: (m: UiMode) => void

  // history & persistence
  beginGesture: () => void
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
function normalize(project: Project): Project {
  const palette = Array.isArray(project.palette) && project.palette.length
    ? project.palette.slice(0, PALETTE_MAX)
    : [...DEFAULT_PALETTE]
  return {
    ...project,
    kind: project.kind ?? 'construction',
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
    changes.push({ id: t.id, name: t.name, oldStart: old, newStart: t.start, deltaDays: t.start - old })
  }
  changes.sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays))
  return { kind, changes, totalMoved: changes.length, startDate: after.startDate }
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply a mutation to the project with history + reschedule + autosave. */
  function commit(
    mutate: (p: Project) => void,
    opts: { history?: boolean; cascade?: boolean } = {},
  ) {
    const { history = true, cascade = false } = opts
    const state = get()
    const prev = state.project
    const draft = clone(prev)
    draft.meta = { ...draft.meta, updatedAt: new Date().toISOString() }
    mutate(draft)

    let next = draft
    if (cascade && state.autoCascade) {
      const r = applyCascade(next.tasks, next.links)
      next = { ...next, tasks: r.tasks }
    }
    const scheduled = withSchedule(next)
    if (scheduled.warnings.length) {
      scheduled.warnings.forEach((w) => logWarn(w))
    }

    set((s) => ({
      project: scheduled.project,
      dirty: true,
      warnings: scheduled.warnings,
      past: history ? [...s.past, prev].slice(-HISTORY_LIMIT) : s.past,
      future: history ? [] : s.future,
    }))
  }

  const initial = withSchedule(normalize(createSampleProject())).project

  return {
    project: initial,
    selectedTaskId: null,
    selectedLinkId: null,
    selectedCategoryId: null,
    selectedCategoryIds: [],
    categoryClipboard: null,
    selectedTextRole: null,
    linking: null,
    zoom: 1,
    navMode: 'edit',
    filter: { ...FILTER_OFF },
    colorMode: (lsGet('hydronet:colorMode', 'category') as ColorMode),
    uiMode: (lsGet('hydronet:uiMode', 'pro') as UiMode),
    autoCascade: true,
    dirty: false,
    warnings: [],
    recalcReport: null,
    past: [],
    future: [],

    setProject: (p) => set({ project: withSchedule(normalize(p)).project, past: [], future: [], dirty: false }),
    newProject: () => {
      const blank = createSampleProject()
      blank.id = `proj-${nanoid(8)}`
      blank.name = '새 프로젝트'
      blank.tasks = []
      blank.links = []
      set({ project: withSchedule(blank).project, past: [], future: [], dirty: true, selectedTaskId: null })
      logInfo('새 프로젝트를 생성했습니다.')
    },
    loadSample: () => {
      set({ project: withSchedule(createSampleProject()).project, past: [], future: [], dirty: false, selectedTaskId: null })
      logInfo('샘플 프로젝트를 불러왔습니다.')
    },
    switchSheet: (id) => {
      const p = get().project
      if (!p.sheets || !p.activeSheet || id === p.activeSheet.id) return
      const target = p.sheets.find((s) => s.id === id)
      if (!target) return
      // Stash the current active sheet back into the list, load the target into
      // the editable top-level fields (the active sheet always lives at top level).
      const current: Sheet = {
        id: p.activeSheet.id, role: p.activeSheet.role, name: p.activeSheet.name,
        categories: p.categories, tasks: p.tasks, links: p.links, rainySeasons: p.rainySeasons,
      }
      const sheets = p.sheets.filter((s) => s.id !== id).concat(current)
      const next: Project = {
        ...p,
        categories: clone(target.categories), tasks: clone(target.tasks),
        links: clone(target.links), rainySeasons: clone(target.rainySeasons),
        sheets, activeSheet: { id: target.id, role: target.role, name: target.name },
      }
      set({ project: withSchedule(next).project, past: [], future: [], selectedTaskId: null, selectedLinkId: null, selectedTextRole: null, dirty: true })
      logInfo(`공정표 전환: ${target.name}`)
    },

    addTask: (categoryId, partial) => {
      const id = `t-${nanoid(8)}`
      commit((p) => {
        const maxEnd = p.tasks.filter((t) => t.categoryId === categoryId).reduce((m, t) => Math.max(m, t.start + t.duration), 0)
        p.tasks.push({
          id,
          categoryId,
          name: partial?.name ?? '새 공정',
          start: partial?.start ?? maxEnd,
          duration: partial?.duration ?? 30,
          isMilestone: partial?.isMilestone ?? false,
          ...partial,
        })
      })
      set({ selectedTaskId: id, selectedLinkId: null })
      return id
    },
    updateTask: (id, patch, opts) => {
      const affectsSchedule = 'start' in patch || 'duration' in patch
      // Live-ish edits (free-text subName, color-picker drag) pass history:false to
      // avoid flooding the undo stack with one entry per keystroke / drag step.
      commit((p) => {
        const t = p.tasks.find((x) => x.id === id)
        if (t) Object.assign(t, patch)
      }, { cascade: affectsSchedule, history: opts?.history ?? true })
    },
    setTaskStartLive: (id, startDay) => {
      // No history push (gesture already snapshotted); cascade respected.
      commit((p) => {
        const t = p.tasks.find((x) => x.id === id)
        if (t) t.start = Math.max(0, Math.round(startDay))
      }, { history: false, cascade: true })
    },
    setTaskSpanLive: (id, startDay, duration) => {
      // Live edge-resize of a bar (start + duration). Gesture already snapshotted.
      commit((p) => {
        const t = p.tasks.find((x) => x.id === id)
        if (t && !t.isMilestone) {
          t.start = Math.max(0, Math.round(startDay))
          t.duration = Math.max(1, Math.round(duration))
        }
      }, { history: false, cascade: true })
    },
    deleteTask: (id) => {
      commit((p) => {
        p.tasks = p.tasks.filter((t) => t.id !== id)
        p.links = p.links.filter((l) => l.from !== id && l.to !== id)
      })
      set((s) => ({ selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId }))
    },
    toggleMilestone: (id) => {
      commit((p) => {
        const t = p.tasks.find((x) => x.id === id)
        if (t) {
          t.isMilestone = !t.isMilestone
          if (t.isMilestone) t.duration = 0
          else if (t.duration === 0) t.duration = 30
        }
      }, { cascade: true })
    },
    reorderTask: (id, targetCategoryId, beforeId, opts) => {
      if (beforeId === id) return // dropping a task onto itself is a no-op
      commit((p) => {
        const moving = p.tasks.find((t) => t.id === id)
        if (!moving) return
        moving.categoryId = targetCategoryId
        const without = p.tasks.filter((t) => t.id !== id)
        let insertAt: number
        if (beforeId) {
          const bi = without.findIndex((t) => t.id === beforeId)
          insertAt = bi >= 0 ? bi : without.length
        } else {
          // No anchor → append after the target lane's current last task.
          let last = -1
          without.forEach((t, i) => { if (t.categoryId === targetCategoryId) last = i })
          insertAt = last >= 0 ? last + 1 : without.length
        }
        without.splice(insertAt, 0, moving)
        p.tasks = without
      }, { history: opts?.history ?? true, cascade: false })
      set({ selectedTaskId: id, selectedLinkId: null })
    },
    setTaskProgress: (id, progress) => commit((p) => {
      const t = p.tasks.find((x) => x.id === id)
      if (t) t.progress = Math.max(0, Math.min(100, Math.round(progress)))
    }, { history: false }),

    addModuleRecord: (moduleId, values = {}) => {
      const id = `m-${nanoid(8)}`
      commit((p) => {
        if (!p.modules) p.modules = {}
        p.modules[moduleId] = [...(p.modules[moduleId] ?? []), { id, values }]
      }, { history: false })
      return id
    },
    updateModuleRecord: (moduleId, id, values) => commit((p) => {
      const r = p.modules?.[moduleId]?.find((x) => x.id === id)
      if (r) r.values = { ...r.values, ...values }
    }, { history: false }),
    deleteModuleRecord: (moduleId, id) => commit((p) => {
      if (p.modules?.[moduleId]) p.modules[moduleId] = p.modules[moduleId].filter((x) => x.id !== id)
    }, { history: false }),

    captureBaseline: () => {
      commit((p) => {
        const catById = new Map(p.categories.map((c) => [c.id, c]))
        const vis = p.tasks.filter((t) => {
          const c = catById.get(t.categoryId)
          return c && (p.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
        })
        const starts = vis.map((t) => t.es ?? t.start)
        const ends = vis.map((t) => t.ef ?? t.start + t.duration)
        p.baseline = {
          capturedAt: new Date().toISOString(),
          asOf: toISO(new Date()),
          // 활성 공정표 id를 박제 — 시트 전환 후엔 표류 비교가 무의미하므로 셀렉터가 가린다.
          sheetId: p.activeSheet?.id,
          startDay: starts.length ? Math.min(...starts) : 0,
          endDay: ends.length ? Math.max(...ends) : 0,
          tasks: p.tasks.map((t) => ({ id: t.id, start: t.es ?? t.start, duration: t.duration })),
        }
      })
      logInfo('현재 일정을 기준선(베이스라인)으로 저장했습니다.')
    },
    clearBaseline: () => {
      commit((p) => { delete p.baseline })
      logInfo('기준선을 해제했습니다.')
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
    updateCategory: (id, patch) => commit((p) => {
      const c = p.categories.find((x) => x.id === id)
      if (c) Object.assign(c, patch)
    }),
    deleteCategory: (id) => commit((p) => {
      p.categories = p.categories.filter((c) => c.id !== id)
      const removed = new Set(p.tasks.filter((t) => t.categoryId === id).map((t) => t.id))
      p.tasks = p.tasks.filter((t) => t.categoryId !== id)
      p.links = p.links.filter((l) => !removed.has(l.from) && !removed.has(l.to))
    }),
    toggleCollapse: (id) => commit((p) => {
      const c = p.categories.find((x) => x.id === id)
      if (c) c.collapsed = !c.collapsed
    }, { history: false }),
    moveCategory: (id, dir) => commit((p) => {
      const sorted = [...p.categories].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex((c) => c.id === id)
      const swap = idx + dir
      if (idx < 0 || swap < 0 || swap >= sorted.length) return
      const a = sorted[idx], b = sorted[swap]
      const ao = a.order; a.order = b.order; b.order = ao
    }),
    reorderCategory: (id, beforeId) => {
      if (beforeId === id) return // 자기 자신 앞으로 = 무동작
      commit((p) => {
        const sorted = [...p.categories].sort((a, b) => a.order - b.order)
        const moving = sorted.find((c) => c.id === id)
        if (!moving) return
        const without = sorted.filter((c) => c.id !== id)
        let insertAt = without.length // beforeId 없음 → 맨 끝
        if (beforeId) {
          const bi = without.findIndex((c) => c.id === beforeId)
          if (bi >= 0) insertAt = bi
        }
        without.splice(insertAt, 0, moving)
        without.forEach((c, i) => { c.order = i }) // order를 0..n-1로 정규화
      })
      set({ selectedCategoryId: id, selectedCategoryIds: [id] })
    },

    toggleCategoryVisible: (id) => commit((p) => {
      const c = p.categories.find((x) => x.id === id)
      if (!c) return
      c.hidden = !c.hidden
      // Turning a lane ON also reveals its activities, so a 공종 switched back on
      // (e.g. after 전체 OFF) never renders as an empty lane. The 공종 switch thus
      // acts as the master for its own tasks.
      if (!c.hidden) for (const t of p.tasks) if (t.categoryId === id) t.hidden = false
    }, { history: false }),
    toggleTaskVisible: (id) => commit((p) => {
      const t = p.tasks.find((x) => x.id === id)
      if (t) t.hidden = !t.hidden
    }, { history: false }),
    setAllVisible: (visible) => commit((p) => {
      const hidden = !visible
      for (const c of p.categories) c.hidden = hidden
      for (const t of p.tasks) t.hidden = hidden
    }, { history: false }),

    startLinking: (fromId) => set({ linking: { fromId, pointer: null }, selectedTaskId: fromId }),
    updateLinkingPointer: (x, y) => set((s) => (s.linking ? { linking: { ...s.linking, pointer: { x, y } } } : {})),
    completeLinking: (toId, type = 'FS') => {
      const linking = get().linking
      if (linking && linking.fromId !== toId) get().addLink(linking.fromId, toId, type)
      set({ linking: null })
    },
    cancelLinking: () => set({ linking: null }),
    addLink: (from, to, type = 'FS', lag = 0) => {
      const exists = get().project.links.some((l) => l.from === from && l.to === to)
      if (exists) { logWarn('이미 동일한 연결이 존재합니다.'); return }
      const id = `l-${nanoid(8)}`
      commit((p) => { p.links.push({ id, from, to, type, lag }) }, { cascade: true })
      set({ selectedLinkId: id })
    },
    updateLink: (id, patch) => commit((p) => {
      const l = p.links.find((x) => x.id === id)
      if (l) Object.assign(l, patch)
    }, { cascade: true }),
    deleteLink: (id) => {
      commit((p) => { p.links = p.links.filter((l) => l.id !== id) })
      set((s) => ({ selectedLinkId: s.selectedLinkId === id ? null : s.selectedLinkId }))
    },

    setPaper: (patch) => commit((p) => { p.paper = { ...p.paper, ...patch } }, { history: false }),
    setView: (patch) => commit((p) => { p.view = { ...p.view, ...patch } }, { history: false }),
    fitToPaper: () => {
      const p = get().project
      const { w, h } = paperMm(p.paper.size, p.paper.orientation)
      const patch = fitToPaperView(p, w, h)
      if (patch.pxPerDay === undefined && patch.rowHeight === undefined && patch.fontScale === undefined) {
        logInfo('이미 용지 비율·글자 크기에 맞춰져 있습니다.')
        return
      }
      commit((d) => { d.view = { ...d.view, ...patch } }, { history: false })
      logInfo('현재 용지 규격에 맞춰 여백 없이 채우고 글자 크기를 조정했습니다.')
    },
    // history:false — 이름/시작일은 자유텍스트 입력(키 입력마다 undo 누적 방지, subName/색
    // 편집과 동일 정책). startDate는 day-offset 기준이라 CPM에 영향 없음.
    setProjectMeta: (patch) => commit((p) => { Object.assign(p, patch) }, { history: false }),
    toggleCommissioning: () => commit((p) => { p.commissioningEnabled = !p.commissioningEnabled }),
    toggleTitle: () => commit((p) => { p.view.showTitle = p.view.showTitle === false }, { history: false }),
    addLogo: (src, w = 168, h = 60) => commit((p) => {
      if (!p.branding) p.branding = { logos: [] }
      p.branding.logos.push({ src, w, h })
    }),
    setLogoSize: (index, w, h) => commit((p) => {
      const lg = p.branding?.logos?.[index]
      if (lg) { lg.w = Math.max(32, Math.round(w)); lg.h = Math.max(16, Math.round(h)) }
    }, { history: false }),
    moveLogo: (index, dir) => commit((p) => {
      const arr = p.branding?.logos
      if (!arr) return
      const j = index + dir
      if (j < 0 || j >= arr.length) return
      const tmp = arr[index]; arr[index] = arr[j]; arr[j] = tmp
    }),
    removeLogo: (index) => commit((p) => {
      if (p.branding?.logos) p.branding.logos.splice(index, 1)
    }),
    setRainySeason: (patch) => commit((p) => {
      const base: RainySeason = p.rainySeasons[0]
        ?? { id: 'rs-1', label: '우기', startMonth: 6, startDay: 1, endMonth: 9, endDay: 30, efficiency: 0.7 }
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
          const c = doyToMonthDay(eDoy); next.startMonth = c.month; next.startDay = c.day
        } else {
          const c = doyToMonthDay(sDoy); next.endMonth = c.month; next.endDay = c.day
        }
      }
      p.rainySeasons = [next]
    }, { history: false }),
    clearRainySeasons: () => commit((p) => { p.rainySeasons = [] }, { history: false }),

    setTextStyle: (role, patch) => commit((p) => {
      const next = { ...(p.view.textStyles ?? {}) }
      next[role] = { ...(next[role] ?? {}), ...patch }
      p.view = { ...p.view, textStyles: next }
    }, { history: false }),
    resetTextStyle: (role) => commit((p) => {
      if (!p.view.textStyles) return
      const next = { ...p.view.textStyles }
      delete next[role]
      p.view = { ...p.view, textStyles: next }
    }, { history: false }),

    addPaletteColor: (color) => commit((p) => {
      const c = (color || '').trim()
      if (!c) return
      const cur = p.palette ?? []
      if (cur.some((x) => x.toLowerCase() === c.toLowerCase())) return
      if (cur.length >= PALETTE_MAX) return // never exceed 10
      p.palette = [...cur, c]
    }, { history: false }),
    removePaletteColor: (index) => commit((p) => {
      if (!p.palette) return
      p.palette = p.palette.filter((_, i) => i !== index)
    }, { history: false }),

    recompute: () => set((s) => ({ project: withSchedule(s.project).project })),
    cascadeNow: () => {
      const before = new Map(get().project.tasks.map((t) => [t.id, t.start]))
      commit((p) => {
        const r = applyCascade(p.tasks, p.links)
        p.tasks = r.tasks
      })
      set({ recalcReport: buildRecalcReport('cascade', before, get().project) })
      logInfo('연쇄 일정 정렬을 적용했습니다.')
    },
    rescheduleNow: () => {
      const before = new Map(get().project.tasks.map((t) => [t.id, t.start]))
      commit((p) => {
        const r = reschedule(p.tasks, p.links)
        p.tasks = r.tasks
      })
      set({ recalcReport: buildRecalcReport('reschedule', before, get().project) })
      logInfo('전체 일정을 최조기(最早期)로 재계산했습니다.')
    },
    setAutoCascade: (v) => set({ autoCascade: v }),
    closeRecalcReport: () => set({ recalcReport: null }),

    selectTask: (id) => set({ selectedTaskId: id, selectedLinkId: null, selectedTextRole: null }),
    selectLink: (id) => set({ selectedLinkId: id, selectedTaskId: null, selectedTextRole: null }),
    selectCategory: (id) => set({ selectedCategoryId: id, selectedCategoryIds: id ? [id] : [] }),
    selectCategories: (ids, anchor) => set({ selectedCategoryIds: ids, selectedCategoryId: anchor }),
    copyCategories: (ids) => {
      const p = get().project
      const idset = new Set(ids)
      const categories = p.categories.filter((c) => idset.has(c.id))
      if (!categories.length) return
      const tasks = p.tasks.filter((t) => idset.has(t.categoryId))
      const taskIds = new Set(tasks.map((t) => t.id))
      const links = p.links.filter((l) => taskIds.has(l.from) && taskIds.has(l.to))
      set({ categoryClipboard: { categories: clone(categories), tasks: clone(tasks), links: clone(links) } })
      logInfo(`공종 ${categories.length}개를 복사했습니다.`)
    },
    pasteCategories: () => {
      const clip = get().categoryClipboard
      if (!clip || !clip.categories.length) return
      const newIds: ID[] = []
      commit((p) => {
        let order = p.categories.length
        const catMap = new Map<ID, ID>() // 원본 공종 id → 새 id
        const taskMap = new Map<ID, ID>() // 원본 공정 id → 새 id (내부 연결 재배선용)
        for (const c of clip.categories) {
          const nid = `c-${nanoid(8)}`
          catMap.set(c.id, nid); newIds.push(nid)
          p.categories.push({ ...clone(c), id: nid, order: order++ })
        }
        for (const t of clip.tasks) {
          const cat = catMap.get(t.categoryId)
          if (!cat) continue
          const nid = `t-${nanoid(8)}`
          taskMap.set(t.id, nid)
          p.tasks.push({ ...clone(t), id: nid, categoryId: cat })
        }
        for (const l of clip.links) {
          const from = taskMap.get(l.from), to = taskMap.get(l.to)
          if (from && to) p.links.push({ ...clone(l), id: `l-${nanoid(8)}`, from, to })
        }
      })
      set({ selectedCategoryIds: newIds, selectedCategoryId: newIds[newIds.length - 1] ?? null })
      logInfo(`공종 ${clip.categories.length}개를 붙여넣었습니다.`)
    },
    selectTextRole: (role) => set({ selectedTextRole: role, selectedTaskId: null, selectedLinkId: null }),
    setZoom: (z) => set({ zoom: Math.min(6, Math.max(0.25, z)) }),
    setNavMode: (m) => set({ navMode: m }),
    setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
    clearFilter: () => set({ filter: { ...FILTER_OFF } }),
    setColorMode: (m) => { lsSet('hydronet:colorMode', m); set({ colorMode: m }) },
    setUiMode: (m) => { lsSet('hydronet:uiMode', m); set({ uiMode: m }) },

    beginGesture: () => set((s) => ({ past: [...s.past, clone(s.project)].slice(-HISTORY_LIMIT), future: [] })),
    undo: () => {
      const { past, project, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({ project: withSchedule(prev).project, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT), dirty: true })
    },
    redo: () => {
      const { past, project, future } = get()
      if (!future.length) return
      const next = future[0]
      set({ project: withSchedule(next).project, past: [...past, project].slice(-HISTORY_LIMIT), future: future.slice(1), dirty: true })
    },

    // 사용자가 명시적으로 "저장"을 누르거나 Ctrl+S 했을 때만 동작 — 사용자가 고른
    // 경로의 .json으로 저장한다(state/fileIO.ts). 자동저장은 없다.
    save: async () => {
      try {
        const ok = await saveProjectToFile(get().project)
        if (ok) set({ dirty: false }) // 사용자가 취소하면 dirty 유지
      } catch (e) {
        logWarn('저장 실패', e)
      }
    },
  }
})
