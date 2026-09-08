import { IndexeddbPersistence, storeState } from 'y-indexeddb'
import * as Y from 'yjs'
import type {
  Baseline,
  BaselineTask,
  BaselineVersion,
  Branding,
  Category,
  ChangeEntry,
  Link,
  ModuleRecord,
  PeriodInputs,
  Project,
  RainySeason,
  Sheet,
  Task,
} from '../types/model'

/** Object identity is intentional: Y.UndoManager tracks only this exact origin. */
export const LOCAL_ORIGIN = Object.freeze({ kind: 'sequence-local' })
/** Schedule/cascade writes converge, but never enter the user's undo history. */
export const SCHEDULE_ORIGIN = Object.freeze({ kind: 'sequence-schedule' })
/** Local UI changes that historically used history:false remain non-undoable. */
export const UNTRACKED_ORIGIN = Object.freeze({ kind: 'sequence-untracked' })
export const SEED_ORIGIN = Object.freeze({ kind: 'sequence-seed' })

const DERIVED_TASK_FIELDS = new Set(['es', 'ef', 'ls', 'lf', 'totalFloat', 'critical', '__mirror'])
const POSITION_KEY = '$position'
const EPSILON = 1e-9

type JsonRecord = Record<string, unknown>
type RecordMap = Y.Map<Y.Map<unknown>>

export interface ProjectYTypes {
  root: Y.Map<unknown>
  meta: Y.Map<unknown>
  view: Y.Map<unknown>
  paper: Y.Map<unknown>
  branding: Y.Map<unknown>
  palette: Y.Array<string>
  categories: RecordMap
  tasks: RecordMap
  links: RecordMap
  rainySeasons: RecordMap
  sheets: RecordMap
  /** 건설사업관리 기록형 모듈: moduleId → RecordMap(recordId → 필드 Y.Map). 사업 단위. */
  modules: Y.Map<RecordMap>
  /** 기준선 스냅샷: 스칼라 필드 + 'tasks' Y.Array. */
  baseline: Y.Map<unknown>
  /** 변경 이력(F13): entryId → 필드 Y.Map. **레코드 단위**라 두 사람이 서로 다른 이력을
   *  동시에 남겨도 병합된다(배열 통값 저장이면 나중 쓰기가 상대 이력을 지운다). */
  changeLog: RecordMap
  /** 확정본(기준선 버전) 목록(F13): versionId → 필드 Y.Map. 저장 후 불변(append-only). */
  baselineVersions: RecordMap
}

export interface ProjectCrdtRuntime {
  readonly projectId: string
  readonly doc: Y.Doc
  readonly types: ProjectYTypes
  readonly undoManager: Y.UndoManager
  readonly persistence: IndexeddbPersistence | null
  /** Resolves after local IndexedDB hydration and any local empty-document seed. */
  readonly ready: Promise<void>
  /**
   * Resolves only when every expected initial authority source has had a chance
   * to apply its full state. Collaborative runtimes wait for both IndexedDB and
   * the provider's initial sync (or an explicit offline/unavailable signal).
   */
  readonly hydrated: Promise<void>
  /** Releases the collaborative provider gate after sync or offline fallback. */
  completeProviderHydration: () => void
  destroy: () => void
}

type RuntimeListener = (
  runtime: ProjectCrdtRuntime | null,
  previous: ProjectCrdtRuntime | null,
) => void

let currentRuntime: ProjectCrdtRuntime | null = null
const runtimeListeners = new Set<RuntimeListener>()
const persistenceByDoc = new WeakMap<Y.Doc, IndexeddbPersistence>()

function cloneJson<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
}

function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map
}

function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array
}

function ensureMap<T = unknown>(parent: Y.Map<unknown>, key: string): Y.Map<T> {
  const existing = parent.get(key)
  if (isYMap(existing)) return existing as Y.Map<T>
  const created = new Y.Map<T>()
  parent.set(key, created)
  return created
}

function ensureArray<T>(parent: Y.Map<unknown>, key: string): Y.Array<T> {
  const existing = parent.get(key)
  if (isYArray(existing)) return existing as Y.Array<T>
  const created = new Y.Array<T>()
  parent.set(key, created)
  return created
}

/**
 * Creates every shared container exactly once for an initialized document.
 * Calling this repeatedly is safe and does not replace an existing Y type.
 */
export function bootstrapProjectYTypes(doc: Y.Doc): ProjectYTypes {
  const root = doc.getMap<unknown>('root')
  const meta = doc.getMap<unknown>('root/meta')
  const view = doc.getMap<unknown>('root/view')
  const paper = doc.getMap<unknown>('root/paper')
  const branding = doc.getMap<unknown>('root/branding')
  const palette = doc.getArray<string>('root/palette')
  const categories = doc.getMap<Y.Map<unknown>>('root/categories')
  const tasks = doc.getMap<Y.Map<unknown>>('root/tasks')
  const links = doc.getMap<Y.Map<unknown>>('root/links')
  const rainySeasons = doc.getMap<Y.Map<unknown>>('root/rainySeasons')
  const sheets = doc.getMap<Y.Map<unknown>>('root/sheets')
  const modules = doc.getMap<RecordMap>('root/modules')
  const baseline = doc.getMap<unknown>('root/baseline')
  const changeLog = doc.getMap<Y.Map<unknown>>('root/changeLog')
  const baselineVersions = doc.getMap<Y.Map<unknown>>('root/baselineVersions')
  let result!: ProjectYTypes
  doc.transact(() => {
    // Stable scalar references avoid the Yjs nested-type replacement trap when
    // independently created peers encounter the same room. The actual shared
    // containers are top-level named types and therefore have stable identity.
    const refs: Record<string, string> = {
      meta: 'root/meta',
      view: 'root/view',
      paper: 'root/paper',
      branding: 'root/branding',
      palette: 'root/palette',
      categories: 'root/categories',
      tasks: 'root/tasks',
      links: 'root/links',
      rainySeasons: 'root/rainySeasons',
      sheets: 'root/sheets',
      modules: 'root/modules',
      baseline: 'root/baseline',
      changeLog: 'root/changeLog',
      baselineVersions: 'root/baselineVersions',
    }
    for (const [key, ref] of Object.entries(refs)) if (root.get(key) !== ref) root.set(key, ref)
    result = {
      root,
      meta,
      view,
      paper,
      branding,
      palette,
      categories,
      tasks,
      links,
      rainySeasons,
      sheets,
      modules,
      baseline,
      changeLog,
      baselineVersions,
    }
  }, SEED_ORIGIN)
  return result
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function syncPlainMap(
  target: Y.Map<unknown>,
  value: JsonRecord,
  reserved = new Set<string>(),
): void {
  for (const key of [...target.keys()]) {
    if (!reserved.has(key) && (!(key in value) || value[key] === undefined)) target.delete(key)
  }
  for (const [key, next] of Object.entries(value)) {
    if (reserved.has(key)) continue
    if (next === undefined) {
      target.delete(key)
      continue
    }
    const current = target.get(key)
    if (!jsonEqual(current, next)) target.set(key, cloneJson(next))
  }
}

function syncArray<T>(target: Y.Array<T>, values: T[]): void {
  const current = target.toArray()
  if (jsonEqual(current, values)) return
  if (target.length) target.delete(0, target.length)
  if (values.length) target.insert(0, cloneJson(values))
}

function stripTask(task: Task): JsonRecord {
  const result: JsonRecord = {}
  for (const [key, value] of Object.entries(task)) {
    if (!DERIVED_TASK_FIELDS.has(key) && value !== undefined) result[key] = cloneJson(value)
  }
  return result
}

function stripUndefined(value: object): JsonRecord {
  const result: JsonRecord = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = cloneJson(item)
  }
  return result
}

function recordPosition(record: Y.Map<unknown> | undefined): number | undefined {
  const value = record?.get(POSITION_KEY)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function midpoint(left: number | undefined, right: number | undefined): number | null {
  if (left === undefined && right === undefined) return 1
  if (left === undefined) return (right as number) - 1
  if (right === undefined) return left + 1
  if (right - left <= EPSILON) return null
  const value = left + (right - left) / 2
  return Number.isFinite(value) && value > left && value < right ? value : null
}

/**
 * Keeps existing fractional positions whenever their relative order is still valid.
 * Only inserted/moved records receive new midpoints. A bounded full rebalance is used
 * solely after floating-point space is exhausted.
 */
function syncPositions(target: RecordMap, ids: string[]): void {
  const positions = new Map<string, number | undefined>()
  for (const id of ids) positions.set(id, recordPosition(target.get(id)))

  let left: number | undefined
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const current = positions.get(id)
    let right: number | undefined
    for (let j = i + 1; j < ids.length; j++) {
      const candidate = positions.get(ids[j])
      if (candidate !== undefined && (left === undefined || candidate > left + EPSILON)) {
        right = candidate
        break
      }
    }
    if (
      current !== undefined &&
      (left === undefined || current > left + EPSILON) &&
      (right === undefined || current < right - EPSILON)
    ) {
      left = current
      continue
    }
    const next = midpoint(left, right)
    if (next === null) {
      ids.forEach((recordId, index) => {
        target.get(recordId)?.set(POSITION_KEY, index + 1)
      })
      return
    }
    target.get(id)?.set(POSITION_KEY, next)
    positions.set(id, next)
    left = next
  }
}

function syncRecordCollection<T extends { id: string }>(
  target: RecordMap,
  records: T[],
  serialize: (record: T) => JsonRecord,
): void {
  const desiredIds = new Set(records.map((record) => record.id))
  for (const id of [...target.keys()]) if (!desiredIds.has(id)) target.delete(id)

  for (const record of records) {
    let shared = target.get(record.id)
    if (!shared) {
      shared = new Y.Map<unknown>()
      target.set(record.id, shared)
    }
    syncPlainMap(shared, serialize(record), new Set([POSITION_KEY]))
  }
  syncPositions(
    target,
    records.map((record) => record.id),
  )
}

function allSheets(project: Project): Sheet[] {
  const sheets = new Map<string, Sheet>()
  if (project.activeSheet) {
    sheets.set(project.activeSheet.id, {
      ...project.activeSheet,
      categories: cloneJson(project.categories),
      tasks: canonicalTasks(project.tasks),
      links: cloneJson(project.links),
      rainySeasons: cloneJson(project.rainySeasons),
    })
  }
  for (const sheet of project.sheets ?? []) {
    if (!sheets.has(sheet.id)) sheets.set(sheet.id, cloneJson(sheet))
  }
  return [...sheets.values()]
}

function syncSheetCollection(target: RecordMap, sheets: Sheet[]): void {
  const desiredIds = new Set(sheets.map((sheet) => sheet.id))
  for (const id of [...target.keys()]) if (!desiredIds.has(id)) target.delete(id)

  for (const sheet of sheets) {
    let shared = target.get(sheet.id)
    if (!shared) {
      shared = new Y.Map<unknown>()
      target.set(sheet.id, shared)
    }
    syncPlainMap(
      shared,
      { id: sheet.id, role: sheet.role, name: sheet.name },
      new Set(['categories', 'tasks', 'links', 'rainySeasons', POSITION_KEY]),
    )
    syncRecordCollection(
      ensureMap<Y.Map<unknown>>(shared, 'categories'),
      sheet.categories,
      stripUndefined,
    )
    syncRecordCollection(ensureMap<Y.Map<unknown>>(shared, 'tasks'), sheet.tasks, stripTask)
    syncRecordCollection(ensureMap<Y.Map<unknown>>(shared, 'links'), sheet.links, stripUndefined)
    syncRecordCollection(
      ensureMap<Y.Map<unknown>>(shared, 'rainySeasons'),
      sheet.rainySeasons,
      stripUndefined,
    )
  }
  syncPositions(
    target,
    sheets.map((sheet) => sheet.id),
  )
}

function canonicalTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => stripTask(task) as unknown as Task)
}

/** Returns a plain Project snapshot containing authority fields only. */
export function canonicalProjectSnapshot(project: Project): Project {
  return {
    ...cloneJson(project),
    tasks: canonicalTasks(project.tasks),
    sheets: project.sheets?.map((sheet) => ({
      ...cloneJson(sheet),
      tasks: canonicalTasks(sheet.tasks),
    })),
  }
}

/** 모듈 데이터(moduleId → ModuleRecord[])를 root/modules 로 diff 동기화(빈 모듈은 제거). */
function syncModuleCollections(
  target: Y.Map<RecordMap>,
  modules: Record<string, ModuleRecord[]> | undefined,
): void {
  const map = modules ?? {}
  const desired = new Set(Object.keys(map).filter((id) => (map[id]?.length ?? 0) > 0))
  for (const id of [...target.keys()]) if (!desired.has(id)) target.delete(id)
  for (const moduleId of desired) {
    let collection = target.get(moduleId)
    if (!collection) {
      collection = new Y.Map<Y.Map<unknown>>()
      target.set(moduleId, collection)
    }
    syncRecordCollection(collection, map[moduleId], (record) => ({ ...record.values }))
  }
}

/** 기준선 스냅샷을 root/baseline 로 diff 동기화(없으면 비움). */
function syncBaseline(target: Y.Map<unknown>, baseline: Baseline | undefined): void {
  if (!baseline) {
    for (const key of [...target.keys()]) target.delete(key)
    return
  }
  syncPlainMap(
    target,
    {
      capturedAt: baseline.capturedAt,
      asOf: baseline.asOf,
      sheetId: baseline.sheetId,
      startDay: baseline.startDay,
      endDay: baseline.endDay,
    },
    new Set(['tasks']),
  )
  syncArray(
    ensureArray<JsonRecord>(target, 'tasks'),
    baseline.tasks.map((t) => ({ id: t.id, start: t.start, duration: t.duration })),
  )
}

/**
 * 공기 산정 전제(PeriodInputs) ↔ root/meta 스칼라 키 매핑.
 * 필드마다 독립된 meta 키를 쓰는 이유는 **동시 편집 병합** 때문이다 — 중첩 객체 한 덩어리로
 * 넣으면 A의 '준비기간 45'와 B의 '법정공휴일 60'이 동시에 들어올 때 나중 쓰기가 객체 전체를
 * 덮어써 상대 입력이 조용히 사라진다.
 */
const PERIOD_INPUT_KEYS = {
  prepDays: 'piPrepDays',
  cleanupDays: 'piCleanupDays',
  holidayDays: 'piHolidayDays',
  weatherDays: 'piWeatherDays',
  tolerancePct: 'piTolerancePct',
} as const satisfies Record<keyof PeriodInputs, string>

/** PeriodInputs → meta 스칼라 키. 미입력 필드는 undefined 로 실어 syncPlainMap 이 키를 지우게 한다. */
function periodInputsToMeta(inputs: PeriodInputs | undefined): JsonRecord {
  const out: JsonRecord = {}
  for (const [field, metaKey] of Object.entries(PERIOD_INPUT_KEYS)) {
    const value = inputs?.[field as keyof PeriodInputs]
    out[metaKey] = typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  return out
}

/**
 * meta 스칼라 키 → PeriodInputs. 스칼라 키가 하나도 없으면 **구버전 문서의 중첩
 * meta.periodInputs 객체**를 폴백으로 읽는다(하위 호환 — 다음 쓰기에서 스칼라로 이관된다).
 * 값이 하나도 없으면 undefined 를 돌려줘 project.periodInputs 자체를 만들지 않는다.
 */
function periodInputsFromMeta(meta: JsonRecord): PeriodInputs | undefined {
  const flat: PeriodInputs = {}
  let found = false
  for (const [field, metaKey] of Object.entries(PERIOD_INPUT_KEYS)) {
    const value = meta[metaKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      flat[field as keyof PeriodInputs] = value
      found = true
    }
  }
  if (found) return flat
  const legacy = meta.periodInputs
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy)
    ? (legacy as PeriodInputs)
    : undefined
}

/** Applies a field/record diff; unchanged records and fields produce no Yjs operation. */
export function applyProjectToYDoc(
  doc: Y.Doc,
  project: Project,
  origin: unknown = LOCAL_ORIGIN,
): ProjectYTypes {
  const types = bootstrapProjectYTypes(doc)
  const canonical = canonicalProjectSnapshot(project)
  doc.transact(() => {
    syncPlainMap(
      types.meta,
      {
        id: canonical.id,
        name: canonical.name,
        kind: canonical.kind,
        facility: canonical.facility,
        startDate: canonical.startDate,
        commissioningEnabled: canonical.commissioningEnabled,
        // 공기 산정 전제(준비·정리·공휴일·기상·허용편차) — meta 의 **스칼라 키 5개로 펼쳐**
        // 저장한다. 중첩 객체 하나로 넣으면 syncPlainMap 이 객체 전체를 한 값으로 비교·교체해
        // 마지막 쓰기가 이깁니다(A가 준비기간, B가 공휴일수를 동시에 고치면 한쪽이 조용히
        // undefined 로 되돌아감). 키를 나누면 필드별로 독립 병합된다.
        // 구버전 문서의 중첩 periodInputs 는 읽기측(projectFromYDoc)이 폴백으로 흡수하고,
        // 이 쓰기에서 키가 사라지며 자연 이관된다(JSON 왕복 형태는 그대로 PeriodInputs).
        ...periodInputsToMeta(canonical.periodInputs),
        createdAt: canonical.meta.createdAt,
        updatedAt: canonical.meta.updatedAt,
        schemaVersion: canonical.meta.schemaVersion,
      },
      new Set(['activeSheetId']),
    )

    const mirrorHidden = canonical.view.mirrorHidden ?? []
    syncPlainMap(
      types.view,
      { ...stripUndefined(canonical.view), mirrorHidden: undefined },
      new Set(['mirrorHidden']),
    )
    syncArray(ensureArray<string>(types.view, 'mirrorHidden'), mirrorHidden)
    syncPlainMap(types.paper, stripUndefined(canonical.paper))

    const logos = canonical.branding?.logos ?? []
    const logosY = ensureArray<JsonRecord>(types.branding, 'logos')
    syncArray(
      logosY,
      logos.map((logo) => stripUndefined(logo)),
    )
    syncArray(types.palette, canonical.palette)
    // Multi-sheet content lives only in resident sheet records. The top-level
    // collections remain the legacy/single-sheet representation and must not be
    // rewritten merely because another user selected a different local sheet.
    if (!canonical.activeSheet) {
      syncRecordCollection(types.categories, canonical.categories, stripUndefined)
      syncRecordCollection(types.tasks, canonical.tasks, stripTask)
      syncRecordCollection(types.links, canonical.links, stripUndefined)
      syncRecordCollection(types.rainySeasons, canonical.rainySeasons, stripUndefined)
    }
    syncSheetCollection(types.sheets, allSheets(canonical))
    // 건설사업관리 모듈·기준선 — 사업 단위(시트 무관). canonical은 project 전체 스프레드라 포함됨.
    syncModuleCollections(types.modules, canonical.modules)
    syncBaseline(types.baseline, canonical.baseline)
    // 변경 이력·확정본 — 레코드 단위 diff. taskIds/tasks 는 배열이지만 각 레코드가 저장 후
    // 불변(append-only)이라 통값 저장으로 충분하고, **서로 다른 이력끼리는 id가 달라 병합**된다.
    syncRecordCollection(types.changeLog, canonical.changeLog ?? [], stripUndefined)
    syncRecordCollection(types.baselineVersions, canonical.baselineVersions ?? [], stripUndefined)
  }, origin)
  return types
}

function orderedRecords<T>(collection: RecordMap): T[] {
  return [...collection.entries()]
    .map(([id, record]) => ({
      id,
      position: recordPosition(record) ?? Number.MAX_SAFE_INTEGER,
      value: record.toJSON() as T,
    }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(({ value }) => {
      const object = value as JsonRecord
      delete object[POSITION_KEY]
      return value
    })
}

function readSheet(record: Y.Map<unknown>): Sheet | null {
  const id = record.get('id')
  const role = record.get('role')
  const name = record.get('name')
  if (
    typeof id !== 'string' ||
    (role !== 'plan' && role !== 'milestone') ||
    typeof name !== 'string'
  ) {
    return null
  }
  const categories = record.get('categories')
  const tasks = record.get('tasks')
  const links = record.get('links')
  const rainySeasons = record.get('rainySeasons')
  return {
    id,
    role,
    name,
    categories: isYMap(categories) ? orderedRecords<Category>(categories as RecordMap) : [],
    tasks: isYMap(tasks) ? orderedRecords<Task>(tasks as RecordMap) : [],
    links: isYMap(links) ? orderedRecords<Link>(links as RecordMap) : [],
    rainySeasons: isYMap(rainySeasons)
      ? orderedRecords<RainySeason>(rainySeasons as RecordMap)
      : [],
  }
}

/** 모듈 RecordMap → ModuleRecord[](id 보존, $position 순서). */
function orderedModuleRecords(collection: RecordMap): ModuleRecord[] {
  return [...collection.entries()]
    .map(([id, record]) => ({
      id,
      position: recordPosition(record) ?? Number.MAX_SAFE_INTEGER,
      record,
    }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(({ id, record }) => {
      const values = record.toJSON() as JsonRecord
      delete values[POSITION_KEY]
      return { id, values: values as Record<string, string> }
    })
}

function readModules(target: Y.Map<RecordMap>): Record<string, ModuleRecord[]> {
  const out: Record<string, ModuleRecord[]> = {}
  for (const [moduleId, collection] of target.entries()) {
    if (!isYMap(collection)) continue
    const records = orderedModuleRecords(collection as RecordMap)
    if (records.length) out[moduleId] = records
  }
  return out
}

function readBaseline(target: Y.Map<unknown>): Baseline | undefined {
  const capturedAt = target.get('capturedAt')
  if (typeof capturedAt !== 'string' || !capturedAt) return undefined
  const tasks = target.get('tasks')
  const sheetId = target.get('sheetId')
  return {
    capturedAt,
    asOf: String(target.get('asOf') ?? ''),
    ...(typeof sheetId === 'string' && sheetId ? { sheetId } : {}),
    startDay: Number(target.get('startDay') ?? 0),
    endDay: Number(target.get('endDay') ?? 0),
    tasks: isYArray(tasks) ? (tasks.toArray() as BaselineTask[]) : [],
  }
}

/** Converts the current converged Y.Doc into the legacy flat editor Project view. */
export function projectFromYDoc(doc: Y.Doc, preferredActiveSheetId?: string): Project {
  const types = bootstrapProjectYTypes(doc)
  const meta = types.meta.toJSON() as JsonRecord
  const viewJson = types.view.toJSON() as JsonRecord
  const mirrorHidden = types.view.get('mirrorHidden')
  const logos = types.branding.get('logos')
  const sheetEntries = [...types.sheets.entries()]
    .map(([id, record]) => ({
      id,
      position: recordPosition(record) ?? Number.MAX_SAFE_INTEGER,
      record,
    }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const residentSheets = sheetEntries
    .map(({ record }) => readSheet(record))
    .filter((sheet): sheet is Sheet => sheet !== null)
  // activeSheetId is deliberately local-only. Ignore legacy shared metadata so
  // one peer's historical selection can never switch another peer's viewport.
  const activeSheetId = preferredActiveSheetId ?? residentSheets[0]?.id
  const activeSheet = activeSheetId
    ? residentSheets.find((sheet) => sheet.id === activeSheetId)
    : undefined
  const modules = readModules(types.modules)
  const baseline = readBaseline(types.baseline)
  // 변경 이력은 기록 시각(at) 오름차순으로 정규화한다 — 두 피어가 동시에 append 하면
  // $position 이 같은 값을 받을 수 있어 순서가 문서마다 흔들릴 수 있기 때문.
  const changeLog = orderedRecords<ChangeEntry>(types.changeLog)
    .map((e) => ({ ...e, taskIds: Array.isArray(e.taskIds) ? e.taskIds : [] }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  const baselineVersions = orderedRecords<BaselineVersion>(types.baselineVersions)
    .map((v) => ({ ...v, tasks: Array.isArray(v.tasks) ? v.tasks : [] }))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id))

  const project = {
    id: String(meta.id ?? ''),
    name: String(meta.name ?? ''),
    ...(typeof meta.kind === 'string' ? { kind: meta.kind } : {}),
    ...(typeof meta.facility === 'string' ? { facility: meta.facility } : {}),
    startDate: String(meta.startDate ?? ''),
    commissioningEnabled: meta.commissioningEnabled !== false,
    // 공기 산정 전제 — meta 스칼라 키 5개를 모아 되돌린다(구버전 중첩 객체는 폴백).
    ...(() => {
      const pi = periodInputsFromMeta(meta)
      return pi ? { periodInputs: pi } : {}
    })(),
    meta: {
      createdAt: String(meta.createdAt ?? ''),
      updatedAt: String(meta.updatedAt ?? ''),
      schemaVersion: Number(meta.schemaVersion ?? 1),
    },
    paper: types.paper.toJSON(),
    view: {
      ...viewJson,
      ...(isYArray(mirrorHidden) ? { mirrorHidden: mirrorHidden.toArray() } : {}),
    },
    branding: {
      logos: isYArray(logos) ? logos.toArray() : [],
    } as Branding,
    palette: types.palette.toArray(),
    categories: activeSheet?.categories ?? orderedRecords<Category>(types.categories),
    tasks: activeSheet?.tasks ?? orderedRecords<Task>(types.tasks),
    links: activeSheet?.links ?? orderedRecords<Link>(types.links),
    rainySeasons: activeSheet?.rainySeasons ?? orderedRecords<RainySeason>(types.rainySeasons),
    ...(Object.keys(modules).length ? { modules } : {}),
    ...(baseline ? { baseline } : {}),
    ...(changeLog.length ? { changeLog } : {}),
    ...(baselineVersions.length ? { baselineVersions } : {}),
    ...(activeSheet
      ? {
          activeSheet: { id: activeSheet.id, role: activeSheet.role, name: activeSheet.name },
          sheets: residentSheets.filter((sheet) => sheet.id !== activeSheet.id),
        }
      : residentSheets.length
        ? { sheets: residentSheets }
        : {}),
  }
  return project as Project
}

export function attachIndexeddbPersistence(
  projectId: string,
  doc: Y.Doc,
): IndexeddbPersistence | null {
  if (typeof indexedDB === 'undefined') return null
  const existing = persistenceByDoc.get(doc)
  if (existing) return existing
  const persistence = new IndexeddbPersistence(`sequence:crdt:${projectId}`, doc)
  persistenceByDoc.set(doc, persistence)
  return persistence
}

/**
 * 이 업데이트가 '이 브라우저에서 만든 변경'인가.
 * provider(원격 수신)·IndexedDB(하이드레이션)가 적용한 업데이트는 origin 이 그 인스턴스라
 * 여기 걸리지 않는다. 판정이 애매하면 로컬로 보지 않는 쪽이 아니라 **보는 쪽**이 안전하다
 * (미확정으로 표시될 뿐, 완료를 거짓으로 말하지 않는다).
 */
function isLocalUpdateOrigin(origin: unknown): boolean {
  return (
    origin == null ||
    origin === LOCAL_ORIGIN ||
    origin === SCHEDULE_ORIGIN ||
    origin === UNTRACKED_ORIGIN ||
    origin === SEED_ORIGIN ||
    origin instanceof Y.UndoManager
  )
}

export interface LocalPersistenceHandlers {
  /** 이 브라우저에서 문서를 고쳤다(= 아직 어디에도 확정되지 않은 변경이 생겼다). */
  onLocalChange?: () => void
  /** IndexedDB 쓰기 트랜잭션이 실제로 끝났다. 가짜 시각을 만들지 않기 위한 유일한 근거. */
  onLocalFlushed?: () => void
}

/**
 * 로컬 편집과 IndexedDB flush 확정을 관찰한다(F01 표시 모델 입력).
 * 편집이 idleMs 동안 멎으면 storeState 로 강제 flush 하고, 트랜잭션 완료 시에만 onLocalFlushed 를 부른다.
 * persistence 가 없는 환경(테스트·file:// 등)에서는 편집 관찰만 하고 flush 는 하지 않는다.
 */
export function observeLocalPersistence(
  runtime: ProjectCrdtRuntime,
  handlers: LocalPersistenceHandlers,
  idleMs = 1500,
): () => void {
  const persistence = runtime.persistence
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const flush = () => {
    timer = null
    if (stopped || !persistence) return
    void storeState(persistence, true)
      .then(() => {
        if (!stopped) handlers.onLocalFlushed?.()
      })
      .catch(() => {
        /* 로컬 기록 실패는 표시를 갱신하지 않는다 — '확정'을 지어내지 않기 위함 */
      })
  }

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (stopped || !isLocalUpdateOrigin(origin)) return
    handlers.onLocalChange?.()
    if (!persistence) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, idleMs)
  }

  runtime.doc.on('update', onUpdate)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    runtime.doc.off('update', onUpdate)
  }
}

export function createProjectUndoManager(types: ProjectYTypes): Y.UndoManager {
  return new Y.UndoManager(
    [
      types.meta,
      types.view,
      types.paper,
      types.branding,
      types.palette,
      types.categories,
      types.tasks,
      types.links,
      types.rainySeasons,
      types.sheets,
      // modules·baseline 은 의도적으로 제외(사업 단위 기록은 도면 되돌리기 대상이 아니다).
      // changeLog·baselineVersions 도 같은 이유로 **절대 넣지 않는다** — 되돌리기가 감사기록
      // (누가·왜 바꿨는지)과 확정본을 지워버리면 이력의 신뢰가 무너진다.
    ],
    {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 60_000,
    },
  )
}

export function projectYDocIsEmpty(types: ProjectYTypes): boolean {
  return (
    types.meta.size === 0 &&
    types.categories.size === 0 &&
    types.tasks.size === 0 &&
    types.links.size === 0 &&
    types.rainySeasons.size === 0 &&
    types.sheets.size === 0
  )
}

/** Seed exactly once, after a server/IndexedDB update has had the first chance to win. */
export function seedProjectYDocIfEmpty(doc: Y.Doc, project: Project): boolean {
  const types = bootstrapProjectYTypes(doc)
  if (!projectYDocIsEmpty(types)) return false
  applyProjectToYDoc(doc, project, SEED_ORIGIN)
  return true
}

export function createProjectCrdtRuntime(
  project: Project,
  options: { persist?: boolean } = {},
): ProjectCrdtRuntime {
  const doc = new Y.Doc()
  const types = bootstrapProjectYTypes(doc)
  const undoManager = createProjectUndoManager(types)
  const persistence = options.persist === false ? null : attachIndexeddbPersistence(project.id, doc)
  const ready = persistence
    ? persistence.whenSynced.then(() => {
        seedProjectYDocIfEmpty(doc, project)
      })
    : Promise.resolve().then(() => {
        seedProjectYDocIfEmpty(doc, project)
      })
  // Preserve synchronous behavior in Node/file contexts where IndexedDB is absent.
  if (!persistence) seedProjectYDocIfEmpty(doc, project)
  let destroyed = false
  return {
    projectId: project.id,
    doc,
    types,
    undoManager,
    persistence,
    ready,
    hydrated: ready,
    completeProviderHydration: () => undefined,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      undoManager.destroy()
      doc.destroy()
    },
  }
}

/**
 * Provider-safe construction path. Apply the authoritative server seed/update (or
 * await IndexedDB sync) before calling seedProjectYDocIfEmpty. This prevents every
 * browser from independently importing the same legacy JSON into one CRDT room.
 */
export function createUnseededProjectCrdtRuntime(
  projectId: string,
  options: { persist?: boolean; waitForProvider?: boolean } = {},
): ProjectCrdtRuntime {
  const doc = new Y.Doc()
  const types = bootstrapProjectYTypes(doc)
  const undoManager = createProjectUndoManager(types)
  const persistence = options.persist === false ? null : attachIndexeddbPersistence(projectId, doc)
  const ready = persistence ? persistence.whenSynced.then(() => undefined) : Promise.resolve()
  const waitForProvider = options.waitForProvider ?? options.persist !== false
  let releaseProviderHydration = (): void => undefined
  const providerHydrated = waitForProvider
    ? new Promise<void>((resolve) => {
        releaseProviderHydration = resolve
      })
    : Promise.resolve()
  const hydrated = Promise.all([ready, providerHydrated]).then(() => undefined)
  let destroyed = false
  return {
    projectId,
    doc,
    types,
    undoManager,
    persistence,
    ready,
    hydrated,
    completeProviderHydration: () => releaseProviderHydration(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      undoManager.destroy()
      doc.destroy()
    },
  }
}

/** Store-owned activation hook. Provider/presence code should subscribe, not replace it. */
export function activateProjectCrdtRuntime(runtime: ProjectCrdtRuntime | null): void {
  if (runtime === currentRuntime) return
  const previous = currentRuntime
  currentRuntime = runtime
  for (const listener of runtimeListeners) listener(runtime, previous)
}

export function getCurrentCrdtRuntime(): ProjectCrdtRuntime | null {
  return currentRuntime
}

/** Immediately reports the current runtime, then every document replacement. */
export function subscribeProjectCrdtRuntime(listener: RuntimeListener): () => void {
  runtimeListeners.add(listener)
  listener(currentRuntime, null)
  return () => runtimeListeners.delete(listener)
}
