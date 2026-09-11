import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
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

// ── 결과 보고는 어떤 경로로 끝나든 정확히 한 번 ────────────────────────────────
// 예전에는 PASS/FAIL 배너와 process.exitCode 가 try/finally **바깥**에 있어서,
// 본문이 도중에 던지면(예: 이벤트 루프를 오래 막은 뒤의 keep-alive 소켓 경합)
// finally 만 돌고 배너는 영영 찍히지 않았다. 그런데도 exitCode 는 기본값 0 이라
// '조용한 성공'으로 보였다 — 뒤쪽 검사 십수 건이 아예 실행되지 않았는데도.
let reported = false
const report = () => {
  if (reported) return
  reported = true
  console.log(failures === 0 ? '\nCOLLAB SMOKE PASS' : `\n${failures} COLLAB SMOKE FAILURE(S)`)
  process.exitCode = failures ? 1 : 0
}
// 최후의 안전망 — 배너 없이 프로세스가 끝나려 하면 그것 자체를 실패로 본다.
process.on('exit', () => {
  if (reported) return
  reported = true
  console.log('\n1 COLLAB SMOKE FAILURE(S) — 스모크가 배너 없이 종료됐다(비정상 종료)')
  process.exitCode = 1
})
const waitFor = async (predicate, message, timeout = 4_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timeout: ${message}`)
}
/** 파일시스템처럼 비동기로만 확인할 수 있는 조건용(버전 폴더 등). */
const waitForAsync = async (predicate, message, timeout = 8_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timeout: ${message}`)
}

const tempRoot = await fs.mkdtemp(path.join(process.env.TEMP || os.tmpdir(), 'sequence-collab-'))
const dataDir = path.join(tempRoot, 'data')
const autosaveDir = path.join(tempRoot, 'autosave')
await fs.mkdir(dataDir, { recursive: true })
await fs.mkdir(autosaveDir, { recursive: true })

// matrixA(일반) · matrixS(체험존 sample) · matrixX(개발자 DELETE 전용 소모품)는 R4 인가
// 매트릭스용. 나머지는 기존 협업/버전 시나리오용.
// deactA 는 R5-4(프로젝트 비활성화) 전용, ackBigA 는 R5-1(누적 세션이 많은 문서의 영속 확정) 전용.
const projectIds = [
  'projA',
  'projB',
  'legacyA',
  'emptyA',
  'matrixA',
  'matrixS',
  'matrixX',
  'deactA',
  'ackBigA',
]
const authState = {
  users: {
    u1: { id: 'u1', name: 'User 1', role: 'user', division: 'road', active: true },
    // u2 는 projA 와 **같은 본부의 PM 이지만 배정(멤버십)은 없다** — canEnterProjectDiv 로
    // 입장·조회는 되지만 canEditProjectDiv 는 false 인 '조회 전용' 신분. 협업 연결이
    // readOnly 로 강등되는 바로 그 사람이며, HTTP 쓰기 경로에서도 같아야 한다.
    u2: { id: 'u2', name: 'Viewer PM', role: 'pm', division: 'road', active: true },
    // u3 은 같은 본부의 **일반 사용자**(미배정). 일반 프로젝트에는 입장조차 못 하지만
    // 체험존(sample)에는 배정 없이 입장·편집이 된다 — B1 두 번째 재현 신분.
    u3: { id: 'u3', name: 'Same Division User', role: 'user', division: 'road', active: true },
    // u4 는 **다른 본부** PM. 유효하게 서명된 project grant 를 들고 와도 통과하면 안 된다
    // (인가의 근거는 토큰이 아니라 저장소의 본부·멤버십이라는 사실을 못박는다).
    u4: { id: 'u4', name: 'Other Division PM', role: 'pm', division: 'plant', active: true },
    dev: { id: 'dev', name: 'Developer', role: 'developer', division: 'road', active: true },
  },
  projects: Object.fromEntries(
    projectIds.map((id) => [
      id,
      {
        id,
        name: id,
        createdBy: 'u1',
        division: 'road',
        ...(id === 'matrixS' ? { sample: true } : {}),
      },
    ]),
  ),
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

// 옛 이름 키 임시저장 파일이 남아 있는 서버를 흉내 낸다 — 레거시 읽기/삭제 경로의 인가 검증용.
await fs.writeFile(
  path.join(autosaveDir, 'secret.json'),
  JSON.stringify({ id: 'projA', name: 'secret' }),
)

process.env.HN_DATA_DIR = dataDir
process.env.HN_AUTOSAVE_DIR = autosaveDir
// F15: 버전 보관 검증 — 스로틀 해제(0ms) + 작은 보관 상한(3)으로 프루닝까지 확인.
process.env.HN_AUTOSAVE_INTERVAL_MS = '0'
process.env.HN_AUTOSAVE_KEEP = '3'
process.env.HN_ERROR_LOG = path.join(tempRoot, 'error.log')
process.env.AUTH_ENABLED = '1'
process.env.AUTH_BACKEND = 'memory'
process.env.AUTH_JWT_SECRET = 'collab-smoke-secret-at-least-sixteen-characters'
process.env.AUTH_SECURE_COOKIE = '0'

const { signProjectToken, signSession } = await import('../src/auth/crypto.js')
const { startServer } = await import('../src/index.js')

// ── R4 인가 매트릭스용 신원 ─────────────────────────────────────────────────
// (a) 배정 멤버 · (b) 같은 본부 미배정 PM · (c) 같은 본부 일반 사용자 · (d) 다른 본부 ·
// (e) 미인증 · (dev) 개발자. 실제 클라이언트처럼 **세션 쿠키 + project grant** 를 모두 보낸다.
const IDENTITIES = {
  a: { user: 'u1', label: '배정 멤버(편집자)' },
  b: { user: 'u2', label: '같은 본부 미배정 PM' },
  c: { user: 'u3', label: '같은 본부 일반 사용자' },
  d: { user: 'u4', label: '다른 본부 PM' },
  e: { user: null, label: '미인증' },
  dev: { user: 'dev', label: '개발자' },
}
const sessionCookies = {}
for (const [key, who] of Object.entries(IDENTITIES)) {
  sessionCookies[key] = who.user
    ? `hn_session=${encodeURIComponent(await signSession(authState.users[who.user]))}`
    : null
}
const grantCache = new Map()
// grant 에는 일부러 canEdit:true / projRole:'pm' 을 실어 둔다 — 서버가 토큰의 주장이 아니라
// 저장소(본부·멤버십)를 근거로 재판정하는지 확인하기 위해서다.
const grantOf = async (key, projectId) => {
  const who = IDENTITIES[key]
  if (!who.user) return null
  const cacheKey = `${who.user}\0${projectId}`
  if (!grantCache.has(cacheKey))
    grantCache.set(cacheKey, await signProjectToken(who.user, projectId, 'pm', true))
  return grantCache.get(cacheKey)
}

const projectGrant = await signProjectToken('u1', 'projA', 'user', true)
const projectBGrant = await signProjectToken('u1', 'projB', 'user', true)
const legacyGrant = await signProjectToken('u1', 'legacyA', 'user', true)
const emptyGrant = await signProjectToken('u1', 'emptyA', 'user', true)
// 조회 전용(같은 본부 PM · 미배정) 신분의 프로젝트 grant.
const viewerGrant = await signProjectToken('u2', 'projA', 'pm', false)

let runtime
const providers = []
const call = async (base, method, url, token, body, cookie) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
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
  // F01: 서버가 '실제로 기록했다'고 알려오는 stateless 메시지를 모아 둔다.
  const stateless = []
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
    onStateless: ({ payload }) => stateless.push(payload),
    // 닫힘 코드까지 넘긴다 — '왜 끊겼는가'를 구분해야 강제 절단(4003 access-revoked)과
    // 스모크의 짧은 유휴 타임아웃(collabTimeout)을 혼동하지 않는다.
    onClose: ({ event }) => closedResolve(event ?? null),
  })
  providers.push(provider)
  return { provider, document, synced, rejected, closed, stateless }
}

// ── R5-1 대용량 시드는 서버를 띄우기 **전에** 만든다 ─────────────────────────
// clientID 9,000개짜리 Y.Doc 을 만드는 데 이 기계에서 약 8초가 걸리고, 그 8초 동안
// 이벤트 루프가 통째로 멈춘다. 스모크는 클라이언트와 서버를 한 프로세스에서 돌리므로
// 그동안 HTTP 서버의 keep-alive 타이머(기본 5초)와 collab 재접속 타이머도 함께 멈춘다.
// 루프가 끝나는 순간 밀린 타이머가 한꺼번에 깨어 유휴 소켓을 닫는데, 바로 그 틱에
// undici(fetch)가 같은 풀 소켓으로 다음 요청을 써 넣으면 ECONNRESET →
// 'TypeError: fetch failed' 로 스모크가 중간에 죽었다(재현율 약 2/3).
// 서버·소켓·타이머가 아직 하나도 없는 시점에 미리 만들어 두면 경합 자체가 사라진다.
const BIG_SESSIONS = 9_000
const bigSeedUpdate = (() => {
  const bigSeed = new Y.Doc()
  const bigMap = bigSeed.getMap('root/tasks')
  let bigLcg = 0x2545f491
  for (let index = 0; index < BIG_SESSIONS; index += 1) {
    bigLcg = (Math.imul(bigLcg, 1103515245) + 12345) >>> 0
    bigSeed.clientID = bigLcg
    bigMap.set(`t${index}`, index)
  }
  return Y.encodeStateAsUpdate(bigSeed)
})()

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
  // R3/S1: 호출자 본문을 그대로 복구 이력에 적재하던 POST /api/autosave 는 폐지(410).
  // 그 본문이 곧 [저장 칩 → ⏱ 서버 버전에서 복구] 목록의 최신 항목이 됐기 때문에,
  // 임의 JSON 한 번으로 '가장 최근 복구 지점'을 위조해 팀 전체 방을 덮어쓰게 만들 수 있었다.
  const poisonBody = { id: 'projA', name: 'POISONED', tasks: [], categories: [], links: [] }
  const unauthAutosave = await call(base, 'POST', '/api/autosave', null, poisonBody)
  const grantedAutosave = await call(base, 'POST', '/api/autosave', projectGrant, poisonBody)
  ok(
    unauthAutosave.status === 410 && grantedAutosave.status === 410,
    'S1 본문 그대로 적재하던 POST /api/autosave 는 인증 여부와 무관하게 폐지(410)',
  )
  const unauthAutosaveList = await call(base, 'GET', '/api/autosave', null)
  const unauthAutosaveRead = await call(base, 'GET', '/api/autosave/file/secret', null)
  const grantedAutosaveRead = await call(base, 'GET', '/api/autosave/file/secret', projectGrant)
  const unauthAutosaveDelete = await call(base, 'DELETE', '/api/autosave/file/secret', null)
  // R4/B1: 파괴적 삭제는 이제 DELETE /api/projects/:id 와 같은 등급(개발자)이다. 배정 멤버인
  // u1 도 지울 수 없고, 정리는 개발자만 한다.
  const memberAutosaveDelete = await call(base, 'DELETE', '/api/autosave/file/secret', projectGrant)
  const devAutosaveDelete = await call(
    base,
    'DELETE',
    '/api/autosave/file/secret',
    await grantOf('dev', 'projA'),
    undefined,
    sessionCookies.dev,
  )
  ok(
    unauthAutosaveList.status === 401 &&
      unauthAutosaveRead.status === 401 &&
      grantedAutosaveRead.status === 200 &&
      unauthAutosaveDelete.status === 401 &&
      memberAutosaveDelete.status === 403 &&
      devAutosaveDelete.status === 200,
    `레거시 autosave read 는 입장 등급, delete 는 개발자 등급 (read=${grantedAutosaveRead.status}, 멤버 삭제=${memberAutosaveDelete.status}, 개발자 삭제=${devAutosaveDelete.status})`,
  )
  const nameKeyedLeft = await fs.access(path.join(autosaveDir, 'secret.json')).then(
    () => true,
    () => false,
  )
  ok(!nameKeyedLeft, 'F15 이름 키 임시저장 파일이 다시 만들어지지 않는다')

  // 위조 본문이 복구 이력 **어디에도** 없어야 한다. 목록만 보고 넘어가면 뒤이은 자동 보관에
  // 밀려 안 보일 뿐이므로, 지금 보관 중인 모든 버전의 내용을 직접 읽어 확인한다.
  const listedNow = await call(base, 'GET', '/api/projects/projA/versions', projectGrant)
  const bodiesNow = await Promise.all(
    (listedNow.data?.items ?? []).map((item) =>
      call(base, 'GET', `/api/projects/projA/versions/${item.version}`, projectGrant),
    ),
  )
  ok(
    listedNow.status === 200 && bodiesNow.every((r) => r.data?.name !== 'POISONED'),
    `S1 위조 본문이 복구 이력에 적재되지 않는다 (검사 ${bodiesNow.length}건)`,
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

  // 공정 앵커($anchor): 클라이언트가 쓰는 저장 형태(JSON 문자열 1개)를 서버가 그대로 해독해
  // 스냅샷에 record.anchor 로 복원해야 한다. 여기가 어긋나면 스냅샷을 되돌린 순간 모든
  // 관리 기록이 공정과의 연결을 잃는다(클·서 대칭이 이 기능의 최대 리스크).
  first.document.transact(() => {
    const rec = first.document.getMap('root/modules').get('cost')?.get('mr-smoke')
    rec?.set('$anchor', JSON.stringify({ taskId: 'ft-0-0-0', stamp: '터널 굴착' }))
  })
  await waitFor(
    () =>
      typeof second.document.getMap('root/modules').get('cost')?.get('mr-smoke')?.get('$anchor') ===
      'string',
    'module anchor convergence',
  )
  const anchorSnap = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  const anchoredRecord = anchorSnap.data?.modules?.cost?.[0]
  ok(
    anchoredRecord?.anchor?.taskId === 'ft-0-0-0' &&
      anchoredRecord?.anchor?.stamp === '터널 굴착' &&
      !('$anchor' in (anchoredRecord?.values ?? {})) &&
      anchoredRecord?.values?.budget === '1000',
    '공정 앵커가 서버 스냅샷에 anchor 로 복원되고 values 로 새지 않는다',
  )

  // 쓰레기 앵커 값은 승격되지 않는다(손으로 고친 JSON·타 클라이언트 방어).
  first.document.transact(() => {
    first.document.getMap('root/modules').get('cost')?.get('mr-smoke')?.set('$anchor', 'not json')
  })
  await waitFor(
    () =>
      second.document.getMap('root/modules').get('cost')?.get('mr-smoke')?.get('$anchor') ===
      'not json',
    'module anchor junk convergence',
  )
  const junkSnap = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  ok(
    junkSnap.data?.modules?.cost?.[0]?.anchor === undefined &&
      !('$anchor' in (junkSnap.data?.modules?.cost?.[0]?.values ?? {})),
    '해독 불가한 앵커 값은 무시되고 values 도 오염되지 않는다',
  )

  // ── F01 영속 확정 브로드캐스트 / F15 ID 기준 버전 보관 ──────────────────────
  const versionFiles = async (id) =>
    (await fs.readdir(path.join(autosaveDir, id)).catch(() => [])).filter((f) =>
      f.endsWith('.json'),
    )

  // F01: 서버가 문서를 실제로 기록한 뒤에만 'sequence:persisted' 를 방에 보낸다.
  first.stateless.length = 0
  first.document.getMap('root/meta').set('persistProbe', String(Date.now()))
  await waitFor(
    () =>
      first.stateless.some((payload) => {
        try {
          const parsed = JSON.parse(payload)
          return parsed?.type === 'sequence:persisted' && Number.isFinite(Date.parse(parsed.at))
        } catch {
          return false
        }
      }),
    'persist ack broadcast',
    8_000,
  )
  ok(true, 'F01 서버 영속 완료 후 sequence:persisted 확정 메시지가 실제로 도착')

  // R3/S3: 확정에는 '무엇을 기록했는가'(Y 상태벡터)가 실려야 한다. 시각만 오면 방 전체
  // 브로드캐스트라 **내 편집이 빠진 저장**의 확정도 내 화면에서 '완료'로 읽힌다.
  const acks = first.stateless
    .map((payload) => {
      try {
        return JSON.parse(payload)
      } catch {
        return null
      }
    })
    .filter((parsed) => parsed?.type === 'sequence:persisted')
  // 상태벡터는 압축(zlib deflate)해서 svz(base64) + svn(압축 전 원본 길이)로 실린다.
  // 클라이언트(client/src/state/collaboration.ts)는 fflate 의 unzlibSync 로 같은 형식을 읽는다.
  const ackStateVector = (ack) => {
    if (typeof ack?.svz !== 'string' || !ack.svz) return null
    const raw = zlib.inflateSync(Buffer.from(ack.svz, 'base64'))
    if (raw.length !== ack.svn) return null
    return Y.decodeStateVector(raw)
  }
  const ackClockFor = (ack, clientId) => {
    const clocks = ackStateVector(ack)
    return clocks ? (clocks.get(clientId) ?? 0) : null
  }
  const firstClock = Y.encodeStateVector(first.document)
  const firstLocalClock = Y.decodeStateVector(firstClock).get(first.document.clientID) ?? 0
  ok(
    acks.length > 0 && acks.every((ack) => typeof ack.svz === 'string' && ack.svz.length > 0),
    'S3 모든 영속 확정이 상태벡터(압축 svz)를 함께 싣는다',
  )
  // R5-1: 상태벡터를 실은 확정에도 집계 증명(cs/cn)이 항상 함께 실린다 — 필드 유무로
  // 서버 버전을 추측하게 만들지 않기 위해서다(집계는 상태벡터를 못 실을 때의 대체 근거).
  ok(
    acks.every((ack) => Number.isInteger(ack.cs) && Number.isInteger(ack.cn) && ack.cn > 0),
    'R5-1 확정에 집계 증명(cs/cn)이 항상 함께 실린다',
  )
  ok(
    acks.every((ack) => ackStateVector(ack)?.size === ack.cn),
    'R5-1 집계 cn 이 실제 상태벡터의 clientID 개수와 일치한다',
  )
  ok(
    acks.some((ack) => (ackClockFor(ack, first.document.clientID) ?? -1) >= firstLocalClock),
    `S3 확정의 상태벡터가 방금 그 편집을 담고 있다(clock ≥ ${firstLocalClock})`,
  )
  ok(
    acks.every((ack) => (ackClockFor(ack, first.document.clientID) ?? -1) <= firstLocalClock),
    'S3 확정 상태벡터가 아직 기록되지 않은 편집을 앞질러 주장하지 않는다',
  )

  // ── R4/B2: 확정 판정이 **삭제**에도 유효한가 (라이브 왕복) ──────────────────
  // Yjs 삭제는 새 struct 를 만들지 않아 어떤 clock 도 전진시키지 않는다. 그래서 '내 clientID
  // clock 하나'만 비교하던 옛 판정은 삭제(및 방금 추가한 것의 Ctrl+Z) **이전**에 만들어진
  // 확정을 그대로 통과시켰고, 칩은 아직 파일에 남아 있는 내용을 '서버가 이 내용을 기록했습니다'
  // 라고 말했다. 아래는 client/src/state/collaboration.ts 의 판정 규칙을 그대로 옮겨,
  // **실제 서버가 쏘는 확정**으로 검증한다.
  const countDeleted = (doc) => {
    let total = 0
    for (const ranges of Y.createDeleteSetFromStructStore(doc.store).clients.values()) {
      for (const range of ranges) total += range.len
    }
    return total
  }
  const localDigestOf = (doc) => ({
    clocks: Y.decodeStateVector(Y.encodeStateVector(doc)),
    deleted: countDeleted(doc),
  })
  const parseAck = (payload) => {
    let parsed = null
    try {
      parsed = JSON.parse(payload)
    } catch {
      return null
    }
    if (parsed?.type !== 'sequence:persisted') return null
    const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
    return {
      at: parsed.at,
      clocks: ackStateVector(parsed),
      deleted: count(parsed.dl),
      clockSum: count(parsed.cs),
      clientCount: count(parsed.cn),
    }
  }
  const ackCovers = (ack, local) => {
    if (local.clocks.size === 0 && local.deleted === 0) return true
    if (ack.clocks) {
      for (const [clientId, clock] of local.clocks) {
        if ((ack.clocks.get(clientId) ?? 0) < clock) return false
      }
    } else {
      // 상태벡터를 실을 수 없을 만큼 clientID 가 많은 문서 — 집계 증명으로 내려앉는다.
      if (ack.clockSum === null || ack.clientCount === null) return false
      let localClockSum = 0
      for (const clock of local.clocks.values()) localClockSum += clock
      if (ack.clockSum < localClockSum) return false
      if (ack.clientCount < local.clocks.size) return false
    }
    if (local.deleted > 0 && ack.deleted === null) return false
    if (ack.deleted !== null && ack.deleted < local.deleted) return false
    return true
  }
  const waitForCoveringAck = async (session, doc, timeout = 8_000) => {
    const started = Date.now()
    const digest = localDigestOf(doc)
    await waitFor(
      () =>
        session.stateless.some((p) => {
          const ack = parseAck(p)
          return ack && ackCovers(ack, digest)
        }),
      'covering persist ack',
      timeout,
    )
    return Date.now() - started
  }

  // (1) 일반 편집 — 확정이 '즉시' 도착해야 한다(거짓 완료를 막느라 영구 대기로 굳으면 안 됨).
  first.stateless.length = 0
  first.document.getMap('root/meta').set('r4Probe', 'v1')
  const insertAckMs = await waitForCoveringAck(first, first.document)
  ok(
    insertAckMs < 6_000,
    `B2 일반 편집은 여전히 곧바로 '완료'에 도달한다 (편집→인정되는 확정 ${insertAckMs}ms)`,
  )

  // (2) 삭제 — 삭제 이전에 만들어진 확정은 삭제 이후 문서를 담고 있지 않다.
  const digestBeforeDelete = localDigestOf(first.document)
  first.document.getMap('root/meta').delete('r4Probe')
  const acksBeforeDelete = [...first.stateless]
  const digestAfterDelete = localDigestOf(first.document)
  ok(
    [...digestAfterDelete.clocks].every(
      ([id, clock]) => digestBeforeDelete.clocks.get(id) === clock,
    ) &&
      digestAfterDelete.clocks.size === digestBeforeDelete.clocks.size &&
      digestAfterDelete.deleted > digestBeforeDelete.deleted,
    `B2 전제: 삭제해도 상태벡터는 그대로고 삭제 총량만 는다 (${digestBeforeDelete.deleted}→${digestAfterDelete.deleted})`,
  )
  ok(
    acksBeforeDelete.length > 0 &&
      acksBeforeDelete.every((p) => {
        const ack = parseAck(p)
        return !ack || !ackCovers(ack, digestAfterDelete)
      }),
    `B2 삭제 이전의 확정 ${acksBeforeDelete.length}건은 삭제 이후 문서를 담았다고 인정되지 않는다`,
  )
  const deleteAckMs = await waitForCoveringAck(first, first.document)
  ok(
    deleteAckMs < 6_000,
    `B2 삭제를 담은 다음 확정이 곧바로 도착해 완료가 된다 — 영구 미완료 아님 (${deleteAckMs}ms)`,
  )
  ok(
    first.stateless
      .map(parseAck)
      .filter(Boolean)
      .every((ack) => ack.deleted !== null),
    'B2 모든 영속 확정이 삭제 총량(dl)을 함께 싣는다',
  )

  // F15: 동명 프로젝트 회귀 방어 — projA/projB 의 이름을 똑같이 맞춰도 보관 폴더는 ID 로 갈린다.
  const SHARED_NAME = '○○ 도로 확장공사'
  const latestVersion = async (id) => {
    const files = (await versionFiles(id)).sort()
    if (!files.length) return null
    return JSON.parse(await fs.readFile(path.join(autosaveDir, id, files.at(-1)), 'utf8'))
  }
  const bTicket = await ticketFor(base, 'projB', projectBGrant)
  const projB = connectProvider({ base, name: 'projB', token: bTicket })
  await projB.synced
  // 이름은 똑같이, 내용은 서로 다르게(startDate) 만들어 '섞임'을 검출할 수 있게 한다.
  first.document.getMap('root/meta').set('name', SHARED_NAME)
  first.document.getMap('root/meta').set('startDate', '2026-01-01')
  projB.document.getMap('root/meta').set('name', SHARED_NAME)
  projB.document.getMap('root/meta').set('startDate', '2030-12-31')
  await waitForAsync(
    async () =>
      (await latestVersion('projA'))?.startDate === '2026-01-01' &&
      (await latestVersion('projB'))?.startDate === '2030-12-31',
    'id-keyed version folders',
  )
  const aVersions = await versionFiles('projA')
  const bVersions = await versionFiles('projB')
  ok(
    aVersions.length > 0 && bVersions.length > 0,
    'F15 이름이 같은 두 프로젝트가 각자의 ID 폴더에 버전을 남긴다(이름 키였다면 한 파일로 충돌)',
  )
  const aLatest = await latestVersion('projA')
  const bLatest = await latestVersion('projB')
  ok(
    aLatest.id === 'projA' &&
      bLatest.id === 'projB' &&
      aLatest.name === SHARED_NAME &&
      bLatest.name === SHARED_NAME &&
      aLatest.startDate === '2026-01-01' &&
      bLatest.startDate === '2030-12-31',
    'F15 동명 프로젝트의 버전 내용이 서로 섞이지 않는다',
  )

  // ── F13 감사기록(변경 이력·확정본)이 서버 왕복에서 살아남는가 ──────────────────
  // seed.js 가 root/changeLog·root/baselineVersions 를 미러링하지 않으면 **보관되는 모든 버전**이
  // 이력 없는 프로젝트가 되고, 그 버전으로 되돌리는 순간(RestoreDialog → importProjectContent →
  // applyProjectToYDoc) 방의 감사기록이 통째로 지워진다. changeLog 는 UndoManager 추적 대상이
  // 아니라 되돌릴 수도 없다. 라이브 방 → 보관 버전 파일 → 스냅샷 GET 세 지점을 모두 확인한다.
  first.document.transact(() => {
    const entry = new Y.Map()
    entry.set('id', 'ch-collab')
    entry.set('at', '2026-05-01T00:00:00.000Z')
    entry.set('actorName', '김검토')
    entry.set('kind', 'duration')
    entry.set('taskIds', ['t1'])
    entry.set('summary', '터파기 60일 → 75일')
    entry.set('reason', '암반 출현')
    entry.set('state', 'confirmed')
    entry.set('$position', 1)
    first.document.getMap('root/changeLog').set('ch-collab', entry)

    const version = new Y.Map()
    version.set('id', 'bv-collab')
    version.set('name', '착공 기준선')
    version.set('authorName', '박소장')
    version.set('capturedAt', '2026-05-01T00:00:00.000Z')
    version.set('asOf', '2026-05-01')
    version.set('startDay', 0)
    version.set('endDay', 120)
    version.set('tasks', [{ id: 't1', start: 0, duration: 60 }])
    version.set('$position', 1)
    first.document.getMap('root/baselineVersions').set('bv-collab', version)
  })
  await waitFor(
    () => second.document.getMap('root/changeLog').get('ch-collab')?.get('reason') === '암반 출현',
    'change log convergence',
  )
  ok(true, 'F13 변경 이력이 두 provider 간 동기화(root/changeLog)')
  await waitForAsync(
    async () => (await latestVersion('projA'))?.changeLog?.length === 1,
    'archived version carries the audit log',
  )
  const auditVersion = await latestVersion('projA')
  ok(
    auditVersion?.changeLog?.[0]?.id === 'ch-collab' &&
      auditVersion?.changeLog?.[0]?.reason === '암반 출현' &&
      Array.isArray(auditVersion?.changeLog?.[0]?.taskIds) &&
      auditVersion.changeLog[0].taskIds.length === 1 &&
      !('$position' in (auditVersion?.changeLog?.[0] ?? {})),
    'F13 보관 버전이 변경 이력(사유·대상 공정)을 담는다 — 복구가 감사기록을 지우지 않기 위한 전제',
  )
  ok(
    auditVersion?.baselineVersions?.[0]?.id === 'bv-collab' &&
      auditVersion?.baselineVersions?.[0]?.tasks?.length === 1 &&
      auditVersion?.baselineVersions?.[0]?.name === '착공 기준선',
    'F13 보관 버전이 확정본(박제 공정 스냅샷)을 담는다',
  )
  const auditSnap = await call(base, 'GET', '/api/projects/projA/snapshot', projectGrant)
  ok(
    auditSnap.status === 200 &&
      auditSnap.data?.changeLog?.length === 1 &&
      auditSnap.data?.baselineVersions?.length === 1,
    'F13 지정 백업 경로(GET /snapshot)도 감사기록을 함께 내려준다',
  )

  const versionList = await call(base, 'GET', '/api/projects/projA/versions', projectGrant)
  ok(
    versionList.status === 200 &&
      Array.isArray(versionList.data?.items) &&
      versionList.data.items.length > 0 &&
      versionList.data.keep === 3 &&
      /^\d{8}T\d{6}Z$/.test(versionList.data.items[0].version) &&
      !Number.isNaN(Date.parse(versionList.data.items[0].savedAt)),
    'F15 버전 목록 API가 최신순 항목·보관 상한을 돌려준다',
  )
  const oneVersion = await call(
    base,
    'GET',
    `/api/projects/projA/versions/${versionList.data.items[0].version}`,
    projectGrant,
  )
  ok(
    oneVersion.status === 200 &&
      oneVersion.data?.id === 'projA' &&
      oneVersion.data?.name === SHARED_NAME &&
      Array.isArray(oneVersion.data?.tasks),
    'F15 버전 열람이 선택한 버전의 Project JSON 을 그대로 돌려준다',
  )
  const badVersion = await call(
    base,
    'GET',
    '/api/projects/projA/versions/..%2F..%2Fauth',
    projectGrant,
  )
  ok(badVersion.status === 404, 'F15 버전 이름 형식 위반(경로 조작) 거부')
  const unauthVersions = await call(base, 'GET', '/api/projects/projA/versions', null)
  ok(unauthVersions.status === 401, 'F15 버전 목록도 프로젝트 인가 게이트 적용')

  const newestNow = versionList.data.items[0].version

  // ── R3/S1·S2 버전 쓰기 인가: 조회 전용은 읽기만, 편집자만 쓰기 ────────────────
  const viewerList = await call(base, 'GET', '/api/projects/projA/versions', viewerGrant)
  const viewerRead = await call(
    base,
    'GET',
    `/api/projects/projA/versions/${newestNow}`,
    viewerGrant,
  )
  ok(
    viewerList.status === 200 && viewerRead.status === 200,
    'S1 조회 전용(같은 본부 PM)도 버전 목록·열람은 가능 — CRDT 조회 입장과 같은 기준',
  )
  const viewerSnapshotWrite = await call(base, 'POST', '/api/projects/projA/versions', viewerGrant)
  ok(
    viewerSnapshotWrite.status === 403,
    'S1/S2 조회 전용의 버전 쓰기는 403 (readOnly 연결과 같은 판정)',
  )
  const viewerAutosaveWrite = await call(base, 'POST', '/api/autosave', viewerGrant, poisonBody)
  ok(viewerAutosaveWrite.status === 410, 'S1 조회 전용의 본문 적재 경로도 존재하지 않는다')

  // 보관 상한(HN_AUTOSAVE_KEEP=3) 초과분 프루닝 — 편집 권한자는 정상 허용된다.
  for (let i = 0; i < 5; i++) {
    const made = await call(base, 'POST', '/api/projects/projA/versions', projectGrant)
    ok(made.status === 200 && /^\d{8}T\d{6}Z$/.test(made.data?.version), `강제 버전 저장 ${i + 1}`)
  }
  const pruned = await versionFiles('projA')
  ok(pruned.length === 3, `F15 보관 상한 3개로 프루닝 (실제 ${pruned.length}개)`)

  // ── S2 연타 방어: 버전은 개수 상한이 있어 '쓰기 = 오래된 복구 지점 삭제'다 ────
  // 제한이 없으면 keep 회 연타로 진짜 복구 지점이 전부 밀려난다. 속도 제한(6회/분)이
  // 실제로 버스트를 끊는지 확인한다(위 루프 5회 + 아래 1회 = 6회까지 허용).
  const sixth = await call(base, 'POST', '/api/projects/projA/versions', projectGrant)
  ok(sixth.status === 200, 'S2 속도 제한 한도(6회/분) 안의 요청은 통과')
  const seventh = await call(base, 'POST', '/api/projects/projA/versions', projectGrant)
  ok(
    seventh.status === 429 && Number(seventh.headers.get('retry-after')) > 0,
    `S2 한도를 넘긴 버스트는 429 + Retry-After 로 거부 (실제 ${seventh.status})`,
  )

  // ── R4: 프로젝트/버전 데이터를 읽고·쓰고·지우는 **모든** 라우트의 인가 매트릭스 ─────
  // 신분 5종 + 개발자를 한 표로 못박는다. resolveProjectAccess 가 canEnterProject(멤버십 필수)
  // 에서 canEnterProjectDiv(같은 본부 PM · 체험존 개방)로 넓어졌을 때 어떤 라우트가 같이
  // 넓어졌는지가 이 표 하나에 드러난다 — B1 회귀는 그 표가 없어서 새어 나갔다.
  const matrixATicket = await ticketFor(base, 'matrixA', await grantOf('a', 'matrixA'))
  const matrixSTicket = await ticketFor(base, 'matrixS', await grantOf('a', 'matrixS'))
  const matrixAProvider = connectProvider({ base, name: 'matrixA', token: matrixATicket })
  const matrixSProvider = connectProvider({ base, name: 'matrixS', token: matrixSTicket })
  await Promise.all([matrixAProvider.synced, matrixSProvider.synced])
  matrixAProvider.document.getMap('root/meta').set('name', 'Matrix A')
  matrixSProvider.document.getMap('root/meta').set('name', 'Matrix S')
  await waitForAsync(
    async () => (await versionFiles('matrixA')).length > 0,
    'matrixA 자동 버전 보관',
  )
  const matrixVersionOf = async (projectId) => {
    const listed = await call(
      base,
      'GET',
      `/api/projects/${projectId}/versions`,
      await grantOf('a', projectId),
      undefined,
      sessionCookies.a,
    )
    return listed.data?.items?.[0]?.version ?? 'noVersion'
  }
  const legacyFile = (name, projectId) =>
    fs.writeFile(
      path.join(autosaveDir, `${name}.json`),
      JSON.stringify({ id: projectId, name: `${projectId} 복구본` }),
    )
  const legacyExists = (name) =>
    fs.access(path.join(autosaveDir, `${name}.json`)).then(
      () => true,
      () => false,
    )

  const runMatrix = async (title, projectId, routes) => {
    for (const route of routes) {
      const got = {}
      for (const key of Object.keys(IDENTITIES)) {
        if (!(key in route.expect)) continue
        await route.before?.()
        const url = typeof route.url === 'function' ? await route.url() : route.url
        const response = await call(
          base,
          route.method,
          url,
          await grantOf(key, projectId),
          route.body,
          sessionCookies[key],
        )
        got[key] = response.status
      }
      const mismatched = Object.entries(route.expect).filter(([key, want]) => got[key] !== want)
      ok(
        mismatched.length === 0,
        `${title} ${route.method} ${route.label} → ${JSON.stringify(got)}${
          mismatched.length ? ` (기대 ${JSON.stringify(route.expect)})` : ''
        }`,
      )
    }
  }

  // 일반 프로젝트(matrixA): 같은 본부라도 '일반 사용자'는 미배정이면 입장 자체가 안 된다.
  await runMatrix('R4 인가표(일반)', 'matrixA', [
    {
      method: 'GET',
      url: '/api/projects/matrixA',
      label: '프로젝트 조회',
      expect: { a: 200, b: 200, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'GET',
      url: '/api/projects/matrixA/snapshot',
      label: '스냅샷 조회',
      expect: { a: 200, b: 200, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'PUT',
      url: '/api/projects/matrixA',
      body: { id: 'matrixA', name: 'overwrite' },
      label: '레거시 전체 PUT',
      expect: { a: 405, b: 405, c: 403, d: 403, e: 401, dev: 405 },
    },
    {
      method: 'GET',
      url: '/api/projects/matrixA/versions',
      label: '버전 목록',
      expect: { a: 200, b: 200, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'GET',
      url: async () => `/api/projects/matrixA/versions/${await matrixVersionOf('matrixA')}`,
      label: '버전 열람',
      expect: { a: 200, b: 200, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'POST',
      url: '/api/projects/matrixA/versions',
      label: '버전 쓰기',
      expect: { a: 200, b: 403, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'GET',
      url: '/api/autosave/file/matrixA-legacy',
      label: '레거시 복구본 읽기',
      before: () => legacyFile('matrixA-legacy', 'matrixA'),
      expect: { a: 200, b: 200, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'DELETE',
      url: '/api/autosave/file/matrixA-legacy',
      label: '레거시 복구본 삭제(파괴적)',
      before: () => legacyFile('matrixA-legacy', 'matrixA'),
      expect: { a: 403, b: 403, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'POST',
      url: '/api/autosave',
      body: { id: 'matrixA', name: 'POISONED' },
      label: '본문 적재(폐지)',
      expect: { a: 410, b: 410, c: 410, d: 410, e: 410, dev: 410 },
    },
    {
      method: 'GET',
      url: '/api/autosave',
      label: '레거시 목록(세션 인증)',
      expect: { a: 200, b: 200, c: 200, d: 200, e: 401, dev: 200 },
    },
    {
      // 개발자 행은 실제로 지워지므로 소모품 프로젝트(matrixX)에서 따로 본다.
      method: 'DELETE',
      url: '/api/projects/matrixA',
      label: '프로젝트 삭제',
      expect: { a: 403, b: 403, c: 403, d: 403, e: 401 },
    },
  ])

  // 체험존(sample): 같은 본부면 배정 없이 입장·**편집**까지 열린다 — 그래서 파괴적 라우트가
  // 입장 등급에 머물러 있으면 일반 사용자가 복구 이력을 지울 수 있다(B1 두 번째 재현).
  await runMatrix('R4 인가표(체험존 sample)', 'matrixS', [
    {
      method: 'GET',
      url: '/api/projects/matrixS',
      label: '프로젝트 조회',
      expect: { a: 200, b: 200, c: 200, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'GET',
      url: '/api/projects/matrixS/versions',
      label: '버전 목록',
      expect: { a: 200, b: 200, c: 200, d: 403, e: 401, dev: 200 },
    },
    {
      // R5-5: 체험존은 **편집**은 같은 본부 누구나지만, 복구 이력 쓰기(=오래된 이력을 밀어내는
      // prune 권한)는 **배정된 담당자**만이다. 예전에는 b(미배정 PM)·c(미배정 일반 사용자)도
      // 200 이라, keep=20 · 최소 간격 10분 기준 약 200분이면 남의 진짜 복구 지점 20개를
      // 전부 밀어낼 수 있었다. 자동 보관(CRDT 영속 훅)은 체험존에서도 그대로 돌아간다.
      method: 'POST',
      url: '/api/projects/matrixS/versions',
      label: '버전 쓰기(체험존이라도 배정 담당자만)',
      expect: { a: 200, b: 403, c: 403, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'GET',
      url: '/api/autosave/file/matrixS-legacy',
      label: '레거시 복구본 읽기',
      before: () => legacyFile('matrixS-legacy', 'matrixS'),
      expect: { a: 200, b: 200, c: 200, d: 403, e: 401, dev: 200 },
    },
    {
      method: 'DELETE',
      url: '/api/autosave/file/matrixS-legacy',
      label: '레거시 복구본 삭제(파괴적)',
      before: () => legacyFile('matrixS-legacy', 'matrixS'),
      expect: { a: 403, b: 403, c: 403, d: 403, e: 401, dev: 200 },
    },
  ])

  // ── R5-4: 프로젝트 비활성화가 '이미 들어와 있는 사람'까지 실제로 막는가 ─────
  //
  // 재현: 편집자가 입장해 12시간짜리 project grant 를 들고 있는 상태에서 개발자가
  // active:false 로 끈다. 예전에는 새 입장(POST .../enter)만 403 이었고,
  //   · GET  /api/projects/:id/snapshot        → 200 (전체 데이터)
  //   · POST /api/projects/:id/versions        → 429 (= 인가는 **통과**했다는 뜻)
  //   · POST /auth/projects/:id/collab-ticket  → 200 (새 5분짜리 편집 티켓 발급)
  // 이 전부 통과했다. 즉 관리자가 프로젝트를 끈 뒤에도 최대 12시간 동안 티켓을 갱신하며
  // CRDT 방을 편집할 수 있었고, 열려 있던 연결을 끊는 훅도 없었다.
  const deactGrant = await grantOf('a', 'deactA')
  const deactTicket = await ticketFor(base, 'deactA', deactGrant)
  const deactProvider = connectProvider({ base, name: 'deactA', token: deactTicket })
  await deactProvider.synced
  deactProvider.document.getMap('root/meta').set('name', 'Deactivation probe')
  const beforeSnapshot = await call(base, 'GET', '/api/projects/deactA/snapshot', deactGrant)
  const beforeTicket = await call(
    base,
    'POST',
    '/api/auth/projects/deactA/collab-ticket',
    deactGrant,
    {},
  )
  ok(
    beforeSnapshot.status === 200 && beforeTicket.status === 200,
    `R5-4 전제: 활성 상태에서는 스냅샷·티켓이 모두 통과한다 (${beforeSnapshot.status}/${beforeTicket.status})`,
  )
  const deactivate = await call(
    base,
    'POST',
    '/api/auth/projects/deactA/active',
    null,
    { active: false },
    sessionCookies.dev,
  )
  ok(deactivate.status === 200, `R5-4 개발자가 프로젝트를 비활성화한다 (${deactivate.status})`)

  const afterEnter = await call(
    base,
    'POST',
    '/api/auth/projects/deactA/enter',
    null,
    {},
    sessionCookies.a,
  )
  const afterSnapshot = await call(base, 'GET', '/api/projects/deactA/snapshot', deactGrant)
  const afterVersions = await call(base, 'POST', '/api/projects/deactA/versions', deactGrant)
  const afterTicket = await call(
    base,
    'POST',
    '/api/auth/projects/deactA/collab-ticket',
    deactGrant,
    {},
  )
  ok(afterEnter.status === 403, `R5-4 새 입장은 거부된다(기존 동작) (${afterEnter.status})`)
  ok(
    afterSnapshot.status === 403,
    `R5-4 비활성화 전에 받은 grant 로도 스냅샷을 읽을 수 없다 (실제 ${afterSnapshot.status})`,
  )
  ok(
    afterVersions.status === 403,
    `R5-4 버전 쓰기가 **인가 단계**에서 막힌다 — 429(=통과)가 아니라 403 (실제 ${afterVersions.status})`,
  )
  ok(
    afterTicket.status === 403,
    `R5-4 새 collab 티켓을 더 이상 발급받을 수 없다 (실제 ${afterTicket.status})`,
  )
  // 닫힘 **코드**로 판정한다. 이 스모크는 collabTimeout=500ms 라 어떤 연결이든 곧 유휴로
  // 끊기므로 '끊겼다'만 보면 항상 통과해 버린다 — 강제 절단은 4003 'access-revoked' 다.
  const deactClose = await Promise.race([
    deactProvider.closed,
    new Promise((resolve) => setTimeout(() => resolve(null), 3_000)),
  ])
  ok(
    deactClose?.reason === 'access-revoked',
    `R5-4 비활성화가 이미 열려 있던 WebSocket 연결을 강제 절단한다 — 사유 access-revoked (실제 "${deactClose?.reason ?? '끊기지 않음'}")`,
  )
  const devAfterDeactivate = await call(
    base,
    'GET',
    '/api/projects/deactA/snapshot',
    await grantOf('dev', 'deactA'),
    undefined,
    sessionCookies.dev,
  )
  ok(
    devAfterDeactivate.status === 200,
    `R5-4 개발자는 비활성 프로젝트도 관리·복구할 수 있다(과잉 차단 아님, ${devAfterDeactivate.status})`,
  )
  // 되돌리면 원래대로 — 비활성화가 영구 잠금이 되지 않는다.
  const reactivate = await call(
    base,
    'POST',
    '/api/auth/projects/deactA/active',
    null,
    { active: true },
    sessionCookies.dev,
  )
  const afterReactivate = await call(base, 'GET', '/api/projects/deactA/snapshot', deactGrant)
  ok(
    reactivate.status === 200 && afterReactivate.status === 200,
    `R5-4 다시 활성화하면 같은 grant 로 접근이 복구된다 (${reactivate.status}/${afterReactivate.status})`,
  )
  // 검증이 끝난 연결은 여기서 정리한다. 살려 두면 아래 runtime.close() 이후에도 재접속을
  // 시도해 ECONNREFUSED ErrorEvent 가 unhandledRejection 으로 새어 나온다.
  deactProvider.provider.destroy()

  // ── R5-1: 누적 세션(clientID)이 아주 많은 문서도 '완료'에 도달하는가 ─────────
  //
  // 상태벡터는 이 문서에 한 번이라도 쓴 clientID 마다 한 항목이고, 새로고침·새 탭마다
  // clientID 가 새로 발급된다 → 항목 수는 접속자 수가 아니라 **누적 세션 수**로 늘어난다.
  // 예전에는 비압축 상태벡터를 4096B 상한 아래에서 실었고, 세션 508개(payload 4100B)부터
  // 클라이언트가 **모든** 확정을 버려 칩이 영원히 '서버 확정 대기…'로 굳었다.
  // 아래는 실제 서버에 그런 문서를 밀어 넣고, 서버가 쏘는 진짜 확정으로 판정한다.
  const bigTicket = await ticketFor(base, 'ackBigA', await grantOf('a', 'ackBigA'))
  const bigSession = connectProvider({ base, name: 'ackBigA', token: bigTicket })
  await bigSession.synced
  bigSession.stateless.length = 0
  Y.applyUpdate(bigSession.document, bigSeedUpdate)
  const bigDigest = localDigestOf(bigSession.document)
  ok(
    bigDigest.clocks.size >= BIG_SESSIONS,
    `R5-1 전제: 누적 세션이 옛 한계(508)를 한참 넘는다 (clientID ${bigDigest.clocks.size}개)`,
  )
  await waitFor(
    () => bigSession.stateless.some((p) => parseAck(p) !== null),
    'big-doc persist ack',
    15_000,
  )
  const bigAcks = bigSession.stateless.map(parseAck).filter(Boolean)
  const bigRaw = bigSession.stateless
    .map((p) => {
      try {
        return JSON.parse(p)
      } catch {
        return null
      }
    })
    .filter((p) => p?.type === 'sequence:persisted')
  ok(
    bigRaw.every((ack) => ack.svz === undefined),
    'R5-1 상태벡터가 상한을 넘으면 서버가 그것을 빼고 집계 증명만 싣는다(강등)',
  )
  ok(
    bigRaw.every((ack) => JSON.stringify(ack).length <= 49_152),
    `R5-1 확정 payload 가 클라이언트 상한(49,152B) 안에 들어온다 (최대 ${Math.max(
      ...bigRaw.map((a) => JSON.stringify(a).length),
    )}B)`,
  )
  await waitFor(
    () => bigSession.stateless.some((p) => ackCovers(parseAck(p), bigDigest)),
    'big-doc covering ack',
    15_000,
  )
  ok(
    bigAcks.length > 0,
    `R5-1 clientID 가 ${BIG_SESSIONS.toLocaleString()}개여도 확정이 버려지지 않고 '완료'에 도달한다`,
  )
  bigSession.provider.destroy()

  // 개발자 전용 파괴 라우트의 성공 대조군(실제로 지워진다).
  const devProjectDelete = await call(
    base,
    'DELETE',
    '/api/projects/matrixX',
    await grantOf('dev', 'matrixX'),
    undefined,
    sessionCookies.dev,
  )
  ok(
    devProjectDelete.status === 200 || devProjectDelete.status === 404,
    `R4 개발자는 프로젝트를 실제로 삭제할 수 있다(대조군, 실제 ${devProjectDelete.status})`,
  )

  // ── B1 재현: '버전 쓰기 403' 신분이 복구 이력은 지울 수 있었다 ────────────────
  await legacyFile('matrixA-legacy', 'matrixA')
  const viewerVersionWrite = await call(
    base,
    'POST',
    '/api/projects/matrixA/versions',
    await grantOf('b', 'matrixA'),
    undefined,
    sessionCookies.b,
  )
  const viewerFileDelete = await call(
    base,
    'DELETE',
    '/api/autosave/file/matrixA-legacy',
    await grantOf('b', 'matrixA'),
    undefined,
    sessionCookies.b,
  )
  ok(
    viewerVersionWrite.status === 403 &&
      viewerFileDelete.status === 403 &&
      (await legacyExists('matrixA-legacy')),
    `B1 버전 쓰기 403 인 신분(같은 본부 미배정 PM)은 복구 파일도 못 지우고 파일이 그대로 남는다 (versions=${viewerVersionWrite.status}, delete=${viewerFileDelete.status})`,
  )
  await legacyFile('matrixS-legacy', 'matrixS')
  const sampleUserFileDelete = await call(
    base,
    'DELETE',
    '/api/autosave/file/matrixS-legacy',
    await grantOf('c', 'matrixS'),
    undefined,
    sessionCookies.c,
  )
  ok(
    sampleUserFileDelete.status === 403 && (await legacyExists('matrixS-legacy')),
    `B1 체험존 일반 사용자도 복구 파일을 지울 수 없고 파일이 그대로 남는다 (실제 ${sampleUserFileDelete.status})`,
  )
  const devFileDelete = await call(
    base,
    'DELETE',
    '/api/autosave/file/matrixS-legacy',
    await grantOf('dev', 'matrixS'),
    undefined,
    sessionCookies.dev,
  )
  ok(
    devFileDelete.status === 200 && !(await legacyExists('matrixS-legacy')),
    `B1 개발자는 정상적으로 복구 파일을 정리할 수 있다(대조군, 실제 ${devFileDelete.status})`,
  )

  matrixAProvider.provider.destroy()
  matrixSProvider.provider.destroy()

  // 프로젝트 삭제 시 버전 이력도 함께 정리.
  const emptyVersion = await call(base, 'POST', '/api/projects/emptyA/versions', emptyGrant)
  ok(emptyVersion.status === 200, 'emptyA 버전 1건 생성(삭제 정리 검증용)')

  const revokedCount = runtime.collab.revokeProjectAccess('projA', 'u1')
  ok(revokedCount >= 1, '#14 revokeProjectAccess가 해당 사용자 활성 연결을 강제 절단')

  first.provider.destroy()
  second.provider.destroy()
  seeded.provider.destroy()
  empty.provider.destroy()
  projB.provider.destroy()
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
  const emptyVersionsAfter = await fs.readdir(path.join(autosaveDir, 'emptyA')).then(
    (files) => files.length,
    () => -1,
  )
  ok(emptyVersionsAfter === -1, 'F15 프로젝트 삭제 시 버전 이력 폴더도 함께 정리')

  await runtime.close()
  runtime = null

  // ── S2 최소 보관 간격(minIntervalMs) — 보관소 단위 ──────────────────────────
  // 사용자가 직접 누르는 버전 저장도 자동 보관과 **같은 간격**을 지켜야 한다. 예전에는
  // force:true 로 스로틀을 통째로 건너뛰어, 간격 설정이 있으나 마나였다.
  const { createVersionArchive } = await import('../src/collab/versions.js')
  const throttled = createVersionArchive({
    root: path.join(tempRoot, 'throttle'),
    decode: (_state, projectId) => ({ id: projectId, name: 'throttle probe' }),
    keep: 5,
    minIntervalMs: 60_000,
    logger: { error() {} },
  })
  const probeState = new Uint8Array([1, 2, 3])
  const firstRetain = await throttled.retain('throttleA', probeState)
  const secondRetain = await throttled.retain('throttleA', probeState)
  ok(
    firstRetain?.status === 'ok' &&
      !!firstRetain.version &&
      secondRetain?.status === 'throttled' &&
      secondRetain.version === null &&
      throttled.retainWaitMs('throttleA') > 0,
    `S2 최소 보관 간격이 연속 보관을 막고 남은 시간을 알려준다 (대기 ${throttled.retainWaitMs('throttleA')}ms, 두 번째 결과 ${secondRetain?.status})`,
  )
  ok(
    (await throttled.retain('throttleB', probeState))?.status === 'ok',
    'S2 스로틀은 프로젝트별로 독립 — 다른 프로젝트 보관은 막지 않는다',
  )
  // B3: 스로틀과 **진짜 실패**는 서로 다른 신호여야 한다. 예전엔 둘 다 null 이라 라우트가
  // 간격 제한을 500 '버전 저장에 실패했습니다'로 보고했다.
  const failingArchive = createVersionArchive({
    root: path.join(tempRoot, 'failing'),
    decode: () => {
      throw new Error('decode-boom')
    },
    keep: 5,
    minIntervalMs: 0,
    logger: { error() {} },
  })
  const failedRetain = await failingArchive.retain('failA', probeState)
  ok(
    failedRetain?.status === 'error' && failedRetain.version === null,
    `B3 보관 실패는 'error' 로, 간격 제한은 'throttled' 로 구분된다 (실제 ${failedRetain?.status})`,
  )
  // B3 TOCTOU 그 자체 — 라우트의 사전 점검이 통과한 뒤 자동 보관이 끼어드는 경합.
  const racy = createVersionArchive({
    root: path.join(tempRoot, 'racy'),
    decode: (_state, projectId) => ({ id: projectId, name: 'race probe' }),
    keep: 5,
    minIntervalMs: 600_000,
    logger: { error() {} },
  })
  // 라우트가 하는 그대로: ① 두 요청이 각자 사전 점검(retainWaitMs)을 먼저 통과하고,
  // ② 그 뒤 serializeWrite 가 둘을 직렬화해 retain 을 차례로 실행한다. 두 번째 retain 이
  // 보는 세상은 첫 번째가 이미 보관을 마친 뒤라 스로틀에 걸린다 — 그게 TOCTOU 다.
  const preCheckOne = racy.retainWaitMs('raceA')
  const preCheckTwo = racy.retainWaitMs('raceA')
  const racedFirst = await racy.retain('raceA', probeState)
  const racedSecond = await racy.retain('raceA', probeState)
  ok(
    preCheckOne === 0 &&
      preCheckTwo === 0 &&
      racedFirst?.status === 'ok' &&
      racedSecond?.status === 'throttled',
    `B3 사전 점검을 둘 다 통과한 뒤 직렬화되면 두 번째는 'throttled'(실패가 아님) — ${racedFirst?.status}/${racedSecond?.status}`,
  )

  const binaryBefore = await fs.readFile(path.join(dataDir, 'ydocs', 'legacyA.bin'))
  await fs.unlink(path.join(dataDir, 'legacyA.json'))
  // 재시작 서버에는 최소 보관 간격을 실제로 걸어, 라우트가 스로틀을 지키는지 HTTP 로 확인한다.
  runtime = await startServer({
    port: 0,
    host: '127.0.0.1',
    collabTimeout: 500,
    versionIntervalMs: 600_000,
  })
  base = `http://127.0.0.1:${runtime.port}`

  const throttledFirst = await call(base, 'POST', '/api/projects/projB/versions', projectBGrant)
  const throttledSecond = await call(base, 'POST', '/api/projects/projB/versions', projectBGrant)
  ok(
    throttledFirst.status === 200 &&
      throttledSecond.status === 429 &&
      Number(throttledSecond.headers.get('retry-after')) > 0,
    `S2 사용자 버전 저장도 최소 간격을 지킨다 — 연속 요청은 429 (실제 ${throttledFirst.status}/${throttledSecond.status})`,
  )
  const throttledFiles = await versionFiles('projB')
  ok(
    throttledFiles.length <= 3,
    `S2 스로틀 아래에서는 연타로 보관 상한을 소진할 수 없다 (${throttledFiles.length}개)`,
  )

  // ── B3: 사전 점검을 통과한 뒤 내부에서 걸린 스로틀이 500 이 아니라 429 로 나가는가 ──
  // 라우트가 retainWaitMs 로 미리 확인한 값과 retain 내부의 재검사 사이에 자동 보관이
  // 끼어들면(탭 두 개·CRDT 영속 훅과 경합) retain 이 'throttled' 를 돌려준다. 그건 실패가
  // 아니므로 429 + Retry-After 여야 한다. 경합 자체는 위에서 보관소 단위로 재현했고,
  // 여기서는 그 결과가 HTTP 로 어떻게 번역되는지를 결정적으로 확인한다.
  const matrixAGrant = await grantOf('a', 'matrixA')
  ok(
    runtime.collab.versions.retainWaitMs('matrixA') === 0,
    'B3 전제: 재기동 직후 matrixA 는 사전 점검을 통과한다',
  )
  const realRetain = runtime.collab.versions.retain
  runtime.collab.versions.retain = async () => ({ status: 'throttled', version: null })
  const toctouThrottled = await call(base, 'POST', '/api/projects/matrixA/versions', matrixAGrant)
  runtime.collab.versions.retain = async () => ({ status: 'error', version: null })
  const toctouFailed = await call(base, 'POST', '/api/projects/matrixA/versions', matrixAGrant)
  runtime.collab.versions.retain = realRetain
  ok(
    toctouThrottled.status === 429 && Number(toctouThrottled.headers.get('retry-after')) > 0,
    `B3 사전 점검 통과 후의 스로틀은 429 + Retry-After (실제 ${toctouThrottled.status}, Retry-After ${toctouThrottled.headers.get('retry-after')})`,
  )
  ok(
    toctouFailed.status === 500,
    `B3 진짜 실패는 여전히 500 으로 구분된다 (실제 ${toctouFailed.status})`,
  )
  // 실제 동시 요청 버스트에서도 500 은 나오지 않는다(사용자가 보는 결과 기준).
  const matrixSGrant = await grantOf('a', 'matrixS')
  const burst = await Promise.all(
    Array.from({ length: 4 }, () =>
      call(base, 'POST', '/api/projects/matrixS/versions', matrixSGrant),
    ),
  )
  ok(
    burst.every((r) => r.status === 200 || r.status === 429) && burst.some((r) => r.status === 200),
    `B3 동시 버스트는 200/429 로만 갈린다 — 500 없음 (${burst.map((r) => r.status).join('/')})`,
  )
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
} catch (error) {
  // 본문 도중의 예외도 '검사 실패'다 — 남은 검사가 통째로 건너뛰어졌다는 뜻이므로
  // 조용히 넘기지 않고 실패로 세고, 아래 finally 를 거쳐 FAIL 배너까지 찍는다.
  failures++
  console.log(`  ✗ 스모크가 도중에 중단됐다 :: ${error?.stack ?? error}`)
} finally {
  for (const provider of providers) {
    try {
      provider.destroy()
    } catch {}
  }
  // 소켓이 실제로 닫히도록 한 틱 양보한 뒤 서버를 내리고, 마지막에 임시 폴더를 지운다
  // (임시 폴더 안에 error.log 가 있어 순서가 뒤집히면 ENOENT 잡음이 난다).
  await new Promise((resolve) => setTimeout(resolve, 50))
  try {
    if (runtime) await runtime.close()
  } catch {}
  try {
    await fs.rm(tempRoot, { recursive: true, force: true })
  } catch {}
}

report()
