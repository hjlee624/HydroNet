import fs from 'node:fs/promises'
import path from 'node:path'
import * as Y from 'yjs'
import { isDocumentName } from './storage.js'

const POSITION_KEY = '$position'
const DERIVED_TASK_FIELDS = new Set(['es', 'ef', 'ls', 'lf', 'totalFloat', 'critical', '__mirror'])
const DEFAULT_PALETTE = [
  '#6E8CA8',
  '#C9803B',
  '#7FA06A',
  '#9A6FA6',
  '#C36B6B',
  '#5E9CA0',
  '#B08A4F',
  '#8089A8',
  '#E12D1B',
  '#2E7D6B',
]
const DEFAULT_PAPER = {
  size: 'A3',
  orientation: 'landscape',
  marginMm: 10,
  dpi: 150,
  fitToPage: true,
}
const DEFAULT_VIEW = {
  pxPerDay: 1.5,
  rowHeight: 46,
  labelWidth: 150,
  headerHeight: 56,
  scale: 'month',
  showCriticalPath: true,
  showFloat: false,
  showGrid: true,
  showTitle: true,
  fontScale: 1,
  textStyles: {},
  taskColumn: true,
  mirrorPlan: false,
  showYearLine: true,
  yearLineWidth: 2.5,
  showMonthLine: true,
  monthLineWidth: 1,
}

/**
 * 공기 산정 전제(Project.periodInputs) ↔ root/meta 스칼라 키 매핑.
 * client/src/state/crdt.ts 의 PERIOD_INPUT_KEYS 와 **같은 키·같은 규칙**이어야 한다 —
 * 여기서 빠뜨리면 스냅샷(GET /api/projects/:id/snapshot)에 허용 편차·준비기간이 실리지 않고,
 * 그 JSON 을 되돌려 방을 다시 열면 모든 공정 판정이 기본값(±15%)으로 조용히 되돌아간다.
 */
const PERIOD_INPUT_KEYS = {
  prepDays: 'piPrepDays',
  cleanupDays: 'piCleanupDays',
  holidayDays: 'piHolidayDays',
  weatherDays: 'piWeatherDays',
  tolerancePct: 'piTolerancePct',
}

/**
 * 관리 레코드의 공정 앵커 예약키. client/src/state/crdt.ts 의 ANCHOR_KEY 와 **같은 키·같은
 * 인코딩(JSON 문자열 하나)** 이어야 한다 — 여기서 빠뜨리면 스냅샷·서버 시드가 앵커를 지운다.
 */
const ANCHOR_KEY = '$anchor'
const MODULE_RESERVED_KEYS = [POSITION_KEY, ANCHOR_KEY]
const ANCHOR_FIELDS = ['sheetId', 'taskId', 'categoryId', 'stamp']

/** 앵커 → 저장 문자열. client crdt.ts encodeAnchor 대칭. */
function encodeAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return undefined
  const compact = {}
  for (const key of ANCHOR_FIELDS) {
    const value = anchor[key]
    if (typeof value === 'string' && value) compact[key] = value
  }
  return Object.keys(compact).length ? JSON.stringify(compact) : undefined
}

/** 저장 문자열 → 앵커. client crdt.ts decodeAnchor 대칭(문자열 필드만 채택). */
function decodeAnchor(raw) {
  if (typeof raw !== 'string' || !raw) return undefined
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const anchor = {}
  for (const key of ANCHOR_FIELDS) {
    const value = parsed[key]
    if (typeof value === 'string' && value) anchor[key] = value
  }
  return Object.keys(anchor).length ? anchor : undefined
}

/** PeriodInputs → meta 스칼라 키. 미입력 필드는 undefined 라 setPlainMap 이 아예 쓰지 않는다. */
function periodInputsToMeta(inputs) {
  const out = {}
  for (const [field, metaKey] of Object.entries(PERIOD_INPUT_KEYS)) {
    const value = inputs?.[field]
    out[metaKey] = typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  return out
}

/**
 * meta 스칼라 키 → PeriodInputs. 스칼라 키가 하나도 없으면 구버전 문서의 중첩
 * meta.periodInputs 객체를 폴백으로 읽는다(하위 호환). 값이 하나도 없으면 undefined 를
 * 돌려줘 스냅샷 JSON 에 periodInputs 키 자체를 만들지 않는다.
 */
function periodInputsFromMeta(meta) {
  const flat = {}
  let found = false
  for (const [field, metaKey] of Object.entries(PERIOD_INPUT_KEYS)) {
    const value = meta?.[metaKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      flat[field] = value
      found = true
    }
  }
  if (found) return flat
  const legacy = meta?.periodInputs
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : undefined
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value))
const compactObject = (value = {}, omitted = new Set()) => {
  const result = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (!omitted.has(key) && item !== undefined) result[key] = cloneJson(item)
  }
  return result
}
const canonicalTask = (task) => compactObject(task, DERIVED_TASK_FIELDS)

function ensureMap(parent, key) {
  const value = new Y.Map()
  parent.set(key, value)
  return value
}

function ensureArray(parent, key, values = []) {
  const value = new Y.Array()
  parent.set(key, value)
  if (values.length) value.insert(0, cloneJson(values))
  return value
}

function setPlainMap(target, value, omitted = new Set()) {
  for (const [key, item] of Object.entries(value || {})) {
    if (!omitted.has(key) && item !== undefined) target.set(key, cloneJson(item))
  }
}

function setRecords(target, records, serializer = compactObject) {
  for (const [index, record] of (records || []).entries()) {
    if (!record?.id) continue
    const shared = new Y.Map()
    setPlainMap(shared, serializer(record))
    shared.set(POSITION_KEY, index + 1)
    target.set(String(record.id), shared)
  }
}

function setSheetRecords(target, sheets) {
  for (const [index, sheet] of sheets.entries()) {
    if (!sheet?.id) continue
    const shared = new Y.Map()
    // 시트별 스칼라(표시 기간·도면 제목)까지 담아야 한다 — client crdt.ts syncSheetCollection
    // 과 같은 키 집합. 빠뜨리면 스냅샷 복구가 그 값만 조용히 지운다.
    setPlainMap(shared, {
      id: sheet.id,
      role: sheet.role,
      name: sheet.name,
      displayStart: sheet.displayStart,
      displayEnd: sheet.displayEnd,
      title: sheet.title,
    })
    setRecords(ensureMap(shared, 'categories'), sheet.categories)
    setRecords(ensureMap(shared, 'tasks'), sheet.tasks, canonicalTask)
    setRecords(ensureMap(shared, 'links'), sheet.links)
    setRecords(ensureMap(shared, 'rainySeasons'), sheet.rainySeasons)
    shared.set(POSITION_KEY, index + 1)
    target.set(String(sheet.id), shared)
  }
}

function residentSheets(project) {
  const byId = new Map()
  if (project.activeSheet?.id) {
    byId.set(project.activeSheet.id, {
      ...cloneJson(project.activeSheet),
      categories: cloneJson(project.categories || []),
      tasks: (project.tasks || []).map(canonicalTask),
      links: cloneJson(project.links || []),
      rainySeasons: cloneJson(project.rainySeasons || []),
      // 활성 시트의 시트별 값은 project.view 에 올라와 있다(client crdt.ts allSheets 와 대칭).
      displayStart: project.view?.displayStart,
      displayEnd: project.view?.displayEnd,
      title: project.view?.title,
    })
  }
  for (const sheet of project.sheets || []) byId.set(sheet.id, cloneJson(sheet))
  return [...byId.values()]
}

/** 모듈 데이터(moduleId → ModuleRecord[])를 root/modules 로 인코딩. client crdt.ts 대칭. */
function setModuleRecords(target, modules) {
  for (const [moduleId, records] of Object.entries(modules || {})) {
    if (!records?.length) continue
    setRecords(ensureMap(target, moduleId), records, (record) => {
      const values = { ...record.values }
      for (const key of MODULE_RESERVED_KEYS) delete values[key]
      const anchor = encodeAnchor(record.anchor)
      return anchor ? { ...values, [ANCHOR_KEY]: anchor } : values
    })
  }
}

/** 기준선 스냅샷을 root/baseline 로 인코딩. */
function setBaseline(target, baseline) {
  if (!baseline) return
  setPlainMap(target, {
    capturedAt: baseline.capturedAt,
    asOf: baseline.asOf,
    sheetId: baseline.sheetId,
    startDay: baseline.startDay,
    endDay: baseline.endDay,
  })
  ensureArray(
    target,
    'tasks',
    (baseline.tasks || []).map((t) => ({ id: t.id, start: t.start, duration: t.duration })),
  )
}

/** Build the same stable named top-level Y types as client/src/state/crdt.ts. */
export function encodeLegacyProject(project, documentName) {
  const doc = new Y.Doc()
  const root = doc.getMap('root')
  const meta = doc.getMap('root/meta')
  const view = doc.getMap('root/view')
  const paper = doc.getMap('root/paper')
  const branding = doc.getMap('root/branding')
  const palette = doc.getArray('root/palette')
  const categories = doc.getMap('root/categories')
  const tasks = doc.getMap('root/tasks')
  const links = doc.getMap('root/links')
  const rainySeasons = doc.getMap('root/rainySeasons')
  const sheets = doc.getMap('root/sheets')
  const modules = doc.getMap('root/modules')
  const baseline = doc.getMap('root/baseline')
  // 변경 이력·확정본(F13) — client/src/state/crdt.ts 의 root/changeLog·root/baselineVersions 대칭.
  // 여기서 빠뜨리면 버전 보관(versions.js)·스냅샷 GET 이 **감사기록 없는 프로젝트**를 만들어내고,
  // 그걸로 되돌리면 방의 이력이 통째로 사라진다(복구 불가 — undo 추적 대상이 아니므로).
  const changeLog = doc.getMap('root/changeLog')
  const baselineVersions = doc.getMap('root/baselineVersions')
  doc.transact(() => {
    for (const name of [
      'meta',
      'view',
      'paper',
      'branding',
      'palette',
      'categories',
      'tasks',
      'links',
      'rainySeasons',
      'sheets',
      'modules',
      'baseline',
      'changeLog',
      'baselineVersions',
    ]) {
      root.set(name, `root/${name}`)
    }
    if (project?.palette?.length) palette.insert(0, cloneJson(project.palette))

    setPlainMap(meta, {
      id: project?.id || documentName,
      name: project?.name || '',
      kind: project?.kind,
      facility: project?.facility,
      startDate: project?.startDate || '',
      commissioningEnabled: project?.commissioningEnabled,
      // 공기 산정 전제 — 클라이언트(crdt.ts)와 같이 meta 스칼라 5개로 펼쳐 쓴다.
      ...periodInputsToMeta(project?.periodInputs),
      createdAt: project?.meta?.createdAt || '',
      updatedAt: project?.meta?.updatedAt || '',
      schemaVersion: project?.meta?.schemaVersion ?? 1,
    })

    const mirrorHidden = project?.view?.mirrorHidden || []
    setPlainMap(view, project?.view, new Set(['mirrorHidden']))
    ensureArray(view, 'mirrorHidden', mirrorHidden)
    setPlainMap(paper, project?.paper)
    ensureArray(branding, 'logos', project?.branding?.logos || [])
    setRecords(categories, project?.categories)
    setRecords(tasks, project?.tasks, canonicalTask)
    setRecords(links, project?.links)
    setRecords(rainySeasons, project?.rainySeasons)
    setSheetRecords(sheets, residentSheets(project || {}))
    setModuleRecords(modules, project?.modules)
    setBaseline(baseline, project?.baseline)
    // 레코드 단위 저장(id → 필드 Map) — 클라이언트와 같은 규칙이라야 병합·왕복이 성립한다.
    setRecords(changeLog, project?.changeLog)
    setRecords(baselineVersions, project?.baselineVersions)
  }, 'sequence-server-seed')
  const state = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return state
}

export function encodeEmptyProject(documentName) {
  const now = new Date().toISOString()
  return encodeLegacyProject(
    {
      id: documentName,
      name: documentName,
      kind: 'construction',
      startDate: now.slice(0, 10),
      commissioningEnabled: false,
      meta: { createdAt: now, updatedAt: now, schemaVersion: 1 },
      paper: DEFAULT_PAPER,
      view: DEFAULT_VIEW,
      branding: { logos: [] },
      palette: DEFAULT_PALETTE,
      categories: [],
      tasks: [],
      links: [],
      rainySeasons: [],
      activeSheet: { id: 'sheet-main', role: 'plan', name: 'Main Schedule' },
      sheets: [],
    },
    documentName,
  )
}

// ── 라이브 Y.Doc → 정규 프로젝트 JSON 역직렬화 ────────────────────────────────
// client/src/state/crdt.ts 의 projectFromYDoc 과 동일 규칙. 백업/스냅샷 GET이
// 최초 시드 JSON이 아니라 실제 라이브 CRDT 상태를 반환하도록 하기 위한 서버측 디코더.
function positionOf(record) {
  const value = record?.get(POSITION_KEY)
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function orderedRecords(map) {
  return [...map.entries()]
    .map(([id, record]) => ({ id, position: positionOf(record), value: record.toJSON() }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(({ value }) => {
      delete value[POSITION_KEY]
      return value
    })
}

function readSheetRecord(record) {
  const id = record.get('id')
  const role = record.get('role')
  const name = record.get('name')
  if (
    typeof id !== 'string' ||
    (role !== 'plan' && role !== 'milestone') ||
    typeof name !== 'string'
  )
    return null
  const categories = record.get('categories')
  const tasks = record.get('tasks')
  const links = record.get('links')
  const rainySeasons = record.get('rainySeasons')
  const displayStart = record.get('displayStart')
  const displayEnd = record.get('displayEnd')
  const title = record.get('title')
  return {
    id,
    role,
    name,
    categories: categories instanceof Y.Map ? orderedRecords(categories) : [],
    tasks: tasks instanceof Y.Map ? orderedRecords(tasks) : [],
    links: links instanceof Y.Map ? orderedRecords(links) : [],
    rainySeasons: rainySeasons instanceof Y.Map ? orderedRecords(rainySeasons) : [],
    // client crdt.ts readSheet 와 같은 규칙 — 문자열일 때만 실어 보낸다(빈 키를 만들지 않음).
    ...(typeof displayStart === 'string' ? { displayStart } : {}),
    ...(typeof displayEnd === 'string' ? { displayEnd } : {}),
    ...(typeof title === 'string' ? { title } : {}),
  }
}

/** 모듈 RecordMap → [{id, values, anchor?}] (id 보존). client crdt.ts orderedModuleRecords 대칭. */
function orderedModuleRecords(collection) {
  return [...collection.entries()]
    .map(([id, record]) => ({ id, position: positionOf(record), record }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(({ id, record }) => {
      const values = record.toJSON()
      const anchor = decodeAnchor(values[ANCHOR_KEY])
      for (const key of MODULE_RESERVED_KEYS) delete values[key]
      return anchor ? { id, values, anchor } : { id, values }
    })
}

function readModules(target) {
  const out = {}
  for (const [moduleId, collection] of target.entries()) {
    if (!(collection instanceof Y.Map)) continue
    const records = orderedModuleRecords(collection)
    if (records.length) out[moduleId] = records
  }
  return out
}

function readBaseline(target) {
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
    tasks: tasks instanceof Y.Array ? tasks.toArray() : [],
  }
}

/**
 * 변경 이력 RecordMap → ChangeEntry[]. client crdt.ts projectFromYDoc 과 **같은 정규화**:
 * taskIds 는 항상 배열, 정렬은 기록 시각(at) → id. 두 피어가 동시에 append 하면 $position 이
 * 겹칠 수 있어 위치 순서만으로는 문서마다 순서가 흔들린다.
 */
function readChangeLog(target) {
  return orderedRecords(target)
    .map((entry) => ({ ...entry, taskIds: Array.isArray(entry.taskIds) ? entry.taskIds : [] }))
    .sort(
      (a, b) =>
        String(a.at ?? '').localeCompare(String(b.at ?? '')) ||
        String(a.id ?? '').localeCompare(String(b.id ?? '')),
    )
}

/** 확정본 RecordMap → BaselineVersion[]. tasks 는 항상 배열, 정렬은 박제 시각(capturedAt) → id. */
function readBaselineVersions(target) {
  return orderedRecords(target)
    .map((version) => ({ ...version, tasks: Array.isArray(version.tasks) ? version.tasks : [] }))
    .sort(
      (a, b) =>
        String(a.capturedAt ?? '').localeCompare(String(b.capturedAt ?? '')) ||
        String(a.id ?? '').localeCompare(String(b.id ?? '')),
    )
}

function readProjectFromDoc(doc, documentName) {
  const meta = doc.getMap('root/meta').toJSON()
  const view = doc.getMap('root/view')
  const paper = doc.getMap('root/paper')
  const branding = doc.getMap('root/branding')
  const palette = doc.getArray('root/palette')
  const categories = doc.getMap('root/categories')
  const tasks = doc.getMap('root/tasks')
  const links = doc.getMap('root/links')
  const rainySeasons = doc.getMap('root/rainySeasons')
  const sheetsMap = doc.getMap('root/sheets')
  const modules = readModules(doc.getMap('root/modules'))
  const baseline = readBaseline(doc.getMap('root/baseline'))
  const changeLog = readChangeLog(doc.getMap('root/changeLog'))
  const baselineVersions = readBaselineVersions(doc.getMap('root/baselineVersions'))

  const mirrorHidden = view.get('mirrorHidden')
  const logos = branding.get('logos')
  const residentSheets = [...sheetsMap.entries()]
    .map(([id, record]) => ({ id, position: positionOf(record), record }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(({ record }) => readSheetRecord(record))
    .filter((sheet) => sheet !== null)
  // activeSheetId 는 클라 로컬 전용이므로 스냅샷은 첫 resident sheet 를 활성으로 본다.
  const activeSheet = residentSheets[0]

  return {
    id: String(meta.id ?? documentName ?? ''),
    name: String(meta.name ?? ''),
    ...(typeof meta.kind === 'string' ? { kind: meta.kind } : {}),
    ...(typeof meta.facility === 'string' ? { facility: meta.facility } : {}),
    startDate: String(meta.startDate ?? ''),
    commissioningEnabled: meta.commissioningEnabled !== false,
    // 공기 산정 전제 — meta 스칼라 5개를 모아 되돌린다(구버전 중첩 객체는 폴백).
    ...(() => {
      const periodInputs = periodInputsFromMeta(meta)
      return periodInputs ? { periodInputs } : {}
    })(),
    meta: {
      createdAt: String(meta.createdAt ?? ''),
      updatedAt: String(meta.updatedAt ?? ''),
      schemaVersion: Number(meta.schemaVersion ?? 1),
    },
    paper: paper.toJSON(),
    view: {
      ...view.toJSON(),
      ...(mirrorHidden instanceof Y.Array ? { mirrorHidden: mirrorHidden.toArray() } : {}),
      // 시트별 값(표시 기간·도면 제목)은 시트가 정본이다. root/view 에 남아 있는 전역 값은
      // 마지막으로 저장한 시트의 것이므로, 활성 시트 값으로 덮어써야 다른 시트의 설정이
      // 스냅샷에서 번져 나가지 않는다(client crdt.ts projectFromYDoc 와 같은 규칙).
      ...(activeSheet
        ? {
            displayStart: activeSheet.displayStart,
            displayEnd: activeSheet.displayEnd,
            title: activeSheet.title,
          }
        : {}),
    },
    branding: { logos: logos instanceof Y.Array ? logos.toArray() : [] },
    palette: palette.toArray(),
    categories: activeSheet?.categories ?? orderedRecords(categories),
    tasks: activeSheet?.tasks ?? orderedRecords(tasks),
    links: activeSheet?.links ?? orderedRecords(links),
    rainySeasons: activeSheet?.rainySeasons ?? orderedRecords(rainySeasons),
    ...(Object.keys(modules).length ? { modules } : {}),
    ...(baseline ? { baseline } : {}),
    // 없는 컨테이너는 키 자체를 만들지 않는다(crdt.ts 와 같은 규칙 — 옛 프로젝트 JSON 형태 보존).
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
}

/** Y.Doc update binary(state) → 정규 프로젝트 JSON. 실패 시 throw. */
export function decodeProjectFromState(state, documentName) {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state instanceof Uint8Array ? state : new Uint8Array(state))
    return readProjectFromDoc(doc, documentName)
  } finally {
    doc.destroy()
  }
}

export function createSeededYDocStorage(storage, legacyDirectory) {
  const seedInFlight = new Map()
  return {
    ...storage,
    async fetch(documentName) {
      if (!isDocumentName(documentName)) throw new Error('invalid-document-name')
      const existing = await storage.fetch(documentName)
      if (existing) return existing

      let pending = seedInFlight.get(documentName)
      if (!pending) {
        pending = (async () => {
          const raced = await storage.fetch(documentName)
          if (raced) return raced
          const legacyFile = path.join(legacyDirectory, `${documentName}.json`)
          let project = null
          try {
            project = JSON.parse(await fs.readFile(legacyFile, 'utf8'))
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
          if (project?.id && project.id !== documentName) {
            throw new Error(`legacy-project-id-mismatch:${documentName}`)
          }
          const state = project
            ? encodeLegacyProject(project, documentName)
            : encodeEmptyProject(documentName)
          return storage.seed(documentName, state)
        })().finally(() => seedInFlight.delete(documentName))
        seedInFlight.set(documentName, pending)
      }
      return pending
    },
  }
}
