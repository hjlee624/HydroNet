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

/** crdt.ts ANCHOR_KEY 와 같은 값 — 스모크가 저장 레이아웃을 직접 들여다보기 위한 리터럴. */
const ANCHOR_SMOKE_KEY = '$anchor'

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

// 예정공정표와 시공 마일스톤의 타임라인 표시 기간은 시트별로 독립적이어야 한다.
// 한 시트의 displayStart/End가 공유 view에 남더라도 다른 시트가 이를 상속하면 안 된다.
{
  const periodDoc = new Y.Doc()
  const plan = clone(multi)
  plan.view.displayStart = '2026-01-01'
  plan.view.displayEnd = '2026-12-01'
  applyProjectToYDoc(periodDoc, plan)

  const milestone = projectFromYDoc(periodDoc, 'sheet-b')
  assert.equal(milestone.view.displayStart, undefined, '마일스톤은 예정공정표 시작 월을 상속하지 않는다')
  assert.equal(milestone.view.displayEnd, undefined, '마일스톤은 예정공정표 종료 월을 상속하지 않는다')

  milestone.view.displayStart = '2027-03-01'
  milestone.view.displayEnd = '2028-02-01'
  applyProjectToYDoc(periodDoc, milestone)

  const rereadPlan = projectFromYDoc(periodDoc, 'sheet-a')
  const rereadMilestone = projectFromYDoc(periodDoc, 'sheet-b')
  assert.equal(rereadPlan.view.displayStart, '2026-01-01')
  assert.equal(rereadPlan.view.displayEnd, '2026-12-01')
  assert.equal(rereadMilestone.view.displayStart, '2027-03-01')
  assert.equal(rereadMilestone.view.displayEnd, '2028-02-01')
}

// ── 공기 산정 전제(periodInputs) 동시 편집 — 필드별 독립 병합 ───────────────────────────
// A가 준비기간 45, B가 법정공휴일수 60 을 **동시에** 넣는다. 예전처럼 중첩 객체 한 덩어리로
// 저장하면 나중 쓰기가 객체 전체를 덮어써 한쪽 입력이 조용히 사라진다(③ 산정 총공기 박스가
// '가정' 으로 되돌아가고 legalTotal 이 말없이 바뀜). 스칼라 키 5개로 펼친 뒤엔 둘 다 살아야 한다.
{
  const piBase = createSampleProject()
  piBase.periodInputs = { tolerancePct: 10 }
  const piLeft = new Y.Doc()
  applyProjectToYDoc(piLeft, piBase)
  const piRight = new Y.Doc()
  Y.applyUpdate(piRight, Y.encodeStateAsUpdate(piLeft))

  edit(piLeft, (project) => {
    project.periodInputs = { ...project.periodInputs, prepDays: 45 }
  })
  edit(piRight, (project) => {
    project.periodInputs = { ...project.periodInputs, holidayDays: 60 }
  })
  sync(piLeft, piRight)
  for (const doc of [piLeft, piRight]) {
    const pi = projectFromYDoc(doc).periodInputs
    assert.equal(pi?.prepDays, 45, 'concurrent prepDays must survive the merge')
    assert.equal(pi?.holidayDays, 60, 'concurrent holidayDays must survive the merge')
    assert.equal(pi?.tolerancePct, 10, 'untouched tolerancePct must be preserved')
  }
  // 필드 삭제(입력 비움)는 그대로 반영돼야 한다 — 키가 남아 유령 값이 되면 안 된다.
  edit(piLeft, (project) => {
    project.periodInputs = { ...project.periodInputs, prepDays: undefined }
  })
  assert.equal(projectFromYDoc(piLeft).periodInputs?.prepDays, undefined)
  assert.equal(projectFromYDoc(piLeft).periodInputs?.holidayDays, 60)

  // 하위 호환 — 구버전 문서는 meta 에 중첩 periodInputs 객체를 갖고 있다. 그대로 읽히고,
  // 다음 쓰기에서 스칼라 키로 이관돼야 한다(JSON 왕복 형태는 PeriodInputs 그대로).
  const legacyDoc = new Y.Doc()
  applyProjectToYDoc(legacyDoc, createSampleProject())
  bootstrapProjectYTypes(legacyDoc).meta.set('periodInputs', {
    prepDays: 20,
    tolerancePct: 8,
  })
  assert.deepEqual(projectFromYDoc(legacyDoc).periodInputs, { prepDays: 20, tolerancePct: 8 })
  edit(legacyDoc, (project) => {
    project.periodInputs = { ...project.periodInputs, cleanupDays: 40 }
  })
  const migratedMeta = bootstrapProjectYTypes(legacyDoc).meta
  assert.equal(migratedMeta.has('periodInputs'), false, 'legacy nested key must be migrated away')
  assert.deepEqual(projectFromYDoc(legacyDoc).periodInputs, {
    prepDays: 20,
    cleanupDays: 40,
    tolerancePct: 8,
  })
}

// ── 신규 Task 필드(extId·owner·actualStart/Finish) 동시 편집 — 필드 단위 병합 ───────────
// 지금까지 crdt-smoke 는 name/note 만 봤다. stripTask 가 파생필드 외 **모든** 키를 싣고
// syncPlainMap 이 필드별로 diff 하므로, A가 담당자·B가 실적일자를 같은 공정에 넣어도 둘 다 살아야 한다.
{
  const fieldBase = createSampleProject()
  const target = fieldBase.tasks[0]
  const fieldLeft = new Y.Doc()
  applyProjectToYDoc(fieldLeft, fieldBase)
  const fieldRight = new Y.Doc()
  Y.applyUpdate(fieldRight, Y.encodeStateAsUpdate(fieldLeft))

  edit(fieldLeft, (project) => {
    const t = taskById(project, target.id)
    t.owner = '좌담당'
    t.extId = 'EXT-77'
  })
  edit(fieldRight, (project) => {
    const t = taskById(project, target.id)
    t.actualStart = '2026-03-02'
    t.actualFinish = '2026-03-20'
  })
  sync(fieldLeft, fieldRight)
  for (const doc of [fieldLeft, fieldRight]) {
    const t = taskById(projectFromYDoc(doc), target.id)
    assert.equal(t.owner, '좌담당', 'concurrent owner survives')
    assert.equal(t.extId, 'EXT-77', 'concurrent extId survives')
    assert.equal(t.actualStart, '2026-03-02', 'concurrent actualStart survives')
    assert.equal(t.actualFinish, '2026-03-20', 'concurrent actualFinish survives')
  }
  // 입력을 비우면 키가 실제로 지워져야 한다(유령 값 금지).
  edit(fieldLeft, (project) => {
    taskById(project, target.id).owner = undefined
  })
  assert.equal(taskById(projectFromYDoc(fieldLeft), target.id).owner, undefined)
  assert.equal(taskById(projectFromYDoc(fieldLeft), target.id).actualFinish, '2026-03-20')
}

// ── 변경 이력·확정본(F13) — 레코드 단위 병합 + undo 불가침 ─────────────────────────────
{
  const histBase = createSampleProject()
  histBase.changeLog = [
    {
      id: 'ch-seed',
      at: '2026-01-01T00:00:00.000Z',
      actorName: '기존',
      kind: 'note',
      taskIds: [],
      summary: '착수',
      reason: '초기 기록',
      state: 'confirmed',
    },
  ]
  const hLeft = new Y.Doc()
  applyProjectToYDoc(hLeft, histBase)
  const hRight = new Y.Doc()
  Y.applyUpdate(hRight, Y.encodeStateAsUpdate(hLeft))

  edit(hLeft, (project) => {
    taskById(project, first.id).duration += 3
    project.changeLog = [
      ...(project.changeLog ?? []),
      {
        id: 'ch-A',
        at: '2026-02-01T00:00:00.000Z',
        actorName: 'A',
        kind: 'duration',
        taskIds: [first.id],
        summary: '공기 +3일',
        reason: '암반',
        state: 'review',
      },
    ]
  })
  edit(hRight, (project) => {
    taskById(project, second.id).owner = 'B담당'
    project.changeLog = [
      ...(project.changeLog ?? []),
      {
        id: 'ch-B',
        at: '2026-02-02T00:00:00.000Z',
        actorName: 'B',
        kind: 'note',
        taskIds: [second.id],
        summary: '담당 지정',
        reason: '인수인계',
      },
    ]
  })
  sync(hLeft, hRight)
  for (const doc of [hLeft, hRight]) {
    const log = projectFromYDoc(doc).changeLog ?? []
    assert.equal(log.length, 3, 'both peers 이력이 모두 살아남는다(덮어쓰기 없음)')
    assert.deepEqual(
      log.map((e) => e.id),
      ['ch-seed', 'ch-A', 'ch-B'],
      '이력은 기록 시각 순으로 두 피어에서 동일하게 정렬된다',
    )
    assert.equal(log[1].reason, '암반')
    assert.equal(log[2].reason, '인수인계')
  }

  // 확정본(baselineVersions)도 같은 방식으로 왕복하고, undo 는 이력·확정본을 건드리지 않는다.
  const auditDoc = new Y.Doc()
  Y.applyUpdate(auditDoc, Y.encodeStateAsUpdate(hLeft))
  edit(auditDoc, (project) => {
    project.baselineVersions = [
      {
        id: 'bv-1',
        name: '착공 기준선',
        authorName: 'A',
        capturedAt: '2026-02-03T00:00:00.000Z',
        asOf: '2026-02-03',
        startDay: 0,
        endDay: 100,
        tasks: [{ id: first.id, start: 0, duration: 10 }],
      },
    ]
  })
  const auditTypes = bootstrapProjectYTypes(auditDoc)
  const auditUndo = createProjectUndoManager(auditTypes)
  auditUndo.stopCapturing()
  const beforeName = taskById(projectFromYDoc(auditDoc), first.id).name
  // 공정 편집 + 이력/확정본 추가를 **같은 LOCAL 트랜잭션**에 담는다. 이래야 되돌리기 스택
  // 항목 안에 이력 쓰기가 실제로 들어가고, '이력은 undo 대상이 아니다' 라는 보장이 시험된다
  // (따로 커밋하면 스택 항목에 이력 연산이 아예 없어 무엇을 추적하든 통과해버린다).
  edit(auditDoc, (project) => {
    taskById(project, first.id).name = 'audit-undo-target'
    project.changeLog = [
      ...(project.changeLog ?? []),
      {
        id: 'ch-audit',
        at: '2026-02-04T00:00:00.000Z',
        actorName: 'A',
        kind: 'duration',
        taskIds: [first.id],
        summary: '이름 변경',
        reason: '오탈자',
      },
    ]
    project.baselineVersions = [
      ...(project.baselineVersions ?? []),
      {
        id: 'bv-2',
        name: '2차 확정본',
        authorName: 'A',
        capturedAt: '2026-02-04T00:00:00.000Z',
        asOf: '2026-02-04',
        startDay: 0,
        endDay: 120,
        tasks: [{ id: first.id, start: 0, duration: 12 }],
      },
    ]
  })
  auditUndo.stopCapturing()
  auditUndo.undo()
  const audited = projectFromYDoc(auditDoc)
  assert.equal(
    audited.tasks.find((t) => t.id === first.id)?.name,
    beforeName,
    'undo 는 편집만 되돌린다',
  )
  assert.equal(audited.changeLog?.length, 4, 'undo 후에도 변경 이력이 그대로 남는다(감사기록)')
  assert.equal(audited.changeLog?.at(-1)?.id, 'ch-audit', '되돌린 편집의 이력도 살아남는다')
  assert.equal(audited.baselineVersions?.length, 2, 'undo 후에도 확정본이 그대로 남는다')
  assert.equal(audited.baselineVersions?.[0].tasks.length, 1, '확정본의 공정 스냅샷이 왕복된다')
  auditUndo.destroy()

  // 구버전 문서(두 컨테이너가 아예 없음)는 필드 부재로 읽힌다 — 구버전 호환.
  const legacy = createSampleProject()
  const legacyDoc = new Y.Doc()
  applyProjectToYDoc(legacyDoc, legacy)
  const legacyRead = projectFromYDoc(legacyDoc)
  assert.equal(legacyRead.changeLog, undefined, '이력 없는 문서는 changeLog 키 자체가 없다')
  assert.equal(legacyRead.baselineVersions, undefined, '확정본 없는 문서는 키 자체가 없다')
}

// ── 건설사업관리 모듈 — 레코드 왕복 기준선 ───────────────────────────────────────
// 지금까지 모듈 레코드는 클라이언트 왕복 검증이 한 건도 없었다(서버 collab-smoke 는 Y.Map 에
// 원시 키를 직접 써서 클라 직렬화기를 타지 않는다). 앵커를 얹기 **전에** 현재 규약을 박제해
// 둬야 이후 변경이 무엇을 깨뜨리는지 이 블록이 말해준다.
{
  const modBase = createSampleProject()
  modBase.modules = {
    quality: [
      { id: 'mr-q1', values: { type: '검측요청(WIR)', target: '기초 배근', status: '합격' } },
      { id: 'mr-q2', values: { type: '부적합(NCR)', target: '거푸집 단차', status: '재검' } },
    ],
    cost: [{ id: 'mr-c1', values: { group: '공사비', item: '토공', budget: '120000' } }],
  }
  const modDoc = new Y.Doc()
  applyProjectToYDoc(modDoc, modBase)
  const modRead = projectFromYDoc(modDoc)

  assert.deepEqual(
    modRead.modules?.quality?.map((r) => r.id),
    ['mr-q1', 'mr-q2'],
    '모듈 레코드는 id 와 입력 순서가 보존된다',
  )
  assert.deepEqual(
    modRead.modules?.quality?.[1].values,
    { type: '부적합(NCR)', target: '거푸집 단차', status: '재검' },
    '레코드 values 가 통째로 왕복된다',
  )
  assert.equal(
    '$position' in (modRead.modules?.cost?.[0].values ?? {}),
    false,
    '순서 예약키($position)는 values 로 새지 않는다',
  )

  // 빈 컬렉션은 moduleId 키 자체가 사라진다(crdt.ts syncModuleCollections 의 desired 필터).
  const emptied = clone(modRead)
  emptied.modules = { ...(emptied.modules ?? {}), cost: [] }
  applyProjectToYDoc(modDoc, emptied, LOCAL_ORIGIN)
  assert.equal(
    'cost' in (projectFromYDoc(modDoc).modules ?? {}),
    false,
    '빈 모듈은 결과에서 키 자체가 없다(빈 배열이 아니라 부재)',
  )

  // JSON 스냅샷(파일 저장·서버 버전) 왕복에서도 레코드가 보존되어야 한다.
  const modJson = JSON.parse(JSON.stringify(canonicalProjectSnapshot(modBase))) as Project
  const modJsonDoc = new Y.Doc()
  applyProjectToYDoc(modJsonDoc, modJson)
  assert.deepEqual(
    projectFromYDoc(modJsonDoc).modules?.quality?.map((r) => r.values.target),
    ['기초 배근', '거푸집 단차'],
    'JSON 스냅샷 왕복에서 모듈 레코드가 보존된다',
  )

  // **이미 존재하는** 모듈 컬렉션에 두 사람이 동시에 추가하면 레코드 단위로 병합된다.
  const mLeft = new Y.Doc()
  applyProjectToYDoc(mLeft, modBase)
  const mRight = new Y.Doc()
  Y.applyUpdate(mRight, Y.encodeStateAsUpdate(mLeft))
  edit(mLeft, (project) => {
    project.modules = {
      ...(project.modules ?? {}),
      quality: [
        ...(project.modules?.quality ?? []),
        { id: 'mr-A', values: { type: '부적합(NCR)', target: 'A가 발견' } },
      ],
    }
  })
  edit(mRight, (project) => {
    project.modules = {
      ...(project.modules ?? {}),
      quality: [
        ...(project.modules?.quality ?? []),
        { id: 'mr-B', values: { type: '부적합(NCR)', target: 'B가 발견' } },
      ],
    }
  })
  sync(mLeft, mRight)
  for (const doc of [mLeft, mRight]) {
    const quality = projectFromYDoc(doc).modules?.quality ?? []
    assert.deepEqual(
      quality.map((r) => r.id).sort(),
      ['mr-A', 'mr-B', 'mr-q1', 'mr-q2'],
      '기존 컬렉션에 동시 추가한 레코드는 모두 살아남는다',
    )
  }

  // ⚠️ 알려진 결함(특성화 테스트) — **아직 없는** 모듈 컬렉션을 두 피어가 동시에 처음 만들면
  // 한쪽 기록이 통째로 사라진다. root/modules 안의 모듈 컬렉션은 중첩 Y.Map 이라 키 단위
  // LWW 로 컨테이너 자체가 교체되기 때문이다 — bootstrapProjectYTypes(crdt.ts) 주석이 말하는
  // "nested-type replacement trap" 이 최상위 컨테이너에서만 해결되어 있고 여기엔 적용되지 않았다.
  // 근본 수정(모듈별 최상위 named type 또는 복합키 평탄화)은 저장 레이아웃 변경이라 구·신
  // 클라이언트가 섞이는 배포 구간에서 데이터가 갈린다 → 마이그레이션 계획이 붙은 별도 슬라이스.
  // 그때까지 이 단언이 **현재 동작을 고정**해 조용한 변화를 막는다(통과 = 아직 안 고쳐짐).
  const rLeft = new Y.Doc()
  applyProjectToYDoc(rLeft, modBase)
  const rRight = new Y.Doc()
  Y.applyUpdate(rRight, Y.encodeStateAsUpdate(rLeft))
  edit(rLeft, (project) => {
    project.modules = {
      ...(project.modules ?? {}),
      risk: [{ id: 'mr-A', values: { type: '리스크', content: '지반 불량' } }],
    }
  })
  edit(rRight, (project) => {
    project.modules = {
      ...(project.modules ?? {}),
      risk: [{ id: 'mr-B', values: { type: '이슈', content: '자재 지연' } }],
    }
  })
  sync(rLeft, rRight)
  assert.equal(
    (projectFromYDoc(rLeft).modules?.risk ?? []).length,
    1,
    '알려진 결함: 신규 모듈 컬렉션 동시 생성은 한쪽만 남는다(고쳐지면 이 단언이 실패해 알려준다)',
  )
}

// ── 공정 앵커($anchor) — 왕복·해제·보존·방어 ──────────────────────────────────────
{
  const anchorBase = createSampleProject()
  const anchoredTask = anchorBase.tasks[0]
  anchorBase.modules = {
    quality: [
      {
        id: 'mr-anchored',
        values: { type: '부적합(NCR)', target: '거푸집 단차' },
        anchor: { taskId: anchoredTask.id, stamp: anchoredTask.name },
      },
      { id: 'mr-plain', values: { type: '검측요청(WIR)', target: '기초 배근' } },
    ],
  }
  const aDoc = new Y.Doc()
  applyProjectToYDoc(aDoc, anchorBase)

  const readBack = projectFromYDoc(aDoc).modules?.quality ?? []
  assert.deepEqual(
    readBack[0].anchor,
    { taskId: anchoredTask.id, stamp: anchoredTask.name },
    '앵커가 왕복에서 그대로 보존된다',
  )
  assert.equal(
    ANCHOR_SMOKE_KEY in readBack[0].values,
    false,
    '예약키가 values 로 새지 않는다(내보내기·AI검토 .md 오염 방지)',
  )
  assert.equal(readBack[1].anchor, undefined, '앵커 없는 레코드는 anchor 키 자체가 없다')

  // 다른 values 필드만 고쳐도 앵커는 살아남는다.
  edit(aDoc, (project) => {
    const record = project.modules?.quality?.find((r) => r.id === 'mr-anchored')
    assert(record, 'anchored record must exist')
    record.values.target = '거푸집 단차(재검)'
  })
  const afterEdit = projectFromYDoc(aDoc).modules?.quality?.[0]
  assert.equal(afterEdit?.values.target, '거푸집 단차(재검)')
  assert.equal(afterEdit?.anchor?.taskId, anchoredTask.id, '값 편집이 앵커를 지우지 않는다')

  // **해제 가능해야 한다** — 예약키를 reserved Set 에 넣으면 여기서 막힌다(쓰기까지 건너뛰므로).
  edit(aDoc, (project) => {
    const record = project.modules?.quality?.find((r) => r.id === 'mr-anchored')
    assert(record, 'anchored record must exist')
    record.anchor = undefined
  })
  const afterClear = projectFromYDoc(aDoc).modules?.quality?.[0]
  assert.equal(afterClear?.anchor, undefined, '앵커 해제가 실제로 반영된다')
  assert.equal(
    bootstrapProjectYTypes(aDoc).modules.get('quality')?.get('mr-anchored')?.has(ANCHOR_SMOKE_KEY),
    false,
    '해제하면 Y.Map 에서 예약키가 사라진다(빈 문자열로 남지 않는다)',
  )

  // 쓰레기 값 방어 — 손으로 고친 .json·다른 클라이언트가 심은 값이 앵커로 승격되면 안 된다.
  for (const junk of [123, 'not json', '[1,2]', '{"sheetId":1}', '{}']) {
    const junkDoc = new Y.Doc()
    applyProjectToYDoc(junkDoc, anchorBase)
    bootstrapProjectYTypes(junkDoc)
      .modules.get('quality')
      ?.get('mr-plain')
      ?.set(ANCHOR_SMOKE_KEY, junk)
    const junkRead = projectFromYDoc(junkDoc).modules?.quality?.find((r) => r.id === 'mr-plain')
    assert.equal(junkRead?.anchor, undefined, `쓰레기 앵커 값은 무시된다: ${String(junk)}`)
    assert.equal(
      ANCHOR_SMOKE_KEY in (junkRead?.values ?? {}),
      false,
      `쓰레기 앵커 값이 values 로 새지 않는다: ${String(junk)}`,
    )
  }

  // JSON 스냅샷(파일 저장·서버 버전) 왕복에서도 앵커가 보존된다.
  const anchorJson = JSON.parse(JSON.stringify(canonicalProjectSnapshot(anchorBase))) as Project
  const anchorJsonDoc = new Y.Doc()
  applyProjectToYDoc(anchorJsonDoc, anchorJson)
  assert.equal(
    projectFromYDoc(anchorJsonDoc).modules?.quality?.[0].anchor?.taskId,
    anchoredTask.id,
    'JSON 스냅샷 왕복에서 앵커가 보존된다',
  )
}

// Legacy shared activeSheetId values are ignored; only the local preferred id applies.
const legacyPointerDoc = new Y.Doc()
applyProjectToYDoc(legacyPointerDoc, multi)
bootstrapProjectYTypes(legacyPointerDoc).meta.set('activeSheetId', 'sheet-b')
assert.equal(projectFromYDoc(legacyPointerDoc).activeSheet?.id, 'sheet-a')
assert.equal(projectFromYDoc(legacyPointerDoc, 'sheet-b').activeSheet?.id, 'sheet-b')

// ── 쓰기 그림자 신선도 — 관찰되지 않는 컨테이너의 원격 기록이 삭제되지 않아야 한다 ──────
// store 의 authoritativeShadow 는 observeRoot 관찰자가 깨울 때만 갱신된다. 관찰 목록에서
// 빠진 컨테이너는 원격 변경을 shadow 가 모른 채로 다음 로컬 편집이 그 shadow 를 정본으로
// 밀어버려 **원격 기록이 조용히 삭제된다**. 아래 4개 컨테이너가 관찰 목록에 있는지를
// 동작으로 검증한다(목록을 눈으로 확인하는 게 아니라, 지워지는지로 판정).
{
  const freshBase = clone(base)
  freshBase.id = 'shadow-freshness'
  freshBase.modules = { quality: [{ id: 'mr-local', values: { target: '내가 쓴 것' } }] }
  freshBase.changeLog = [
    {
      id: 'ch-local',
      at: '2026-03-01T00:00:00.000Z',
      actorName: '나',
      kind: 'note',
      taskIds: [],
      summary: '로컬',
      reason: '',
    },
  ]
  useEditor.getState().setProject(freshBase)
  const freshRuntime = getCurrentCrdtRuntime()
  assert(freshRuntime, 'store must expose the active CRDT runtime')

  // 원격 피어가 모듈 레코드·이력·기준선을 남긴다(로컬 편집이 아니라 외부에서 들어온 업데이트).
  const peer = new Y.Doc()
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(freshRuntime.doc))
  edit(peer, (project) => {
    project.modules = {
      ...(project.modules ?? {}),
      quality: [
        ...(project.modules?.quality ?? []),
        { id: 'mr-remote', values: { target: '동료가 쓴 것' } },
      ],
    }
    project.changeLog = [
      ...(project.changeLog ?? []),
      {
        id: 'ch-remote',
        at: '2026-03-02T00:00:00.000Z',
        actorName: '동료',
        kind: 'note',
        taskIds: [],
        summary: '원격',
        reason: '',
      },
    ]
    project.baseline = {
      capturedAt: '2026-03-02T00:00:00.000Z',
      asOf: '2026-03-02',
      startDay: 0,
      endDay: 90,
      tasks: [{ id: first.id, start: 0, duration: 10 }],
    }
  })
  Y.applyUpdate(freshRuntime.doc, Y.encodeStateAsUpdate(peer))
  await Promise.resolve()

  // 이제 **모듈과 무관한** 로컬 편집을 한 번 한다. 이 커밋이 shadow 전체를 정본으로 민다.
  useEditor.getState().updateTask(first.id, { note: '로컬 편집' })

  const settled = projectFromYDoc(freshRuntime.doc)
  assert.deepEqual(
    (settled.modules?.quality ?? []).map((r) => r.id).sort(),
    ['mr-local', 'mr-remote'],
    '원격 모듈 레코드가 로컬 편집 한 번에 삭제되지 않는다(root/modules 관찰 필요)',
  )
  assert.deepEqual(
    (settled.changeLog ?? []).map((e) => e.id),
    ['ch-local', 'ch-remote'],
    '원격 변경 이력이 로컬 편집에 삭제되지 않는다(root/changeLog 관찰 필요)',
  )
  assert.equal(
    settled.baseline?.asOf,
    '2026-03-02',
    '원격 기준선이 로컬 편집에 삭제되지 않는다(root/baseline 관찰 필요)',
  )
}

// ── 앵커 store 경로 — 레거시 승격 · 합집합 보호 · 액션 · 조회전용 ────────────────────
{
  const storeBase = clone(base)
  storeBase.id = 'anchor-store'
  const targetTask = storeBase.tasks[0]

  // (1) 구버전 파일 승격 — 앵커를 모르는 버전이 values 안에 가둬둔 값을 anchor 로 올린다.
  storeBase.modules = {
    quality: [
      {
        id: 'mr-legacy',
        values: {
          type: '부적합(NCR)',
          target: '구버전 저장분',
          $anchor: JSON.stringify({ taskId: targetTask.id, stamp: targetTask.name }),
        },
      },
      {
        id: 'mr-junk',
        values: { type: '검측요청(WIR)', target: '깨진 앵커', $anchor: 'not json' },
      },
    ],
    cost: [{ id: 'mr-cost', values: { group: '공사비', budget: '5000' } }],
  }
  useEditor.getState().setProject(storeBase)
  const promoted = useEditor.getState().project.modules?.quality ?? []
  assert.equal(
    promoted.find((r) => r.id === 'mr-legacy')?.anchor?.taskId,
    targetTask.id,
    '구버전 파일의 values.$anchor 가 anchor 로 승격된다',
  )
  assert.equal(
    ANCHOR_SMOKE_KEY in (promoted.find((r) => r.id === 'mr-legacy')?.values ?? {}),
    false,
    '승격 후 values 에서 예약키가 제거된다',
  )
  assert.equal(
    promoted.find((r) => r.id === 'mr-junk')?.anchor,
    undefined,
    '해독 불가한 구버전 값은 앵커가 되지 않는다',
  )
  assert.equal(
    ANCHOR_SMOKE_KEY in (promoted.find((r) => r.id === 'mr-junk')?.values ?? {}),
    false,
    '해독 불가해도 예약키는 values 에 남지 않는다',
  )

  // (2) 앵커 액션 — 걸고, 값 편집에도 살아남고, 해제된다.
  useEditor.getState().setRecordAnchor('cost', 'mr-cost', {
    taskId: targetTask.id,
    stamp: targetTask.name,
  })
  assert.equal(
    useEditor.getState().project.modules?.cost?.[0].anchor?.taskId,
    targetTask.id,
    'setRecordAnchor 가 앵커를 건다',
  )
  useEditor.getState().updateModuleRecord('cost', 'mr-cost', { budget: '6000' })
  assert.equal(
    useEditor.getState().project.modules?.cost?.[0].anchor?.taskId,
    targetTask.id,
    '값 편집이 앵커를 지우지 않는다',
  )
  useEditor.getState().clearRecordAnchor('cost', 'mr-cost')
  assert.equal(
    useEditor.getState().project.modules?.cost?.[0].anchor,
    undefined,
    'clearRecordAnchor 가 앵커를 해제한다',
  )

  // (3) 합집합 보호 — 템플릿 적용처럼 modules 키가 **아예 없는** 내용이 들어와도 살아남는다.
  const templateLike = clone(base)
  templateLike.id = 'anchor-store'
  templateLike.modules = undefined
  useEditor.getState().importProjectContent(templateLike)
  const survived = useEditor.getState().project.modules
  assert.deepEqual(
    (survived?.quality ?? []).map((r) => r.id),
    ['mr-legacy', 'mr-junk'],
    'modules 없는 내용을 실어도 기존 관리 기록이 살아남는다(템플릿 적용 = 데이터 소실 금지)',
  )
  assert.equal((survived?.cost ?? []).length, 1, '다른 모듈도 함께 보존된다')

  // (4) 조회 전용 — 열람은 되고 편집만 막힌다.
  useEditor.getState().setReadOnly(true)
  const blockedId = useEditor.getState().addModuleRecord('cost', { group: '설계비' })
  assert.equal(blockedId, '', '조회 전용은 레코드를 만들지 못하고 빈 id 를 돌려준다')
  useEditor.getState().setRecordAnchor('quality', 'mr-legacy', { taskId: 'someone-else' })
  assert.equal(
    useEditor.getState().project.modules?.quality?.[0].anchor?.taskId,
    targetTask.id,
    '조회 전용은 앵커를 바꾸지 못한다',
  )
  useEditor.getState().setReadOnly(false)
}

console.log(
  'CRDT SMOKE OK: convergence, authority, JSON, hydration gate, undo, gesture, local sheet, periodInputs merge, task actuals merge, changeLog/baselineVersions audit, module records, shadow freshness, anchors',
)
