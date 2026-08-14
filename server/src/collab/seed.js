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
    setPlainMap(shared, { id: sheet.id, role: sheet.role, name: sheet.name })
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
    })
  }
  for (const sheet of project.sheets || []) byId.set(sheet.id, cloneJson(sheet))
  return [...byId.values()]
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
