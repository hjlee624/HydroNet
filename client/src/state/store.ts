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
import { normWorkName } from '../engine/adequacy'
import { daysInMonth, doyToMonthDay, monthDayToDoy } from '../engine/dates'
import { fitToPaperScopedView, paperMm } from '../engine/paper'
import {
  applyCascade,
  computeSchedule,
  type EditImpact,
  type EditMode,
  linkConstrainedStart,
  linkLagFromPositions,
  reschedule,
  type ScheduleProblem,
} from '../engine/scheduling'
import { DEFAULT_PALETTE } from '../styles/theme'
import type {
  Baseline,
  BaselineVersion,
  Category,
  ChangeEntry,
  ChangeState,
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
import { PALETTE_MAX, SCHEMA_VERSION } from '../types/model'
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
import { usePersistence } from './persistence'
import type { ReviewDelta } from './reviewImport'

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
/** Bar colouring scheme: by top-level process, or critical-path emphasis (rest muted). */
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
  /** 일정 편집 의미론 — 'free'(위치 자유 편집·기본, 지금까지의 동작) / 'keepLinks'(선후행 제약 유지). */
  editMode: EditMode
  /** 마지막 편집의 영향 요약(드래그·기간 변경 직후 카드 + 되돌리기). null = 없음. */
  lastEditImpact: EditImpact | null
  /** 조회 전용(입장했으나 편집 권한 없음). true면 모든 변경(commit)이 차단된다. */
  readOnly: boolean
  dirty: boolean
  warnings: string[]
  /** 미해결 일정 문제 목록(순환 등) — 클릭해 해당 공정·연결로 이동한다. */
  problems: ScheduleProblem[]
  /** 미해결 문제가 있어 계산 결과가 '잠정'인 상태. problems.length > 0 과 동치. */
  provisional: boolean
  /** 상태바의 문제 목록 팝오버 열림 여부. */
  problemsOpen: boolean
  /** 문제 목록에서 '이동'을 눌렀을 때 차트를 그 막대로 스크롤시키는 1회성 요청. */
  focusTaskId: ID | null
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
  /** AI 검토 라운드트립(ADR-003) — 검증된 델타들의 duration 을 **단일 커밋(undo 1엔트리)**으로
   *  반영한다. 커밋 시점에 from CAS 를 재검증해 프리뷰↔반영 사이의 동시편집 소실을 막고,
   *  reschedule 은 절대 호출하지 않는다(수동 여유 보존). 반영/스킵 결과를 돌려준다. */
  applyReviewDeltas: (deltas: ReviewDelta[]) => {
    applied: number
    skipped: Array<{ taskId: string; reason: string }>
  }
  /** 내역서(BoQ) 취입(검토서 B3) — 사용자가 확인한 매핑의 물량·단위·공종코드를 **단일 커밋**
   *  (undo 1엔트리)으로 반영한다. 일정(start/duration)은 건드리지 않으므로 cascade 없음.
   *  조회 전용은 무반영. 반영 건수를 돌려준다. */
  importBoqQuantities: (
    items: Array<{ taskId: ID; quantity?: number; unit?: string; workCode?: string }>,
    rows?: Array<{ name: string; category?: string; spec?: string; unit?: string; quantity: number; price?: number; note?: string }>,
  ) => { applied: number; recordsAdded: number }
  /** 사내 일정표(엑셀·CSV) 취입(F12) — 공종 생성·공정 upsert·선후행 연결을 **단일 커밋**
   *  (undo 1엔트리)으로 반영한다. 같은 번호(extId)/공정 id 는 새로 만들지 않고 갱신한다.
   *  reschedule 은 호출하지 않는다(외부 일정표의 날짜가 정본). 조회 전용은 무반영. */
  importScheduleRows: (plan: {
    categories: string[]
    tasks: Array<{
      taskId?: ID
      extId?: string
      categoryName: string
      name: string
      start: number
      duration: number
      owner?: string
    }>
    links: Array<{ fromKey: string; toKey: string; type: LinkType; lag: number }>
    /** 이력에 남길 파일명(없으면 '일정표'). */
    sourceName?: string
  }) => {
    created: number
    updated: number
    linked: number
    /** 공종을 찾지 못해 **반영하지 않은** 행 설명(사람이 읽는 문구). 조용한 재배치 금지. */
    unresolved: string[]
  }
  /** 여러 공정 색상을 한 번에 지정(다중 선택 색 변경). ids가 1개면 그 하나만. */
  setTasksColor: (ids: ID[], color: string, opts?: { history?: boolean }) => void
  /** 세부공종(WBS 2단계) 일괄 이름변경 — 한 공종 안에서 subName===oldSub 인 공정들의 subName을
   *  newSub로 바꾼다(사이드바 세부공종 헤더 더블클릭). 빈 문자열 newSub = 세부공종 해제(직속). */
  renameSubName: (categoryId: ID, oldSub: string, newSub: string) => void
  setTaskStartLive: (id: ID, startDay: number) => void
  setTaskSpanLive: (id: ID, startDay: number, duration: number) => void
  deleteTask: (id: ID) => void
  toggleMilestone: (id: ID) => void
  /** DUMMY(가상/연결) 공정 표시 토글 — 막대를 공정색 60% 투명으로 렌더(우클릭/인스펙터). */
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
  /** 공종 색상 변경 — 좌측 WBS 공종 표식에 적용한다. 막대 색상은 공정 묶음에서 관리한다. */
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
  fitToPaper: (filter?: ViewFilter) => void
  /** 사업 메타(이름·착수일·공기 산정 전제) 병합 수정. periodInputs 는 통째로 교체되므로
   *  호출부에서 기존 값을 펼쳐 넘긴다({ ...project.periodInputs, prepDays: v }). */
  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'startDate' | 'periodInputs'>>) => void
  // ── 건설사업관리 모듈 (사업 단위 · CRDT root/modules·root/baseline) ──
  /** 공정 실적 진척률(0–100) 설정 — 진척·실적 모듈. */
  setTaskProgress: (id: ID, progress: number) => void
  /** 진척 실적 부가정보(담당자·실적 착수/완료일) — 일정(CPM)에 영향 없음(cascade 없음).
   *  빈 문자열은 undefined 로 정규화해 CRDT 에서 키가 지워지게 한다(유령 값 방지). */
  setTaskActuals: (
    id: ID,
    patch: Partial<Pick<Task, 'owner' | 'actualStart' | 'actualFinish'>>,
  ) => void
  // ── 변경 이력·확정본 (F13 · CRDT root/changeLog·root/baselineVersions · undo 대상 아님) ──
  /** 이력 작성자를 설정(로그인 사용자). store 가 authStore 를 import 하면 순환이라 주입식이다. */
  setChangeActor: (actor: { id?: string; name: string }) => void
  /** 변경 이력 1건 추가 — **제출·주요 변경 단위**로만 부른다(키 입력마다 부르지 말 것).
   *  history:false + UNTRACKED_ORIGIN 이라 되돌리기가 감사기록을 지우지 않는다. 새 id 반환. */
  appendChange: (entry: {
    kind: ChangeEntry['kind']
    taskIds?: ID[]
    summary: string
    reason: string
    state?: ChangeState
    versionId?: ID
  }) => ID
  /** 검토요청 → 확정 상태 전이(결재자·시각 기록). */
  setChangeState: (id: ID, state: ChangeState) => void
  /** 현재 일정을 **이름 있는 확정본**으로 박제하고 비교 기준선(project.baseline)도 갱신. 새 id 반환. */
  saveBaselineVersion: (name: string, note?: string) => ID
  /** 기록형 모듈에 빈 행 추가 → 새 레코드 id 반환. */
  addModuleRecord: (moduleId: string, values?: Record<string, string>) => ID
  /** 기록형 모듈 레코드의 필드 병합 수정. */
  updateModuleRecord: (moduleId: string, id: ID, patch: Record<string, string>) => void
  /** 기록형 모듈 레코드 삭제. */
  deleteModuleRecord: (moduleId: string, id: ID) => void
  /** 현재 일정을 기준선으로 박제(대시보드 표류/EVM 연계). */
  captureBaseline: () => void
  clearBaseline: () => void
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
  /** 편집 의미론 전환(위치 자유 편집 ↔ 선후행 제약 유지). localStorage 에 기억된다. */
  setEditMode: (m: EditMode) => void
  /** 마지막 편집 영향 카드 설정/해제. */
  setLastEditImpact: (i: EditImpact | null) => void
  closeRecalcReport: () => void
  /** 문제 목록 팝오버 토글(값을 주면 그 값으로 고정). */
  toggleProblems: (v?: boolean) => void
  /** 문제 목록에서 공정 선택 + 차트 스크롤 요청. */
  focusTask: (id: ID) => void
  /** 스크롤 요청 소비 후 해제(ChartCanvas). */
  clearFocusTask: () => void

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
  /** 파일로 저장. **실제로 파일이 써졌을 때만 true** — 사용자가 취소하면 false. */
  save: () => Promise<boolean>
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

/**
 * 감사기록 합집합(id 기준) — **삭제 없는 병합**. 이미 방에 있는 레코드가 언제나 이깁니다
 * (복구본의 오래된 사본이 '검토요청 → 확정' 같은 결재 상태를 되돌리지 못하게).
 * 새 레코드만 뒤에 붙인 뒤 정렬은 CRDT 읽기(projectFromYDoc)와 같은 규칙을 쓴다.
 */
function mergeAuditRecords<T extends { id: string }>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
  sortKey: (record: T) => string,
): T[] | undefined {
  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map((record) => record.id))
  for (const record of incoming ?? []) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    merged.push(record)
  }
  if (!merged.length) return undefined
  // 상한(BASELINE_VERSION_LIMIT)은 여기서 적용하지 않는다 — 복구가 이력을 '정리'하는 순간
  // 그것도 곧 데이터 소실이다. 상한은 새 확정본을 만드는 자리(saveBaselineVersion)에만 있다.
  return merged.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.id.localeCompare(b.id))
}

const mergeChangeLog = (
  existing: ChangeEntry[] | undefined,
  incoming: ChangeEntry[] | undefined,
): ChangeEntry[] | undefined => mergeAuditRecords(existing, incoming, (e) => e.at ?? '')

const mergeBaselineVersions = (
  existing: BaselineVersion[] | undefined,
  incoming: BaselineVersion[] | undefined,
): BaselineVersion[] | undefined => mergeAuditRecords(existing, incoming, (v) => v.capturedAt ?? '')

function normalize(project: Project): Project {
  const palette =
    Array.isArray(project.palette) && project.palette.length
      ? project.palette.slice(0, PALETTE_MAX)
      : [...DEFAULT_PALETTE]
  return {
    ...project,
    kind: project.kind ?? 'construction',
    // 스키마 버전은 **파일이 실제로 담고 있는 내용**을 따라간다. v2 파일을 열어 v4 전용 필드
    // (extId·owner·실적일자·changeLog·baselineVersions)를 얹고 다시 저장하면 그 파일은 v4 다 —
    // 선언만 v2 로 남으면 나중에 버전으로 분기하는 코드가 있는 필드를 없다고 판단하게 된다.
    meta: { ...(project.meta ?? { createdAt: '', updatedAt: '' }), schemaVersion: SCHEMA_VERSION },
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

/** 파생 일정 결과 — 화면(project) + 사람이 읽는 경고 + 클릭 가능한 문제 목록. */
interface ScheduledView {
  project: Project
  warnings: string[]
  problems: ScheduleProblem[]
}

function withSchedule(project: Project): ScheduledView {
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
  return { project: { ...project, tasks }, warnings: result.warnings, problems: result.problems }
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

/** 'keepLinks'(선후행 제약 유지) — lag 는 절대 건드리지 않고, 들어오는 링크가 허용하는
 *  최조기 시작 이전으로는 내려가지 못하게 막대를 붙잡는다(수동 여유는 그대로 보존). */
function clampToIncoming(p: Project, toId: ID): void {
  const t = p.tasks.find((x) => x.id === toId)
  if (!t) return
  const min = linkConstrainedStart(p.tasks, p.links, toId)
  if (min != null && t.start < min) t.start = min
}

/** 편집 의미론 분기 — 자유 편집은 위치→지연 역산, 제약 유지는 지연 불변 + 위치 clamp.
 *  editMode 기본값('free')에서는 예전 동작과 완전히 동일하다. */
function applyEditSemantics(p: Project, toId: ID, mode: EditMode): void {
  if (mode === 'keepLinks') clampToIncoming(p, toId)
  else relinkIncoming(p, toId)
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

export function moveTaskFractionally(
  project: Project,
  id: ID,
  targetCategoryId: ID,
  anchorId: ID | null,
  mode: 'merge' | 'above' | 'below',
): void {
  const moving = project.tasks.find((task) => task.id === id)
  if (!moving) return
  const parent = moving.parentId
    ? project.tasks.find((task) => task.id === moving.parentId)
    : undefined
  // 세부공정은 같은 상위 공정 블록 안에서만 행을 바꾼다. 다른 공종/공정 위에 놓더라도
  // parentId와 공종을 바꾸지 않아 WBS 소속이 흐트러지지 않는다.
  if (parent) targetCategoryId = parent.categoryId
  moving.categoryId = targetCategoryId
  const lane = project.tasks.filter(
    (task) =>
      task.categoryId === targetCategoryId &&
      task.id !== id &&
      (!parent || task.parentId === parent.id),
  )
  let auto = 0
  const rowOf = new Map<ID, number>()
  for (const task of lane)
    rowOf.set(task.id, typeof task.row === 'number' ? task.row : parent ? 0 : auto++)
  let rows = [...new Set(lane.map((task) => rowOf.get(task.id) ?? 0))].sort((a, b) => a - b)
  // 자식이 하나뿐이어도 상위 공정명 기준 줄(row 0)을 앵커로 삼아 위/아래로 분리할 수 있다.
  if (parent && !rows.includes(0)) rows.push(0)
  rows.sort((a, b) => a - b)
  const anchorRow = parent && anchorId === parent.id ? 0 : rowOf.get(anchorId ?? '')
  let anchorIndex = anchorId == null ? -1 : rows.indexOf(anchorRow ?? Number.NaN)

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
        anchorId == null
          ? -1
          : parent && anchorId === parent.id
            ? rows.indexOf(1024)
            : rows.indexOf(lane.find((t) => t.id === anchorId)?.row ?? Number.NaN)
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

/**
 * 변경 이력(F13)의 작성자. authStore 를 store 에서 import 하면 순환이 되므로, 로그인 상태를
 * 아는 화면(App)이 setChangeActor 로 **주입**한다. 주입 전(로컬 단독 모드)은 '나'.
 */
let changeActor: { id?: string; name: string } = { name: '나' }

/** 확정본(기준선 버전) 보관 상한. 넘치면 오래된 것부터 버린다(문서 무한 증가 방지). */
const BASELINE_VERSION_LIMIT = 20

/** 스케줄된 렌더 프로젝트에서 es/ef 를 읽어 기준선 스냅샷을 만든다(captureBaseline·확정본 공용). */
function buildBaselineSnapshot(scheduled: Project): Baseline {
  const starts = scheduled.tasks.map((t) => t.es ?? t.start)
  const ends = scheduled.tasks.map((t) => t.ef ?? t.start + t.duration)
  const now = new Date()
  return {
    capturedAt: now.toISOString(),
    asOf: now.toISOString().slice(0, 10),
    ...(scheduled.activeSheet?.id ? { sheetId: scheduled.activeSheet.id } : {}),
    startDay: starts.length ? Math.min(...starts) : 0,
    endDay: ends.length ? Math.max(...ends) : 0,
    tasks: scheduled.tasks.map((t) => ({
      id: t.id,
      start: t.es ?? t.start,
      duration: t.duration,
    })),
  }
}

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

  const deriveProject = (authoritative: Project): ScheduledView => {
    let derived = authoritative
    if (scheduleDerivation === 'cascade') {
      derived = { ...derived, tasks: applyCascade(derived.tasks, derived.links).tasks }
    } else if (scheduleDerivation === 'reschedule') {
      derived = { ...derived, tasks: reschedule(derived.tasks, derived.links).tasks }
    }
    return withSchedule(derived)
  }

  const readRuntimeProject = (): ScheduledView => {
    authoritativeShadow = normalize(projectFromYDoc(runtime.doc, activeSheetId))
    return deriveProject(authoritativeShadow)
  }

  /** 파생 결과(project/warnings/problems)를 한 번에 반영 — '잠정' 여부도 같은 자리에서 계산해
   *  화면(상태바 배지·문제 목록)과 계산 결과가 절대 어긋나지 않게 한다. */
  const setScheduled = (s: ScheduledView, extra: Partial<EditorState> = {}): void => {
    set({
      project: s.project,
      warnings: s.warnings,
      problems: s.problems,
      provisional: s.problems.length > 0,
      ...extra,
    })
  }

  const syncDerivedView = (dirty = true): void => {
    if (!observing || !runtimeReady) return
    const scheduled = readRuntimeProject()
    if (scheduled.warnings.length) {
      scheduled.warnings.forEach((warning) => {
        logWarn(warning)
      })
    }
    setScheduled(scheduled, { dirty })
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
    // 감사기록 보호 — importProjectContent 와 **같은 규칙**을 이 경로에도 적용한다.
    // 파일 열기(setProject)는 파일 자신의 project.id 를 그대로 쓰므로, 같은 id 의
    // IndexedDB 문서(sequence:crdt:<id>)가 다시 붙는다. 그 문서에 남아 있던 변경 이력·확정본이
    // '이력이 없던 시절의 백업 파일'로 덮이면 applyProjectToYDoc 의 레코드 diff 가 통째로
    // 지운다(undo 대상이 아니라 되돌릴 수도 없다). 그래서 **같은 문서를 다시 여는 경우에만**
    // 합집합으로 만든다 — 새 도면(newProject)·샘플(loadSample)은 id 가 달라 여기 걸리지 않으며,
    // 그쪽은 애초에 다른 문서라 이월할 이력도 없다.
    const prior = authoritativeShadow
    if (authority === 'replace' && prior && prior.id === normalized.id) {
      normalized.changeLog = mergeChangeLog(prior.changeLog, normalized.changeLog)
      normalized.baselineVersions = mergeBaselineVersions(
        prior.baselineVersions,
        normalized.baselineVersions,
      )
    }
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
    setScheduled(scheduled, {
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      dirty,
      lastEditImpact: null,
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
    else setScheduled(deriveProject(authoritativeShadow), { dirty: true })
  }

  // 재시작 시 마지막 작업 복원 — localStorage 캐시가 있으면 그걸, 없으면 샘플로 시작.
  const initialScheduled = runtimeReady ? readRuntimeProject() : deriveProject(initialNormalized)
  const initial = initialScheduled.project
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
    // 기본은 지금까지의 동작(위치 자유 편집) — 기존 사용자에게 변화 없음.
    editMode: (lsGet('sequence:editMode', 'free') === 'keepLinks'
      ? 'keepLinks'
      : 'free') as EditMode,
    lastEditImpact: null,
    readOnly: false,
    dirty: initialDirty,
    // 시작부터 순환이 있는 도면(불러온 파일)도 첫 화면에서 '잠정'으로 보이게 한다.
    warnings: initialScheduled.warnings,
    problems: initialScheduled.problems,
    provisional: initialScheduled.problems.length > 0,
    problemsOpen: false,
    focusTaskId: null,
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
      const current = get().project
      const incoming = normalize(migrateProject({ ...clone(p), id: current.id }))
      // 감사기록은 **덮어쓰기 대상이 아니다**. applyProjectToYDoc 의 레코드 diff 는 들어온 목록에
      // 없는 id 를 지우므로, 이력이 빠진 버전/파일을 그대로 실으면 방의 변경 이력·확정본이 통째로
      // 사라진다(undo 추적 대상이 아니라 되돌릴 수도 없다). 그래서 여기서 **합집합**으로 만든다 —
      // 스키마 미러링만으로는 서버·내보내기 중 한 곳만 빠뜨려도 같은 사고가 다시 난다.
      incoming.changeLog = mergeChangeLog(current.changeLog, incoming.changeLog)
      incoming.baselineVersions = mergeBaselineVersions(
        current.baselineVersions,
        incoming.baselineVersions,
      )
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
        setScheduled(deriveProject(incoming), { dirty: true })
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
      setScheduled(readRuntimeProject(), {
        selectedTaskId: null,
        selectedTaskIds: [],
        selectedLinkId: null,
        selectedTextRole: null,
        lastEditImpact: null,
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
      const mode = get().editMode
      // Live-ish edits (free-text subName, color-picker drag) pass history:false to
      // avoid flooding the undo stack with one entry per keystroke / drag step.
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t) Object.assign(t, patch)
          // 위치(시작·기간)를 바꾸면 편집 의미론에 따라 지연을 역산하거나(자유 편집),
          // 지연을 그대로 두고 위치만 제약 안으로 붙잡는다(제약 유지).
          if (affectsSchedule) applyEditSemantics(p, id, mode)
        },
        { cascade: affectsSchedule, history: opts?.history ?? true },
      )
    },
    applyReviewDeltas: (deltas) => {
      const skipped: Array<{ taskId: string; reason: string }> = []
      let applied = 0
      const mode = get().editMode
      // 조회 전용은 파싱·감사보다 먼저 차단(부작용 0).
      if (get().readOnly) {
        for (const d of deltas) skipped.push({ taskId: d.taskId, reason: '조회 전용 — 반영 불가' })
        return { applied: 0, skipped }
      }
      // 단일 commit = undo 1엔트리. mutate 의 p 는 최신 authoritativeShadow(=CRDT 진실)이라
      // 여기서의 from 대조가 곧 반영 시점 CAS(프리뷰 이후 원격/타 검토자 변경 소실 방어).
      const appliedIds: ID[] = []
      const reasons: string[] = []
      commit(
        (p) => {
          const changed: ID[] = []
          for (const d of deltas) {
            const t = p.tasks.find((x) => x.id === d.taskId)
            if (!t || t.isMilestone) {
              skipped.push({ taskId: d.taskId, reason: '공정 없음/마일스톤' })
              continue
            }
            if (t.duration !== d.from) {
              skipped.push({ taskId: d.taskId, reason: `반영 중 값 변경(현재 ${t.duration}일)` })
              continue
            }
            const to = Math.max(1, Math.round(d.to))
            // durationLabel 무언파괴 방지: 자동 라벨(=`${from}일`)일 때만 비워 새 공기가 자동
            // 표시되게 하고, 사용자가 넣은 수동 라벨("약 2개월" 등)은 그대로 둔다.
            if (t.durationLabel != null && t.durationLabel === `${d.from}일`)
              t.durationLabel = undefined
            t.duration = to
            changed.push(t.id)
            appliedIds.push(t.id)
            // 검토서의 '사유'는 지금까지 파서만 알고 store 가 버렸다 — 변경 이력에 그대로 싣는다.
            if (d.reason?.trim()) reasons.push(`${t.name}: ${d.reason.trim()}`)
            applied++
          }
          // 반영된 공정들의 incoming 링크를 편집 의미론대로 정리 — 전 델타 적용 후 배치 1회.
          // 제약 유지 모드에서는 AI 검토 반영도 lag 를 몰래 고쳐 쓰지 않는다.
          for (const id of changed) applyEditSemantics(p, id, mode)
        },
        { cascade: true, history: true },
      )
      // 이력은 **별도 커밋(history:false)** 이라 위 반영의 'undo 1엔트리' 보장이 그대로 유지된다.
      if (applied > 0) {
        get().appendChange({
          kind: 'review',
          taskIds: appliedIds,
          summary: `AI 검토 반영 ${applied}건`,
          reason: reasons.join(' / ') || 'AI 검토 반영',
        })
      }
      return { applied, skipped }
    },
    importBoqQuantities: (items, rows = []) => {
      if (get().readOnly) return { applied: 0, recordsAdded: 0 }
      let applied = 0
      let recordsAdded = 0
      commit(
        (p) => {
          p.modules ??= {}
          p.modules.boq ??= []
          for (const row of rows) {
            p.modules.boq.push({ id: `mr-${nanoid(8)}`, values: { category: row.category ?? '', item: row.name, spec: row.spec ?? '', unit: row.unit ?? '', qty: String(row.quantity), price: row.price == null ? '' : String(row.price), note: row.note ?? '' } })
            recordsAdded++
          }
          for (const it of items) {
            const t = p.tasks.find((x) => x.id === it.taskId)
            if (!t || t.isMilestone) continue
            let touched = false
            if (it.quantity != null && Number.isFinite(it.quantity) && it.quantity > 0) {
              t.quantity = it.quantity
              touched = true
            }
            if (it.unit !== undefined) {
              t.unit = it.unit ? it.unit : undefined
              touched = true
            }
            if (it.workCode !== undefined) {
              t.workCode = it.workCode ? it.workCode : undefined
              touched = true
            }
            if (touched) applied++
          }
        },
        { cascade: false, history: true },
      )
      return { applied, recordsAdded }
    },
    importScheduleRows: (plan) => {
      if (get().readOnly) return { created: 0, updated: 0, linked: 0, unresolved: [] }
      let created = 0
      let updated = 0
      let linked = 0
      const touched: ID[] = []
      /** 공종을 끝내 찾지 못해 **반영하지 않은** 행. 조용히 다른 공종으로 옮기지 않는다. */
      const unresolved: string[] = []
      // 단일 commit = undo 1엔트리. 공종 생성·공정 upsert·연결까지 전부 이 안에서 끝내야
      // '취입을 한 번에 취소' 가 성립한다(중간에 나눠 쓰면 되돌리기가 반쪽만 된다).
      commit(
        (p) => {
          // ① 없는 공종 만들기. 대조는 buildSchedulePlan 과 **같은 규칙**(normWorkName)으로 한다 —
          //    원문 그대로 비교하면 '토공  공사'(공백 2칸)와 '토공 공사'가 다른 이름이 되어,
          //    계획은 "이미 있는 공종"이라 생성을 건너뛰고 여기선 못 찾는 어긋남이 생긴다.
          const catIdByName = new Map(p.categories.map((c) => [normWorkName(c.name), c.id]))
          for (const name of plan.categories) {
            if (catIdByName.has(normWorkName(name))) continue
            const id = `c-${nanoid(8)}`
            p.categories.push({
              id,
              name,
              color: DEFAULT_PALETTE[p.categories.length % DEFAULT_PALETTE.length],
              collapsed: false,
              order: p.categories.length,
            })
            catIdByName.set(normWorkName(name), id)
          }
          // ② 공정 upsert. taskId 가 있으면 갱신(중복 생성 금지), 없으면 신규.
          const keyToTaskId = new Map<string, ID>()
          for (const item of plan.tasks) {
            // 공종을 못 찾으면 **첫 공종으로 밀어넣지 않는다**. 조용한 재배치는 공기 적정성
            //(요율이 공종별)·도면·주간보고까지 함께 틀리게 만들고 아무도 눈치채지 못한다.
            const categoryId = catIdByName.get(normWorkName(item.categoryName))
            if (!categoryId) {
              unresolved.push(`${item.name}(공종 '${item.categoryName}')`)
              continue
            }
            const owner = item.owner?.trim() ? item.owner.trim() : undefined
            const existing = item.taskId ? p.tasks.find((t) => t.id === item.taskId) : undefined
            if (existing) {
              existing.categoryId = categoryId
              existing.name = item.name
              existing.start = item.start
              existing.duration = item.duration
              existing.owner = owner
              if (item.extId) existing.extId = item.extId
              // 기간 0 = 마일스톤(외부 일정표의 기간이 정본).
              existing.isMilestone = item.duration === 0
              touched.push(existing.id)
              updated++
              if (item.extId) keyToTaskId.set(item.extId, existing.id)
              keyToTaskId.set(existing.id, existing.id)
            } else {
              const id = `t-${nanoid(8)}`
              p.tasks.push({
                id,
                categoryId,
                name: item.name,
                start: item.start,
                duration: item.duration,
                isMilestone: item.duration === 0,
                ...(item.extId ? { extId: item.extId } : {}),
                ...(owner ? { owner } : {}),
              })
              touched.push(id)
              created++
              if (item.extId) keyToTaskId.set(item.extId, id)
              keyToTaskId.set(id, id)
            }
          }
          // ③ 선후행. relinkIncoming 은 부르지 않는다 — 외부 일정표의 지연(lag)이 정본이고,
          //    위치에서 역산하면 파일이 지정한 연결 의미가 조용히 바뀐다.
          const existingPair = new Map(p.links.map((l) => [`${l.from} ${l.to} ${l.type}`, l]))
          for (const link of plan.links) {
            const from = keyToTaskId.get(link.fromKey)
            const to = keyToTaskId.get(link.toKey)
            if (!from || !to || from === to) continue
            const pair = `${from} ${to} ${link.type}`
            const existing = existingPair.get(pair)
            if (existing) {
              existing.lag = link.lag
              continue
            }
            const added = { id: `l-${nanoid(8)}`, from, to, type: link.type, lag: link.lag }
            existingPair.set(pair, added)
            p.links.push(added)
            linked++
          }
        },
        { cascade: false, history: true },
      )
      if (unresolved.length > 0) {
        // 화면에도 남긴다 — 반환값만 늘리면 '반영됨'만 보이고 빠진 행은 아무도 모른다.
        logWarn(
          `일정표 취입: 공종을 찾지 못해 반영하지 않은 행 ${unresolved.length}건 — ${unresolved.slice(0, 5).join(', ')}`,
        )
      }
      if (created + updated > 0) {
        // 이력은 **별도 커밋(history:false)** — 위 취입 커밋의 'undo 1엔트리' 보장을 깨지 않고,
        // 되돌려도 '누가 언제 무엇을 취입했는가' 는 남는다.
        get().appendChange({
          kind: 'import',
          taskIds: touched,
          summary: `${plan.sourceName ?? '일정표'} 취입 — 신규 ${created} · 갱신 ${updated} · 연결 ${linked}${
            unresolved.length ? ` · 미반영 ${unresolved.length}` : ''
          }`,
          reason: '사내 일정표(엑셀·CSV) 취입',
        })
      }
      return { created, updated, linked, unresolved }
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
      // No history push (gesture already snapshotted); cascade respected. 자유 편집이면
      // incoming 지연을 새 위치로 역산하고, 제약 유지면 지연은 그대로 두고 위치를 붙잡는다.
      const mode = get().editMode
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          // 시작일은 프로젝트 시작(day 0) 이전(음수)도 허용 — 공사기간 좌우 자유 이동.
          if (t) t.start = Math.round(startDay)
          applyEditSemantics(p, id, mode)
        },
        { history: false, cascade: true },
      )
    },
    setTasksStartLive: (moves) => {
      // 다중 선택 공정을 한 제스처로 동시 수평 이동(cascade 1회). gesture 스냅샷은 호출 측.
      const mode = get().editMode
      commit(
        (p) => {
          for (const m of moves) {
            const t = p.tasks.find((x) => x.id === m.id)
            if (t) t.start = Math.round(m.start) // day 0 이전(음수) 허용 — 자유 이동
          }
          // 모든 start 반영 후 정리 — 같은 선택 안의 선후행은 갭 보존(lag 불변).
          for (const m of moves) applyEditSemantics(p, m.id, mode)
        },
        { history: false, cascade: true },
      )
    },
    setTaskSpanLive: (id, startDay, duration) => {
      // Live edge-resize of a bar (start + duration). Gesture already snapshotted.
      const mode = get().editMode
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t && !t.isMilestone) {
            t.start = Math.round(startDay) // day 0 이전(음수) 허용 — 자유 이동
            t.duration = Math.max(1, Math.round(duration))
            applyEditSemantics(p, id, mode)
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
    // filter 를 주면 **그 필터가 남기는 도면**(= '현재 표시 범위'로 출력될 도면)에 맞춘다.
    // 주지 않으면 예전 그대로 전체 도면 기준.
    fitToPaper: (filter) => {
      const p = get().project
      const { w, h } = paperMm(p.paper.size, p.paper.orientation)
      const patch = fitToPaperScopedView(p, filter, w, h)
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
      // '여백 없이 채웠다'고 단정하지 않는다 — 실제 여백은 호출한 화면이 출력 사전 점검으로
      // 다시 계산해 말한다(ExportDialog). 여기서는 무엇을 바꿨는지만 남긴다.
      logInfo('용지 비율에 맞춰 읽기 좋은 범위에서 시간축·행 높이·글자 크기를 조정했습니다.')
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

    // ── 건설사업관리 모듈 — 모두 commit(readOnly 가드 + CRDT write + 파생) · history:false ──
    setTaskProgress: (id, progress) =>
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t) t.progress = Math.max(0, Math.min(100, Math.round(progress)))
        },
        { history: false },
      ),
    setTaskActuals: (id, patch) =>
      commit(
        (p) => {
          const t = p.tasks.find((x) => x.id === id)
          if (!t) return
          // 빈 문자열은 undefined 로 — syncPlainMap 이 키를 지워 '입력을 비웠다'가 그대로 전달된다.
          for (const key of ['owner', 'actualStart', 'actualFinish'] as const) {
            if (!(key in patch)) continue
            const value = patch[key]
            t[key] = value?.trim() ? value.trim() : undefined
          }
        },
        { history: false },
      ),
    setChangeActor: (actor) => {
      changeActor = { id: actor.id, name: actor.name.trim() || '알 수 없음' }
    },
    appendChange: (entry) => {
      if (get().readOnly) return ''
      const id = `ch-${nanoid(8)}`
      const record: ChangeEntry = {
        id,
        at: new Date().toISOString(),
        ...(changeActor.id ? { actorId: changeActor.id } : {}),
        actorName: changeActor.name,
        kind: entry.kind,
        taskIds: entry.taskIds ?? [],
        summary: entry.summary,
        reason: entry.reason,
        state: entry.state ?? 'draft',
        ...(entry.versionId ? { versionId: entry.versionId } : {}),
      }
      commit(
        (p) => {
          p.changeLog = [...(p.changeLog ?? []), record]
        },
        // UNTRACKED_ORIGIN 을 명시한다 — 드래그 제스처 중이어도 이력이 undo 스택에 섞이지 않는다.
        { history: false, origin: UNTRACKED_ORIGIN },
      )
      return id
    },
    setChangeState: (id, state) =>
      commit(
        (p) => {
          const entry = p.changeLog?.find((e) => e.id === id)
          if (!entry) return
          entry.state = state
          entry.decidedBy = changeActor.name
          entry.decidedAt = new Date().toISOString()
        },
        { history: false, origin: UNTRACKED_ORIGIN },
      ),
    saveBaselineVersion: (name, note) => {
      if (get().readOnly) return ''
      const id = `bv-${nanoid(8)}`
      const label = name.trim() || `확정본 ${new Date().toISOString().slice(0, 10)}`
      const version: BaselineVersion = {
        ...buildBaselineSnapshot(get().project),
        id,
        name: label,
        authorName: changeActor.name,
        ...(note?.trim() ? { note: note.trim() } : {}),
      }
      commit(
        (p) => {
          // 확정본은 append-only. 상한을 둬 문서가 무한정 커지지 않게 하고, 넘치면 **오래된 것부터** 버린다.
          const next = [...(p.baselineVersions ?? []), version]
          p.baselineVersions = next.slice(Math.max(0, next.length - BASELINE_VERSION_LIMIT))
          // 기존 표류 KPI(projectKpis.baseline)가 계속 동작하도록 비교 기준선도 최신 확정본으로.
          p.baseline = {
            capturedAt: version.capturedAt,
            asOf: version.asOf,
            ...(version.sheetId ? { sheetId: version.sheetId } : {}),
            startDay: version.startDay,
            endDay: version.endDay,
            tasks: version.tasks,
          }
        },
        { history: false, origin: UNTRACKED_ORIGIN },
      )
      get().appendChange({
        kind: 'baseline',
        summary: `확정본 저장 — ${label} (추적 공정 ${version.tasks.length})`,
        reason: note?.trim() || '기준선 확정',
        state: 'confirmed',
        versionId: id,
      })
      return id
    },
    addModuleRecord: (moduleId, values = {}) => {
      const id = `mr-${nanoid(8)}`
      commit(
        (p) => {
          if (!p.modules) p.modules = {}
          p.modules[moduleId] = [...(p.modules[moduleId] ?? []), { id, values: { ...values } }]
        },
        { history: false },
      )
      return id
    },
    updateModuleRecord: (moduleId, id, patch) =>
      commit(
        (p) => {
          const rec = p.modules?.[moduleId]?.find((r) => r.id === id)
          if (rec) rec.values = { ...rec.values, ...patch }
        },
        { history: false },
      ),
    deleteModuleRecord: (moduleId, id) =>
      commit(
        (p) => {
          if (p.modules?.[moduleId])
            p.modules[moduleId] = p.modules[moduleId].filter((r) => r.id !== id)
        },
        { history: false },
      ),
    captureBaseline: () => {
      // 스케줄된 렌더 프로젝트에서 es/ef를 읽어 박제(가시 공정 envelope + 전체 tasks).
      const snapshot = buildBaselineSnapshot(get().project)
      commit(
        (p) => {
          p.baseline = snapshot
        },
        { history: false },
      )
    },
    clearBaseline: () =>
      commit(
        (p) => {
          delete p.baseline
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
      setScheduled(deriveProject(authoritativeShadow))
      set({ recalcReport: buildRecalcReport('cascade', before, get().project) })
      logInfo('연쇄 일정 정렬을 적용했습니다.')
    },
    rescheduleNow: () => {
      const before = new Map(get().project.tasks.map((t) => [t.id, t.start]))
      scheduleDerivation = 'reschedule'
      setScheduled(deriveProject(authoritativeShadow))
      set({ recalcReport: buildRecalcReport('reschedule', before, get().project) })
      logInfo('전체 일정을 최조기(最早期)로 재계산했습니다.')
    },
    setAutoCascade: (v) => {
      if (!v && scheduleDerivation === 'cascade') scheduleDerivation = null
      setScheduled(deriveProject(authoritativeShadow), { autoCascade: v })
    },
    setEditMode: (m) => {
      lsSet('sequence:editMode', m)
      set({ editMode: m })
    },
    setLastEditImpact: (i) => set({ lastEditImpact: i }),
    closeRecalcReport: () => set({ recalcReport: null }),
    toggleProblems: (v) => set((s) => ({ problemsOpen: v ?? !s.problemsOpen })),
    focusTask: (id) =>
      set({
        selectedTaskId: id,
        selectedTaskIds: [id],
        selectedLinkId: null,
        selectedTextRole: null,
        inspectorTab: 'task' as InspectorTab,
        focusTaskId: id,
      }),
    clearFocusTask: () => set({ focusTaskId: null }),

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
    setZoom: (z) => set({ zoom: Math.min(6, Math.max(0.02, z)) }),
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
    setReadOnly: (v) => {
      set({ readOnly: v })
      // 저장 상태 칩도 같은 사실을 봐야 한다 — 조회 전용 연결은 서버가 업데이트를 받지
      // 않으므로 provider 의 미전송 카운터가 영영 0으로 돌아오지 않는다(칩이 '전송 대기…'로 굳음).
      usePersistence.getState().setReadOnly(v)
    },

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
      // 되돌린 편집의 영향 카드는 더 이상 사실이 아니다 — 즉시 내린다.
      set({ lastEditImpact: null })
    },
    redo: () => {
      if (!runtimeReady) return
      runtime.undoManager.stopCapturing()
      gestureActive = false
      const stackItem = runtime.undoManager.redoStack[runtime.undoManager.redoStack.length - 1]
      runtime.undoManager.redo()
      restoreSelection(stackItem?.meta.get(selectionAfterKey) as SelectionSnapshot | undefined)
      syncDerivedView(true)
      set({ lastEditImpact: null })
    },

    // 사용자가 명시적으로 "저장"을 누르거나 Ctrl+S 했을 때만 동작 — 사용자가 고른
    // 경로의 .json으로 저장한다(state/fileIO.ts). 자동저장은 없다.
    save: async () => {
      try {
        const snapshot = runtimeReady ? projectFromYDoc(runtime.doc, activeSheetId) : get().project
        const ok = await saveProjectToFile(snapshot)
        if (ok) set({ dirty: false }) // 사용자가 취소하면 dirty 유지
        return ok
      } catch (e) {
        logWarn('저장 실패', e)
        return false
      }
    },
  }
})

/**
 * 파일 백업(.json)의 **유일한** 진입점 — 상단바 [저장] 버튼·Ctrl+S·저장 칩이 모두 여기를 지난다.
 *
 * 예전에는 각 호출부가 `await save(); if (!dirty) markFileBackup()` 로 '저장됨'을 **추론**했다.
 * dirty=false 는 '보류 중인 변경이 없다'일 뿐 '파일이 써졌다'가 아니어서, 편집 없이 저장을 눌러
 * OS 대화상자를 취소해도 칩에 없는 파일의 백업 시각이 찍혔다. 반대로 Ctrl+S 는 save() 만 불러
 * 성공해도 '파일 백업 없음'으로 남았다. 이제 save() 의 실제 결과(파일 기록 여부)만 근거로 삼는다.
 */
export async function backupProjectToFile(): Promise<boolean> {
  const ok = await useEditor.getState().save()
  if (ok) usePersistence.getState().markFileBackup()
  return ok
}
