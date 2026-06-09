// ─────────────────────────────────────────────────────────────────────────────
// HydroNet domain model
// The single source of truth for the project data structure. Every module
// (engine, rendering, export, persistence) depends on these shapes.
// ─────────────────────────────────────────────────────────────────────────────

export type ID = string

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0'
export type Orientation = 'landscape' | 'portrait'
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'
export type LabelPosition = 'above' | 'below' | 'inside'

/** A 공종 (work-type) lane on the left of the chart. */
export interface Category {
  id: ID
  name: string
  /** Bar fill colour for tasks in this lane (tasks may override). */
  color: string
  collapsed: boolean
  order: number
  /** Belongs to the 시운전(commissioning) group — hidden in "dam-only" mode. */
  isCommissioning?: boolean
}

/** A single 공정 (activity) drawn as a time-scaled bar, or a milestone diamond. */
export interface Task {
  id: ID
  categoryId: ID
  name: string
  /** Day offset from the project start date (day 0). */
  start: number
  /** Duration in days. Milestones use 0. */
  duration: number
  isMilestone: boolean
  /** Optional explicit sub-row within the lane; auto-stacked when undefined. */
  row?: number
  color?: string
  labelPosition?: LabelPosition
  note?: string

  // ── Computed by the CPM engine (never persisted as authoritative) ──
  es?: number // early start
  ef?: number // early finish
  ls?: number // late start
  lf?: number // late finish
  totalFloat?: number
  critical?: boolean
}

/** A precedence relationship rendered as an arrow. */
export interface Link {
  id: ID
  from: ID
  to: ID
  type: LinkType
  /** Lag in days (may be negative for lead). */
  lag: number
}

/**
 * A recurring "우기"(rainy season) shaded band. Defined by month range and
 * repeated every year across the timeline. `startMonth`..`endMonth` inclusive
 * (1-12). If endMonth < startMonth the band wraps across the year boundary.
 */
export interface RainySeason {
  id: ID
  label: string
  startMonth: number
  endMonth: number
  /** Efficiency factor applied to durations overlapping the band (0-1, 1 = none). */
  efficiency: number
}

export interface PaperSettings {
  size: PaperSize
  orientation: Orientation
  marginMm: number
  /** Export raster DPI for PNG/JPG and the image embedded in the PDF. */
  dpi: number
  /** Scale the whole chart to fit one page; otherwise tile across pages at 1:1. */
  fitToPage: boolean
}

export type TimeScale = 'day' | 'week' | 'month'

export interface ViewSettings {
  /** Horizontal pixels per day at zoom 1. */
  pxPerDay: number
  rowHeight: number
  labelWidth: number
  headerHeight: number
  /** Display granularity of the secondary axis row. */
  scale: TimeScale
  showCriticalPath: boolean
  showFloat: boolean
  showGrid: boolean
}

export interface ProjectMeta {
  createdAt: string
  updatedAt: string
  schemaVersion: number
}

export interface Project {
  id: ID
  name: string
  /** ISO date (YYYY-MM-DD) representing day 0 of the schedule. */
  startDate: string
  paper: PaperSettings
  view: ViewSettings
  categories: Category[]
  tasks: Task[]
  links: Link[]
  rainySeasons: RainySeason[]
  /** When false, commissioning lanes/tasks are excluded (general dam mode). */
  commissioningEnabled: boolean
  meta: ProjectMeta
}

export const SCHEMA_VERSION = 1
