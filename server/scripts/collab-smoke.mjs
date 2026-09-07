import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import NodeWebSocket from 'crossws/websocket'
import * as Y from 'yjs'

const clientRequire = createRequire(new URL('../../client/package.json', import.meta.url))
const providerPath = clientRequire.resolve('@hocuspocus/provider')
// The smoke deliberately loads the client provider and server in one process;
// production runs them in separate processes. Suppress Yjs's expected duplicate-
// package warning for this test-only arrangement.
const originalConsoleError = console.error
console.error = (first, ...rest) => {
  if (String(first).startsWith('Yjs was already imported.')) return
  originalConsoleError(first, ...rest)
}
let providerModule
try {
  providerModule = await import(pathToFileURL(providerPath))
} finally {
  console.error = originalConsoleError
}
const { HocuspocusProvider } = providerModule

let failures = 0
const ok = (condition, message) => {
  console.log(`${condition ? '  ✓' : '  ✗'} ${message}`)
  if (!condition) failures++
}
const waitFor = async (predicate, message, timeout = 4_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timeout: ${message}`)
}

const tempRoot = await fs.mkdtemp(path.join(process.env.TEMP || os.tmpdir(), 'sequence-collab-'))
const dataDir = path.join(tempRoot, 'data')
const autosaveDir = path.join(tempRoot, 'autosave')
await fs.mkdir(dataDir, { recursive: true })
await fs.mkdir(autosaveDir, { recursive: true })

const projectIds = ['projA', 'projB', 'legacyA', 'emptyA']
const authState = {
  users: { u1: { id: 'u1', name: 'User 1', role: 'user', active: true } },
  projects: Object.fromEntries(projectIds.map((id) => [id, { id, name: id, createdBy: 'u1' }])),
  members: projectIds.map((projectId) => ({
    projectId,
    userId: 'u1',
    role: 'user',
    addedBy: 'u1',
  })),
}
await fs.writeFile(path.join(dataDir, 'auth.json'), JSON.stringify(authState))
await fs.writeFile(
  path.join(dataDir, 'projA.json'),
  JSON.stringify({
    id: 'projA',
    name: 'Project A',
    meta: { schemaVersion: 1 },
    categories: [],
    tasks: [],
    links: [],
    rainySeasons: [],
  }),
)
const legacyProject = {
  id: 'legacyA',
  name: 'Legacy Seed',
  startDate: '2026-01-01',
  meta: { createdAt: '2026-01-01', updatedAt: '2026-01-02', schemaVersion: 7 },
  view: { zoom: 1, mirrorHidden: ['m1'] },
  paper: { size: 'A3' },
  branding: { logos: [{ id: 'logo1', name: 'Logo' }] },
  palette: ['#112233'],
  categories: [{ id: 'c1', name: 'Civil' }],
  tasks: [
    {
      id: 't1',
      categoryId: 'c1',
      name: 'Seed task',
      duration: 3,
      es: 1,
      ef: 4,
      ls: 1,
      lf: 4,
      totalFloat: 0,
      critical: true,
      __mirror: true,
    },
  ],
  links: [{ id: 'l1', from: 't1', to: 't1', type: 'FS' }],
  rainySeasons: [{ id: 'r1', start: '2026-07-01', end: '2026-07-31' }],
  activeSheet: { id: 's1', role: 'plan', name: 'Main' },
  sheets: [
    {
      id: 's2',
      role: 'milestone',
      name: 'Milestones',
      categories: [],
      tasks: [],
      links: [],
      rainySeasons: [],
    },
  ],
}
await fs.writeFile(path.join(dataDir, 'legacyA.json'), JSON.stringify(legacyProject))

process.env.HN_DATA_DIR = dataDir
process.env.HN_AUTOSAVE_DIR = autosaveDir
process.env.HN_ERROR_LOG = path.join(tempRoot, 'error.log')
process.env.AUTH_ENABLED = '1'
process.env.AUTH_BACKEND = 'memory'
process.env.AUTH_JWT_SECRET = 'collab-smoke-secret-at-least-sixteen-characters'
process.env.AUTH_SECURE_COOKIE = '0'

const { signProjectToken } = await import('../src/auth/crypto.js')
const { startServer } = await import('../src/index.js')

const projectGrant = await signProjectToken('u1', 'projA', 'user')
const legacyGrant = await signProjectToken('u1', 'legacyA', 'user')
const emptyGrant = await signProjectToken('u1', 'emptyA', 'user')

let runtime
const providers = []
const call = async (base, method, url, token, body) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await response.json()
  } catch {}
  return { status: response.status, data, headers: response.headers }
}

const ticketFor = async (base, projectId, grant) => {
  const result = await call(
    base,
    'POST',
    `/api/auth/projects/${projectId}/collab-ticket`,
    grant,
    {},
  )
  if (result.status !== 200 || !result.data?.ticket) {
    throw new Error(`collab ticket failed for ${projectId}: ${result.status}`)
  }
  return result.data.ticket
}

const originWebSocket = (origin) =>
  class extends NodeWebSocket {
    constructor(url, protocols) {
      super(url, protocols, { origin })
    }
  }

const openWithoutToken = (base) =>
  new Promise((resolve, reject) => {
    const WebSocketWithOrigin = originWebSocket(base)
    const socket = new WebSocketWithOrigin(`${base.replace(/^http/, 'ws')}/collab`)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('unauthenticated socket was not closed'))
    }, 2_000)
    socket.addEventListener('open', () => {})
    socket.addEventListener('close', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.addEventListener('error', () => {})
  })

const expectOriginRejected = (base) =>
  new Promise((resolve, reject) => {
    const BadOriginWebSocket = originWebSocket('http://evil.example')
    const socket = new BadOriginWebSocket(`${base.replace(/^http/, 'ws')}/collab`)
    const timer = setTimeout(() => reject(new Error('disallowed Origin was not rejected')), 2_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('disallowed Origin opened a socket'))
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      resolve()
    })
  })

const connectProvider = ({ base, name, token, document = new Y.Doc() }) => {
  let syncedResolve
  let rejectedResolve
  let closedResolve
  const synced = new Promise((resolve) => {
    syncedResolve = resolve
  })
  const rejected = new Promise((resolve) => {
    rejectedResolve = resolve
  })
  const closed = new Promise((resolve) => {
    closedResolve = resolve
  })
  const provider = new HocuspocusProvider({
    url: `${base.replace(/^http/, 'ws')}/collab`,
    name,
    token,
    document,
    WebSocketPolyfill: originWebSocket(base),
    maxAttempts: 1,
    timeout: 2_000,
    delay: 10,
    minDelay: 10,
    maxDelay: 10,
    onSynced: ({ state }) => {
      if (state) syncedResolve()
    },
    onAuthenticationFailed: ({ reason }) => rejectedResolve(reason),
    onClose: () => closedResolve(),
  })
  providers.push(provider)
  return { provider, document, synced, rejected, closed }
}

try {
  runtime = await startServer({ port: 0, host: '127.0.0.1', collabTimeout: 500 })
  let base = `http://127.0.0.1:${runtime.port}`
  const ticket = await ticketFor(base, 'projA', projectGrant)
  const legacyTicket = await ticketFor(base, 'legacyA', legacyGrant)
  const emptyTicket = await ticketFor(base, 'emptyA', emptyGrant)
  const concurrentSeeds = await Promise.all(
    Array.from({ length: 8 }, () => runtime.collab.storage.fetch('legacyA')),
  )
  ok(
    concurrentSeeds.every((state) => Buffer.from(state).equals(Buffer.from(concurrentSeeds[0]))),
    '동시 legacy fetch도 단일 원자 seed binary로 직렬화',
  )

  await expectOriginRejected(base)
  ok(true, 'same-origin/LAN allowlist가 외부 Origin handshake 거부')

  await openWithoutToken(base)
  ok(
    runtime.collab.hocuspocus.getConnectionsCount() === 0,
    'token 없는 WebSocket을 인증 timeout으로 종료',
  )

  const invalid = connectProvider({ base, name: 'projA', token: 'not-a-jwt' })
  await invalid.rejected
  ok(!invalid.provider.isAuthenticated, '잘못된 collab token 거부')
  invalid.provider.destroy()

  const projectTokenDirect = connectProvider({ base, name: 'projA', token: projectGrant })
  await projectTokenDirect.rejected
  ok(!projectTokenDirect.provider.isAuthenticated, '12시간 project grant의 WS 직접 사용 거부')
  projectTokenDirect.provider.destroy()

  const wrongRoom = connectProvider({ base, name: 'projB', token: ticket })
  await wrongRoom.rejected
  ok(!wrongRoom.provider.isAuthenticated, 'ticket과 다른 room 교차 접근 거부')
  wrongRoom.provider.destroy()

  await runtime.authRepo.removeMember('projA', 'u1')
  const revokedMember = connectProvider({ base, name: 'projA', token: ticket })
  await revokedMember.rejected
  ok(
    !revokedMember.provider.isAuthenticated,
    'ticket 발급 후 멤버십 제거도 최신 저장소 조회로 거부',
  )
  revokedMember.provider.destroy()
  await runtime.authRepo.addMember('projA', 'u1', 'user', 'u1')

  const first = connectProvider({ base, name: 'projA', token: ticket })
  const second = connectProvider({ base, name: 'projA', token: ticket })
  await Promise.all([first.synced, second.synced])
  first.document.getMap('root/meta').set('fromFirst', 'A')
  second.document.getMap('root/meta').set('fromSecond', 'B')
  await waitFor(
    () =>
      first.document.getMap('root/meta').get('fromSecond') === 'B' &&
      second.document.getMap('root/meta').get('fromFirst') === 'A',
    'two-provider convergence',
  )
  ok(
    Buffer.from(Y.encodeStateAsUpdate(first.document)).equals(
      Buffer.from(Y.encodeStateAsUpdate(second.document)),
    ),
    '두 provider 동시 편집 수렴',
  )

  const docBeforeAwareness = Buffer.from(Y.encodeStateAsUpdate(first.document))
  const firstClientId = first.provider.awareness.clientID
  first.provider.setAwarenessField('user', {
    id: 'synthetic-user',
    name: 'Synthetic',
    color: '#000',
  })
  first.provider.setAwarenessField('selection', {
    selectedTaskIds: ['seed-task'],
    selectedCategoryIds: [],
    selectedLinkId: null,
  })
  first.provider.setAwarenessField('cursor', { x: 12, y: 34 })
  await waitFor(
    () => second.provider.awareness.getStates().get(firstClientId)?.cursor?.x === 12,
    'awareness propagation',
  )
  ok(
    Buffer.from(Y.encodeStateAsUpdate(first.document)).equals(docBeforeAwareness),
    'awareness가 Y.Doc binary를 변경하지 않음',
  )
  first.provider.awareness.setLocalState(null)
  await waitFor(
    () => !second.provider.awareness.getStates().has(firstClientId),
    'awareness clear propagation',
  )
  ok(true, '원격 선택·커서 awareness 전파 후 clear로 유령 상태 제거')

  const seeded = connectProvider({ base, name: 'legacyA', token: legacyTicket })
  await seeded.synced
  const seededRoot = seeded.document.getMap('root')
  const seededTask = seeded.document.getMap('root/tasks').get('t1')
  ok(
    seededRoot.get('tasks') === 'root/tasks' && seededTask?.get('name') === 'Seed task',
    'legacy JSON을 안정된 named Y type으로 1회 seed',
  )
  ok(
    ['es', 'ef', 'ls', 'lf', 'totalFloat', 'critical', '__mirror'].every(
      (field) => !seededTask?.has(field),
    ),
    'legacy seed에서 CPM/mirror 파생 필드 제거',
  )
  ok(
    seededTask?.get('$position') === 1 && seeded.document.getMap('root/sheets').size === 2,
    'legacy 순서와 active/inactive sheet 구조 보존',
  )
  const seededMeta = seeded.document.getMap('root/meta')
  const seededSheets = seeded.document.getMap('root/sheets')
  ok(!seededMeta.has('activeSheetId'), 'legacy active sheet selection remains client-local')
  ok(
    seededSheets.get('s1')?.get('$position') === 1 &&
      seededSheets.get('s2')?.get('$position') === 2,
    'legacy active sheet becomes the first resident sheet without a shared selection pointer',
  )

  const empty = connectProvider({ base, name: 'emptyA', token: emptyTicket })
  await empty.synced
  ok(
    empty.document.getMap('root').get('meta') === 'root/meta',
    'legacy가 없는 신규 room도 서버가 stable container bootstrap',
  )
  const emptyMeta = empty.document.getMap('root/meta')
  const emptyPaper = empty.document.getMap('root/paper')
  const emptyView = empty.document.getMap('root/view')
  const emptySheets = empty.document.getMap('root/sheets')
  ok(
    emptyMeta.get('id') === 'emptyA' &&
      emptyMeta.get('name') === 'emptyA' &&
      /^\d{4}-\d{2}-\d{2}$/.test(emptyMeta.get('startDate')) &&
      !Number.isNaN(Date.parse(emptyMeta.get('createdAt'))) &&
      emptyMeta.get('createdAt') === emptyMeta.get('updatedAt') &&
      emptyMeta.get('schemaVersion') === 1 &&
      !emptyMeta.has('activeSheetId'),
    'blank room has complete canonical metadata without shared active-sheet state',
  )
  ok(
    emptyPaper.get('size') === 'A3' &&
      emptyPaper.get('orientation') === 'landscape' &&
      emptyPaper.get('marginMm') === 10 &&
      emptyPaper.get('dpi') === 150 &&
      emptyPaper.get('fitToPage') === true,
    'blank room has client-compatible paper defaults',
  )
  ok(
    emptyView.get('pxPerDay') === 1.5 &&
      emptyView.get('rowHeight') === 46 &&
      emptyView.get('scale') === 'month' &&
      emptyView.get('showCriticalPath') === true &&
      emptyView.get('showGrid') === true &&
      emptyView.get('showTitle') === true,
    'blank room has client-compatible view defaults',
  )
  ok(
    empty.document.getArray('root/palette').length === 10 &&
      emptySheets.size === 1 &&
      emptySheets.get('sheet-main')?.get('role') === 'plan' &&
      emptySheets.get('sheet-main')?.get('$position') === 1,
    'blank room has default palette and a valid first resident sheet',
  )

  const put = await call(base, 'PUT', '/api/projects/projA', projectGrant, {
    id: 'projA',
    name: 'overwrite',
  })
  ok(put.status === 405 && put.headers.get('allow') === 'GET', 'legacy 전체 JSON PUT 405 강등')
  const snapshot = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  ok(snapshot.status === 200 && snapshot.data?.id === 'projA', '명시적 snapshot GET 백업 경로 유지')
  const memberDelete = await call(base, 'DELETE', '/api/projects/projA', projectGrant)
  ok(memberDelete.status === 403, '프로젝트 DELETE는 개발자 권한으로 제한')
  const unauthAutosave = await call(base, 'POST', '/api/autosave', null, {
    id: 'projA',
    name: 'secret',
  })
  ok(unauthAutosave.status === 401, 'autosave write 무인증 접근 거부')
  const savedAutosave = await call(base, 'POST', '/api/autosave', projectGrant, {
    id: 'projA',
    name: 'secret',
  })
  const unauthAutosaveList = await call(base, 'GET', '/api/autosave', null)
  const unauthAutosaveRead = await call(base, 'GET', '/api/autosave/file/secret', null)
  const grantedAutosaveRead = await call(base, 'GET', '/api/autosave/file/secret', projectGrant)
  const unauthAutosaveDelete = await call(base, 'DELETE', '/api/autosave/file/secret', null)
  const grantedAutosaveDelete = await call(
    base,
    'DELETE',
    '/api/autosave/file/secret',
    projectGrant,
  )
  ok(
    savedAutosave.status === 200 &&
      unauthAutosaveList.status === 401 &&
      unauthAutosaveRead.status === 401 &&
      grantedAutosaveRead.status === 200 &&
      unauthAutosaveDelete.status === 401 &&
      grantedAutosaveDelete.status === 200,
    'autosave list/read/write/delete 전체 auth/project grant 적용',
  )

  // ── #19 라이브 스냅샷 / #14 강제 절단 / #20 삭제 정리 검증 ──
  first.document.getMap('root/meta').set('name', 'LIVE EDITED NAME')
  await waitFor(
    () => second.document.getMap('root/meta').get('name') === 'LIVE EDITED NAME',
    'live meta.name convergence',
  )
  const liveSnap = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  ok(
    liveSnap.status === 200 && liveSnap.data?.name === 'LIVE EDITED NAME',
    '#19 snapshot이 최초 시드가 아닌 라이브 CRDT 편집을 반영',
  )

  // 건설사업관리 모듈 CRDT 동기화: provider가 root/modules에 기록 → 두 번째 provider 수렴
  // → 서버 스냅샷(decodeProjectFromState)에 반영($position 제거).
  first.document.transact(() => {
    const coll = new Y.Map()
    first.document.getMap('root/modules').set('cost', coll)
    const rec = new Y.Map()
    rec.set('group', '공사비')
    rec.set('budget', '1000')
    rec.set('$position', 1)
    coll.set('mr-smoke', rec)
  })
  await waitFor(
    () =>
      second.document.getMap('root/modules').get('cost')?.get('mr-smoke')?.get('budget') === '1000',
    'module record convergence',
  )
  ok(true, '모듈 레코드 두 provider 간 동기화(root/modules)')
  const modSnap = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  ok(
    modSnap.data?.modules?.cost?.[0]?.values?.budget === '1000' &&
      modSnap.data?.modules?.cost?.[0]?.values?.group === '공사비' &&
      !('$position' in (modSnap.data?.modules?.cost?.[0]?.values ?? {})),
    '모듈이 서버 스냅샷(decodeProjectFromState)에 반영',
  )

  const revokedCount = runtime.collab.revokeProjectAccess('projA', 'u1')
  ok(revokedCount >= 1, '#14 revokeProjectAccess가 해당 사용자 활성 연결을 강제 절단')

  first.provider.destroy()
  second.provider.destroy()
  seeded.provider.destroy()
  empty.provider.destroy()
  await new Promise((resolve) => setTimeout(resolve, 100))

  const emptyBin = path.join(dataDir, 'ydocs', 'emptyA.bin')
  const emptyBinBefore = await fs.access(emptyBin).then(
    () => true,
    () => false,
  )
  await runtime.collab.deleteProjectState('emptyA')
  const emptyBinAfter = await fs.access(emptyBin).then(
    () => true,
    () => false,
  )
  ok(emptyBinBefore && !emptyBinAfter, '#20 프로젝트 삭제 시 라이브 ydoc(.bin) 정리')

  await runtime.close()
  runtime = null

  const binaryBefore = await fs.readFile(path.join(dataDir, 'ydocs', 'legacyA.bin'))
  await fs.unlink(path.join(dataDir, 'legacyA.json'))
  runtime = await startServer({ port: 0, host: '127.0.0.1', collabTimeout: 500 })
  base = `http://127.0.0.1:${runtime.port}`
  const restored = connectProvider({ base, name: 'projA', token: ticket })
  await restored.synced
  ok(
    restored.document.getMap('root/meta').get('fromFirst') === 'A' &&
      restored.document.getMap('root/meta').get('fromSecond') === 'B',
    '서버 재시작 후 Y.Doc binary 복원',
  )

  const restoredLegacy = connectProvider({ base, name: 'legacyA', token: legacyTicket })
  await restoredLegacy.synced
  const binaryAfter = await fs.readFile(path.join(dataDir, 'ydocs', 'legacyA.bin'))
  ok(
    binaryBefore.equals(binaryAfter) && restoredLegacy.document.getMap('root/tasks').size === 1,
    'legacy 제거 후 재접속에도 seed 중복 없이 binary 그대로 복원',
  )
  restored.provider.destroy()
  restoredLegacy.provider.destroy()
} finally {
  for (const provider of providers) {
    try {
      provider.destroy()
    } catch {}
  }
  if (runtime) await runtime.close().catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nCOLLAB SMOKE PASS' : `\n${failures} COLLAB SMOKE FAILURE(S)`)
process.exitCode = failures ? 1 : 0
