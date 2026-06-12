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

/** Every distinct text element on the drawing that can be individually styled. */
export type TextRole =
  | 'title'
  | 'categoryLabel'
  | 'subCategoryLabel'
  | 'headerTitle'
  | 'headerSub'
  | 'taskName'
  | 'taskDuration'
  | 'milestoneName'
  | 'milestoneDate'
  | 'axisYear'
  | 'axisMonth'
  | 'rainyLabel'

/** Per-role typography override. Any omitted field falls back to the role default. */
export interface TextStyle {
  /** Font size in chart units (≈ pt on screen). */
  fontSize?: number
  /** CSS font-family string; empty/undefined = role default. */
  fontFamily?: string
  color?: string
}

/** A 공종 (work-type) lane on the left of the chart. */
export interface Category {
  id: ID
  name: string
  /** Bar fill colour for tasks in this lane (tasks may override). */
  color: string
  /** Sidebar tree expand/collapse ONLY — does not affect the chart. */
  collapsed: boolean
  order: number
  /** Belongs to the 시운전(commissioning) group — hidden in "dam-only" mode. */
  isCommissioning?: boolean
  /** ON/OFF visibility: when true the lane (and its tasks) are hidden from the chart. */
  hidden?: boolean
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
  /** Optional 세부공종 (sub-work) grouping label, shown on the left label column. */
  subName?: string
  /** ON/OFF visibility: when true this activity is hidden from the chart. */
  hidden?: boolean
  /** Manual 주공정(CP) override: true = always critical, false = never, undefined = auto (CPM). */
  forceCritical?: boolean

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
 * A recurring "우기"(rainy season) shaded band, defined to the DAY and repeated
 * every year across the timeline. The window runs from (startMonth, startDay) to
 * (endMonth, endDay), inclusive. If the end falls on/before the start within a
 * year, the band wraps across the year boundary. Months 1-12, days 1-31.
 */
export interface RainySeason {
  id: ID
  label: string
  startMonth: number
  startDay: number
  endMonth: number
  endDay: number
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
  /** Show the bold drawing title (project name) centred at the top. */
  showTitle: boolean
  /** Global multiplier on every text size (1 = design size). Raised by
   *  "fit to paper" so text stays legible on large sheets; user-adjustable. */
  fontScale?: number
  /** Per-role typography overrides for the chart texts (empty = all defaults). */
  textStyles?: Partial<Record<TextRole, TextStyle>>
}

/** A CI/logo image (data URL) with its on-drawing box size in px. */
export interface LogoItem {
  src: string
  w: number
  h: number
}

/** Drawing branding — CI/logo images placed bottom-right (resizable, orderable). */
export interface Branding {
  logos: LogoItem[]
}

export interface ProjectMeta {
  createdAt: string
  updatedAt: string
  schemaVersion: number
}

/** 사업 단계/유형 — 설계 단계들은 "설계 공정표", 시공은 "시공 공정표" 성격을
 *  가지며, 시작 시 유형별 프리셋(공종/공정·강조 모듈)이 세팅된다. */
export type ProjectKind = 'feasibility' | 'basic-design' | 'detailed-design' | 'construction'

export interface Project {
  id: ID
  name: string
  /** 사업 단계/유형 (없으면 시공으로 간주 — 구버전 호환). */
  kind?: ProjectKind
  /** ISO date (YYYY-MM-DD) representing day 0 of the schedule. */
  startDate: string
  paper: PaperSettings
  view: ViewSettings
  categories: Category[]
  tasks: Task[]
  links: Link[]
  rainySeasons: RainySeason[]
  branding: Branding
  /** Favourite colours (즐겨찾기) for quick bar recolouring. Capped at 10. */
  palette: string[]
  /** When false, commissioning lanes/tasks are excluded (general dam mode). */
  commissioningEnabled: boolean
  meta: ProjectMeta
}

/** Hard cap on the favourite-colour palette (2 rows × 5). */
export const PALETTE_MAX = 10

export const SCHEMA_VERSION = 1
