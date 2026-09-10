// ─────────────────────────────────────────────────────────────────────────────
// Sequence domain model
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
  /** WBS/category accent colour. Bar colours are assigned by top-level process. */
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
  /** 레인/상위 공정 블록 안의 세로 행 위치. 일반 공정은 WBS 순서로 배치하고, 세부공정은 같은
   *  parentId 그룹 안에서 이 값을 사용해 같은 줄에 합치거나 위·아래 줄로 나눌 수 있다. */
  row?: number
  color?: string
  labelPosition?: LabelPosition
  note?: string
  /** Optional 세부공종 (sub-work) grouping label. **레거시** — 이제 세부공정은 parentId로
   *  상위 공정에 연결한다. 저장 파일 호환을 위해 남겨두며, 로드 시 normalize가 parentId로 이관한다. */
  subName?: string
  /** 세부공정의 **상위 공정 task id**. 이름/순서가 바뀌어도 상위 공정 블록에 안정적으로 고정된다.
   *  상위 공정(자식이 있는 공정)은 차트에서 자기 막대를 숨기며, 세부공정은 블록 안에서 여러 줄을 쓸 수 있다. */
  parentId?: ID
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
  /** 사내 일정표(엑셀·CSV)의 고유 번호 — 재취입 시 **동일 ID 갱신** 키. undefined = 외부 연계 없음.
   *  state/scheduleImport.ts 가 이 값으로 기존 공정을 찾아 append 대신 update 한다. */
  extId?: string
  /** 공정 담당자(실명/직책). 일정표 취입·진척 입력·주간 공정회의 자료의 책임자 열. */
  owner?: string
  /** 실적 착수일(ISO YYYY-MM-DD). 미입력 = 미착수. 계획(start)과 달리 CPM에 영향 없음. */
  actualStart?: string
  /** 실적 완료일(ISO YYYY-MM-DD). 미입력 = 미완료. 계획과 달리 CPM에 영향 없음. */
  actualFinish?: string
  /** DUMMY(가상/연결) 공정 표시 — 막대를 공정색 60% 투명(opacity 0.4)으로 칠해
   *  실제 작업이 아닌 연결/대기 구간임을 나타낸다. CPM 계산엔 일반 공정과 동일하게
   *  참여(기간·선후행 유지). undefined/false = 일반 공정. */
  isDummy?: boolean

  // ── 물량 기반 공기 적정성(도메인 연동) ─────────────────────────────────────────
  // 「공공 건설공사의 공사기간 산정기준」(국토부고시 제2024-1021호)의 법정 산정식과 정합:
  //   작업일수 = 작업수량(quantity) ÷ 1일 작업량(부록4, workCode로 조회) — 주공정선 한정.
  // engine/adequacy.ts가 이 필드 + data/standardRates.ts 로 이론 작업일수·편차·근거를 계산한다.
  /** 이 공정의 시공 수량(물량). 표준 일작업량과 단위를 맞춰야 이론 작업일수가 유효. undefined = 미입력. */
  quantity?: number
  /** 물량 단위(㎥·㎡·m·ton·본·개소 등). 표준 일작업량(부록4)의 단위와 일치해야 함. */
  unit?: string
  /** 표준 일작업량 DB(data/standardRates.ts) 매핑 키 — 공종/세부작업 코드(조달청 세부공종분류코드 호환).
   *  이 코드로 부록4의 1일 작업량을 찾아 물량÷생산성으로 이론 작업일수를 산출한다. undefined = 미매핑. */
  workCode?: string

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
  /** Arrow line width in px. Undefined = auto (critical=2, else 1.3). 연결 속성에서 조절. */
  width?: number
  /** 같은 줄로 연결된 두 공정 사이 빈 구간의 DUMMY 음영(공정색 옅게) 표시 여부.
   *  undefined/true = 표시(기존 동작), false = 숨김. 연결 속성에서 토글. */
  showDummy?: boolean
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
  /** [공사기간 구분선] 연도 경계 세로 구분선 + 제목↔연도 가로 구분선 표시 여부(기본 ON). */
  showYearLine?: boolean
  /** [공사기간 구분선] 연도 구분선(세로 + 제목↔연도 가로) 두께(px, 기본 2.5, 1~20 사용자 조절). */
  yearLineWidth?: number
  /** [공사기간 구분선] 월 경계 세로 구분선 표시 여부(기본 ON). showGrid(가로 행 구분선)와 독립. */
  showMonthLine?: boolean
  /** [공사기간 구분선] 월 구분선(세로) 두께(px, 기본 1, 1~20 사용자 조절). */
  monthLineWidth?: number
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

/** 한 사업 안의 공정표 문서. 대부분의 표시 설정(startDate/view/paper)은 사업 단위로 공유하되,
 *  타임라인 표시 기간은 예정공정표와 마일스톤이 서로 영향을 주지 않도록 시트별로 갖는다.
 *  공정 데이터(공종/공정/연결/우기)도 시트별로 갖는다. 활성 시트는 Project 최상위
 *  categories/tasks/links/rainySeasons에 펼쳐져 있고, 여기엔 비활성 시트만 담는다. */
export interface Sheet {
  id: ID
  role: SheetRole
  name: string
  categories: Category[]
  tasks: Task[]
  links: Link[]
  rainySeasons: RainySeason[]
  /** 이 시트에만 적용되는 타임라인 표시 시작/종료 월. */
  displayStart?: string
  displayEnd?: string
}

/** 건설사업관리 기록형 모듈(예산·공사비·자원·품질·안전·문서·인허가·시운전·리스크)의 한 행.
 *  values 키는 해당 모듈의 필드 스키마(data/modules.ts ModuleField[])를 따른다. */
export interface ModuleRecord {
  id: ID
  values: Record<string, string>
}

/** 기준선(베이스라인) 스냅샷의 한 공정(계획 시작·기간 박제). */
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
  /** 박제 당시 활성 공정표 시트 id — 다른 시트로 전환하면 표류 비교가 무의미해 가린다. */
  sheetId?: ID
  startDay: number
  endDay: number
  tasks: BaselineTask[]
}

/** 변경 이력 한 건의 결재 상태 — 초안 → 검토요청 → 확정. undefined = 초안(구버전 호환). */
export type ChangeState = 'draft' | 'review' | 'confirmed'

/**
 * 변경 이력 한 건. **제출·주요 일정 변경 단위**로만 기록한다(키 입력 단위 아님) —
 * 사용자가 사유를 남기거나, AI 검토를 반영하거나, 일정표를 취입하거나, 확정본을 저장할 때.
 * CRDT: root/changeLog 에 **레코드 단위**로 동기화되므로 두 사람이 서로 다른 이력을 동시에
 * 남겨도 병합된다(중첩 객체 통값 저장이 아니라 id별 Y.Map). undo 대상이 아니다(감사기록).
 */
export interface ChangeEntry {
  id: ID
  /** 기록 시각(ISO timestamp). */
  at: string
  /** 작성자 계정 id(로컬 모드는 없음). */
  actorId?: string
  /** 작성자 표시 이름 — 이력 표의 '변경자' 열. */
  actorName: string
  /** 변경 구분. */
  kind: 'duration' | 'schedule' | 'baseline' | 'review' | 'import' | 'note'
  /** 관련 공정 id들(없으면 사업 단위 변경). */
  taskIds: ID[]
  /** 무엇이 바뀌었는지 한 줄 요약(자동 생성). */
  summary: string
  /** 왜 바꿨는지(사용자 입력). 빈 문자열 = 미기재. */
  reason: string
  state?: ChangeState
  /** 확정/검토요청을 누른 사람·시각. */
  decidedBy?: string
  decidedAt?: string
  /** 이 이력이 만들어낸 기준선 버전 id(kind==='baseline'). */
  versionId?: ID
}

/** 기준선 '버전' — 기존 Baseline 스냅샷에 id·이름·작성자를 더해 **여러 개** 보존하는 확정본. */
export interface BaselineVersion extends Baseline {
  id: ID
  /** 확정본 이름(예: '착공 기준선', '1차 변경'). */
  name: string
  authorName: string
  note?: string
}

/**
 * 공기(공사기간) 적정성 산정 전제 — 「공공 건설공사의 공사기간 산정기준」 4대 구성요소 중
 * 달력·물량으로 계산할 수 **없는** 항목들을 사용자가 직접 입력하는 자리다(engine/adequacy.ts
 * assessConstructionPeriod 로 그대로 전달). 모든 필드가 선택이며, **미입력 항목은 제품 기본
 * 가정값**(준비 30 · 정리 30 · 공휴일 0 · 허용편차 ±15%)으로 계산되고 결과는 '가정 기반
 * 참고값'으로 표기된다 — 법정 확정 판정이 아니다.
 */
export interface PeriodInputs {
  /** 준비기간(일). 미입력 시 30일 — **제품 기본 가정값**이다. 가이드라인 p17 은 준비기간의
   *  내용(설계도서 검토·측량·가설건물·조달 등)만 정의하고 기간을 정하지 않는다. */
  prepDays?: number
  /** 정리기간(일) — 가이드라인 p17 정의의 '준공 전 1개월 범위' 문언. 미입력 시 30일 가정. */
  cleanupDays?: number
  /** 법정공휴일수(일) — 부록1(대상연도). 미입력 시 0(임의 생성 금지). */
  holidayDays?: number
  /** 기상 공사불능일수(일) — 관측통계 기준. 미입력 시 우기밴드로 추정. */
  weatherDays?: number
  /** 적정 허용 편차(±%) — 제품 기본값 15%(법정 허용치 아님). */
  tolerancePct?: number
}

export interface Project {
  id: ID
  name: string
  /** 사업 단계/유형 (없으면 시공으로 간주 — 구버전 호환). */
  kind?: ProjectKind
  /** 시설물 유형 키(data/facilities.ts FACILITY_TYPES). 새 사업 생성 시 선택하며,
   *  예정공정표·마일스톤(시공 패키지) 프리셋을 결정한다. 구버전엔 없음. */
  facility?: string
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
  /** 공기 적정성 산정 전제(준비·정리·공휴일·기상·허용편차). 없으면 기본 가정값으로 계산
   *  하고 '가정 기반 참고값'으로 표기(구버전 호환). CRDT: root/meta 에 동기화. */
  periodInputs?: PeriodInputs
  /** 건설사업관리 기록형 모듈 데이터(키 = ModuleId). 사업 단위 — 시트 전환에도 보존.
   *  없으면 미설정(구버전 호환). CRDT: root/modules에 동기화. */
  modules?: Record<string, ModuleRecord[]>
  /** 기준선(베이스라인) 스냅샷 — 현재 비교 대상 포인터. 없으면 미설정. CRDT: root/baseline. */
  baseline?: Baseline
  /** 변경 이력(작성자·사유·검토상태). 없으면 미기록(구버전 호환). CRDT: root/changeLog.
   *  **undo 대상이 아니다** — 되돌리기가 감사기록을 지우면 안 되기 때문. */
  changeLog?: ChangeEntry[]
  /** 확정본(기준선 버전) 목록. 없으면 미설정(구버전 호환). CRDT: root/baselineVersions. */
  baselineVersions?: BaselineVersion[]
  meta: ProjectMeta
}

/** Hard cap on the favourite-colour palette (2 rows × 5). */
export const PALETTE_MAX = 10

// v2: Task에 물량 기반 공기 적정성 필드(quantity·unit·workCode) 추가(추가·optional, 마이그레이션 불요).
// v3: Project에 공기 산정 전제(periodInputs) 추가(추가·optional — 구버전 파일은 기본 가정값으로 동작).
// v4: Task에 extId·owner·actualStart·actualFinish, Project에 changeLog·baselineVersions 추가
//     (F12 일정표 취입 · F13 변경이력/확정본 · F16 주간 집계). 전부 optional 이라 마이그레이션 불요 —
//     구버전 파일은 필드 부재로 로드되고, 신버전 파일은 구버전 리더가 모르는 키를 무시한다.
export const SCHEMA_VERSION = 4
