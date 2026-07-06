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
/** Dependency-arrow line style (user-editable). Undefined = auto (critical=solid,
 *  else dashed) for backward compatibility with older saved projects. */
export type LinkStyle = 'solid' | 'dashed' | 'dotted'

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
  /** Explicit sub-row WITHIN the lane (0-based). Tasks sharing the same row sit on
   *  one horizontal line, positioned by start/duration — so a package like 상부댐 can
   *  run 굴착→축조→페이스슬라브→충수 as adjacent bars on a single row. Undefined =
   *  auto (one task per row, in array order) for backward compatibility. */
  row?: number
  color?: string
  labelPosition?: LabelPosition
  note?: string
  /** Optional 세부공종 (sub-work) grouping label, shown on the left label column. */
  subName?: string
  /** 막대 아래 공기(기간) 표시 텍스트의 사용자 지정 override. 비어있으면 `${duration}일`로
   *  자동 계산. 더블클릭 편집 시 순수 숫자는 duration 자체를 바꾸고, 그 외 문자열은 이 라벨로
   *  저장된다(예: "약 2개월", "120일"). */
  durationLabel?: string
  /** ON/OFF visibility: when true this activity is hidden from the chart. */
  hidden?: boolean
  /** Manual 주공정(CP) override: true = always critical, false = never, undefined = auto (CPM). */
  forceCritical?: boolean
  /** 실적 진척률 0–100 (진척·실적 모듈). undefined = 미입력(0). */
  progress?: number
  /** DUMMY(가상/연결) 공정 표시 — 막대를 공종색 60% 투명(opacity 0.4)으로 칠해
   *  실제 작업이 아닌 연결/대기 구간임을 나타낸다. CPM 계산엔 일반 공정과 동일하게
   *  참여(기간·선후행 유지). undefined/false = 일반 공정. */
  isDummy?: boolean

  /** 비영속 표시 플래그 — 예정공정표↔마일스톤 연동(augmentForMirror)으로 마일스톤 차트에
   *  '함께 표시'된 예정 공정임을 나타낸다. 렌더 시점에만 부여되며 저장되지 않는다. 표시 전용
   *  (드래그/선택/편집 불가)이고, 마일스톤에서만 숨길 수 있다(view.mirrorHidden). */
  __mirror?: boolean

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
  /** Line style of the arrow (실선/파선/점선). Undefined = auto (critical=solid,
   *  else dashed). User-set via the 연결 속성 inspector. */
  style?: LinkStyle
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
  /** 표시 기간 override (ISO `YYYY-MM-01`). 마일스톤 상단 연/월 클릭 팝업에서 설정.
   *  둘 다 있으면 타임라인 도메인을 이 구간(시작 월 ~ 종료 월)으로 정확히 고정하고,
   *  구간 밖 공정은 제외·부분 걸친 막대는 구간 경계로 클램프한다. 없으면 자동(데이터 범위). */
  displayStart?: string
  displayEnd?: string
  /** 마일스톤 도면 **왼쪽 라벨열**에 각 공정 이름을 공종(및 세부공종) 하위 행으로 나열한다
   *  (사이드바 '공종 구성' 트리처럼). 한 공정만 있는 줄은 공정명을 왼쪽으로 옮기고 막대 위
   *  플로팅 이름은 생략, 한 줄 패키지(여러 공정)·마일스톤은 기존대로 표기. 기본 ON. */
  taskColumn?: boolean
  /** 예정공정표↔마일스톤 연동(요구사항 4). 활성 시트가 마일스톤이고 plan 시트가 있을 때만
   *  작동 — 예정공정표의 공종/공정을 마일스톤 차트에 라이브로 함께 표시한다. 기본 off. */
  mirrorPlan?: boolean
  /** 미러로 가져온 예정 공정 중 '마일스톤에서만' 숨긴 공정 id들(예정 원본은 불변). */
  mirrorHidden?: ID[]
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

/** 공정표 시트 종류: 예정공정표(상세 계획·과업) / 마일스톤(건설 요약). 한 사업이
 *  둘 다 가질 수 있다(설계 단계=둘 다, 시공=마일스톤만). */
export type SheetRole = 'plan' | 'milestone'

/** 한 사업 안의 공정표 문서. 표시 설정(startDate/view/paper)은 사업 단위로 공유하고
 *  공정 데이터(공종/공정/연결/우기)만 시트별로 갖는다. 활성 시트는 Project 최상위
 *  categories/tasks/links/rainySeasons에 펼쳐져 있고, 여기엔 비활성 시트만 담는다. */
export interface Sheet {
  id: ID
  role: SheetRole
  name: string
  categories: Category[]
  tasks: Task[]
  links: Link[]
  rainySeasons: RainySeason[]
}

/** A row in a package module (품질/안전/문서/원가/… 모듈의 한 항목). `values`는
 *  해당 모듈의 필드 스키마(data/modules.ts ModuleField[])에 따라 키가 정해진다. */
export interface ModuleRecord {
  id: ID
  values: Record<string, string>
}

/** 베이스라인 스냅샷의 한 공정(계획 시작·기간 박제). */
export interface BaselineTask {
  id: ID
  start: number
  duration: number
}

/** 기준선(베이스라인) — 어느 시점의 계획 일정을 박제해 이후 표류(드리프트)를 잰다.
 *  사업 단위(시트 전환에도 보존). 없으면 미설정(구버전 호환). */
export interface Baseline {
  /** 박제 시각(ISO timestamp). */
  capturedAt: string
  /** 박제 기준일(YYYY-MM-DD). */
  asOf: string
  /** 박제 당시 활성 공정표 시트 id — 다른 시트로 전환하면 표류 비교가 무의미해 가린다.
   *  단일 공정표(구버전)에선 undefined. */
  sheetId?: ID
  startDay: number
  endDay: number
  tasks: BaselineTask[]
}

export interface Project {
  id: ID
  name: string
  /** 사업 단계/유형 (없으면 시공으로 간주 — 구버전 호환). */
  kind?: ProjectKind
  /** 시설물 유형 키(data/facilities.ts FACILITY_TYPES). 새 사업 생성 시 선택하며,
   *  예정공정표·마일스톤(시공 패키지) 프리셋을 결정한다. 구버전엔 없음. */
  facility?: string
  /** 패키지 모듈별 기록(키 = ModuleId). 기록형 모듈(품질·안전·문서·원가 등)에서 사용. */
  modules?: Record<string, ModuleRecord[]>
  /** 기준선(베이스라인) 스냅샷. 없으면 미설정(구버전 호환). */
  baseline?: Baseline
  /** 비활성 공정표 시트들(활성 시트는 최상위 categories/tasks/links/rainySeasons). */
  sheets?: Sheet[]
  /** 현재 편집 중인 시트 메타. 없으면 단일 공정표(구버전 호환). */
  activeSheet?: { id: ID; role: SheetRole; name: string }
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
