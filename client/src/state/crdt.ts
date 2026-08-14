import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import type { Branding, Category, Link, Project, RainySeason, Sheet, Task } from '../types/model'

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

  const project = {
    id: String(meta.id ?? ''),
    name: String(meta.name ?? ''),
    ...(typeof meta.kind === 'string' ? { kind: meta.kind } : {}),
    ...(typeof meta.facility === 'string' ? { facility: meta.facility } : {}),
    startDate: String(meta.startDate ?? ''),
    commissioningEnabled: meta.commissioningEnabled !== false,
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
