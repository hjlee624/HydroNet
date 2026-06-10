// ─────────────────────────────────────────────────────────────────────────────
// Central editor store (zustand). Holds the project, selection, undo/redo
// history and view zoom, and exposes every mutation as an action. Scheduling
// fields (es/ef/critical…) are recomputed after each change so the canvas and
// the critical-path highlight stay in sync. Changes autosave (debounced).
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Category, ID, Link, LinkType, LogoItem, PaperSettings, Project, Task, TextRole, TextStyle, ViewSettings,
} from '../types/model'
import { PALETTE_MAX } from '../types/model'
import { applyCascade, computeSchedule, reschedule } from '../engine/scheduling'
import { createSampleProject } from '../data/sampleProject'
import { DEFAULT_PALETTE } from '../styles/theme'
import { saveProject } from './api'
import { logInfo, logWarn } from './logger'

const HISTORY_LIMIT = 50

interface LinkingState {
  fromId: ID
  pointer: { x: number; y: number } | null
}

/** One task whose start moved during a 재계산 / 일정 정렬 pass. */
export interface RecalcChange {
  id: ID
  name: string
  oldStart: number
  newStart: number
  deltaDays: number
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
  /** When set, the inspector shows the text-style editor for this role. */
  selectedTextRole: TextRole | null
  linking: LinkingState | null
  zoom: number
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

  // tasks
  addTask: (categoryId: ID, partial?: Partial<Task>) => ID
  updateTask: (id: ID, patch: Partial<Task>, opts?: { history?: boolean }) => void
  setTaskStartLive: (id: ID, startDay: number) => void
  setTaskSpanLive: (id: ID, startDay: number, duration: number) => void
  deleteTask: (id: ID) => void
  toggleMilestone: (id: ID) => void

  // categories
  addCategory: (partial?: Partial<Category>) => ID
  updateCategory: (id: ID, patch: Partial<Category>) => void
  deleteCategory: (id: ID) => void
  toggleCollapse: (id: ID) => void
  moveCategory: (id: ID, dir: -1 | 1) => void

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
  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'startDate'>>) => void
  toggleCommissioning: () => void
  toggleTitle: () => void
  addLogo: (src: string, w?: number, h?: number) => void
  setLogoSize: (index: number, w: number, h: number) => void
  moveLogo: (index: number, dir: -1 | 1) => void
  removeLogo: (index: number) => void
  setRainySeason: (startMonth: number, endMonth: number, label?: string) => void
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
  selectTextRole: (role: TextRole | null) => void
  setZoom: (z: number) => void

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
    branding: { logos: normalizeLogos(project.branding?.logos) },
    rainySeasons: project.rainySeasons ?? [],
    palette,
    view: {
      ...project.view,
      showTitle: project.view.showTitle !== false,
      textStyles: project.view.textStyles ?? {},
    },
  }
}

function withSchedule(project: Project): { project: Project; warnings: string[] } {
  const result = computeSchedule(project.tasks, project.links)
  const byId = new Map(result.tasks.map((t) => [t.id, t]))
  const tasks = project.tasks.map((t) => {
    const c = byId.get(t.id)
    return c ? { ...t, es: c.es, ef: c.ef, ls: c.ls, lf: c.lf, totalFloat: c.totalFloat, critical: c.critical } : t
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

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => EditorState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void get().save(), 800)
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
    scheduleSave(get)
  }

  const initial = withSchedule(normalize(createSampleProject())).project

  return {
    project: initial,
    selectedTaskId: null,
    selectedLinkId: null,
    selectedCategoryId: null,
    selectedTextRole: null,
    linking: null,
    zoom: 1,
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
      scheduleSave(get)
      logInfo('새 프로젝트를 생성했습니다.')
    },
    loadSample: () => {
      set({ project: withSchedule(createSampleProject()).project, past: [], future: [], dirty: false, selectedTaskId: null })
      logInfo('샘플 프로젝트를 불러왔습니다.')
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
      set({ selectedCategoryId: id })
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
    setProjectMeta: (patch) => commit((p) => { Object.assign(p, patch) }),
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
    setRainySeason: (startMonth, endMonth, label = '우기') => commit((p) => {
      p.rainySeasons = [{ id: 'rs-1', label, startMonth, endMonth, efficiency: 0.7 }]
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
    selectCategory: (id) => set({ selectedCategoryId: id }),
    selectTextRole: (role) => set({ selectedTextRole: role, selectedTaskId: null, selectedLinkId: null }),
    setZoom: (z) => set({ zoom: Math.min(6, Math.max(0.25, z)) }),

    beginGesture: () => set((s) => ({ past: [...s.past, clone(s.project)].slice(-HISTORY_LIMIT), future: [] })),
    undo: () => {
      const { past, project, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({ project: withSchedule(prev).project, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT) })
      scheduleSave(get)
    },
    redo: () => {
      const { past, project, future } = get()
      if (!future.length) return
      const next = future[0]
      set({ project: withSchedule(next).project, past: [...past, project].slice(-HISTORY_LIMIT), future: future.slice(1) })
      scheduleSave(get)
    },

    save: async () => {
      const p = get().project
      try {
        await saveProject(p)
        set({ dirty: false })
      } catch (e) {
        logWarn('저장 실패', e)
      }
    },
  }
})
