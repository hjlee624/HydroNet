import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createSampleProject } from '../src/data/sampleProject'
import {
  applyProjectToYDoc,
  bootstrapProjectYTypes,
  canonicalProjectSnapshot,
  createProjectUndoManager,
  createUnseededProjectCrdtRuntime,
  getCurrentCrdtRuntime,
  LOCAL_ORIGIN,
  projectFromYDoc,
  seedProjectYDocIfEmpty,
} from '../src/state/crdt'
import { useEditor } from '../src/state/store'
import type { Project } from '../src/types/model'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sync(left: Y.Doc, right: Y.Doc): void {
  const leftUpdate = Y.encodeStateAsUpdate(left)
  const rightUpdate = Y.encodeStateAsUpdate(right)
  Y.applyUpdate(left, rightUpdate)
  Y.applyUpdate(right, leftUpdate)
}

function edit(doc: Y.Doc, mutate: (project: Project) => void): void {
  const project = projectFromYDoc(doc)
  mutate(project)
  applyProjectToYDoc(doc, project, LOCAL_ORIGIN)
}

function taskById(project: Project, id: string): Project['tasks'][number] {
  const task = project.tasks.find((candidate) => candidate.id === id)
  assert(task, `missing task ${id}`)
  return task
}

const base = createSampleProject()
const [first, second] = base.tasks
assert(first && second, 'sample requires at least two tasks')

// Seed once, then distribute the CRDT update. Peers must never re-import JSON independently.
const left = new Y.Doc()
applyProjectToYDoc(left, base)
const right = new Y.Doc()
Y.applyUpdate(right, Y.encodeStateAsUpdate(left))

edit(left, (project) => {
  taskById(project, first.id).name = 'left-record-edit'
})
edit(right, (project) => {
  taskById(project, second.id).note = 'right-record-edit'
})
sync(left, right)
for (const doc of [left, right]) {
  const project = projectFromYDoc(doc)
  assert.equal(project.tasks.find((task) => task.id === first.id)?.name, 'left-record-edit')
  assert.equal(project.tasks.find((task) => task.id === second.id)?.note, 'right-record-edit')
}
assert.deepEqual(projectFromYDoc(left), projectFromYDoc(right), 'different-record edits converge')

// Same-field concurrent writes choose one deterministic Yjs winner on every peer.
const sameA = new Y.Doc()
const sameB = new Y.Doc()
const convergedUpdate = Y.encodeStateAsUpdate(left)
Y.applyUpdate(sameA, convergedUpdate)
Y.applyUpdate(sameB, convergedUpdate)
edit(sameA, (project) => {
  taskById(project, first.id).note = 'same-field-a'
})
edit(sameB, (project) => {
  taskById(project, first.id).note = 'same-field-b'
})
sync(sameA, sameB)
const sameAValue = projectFromYDoc(sameA).tasks.find((task) => task.id === first.id)?.note
const sameBValue = projectFromYDoc(sameB).tasks.find((task) => task.id === first.id)?.note
assert.equal(sameAValue, sameBValue, 'same field converges')
assert(['same-field-a', 'same-field-b'].includes(sameAValue ?? ''))

// CPM and mirror render fields never enter the authoritative document or JSON snapshot.
const polluted = clone(base)
Object.assign(polluted.tasks[0], {
  es: 1,
  ef: 2,
  ls: 3,
  lf: 4,
  totalFloat: 5,
  critical: true,
  __mirror: true,
  forceCritical: false,
  start: 77,
})
const cleanDoc = new Y.Doc()
applyProjectToYDoc(cleanDoc, polluted)
const cleanTask = projectFromYDoc(cleanDoc).tasks[0]
for (const key of ['es', 'ef', 'ls', 'lf', 'totalFloat', 'critical', '__mirror']) {
  assert(!(key in cleanTask), `${key} must not be authoritative`)
}
assert.equal(cleanTask.forceCritical, false)
assert.equal(cleanTask.start, 77)

const json = JSON.stringify(canonicalProjectSnapshot(polluted))
const parsed = JSON.parse(json) as Project
const roundtrip = new Y.Doc()
applyProjectToYDoc(roundtrip, parsed)
assert.deepEqual(
  canonicalProjectSnapshot(projectFromYDoc(roundtrip)),
  canonicalProjectSnapshot(projectFromYDoc(cleanDoc)),
  'canonical JSON roundtrip is lossless',
)

// Undo tracks only LOCAL_ORIGIN. A later remote task edit remains after local undo.
const undoDoc = new Y.Doc()
const undoTypes = applyProjectToYDoc(undoDoc, base)
const undoManager = createProjectUndoManager(undoTypes)
const originalFirstName = taskById(base, first.id).name
undoManager.stopCapturing()
edit(undoDoc, (project) => {
  taskById(project, first.id).name = 'local-undo-target'
})
undoManager.stopCapturing()
const remoteDoc = new Y.Doc()
Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(undoDoc))
edit(remoteDoc, (project) => {
  taskById(project, second.id).name = 'remote-must-survive'
})
Y.applyUpdate(undoDoc, Y.encodeStateAsUpdate(remoteDoc))
undoManager.undo()
const undone = projectFromYDoc(undoDoc)
assert.equal(undone.tasks.find((task) => task.id === first.id)?.name, originalFirstName)
assert.equal(undone.tasks.find((task) => task.id === second.id)?.name, 'remote-must-survive')
undoManager.destroy()

// Two LOCAL transactions between stopCapturing boundaries form one drag gesture.
const gestureDoc = new Y.Doc()
const gestureTypes = applyProjectToYDoc(gestureDoc, base)
const gestureUndo = createProjectUndoManager(gestureTypes)
const original = clone(taskById(projectFromYDoc(gestureDoc), first.id))
gestureUndo.stopCapturing()
edit(gestureDoc, (project) => {
  taskById(project, first.id).start = original.start + 10
})
edit(gestureDoc, (project) => {
  taskById(project, first.id).duration = original.duration + 5
})
gestureUndo.stopCapturing()
gestureUndo.undo()
const gestureUndone = taskById(projectFromYDoc(gestureDoc), first.id)
assert.equal(gestureUndone.start, original.start)
assert.equal(gestureUndone.duration, original.duration)
gestureUndo.destroy()

// Existing persisted/server state wins over a stale seed candidate.
const existing = new Y.Doc()
applyProjectToYDoc(existing, base)
edit(existing, (project) => {
  taskById(project, first.id).name = 'persisted-authority'
})
const hydrated = createUnseededProjectCrdtRuntime(base.id, { persist: false })
Y.applyUpdate(hydrated.doc, Y.encodeStateAsUpdate(existing))
assert.equal(seedProjectYDocIfEmpty(hydrated.doc, base), false)
assert.equal(
  projectFromYDoc(hydrated.doc).tasks.find((task) => task.id === first.id)?.name,
  'persisted-authority',
)
hydrated.destroy()

// A collaborative store must not replay queued edits after the first partial
// server update. Replay waits for the explicit provider initial-sync signal.
const gatedProjectId = `hydration-gate-${Date.now()}`
useEditor.getState().openCollaborativeProject(gatedProjectId, 'hydration-placeholder')
const gatedRuntime = getCurrentCrdtRuntime()
assert(gatedRuntime, 'collaborative runtime must be active')
useEditor.getState().setProjectMeta({ name: 'queued-after-full-hydration' })

const serverAuthority = clone(base)
serverAuthority.id = gatedProjectId
serverAuthority.name = 'server-authority'
const serverDoc = new Y.Doc()
const serverTypes = bootstrapProjectYTypes(serverDoc)
serverDoc.transact(() => {
  serverTypes.meta.set('id', gatedProjectId)
  serverTypes.meta.set('name', 'server-partial')
})
const partialUpdate = Y.encodeStateAsUpdate(serverDoc)
const partialVector = Y.encodeStateVector(serverDoc)
applyProjectToYDoc(serverDoc, serverAuthority)
const remainingUpdate = Y.encodeStateAsUpdate(serverDoc, partialVector)

Y.applyUpdate(gatedRuntime.doc, partialUpdate)
await Promise.resolve()
assert.equal(
  projectFromYDoc(gatedRuntime.doc).name,
  'server-partial',
  'a partial Y update must not release queued edits',
)
Y.applyUpdate(gatedRuntime.doc, remainingUpdate)
await Promise.resolve()
assert.equal(
  projectFromYDoc(gatedRuntime.doc).name,
  'server-authority',
  'even a non-empty full document waits for provider onSynced',
)
gatedRuntime.completeProviderHydration()
await gatedRuntime.hydrated
await Promise.resolve()
assert.equal(projectFromYDoc(gatedRuntime.doc).name, 'queued-after-full-hydration')
assert.equal(
  projectFromYDoc(gatedRuntime.doc).tasks.length,
  serverAuthority.tasks.length,
  'queued replay preserves fully hydrated server records',
)

// Explicit provider-less runtimes remain immediately usable after local readiness.
const providerless = createUnseededProjectCrdtRuntime('providerless', { persist: false })
await providerless.hydrated
providerless.destroy()

// Store cascade is a local derived view: only the user's changed duration is authoritative.
const cascadeProject = clone(base)
cascadeProject.activeSheet = undefined
cascadeProject.sheets = undefined
cascadeProject.categories = [clone(base.categories[0])]
cascadeProject.tasks = [
  {
    id: 'cascade-a',
    categoryId: cascadeProject.categories[0].id,
    name: 'A',
    start: 0,
    duration: 10,
    isMilestone: false,
  },
  {
    id: 'cascade-b',
    categoryId: cascadeProject.categories[0].id,
    name: 'B',
    start: 10,
    duration: 5,
    isMilestone: false,
  },
]
cascadeProject.links = [
  { id: 'cascade-link', from: 'cascade-a', to: 'cascade-b', type: 'FS', lag: 0 },
]
useEditor.getState().setProject(cascadeProject)
useEditor.getState().updateTask('cascade-a', { duration: 20 })
assert.equal(
  useEditor.getState().project.tasks.find((task) => task.id === 'cascade-b')?.start,
  20,
  'cascade is visible in the derived view',
)
const cascadeRuntime = getCurrentCrdtRuntime()
assert(cascadeRuntime, 'store must expose the active CRDT runtime')
assert.equal(
  projectFromYDoc(cascadeRuntime.doc).tasks.find((task) => task.id === 'cascade-b')?.start,
  10,
  'cascade-only start is absent from the CRDT snapshot',
)

// Undo UI state and selection metadata follow Y.UndoManager, not legacy snapshots.
useEditor.getState().setProject(cascadeProject)
useEditor.getState().selectTask('cascade-a')
useEditor.getState().updateTask('cascade-a', { name: 'undo-selection' })
useEditor.getState().selectTask('cascade-b')
assert.equal(useEditor.getState().canUndo, true)
useEditor.getState().undo()
assert.equal(useEditor.getState().selectedTaskId, 'cascade-a')
assert.equal(useEditor.getState().project.tasks.find((task) => task.id === 'cascade-a')?.name, 'A')
assert.equal(useEditor.getState().canRedo, true)

// activeSheet is a local pointer: switching sheets neither writes nor replaces the document.
const multi = clone(cascadeProject)
multi.activeSheet = { id: 'sheet-a', role: 'plan', name: 'Sheet A' }
multi.sheets = [
  {
    id: 'sheet-b',
    role: 'milestone',
    name: 'Sheet B',
    categories: [clone(cascadeProject.categories[0])],
    tasks: [
      {
        id: 'sheet-b-task',
        categoryId: cascadeProject.categories[0].id,
        name: 'B task',
        start: 3,
        duration: 1,
        isMilestone: false,
      },
    ],
    links: [],
    rainySeasons: [],
  },
]
useEditor.getState().setProject(multi)
const sheetRuntime = getCurrentCrdtRuntime()
assert(sheetRuntime, 'sheet project must expose the active CRDT runtime')
assert.equal(sheetRuntime.types.meta.has('activeSheetId'), false)
const sheetUpdateBefore = Y.encodeStateAsUpdate(sheetRuntime.doc)
useEditor.getState().switchSheet('sheet-b')
assert.equal(getCurrentCrdtRuntime(), sheetRuntime, 'sheet switch keeps the same runtime')
assert.equal(useEditor.getState().project.activeSheet?.id, 'sheet-b')
assert.deepEqual(
  Y.encodeStateAsUpdate(sheetRuntime.doc),
  sheetUpdateBefore,
  'sheet switch does not mutate shared state',
)

// Legacy shared activeSheetId values are ignored; only the local preferred id applies.
const legacyPointerDoc = new Y.Doc()
applyProjectToYDoc(legacyPointerDoc, multi)
bootstrapProjectYTypes(legacyPointerDoc).meta.set('activeSheetId', 'sheet-b')
assert.equal(projectFromYDoc(legacyPointerDoc).activeSheet?.id, 'sheet-a')
assert.equal(projectFromYDoc(legacyPointerDoc, 'sheet-b').activeSheet?.id, 'sheet-b')

console.log(
  'CRDT SMOKE OK: convergence, authority, JSON, hydration gate, undo, gesture, local sheet',
)
