// 인증/RBAC 통합 스모크 — 메모리 어댑터(Postgres 불필요)로 로그인·역할·엑셀임포트·접속코드·멤버십 검증.
// 실행: node server/scripts/auth-smoke.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import * as XLSX from 'xlsx'
import { hashSecret, verifySecret, verifyToken } from '../src/auth/crypto.js'
import { importUsers, parseRosterFile, UserImportValidationError } from '../src/auth/importUsers.js'
import { canonicalPhoneId, formatPhoneId, normalizeLoginId } from '../src/auth/phone.js'
import { createMemoryRepo } from '../src/auth/repo.js'
import { bootstrapDeveloper, createAuthRouter } from '../src/auth/routes.js'
import {
  createBoundedRateLimiter,
  createHttpOriginPolicy,
  normalizeClientLogEntries,
  resolveAuthBackendConfig,
} from '../src/security.js'

let fail = 0
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m)
  if (!c) fail++
}

const workbookBuffer = (aoa) => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'S')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

// Startup/storage configuration must be deterministic: never silently mix pg auth with file collab.
ok(
  resolveAuthBackendConfig({ AUTH_BACKEND: 'memory' }).backend === 'memory',
  'memory backend config',
)
let missingPgUrl = null
try {
  resolveAuthBackendConfig({ AUTH_BACKEND: 'pg', DATABASE_URL: '' })
} catch (error) {
  missingPgUrl = error
}
ok(
  /requires DATABASE_URL/.test(missingPgUrl?.message || ''),
  'pg backend without DATABASE_URL rejected',
)
const serverDir = fileURLToPath(new URL('..', import.meta.url))
const failedStartup = spawnSync(
  process.execPath,
  ['--input-type=module', '--eval', "import('./src/index.js')"],
  {
    cwd: serverDir,
    env: { ...process.env, AUTH_BACKEND: 'pg', DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 5_000,
  },
)
ok(
  failedStartup.status !== 0 &&
    `${failedStartup.stdout}${failedStartup.stderr}`.includes(
      'AUTH_BACKEND=pg requires DATABASE_URL',
    ),
  'server startup fails clearly for incomplete pg config',
)

const requestForOrigin = (origin, host = '127.0.0.1:4020') => ({
  protocol: 'http',
  originalUrl: '/api/health',
  headers: { ...(origin ? { origin } : {}), host },
  get(name) {
    return this.headers[String(name).toLowerCase()]
  },
})
const defaultOriginPolicy = createHttpOriginPolicy('')
ok(defaultOriginPolicy(requestForOrigin(null)), 'HTTP origin policy allows non-browser request')
ok(
  defaultOriginPolicy(requestForOrigin('http://127.0.0.1:4020')),
  'HTTP origin policy allows same-origin LAN request',
)
ok(
  !defaultOriginPolicy(requestForOrigin('http://192.168.0.77:4020')),
  'HTTP origin policy rejects unlisted cross-origin LAN request',
)
ok(
  createHttpOriginPolicy('https://trusted.example')(requestForOrigin('https://trusted.example')),
  'HTTP origin policy honors the same explicit allowlist as WebSocket',
)

const safeLog = normalizeClientLogEntries({
  level: 'fatal',
  message: 'failure\n[forged log line]\u001b[31m',
  stack: 'line 1\nline 2',
  project: { injected: true },
})[0]
ok(
  safeLog.level === 'info' &&
    !safeLog.message.includes('\n') &&
    safeLog.message.includes('[forged log line]') &&
    safeLog.detail === 'line 1\\nline 2' &&
    !('project' in safeLog),
  'client log fields are bounded, allowlisted, and log-injection safe',
)
let oversizedLogBatch = null
try {
  normalizeClientLogEntries({ entries: Array.from({ length: 21 }, () => ({ message: 'x' })) })
} catch (error) {
  oversizedLogBatch = error
}
ok(/1-20/.test(oversizedLogBatch?.message || ''), 'client log batch count is bounded')

const logLimiter = createBoundedRateLimiter({ limit: 2, windowMs: 1_000, maxTracked: 2 })
ok(
  logLimiter.consume('ip\0actor', 0).allowed &&
    logLimiter.consume('ip\0actor', 1).allowed &&
    !logLimiter.consume('ip\0actor', 2).allowed &&
    logLimiter.consume('ip\0actor', 1_001).allowed,
  'client log IP/actor limiter rejects bursts and resets by window',
)
logLimiter.consume('ip2\0actor2', 1_001)
logLimiter.consume('ip3\0actor3', 1_001)
ok(logLimiter.size <= 2, 'client log limiter keeps bounded actor/IP state')

// 전화번호 canonicalization + 표시 formatter
ok(canonicalPhoneId('010-1234-5678') === '01012345678', '전화번호 ID canonical digits')
ok(canonicalPhoneId('010-123-4567') === null, '잘못된 전화번호 ID 거부')
ok(canonicalPhoneId('id010-1234-5678') === null, '문자가 섞인 전화번호 ID 거부')
ok(canonicalPhoneId('010--1234-5678') === null, '비정상 구분자 전화번호 ID 거부')
ok(normalizeLoginId(' break-glass ') === 'break-glass', '비전화 break-glass ID exact 보존')
ok(formatPhoneId('010a1234b5678') === '010-1234-5678', '숫자 입력 자동 하이픈 표시')

// 실제 개인정보를 쓰지 않는 synthetic 한글 roster: 엄격 헤더/그룹/비밀번호/재실행 검증.
const rosterAoa = [
  ['No', '이름', '전화번호', '그룹'],
  [1, '테스트개발', '010-0000-0001', '개발자'],
  [2, '테스트관리', '010-0000-0002', '관리자'],
  [3, '테스트사용', '010-0000-0003', '사용자'],
]
const rosterBuf = workbookBuffer(rosterAoa)
const parsedRoster = parseRosterFile(rosterBuf)
ok(
  parsedRoster.length === 3 && parsedRoster.map((u) => u.role).join(',') === 'developer,pm,user',
  '한글 roster 전화번호·그룹 엄격 매핑',
)

const invalidRosterBuf = workbookBuffer([
  ['이름', '전화번호', '그룹'],
  ['누락', '010-0000-0004', '알수없음'],
  ['중복1', '010-0000-0005', '사용자'],
  ['중복2', '01000000005', '사용자'],
  ['', '010-000-0006', '관리자'],
])
let invalidRosterError = null
try {
  parseRosterFile(invalidRosterBuf)
} catch (error) {
  invalidRosterError = error
}
ok(
  invalidRosterError instanceof UserImportValidationError &&
    invalidRosterError.summary.unknownGroup === 1 &&
    invalidRosterError.summary.duplicatePhone === 1 &&
    invalidRosterError.summary.invalidPhone === 1 &&
    invalidRosterError.summary.missingName === 1,
  'unknown/invalid/duplicate/blank roster 전체 거부',
)
const invalidRepo = createMemoryRepo(null)
await importUsers(invalidRepo, invalidRosterBuf).catch(() => {})
ok((await invalidRepo.listUsers()).length === 0, 'roster 검증 실패 시 쓰기 0건')

const rosterRepo = createMemoryRepo(null)
let rosterImport = await importUsers(rosterRepo, rosterBuf)
ok(rosterImport.withPassword === 3, '신규 전화계정 last4 초기비밀번호 해시')
const preservedId = parsedRoster[0].username
await rosterRepo.setUserPassword(preservedId, await hashSecret('changed-password'))
rosterImport = await importUsers(rosterRepo, rosterBuf)
const preservedUser = await rosterRepo.getUser(preservedId)
ok(
  rosterImport.withPassword === 0 &&
    (await verifySecret('changed-password', preservedUser.passwordHash)) &&
    !(await verifySecret(parsedRoster[0].password, preservedUser.passwordHash)),
  'roster 재실행은 기존 비밀번호 보존',
)
rosterImport = await importUsers(rosterRepo, rosterBuf, { resetPasswords: true })
ok(
  rosterImport.withPassword === 3 &&
    (await verifySecret(
      parsedRoster[0].password,
      (
        await rosterRepo.getUser(preservedId)
      ).passwordHash,
    )),
  '명시 reset에서만 초기비밀번호 재설정',
)

const repo = createMemoryRepo(null)
const boot = await bootstrapDeveloper(repo)
const { router } = createAuthRouter(repo, { secure: false })
const app = express()
app.use(express.json({ limit: '8mb' }))
app.use('/api', router)
const server = app.listen(0)
await new Promise((r) => server.once('listening', r))
const base = `http://127.0.0.1:${server.address().port}/api`

let cookie = ''
async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  let data = null
  try {
    data = await res.json()
  } catch {}
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') }
}

let r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
ok(r.status === 200 && r.data.user.role === 'developer', '개발자 부트스트랩 로그인')
const bootstrapCookie = cookie
r = await call('GET', '/auth/me')
ok(r.status === 200 && r.data.user.id === boot.id, '세션 /auth/me')

// 엑셀(.xlsx) 사용자 임포트
const aoa = [
  ['username', 'name', 'role', 'password'],
  ['pm1', '피엠', 'pm', 'pw-pm'],
  ['u1', '사용자', 'user', 'pw-u'],
]
const buf = workbookBuffer(aoa)
r = await call('POST', '/admin/users/import', { fileBase64: buf.toString('base64') })
ok(
  r.status === 200 && r.data.imported === 2 && r.data.withPassword === 2,
  `엑셀 사용자 임포트 ${r.data?.imported}명`,
)
// 본부(division) 부여 — projA 와 같은 본부로 두어야 목록/입장 가능(본부 기반 RBAC).
await repo.upsertUser({ id: 'pm1', name: '피엠', role: 'pm', division: 'water-res' })
await repo.upsertUser({ id: 'u1', name: '사용자', role: 'user', division: 'water-res' })

// 한글 전화번호 roster API 임포트 + formatted 로그인 + rate limit/성공 초기화.
r = await call('POST', '/admin/users/import', { fileBase64: rosterBuf.toString('base64') })
ok(
  r.status === 200 && r.data.imported === 3 && r.data.withPassword === 3,
  '한글 전화번호 roster API 임포트',
)
r = await call('POST', '/admin/users/import', { fileBase64: invalidRosterBuf.toString('base64') })
ok(r.status === 400 && /validation|검증/.test(r.data.error), '잘못된 roster API 400 안전 거부')
const rateUser = parsedRoster[2]
r = await call('POST', '/auth/login', {
  username: formatPhoneId(rateUser.username),
  password: rateUser.password,
})
ok(
  r.status === 200 && r.data.user.id === rateUser.username,
  '하이픈 전화번호 로그인 canonical lookup',
)
let beforeReset401 = 0
for (let i = 0; i < 4; i++) {
  r = await call('POST', '/auth/login', { username: rateUser.username, password: 'wrong' })
  if (r.status === 401) beforeReset401++
}
r = await call('POST', '/auth/login', { username: rateUser.username, password: rateUser.password })
ok(beforeReset401 === 4 && r.status === 200, '로그인 성공 시 실패 횟수 초기화')
let afterReset401 = 0
for (let i = 0; i < 4; i++) {
  r = await call('POST', '/auth/login', {
    username: formatPhoneId(rateUser.username),
    password: 'wrong',
  })
  if (r.status === 401) afterReset401++
}
r = await call('POST', '/auth/login', { username: rateUser.username, password: 'wrong' })
ok(
  afterReset401 === 4 && r.status === 429 && Number(r.retryAfter) > 0,
  '5회 실패 후 15분 429/Retry-After',
)
cookie = bootstrapCookie

r = await call('POST', '/admin/projects', {
  id: 'projA',
  name: 'A댐',
  accessCode: 'code-A',
  division: 'water-res',
})
ok(r.status === 200, '프로젝트 생성 + 접속코드')
r = await call('POST', '/projects/projA/members', { userId: 'pm1', role: 'pm' })
ok(r.status === 200, 'PM 멤버 추가')
r = await call('POST', '/projects/projA/members', { userId: 'u1', role: 'user' })
ok(r.status === 200, 'user 멤버 추가')
r = await call('POST', '/auth/projects/projA/enter', {})
ok(r.status === 200 && !!r.data.token, '개발자: 코드 없이 입장(전체 접근)')
const developerCookie = cookie
cookie = ''
r = await call('POST', '/auth/projects/projA/collab-ticket', {})
ok(r.status === 401, 'project grant 없는 collab ticket 발급 거부')
cookie = developerCookie

// 사용자(user) — 접속코드 게이트
r = await call('POST', '/auth/login', { username: 'u1', password: 'pw-u' })
ok(r.status === 200 && r.data.user.role === 'user', 'user 로그인')
r = await call('GET', '/auth/projects')
ok(r.status === 200 && r.data.some((p) => p.id === 'projA'), 'user 접근가능 목록에 projA')
r = await call('POST', '/auth/projects/projA/enter', { code: 'wrong' })
ok(r.status === 401, 'user 잘못된 접속코드 거부(401)')
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(
  r.status === 200 && !!r.data.token && r.data.projRole === 'user',
  'user 올바른 접속코드 → 입장+프로젝트토큰',
)
const projectGrant = r.data.token
r = await call(
  'POST',
  '/auth/projects/projA/collab-ticket',
  {},
  { authorization: `Bearer ${projectGrant}` },
)
const collabClaims = r.status === 200 ? await verifyToken(r.data.ticket, 'collab') : null
ok(
  r.status === 200 &&
    r.data.expiresIn === 300 &&
    collabClaims?.typ === 'collab' &&
    collabClaims?.projectId === 'projA' &&
    collabClaims?.projRole === 'user' &&
    collabClaims?.sub === 'u1' &&
    collabClaims.exp - collabClaims.iat === 300,
  'project grant → 5분 collab ticket claim 검증',
)
await repo.removeMember('projA', 'u1')
r = await call(
  'POST',
  '/auth/projects/projA/collab-ticket',
  {},
  { authorization: `Bearer ${projectGrant}` },
)
ok(r.status === 403, '멤버십 제거 후 기존 grant의 collab ticket 교환 거부')
await repo.addMember('projA', 'u1', 'user', boot.id)
r = await call('GET', '/projects/projA/members')
ok(r.status === 403, 'user 멤버관리 거부(403)')

// PM — 관리 권한 + 코드 면제
r = await call('POST', '/auth/login', { username: 'pm1', password: 'pw-pm' })
ok(r.status === 200, 'PM 로그인')
r = await call('GET', '/projects/projA/members')
ok(r.status === 200 && r.data.length === 2, 'PM 멤버 조회(2명)')
r = await call('POST', '/auth/projects/projA/enter', {})
ok(r.status === 200, 'PM: 담당 프로젝트 코드 면제 입장')

// PM 프로젝트 생성 — 자기 프로젝트 PM으로 자동 등록 + 코드 면제 입장
r = await call('POST', '/auth/projects', { name: 'PM새프로젝트' })
ok(r.status === 201 && !!r.data.project?.id, 'PM 새 프로젝트 생성(201)')
const pmProj = r.data?.project?.id
r = await call('GET', '/auth/projects')
ok(
  r.status === 200 && r.data.some((p) => p.id === pmProj && p.role === 'pm'),
  'PM 생성 프로젝트가 목록에 pm으로 노출',
)
r = await call('POST', `/auth/projects/${pmProj}/enter`, {})
ok(r.status === 200 && !!r.data.token, 'PM 생성 프로젝트 코드 면제 입장')

// user 는 프로젝트 생성 불가(403)
r = await call('POST', '/auth/login', { username: 'u1', password: 'pw-u' })
ok(r.status === 200, 'user 재로그인')
r = await call('POST', '/auth/projects', { name: '금지' })
ok(r.status === 403, 'user 프로젝트 생성 거부(403)')

// developer 프로젝트 생성(201)
r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
ok(r.status === 200, '개발자 재로그인')
r = await call('POST', '/auth/projects', { name: 'DEV프로젝트', division: 'water-res' })
ok(r.status === 201 && !!r.data.project?.id, '개발자 새 프로젝트 생성(201)')

// 셀프 등록 — 사용자 즉시 활성 / 관리자(PM) 개발자 승인 대기 + 본부 기반 격리
cookie = ''
r = await call('POST', '/auth/register', {
  name: '등록사용자',
  phone: '010-7777-0001',
  password: 'Pass12!@',
  role: 'user',
  division: 'road',
})
ok(r.status === 201 && r.data.pending === false, '사용자 셀프등록(즉시 활성)')
r = await call('POST', '/auth/login', { username: '010-7777-0001', password: 'Pass12!@' })
ok(r.status === 200 && r.data.user.division === 'road', '등록 사용자 로그인 + 본부 반영')
r = await call('GET', '/auth/projects')
ok(
  r.status === 200 && !r.data.some((p) => p.id === 'projA'),
  '다른 본부 사용자는 타 본부 프로젝트 미노출',
)
cookie = ''
r = await call('POST', '/auth/register', {
  name: '등록관리자',
  phone: '010-7777-0002',
  password: 'Pass12!@',
  role: 'pm',
  division: 'road',
})
ok(r.status === 201 && r.data.pending === true, '관리자 셀프등록(승인 대기)')
r = await call('POST', '/auth/login', { username: '010-7777-0002', password: 'Pass12!@' })
ok(r.status === 401, '승인 전 관리자 로그인 거부')
r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
r = await call('GET', '/admin/pending')
ok(
  r.status === 200 && r.data.some((u) => u.id === '01077770002'),
  '개발자 승인대기 목록 노출(알림)',
)
ok(
  typeof r.data.find((u) => u.id === '01077770002')?.requestedAt === 'number',
  '승인 대기 항목에 요청 시각(requestedAt) 포함',
)
r = await call('POST', '/admin/users/01077770002/approve', { approve: true })
ok(r.status === 200 && r.data.approved === true, '개발자 관리자 승인')
cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0002', password: 'Pass12!@' })
ok(r.status === 200 && r.data.user.role === 'pm', '승인 후 관리자 로그인')

// 사용자 삭제(개발자 전용) — 본인 삭제 금지 + 실제 삭제·멤버십 정리
r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
r = await call('DELETE', `/admin/users/${boot.id}`, {})
ok(r.status === 400, '개발자 본인 계정 삭제 거부(400)')
r = await call('DELETE', '/admin/users/010-7777-0001', {})
ok(
  r.status === 200 && (await repo.getUser('01077770001')) === null,
  '개발자 사용자 삭제(200) + 저장소 제거',
)

// ── 비밀번호 정책 · 초기화 요청 · 변경(신규) ──
cookie = ''
r = await call('POST', '/auth/register', {
  name: '약한암호',
  phone: '010-7777-0003',
  password: '123',
  role: 'user',
  division: 'road',
})
ok(r.status === 400, '약한 비밀번호 등록 거부(정책)')
r = await call('POST', '/auth/register', {
  name: '정상암호',
  phone: '010-7777-0003',
  password: 'Good12!@',
  role: 'user',
  division: 'road',
})
ok(r.status === 201, '정책 통과 비밀번호 등록(201)')
cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0003', password: 'Good12!@' })
ok(r.status === 200 && r.data.mustChangePassword === false, '정책 통과 로그인 — 강제변경 없음')

// 초기화 요청(공개) → 관리자 목록 → 관리자 새 비밀번호 지정 → 새 비밀번호 로그인
cookie = ''
r = await call('POST', '/auth/reset-request', { phone: '010-7777-0003' })
ok(r.status === 200, '비밀번호 초기화 요청 접수')
r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
r = await call('GET', '/admin/reset-requests')
ok(r.status === 200 && r.data.some((u) => u.id === '01077770003'), '초기화 요청 목록 노출')
ok(
  typeof r.data.find((u) => u.id === '01077770003')?.requestedAt === 'number',
  '초기화 요청 항목에 요청 시각(requestedAt) 포함',
)
r = await call('POST', '/admin/users/010-7777-0003/password', { password: 'ResetX9!' })
ok(r.status === 200, '관리자 새 비밀번호 지정(200)')
r = await call('GET', '/admin/reset-requests')
ok(r.status === 200 && !r.data.some((u) => u.id === '01077770003'), '지정 후 요청 목록에서 제거')
cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0003', password: 'ResetX9!' })
ok(r.status === 200, '관리자 지정 비밀번호로 로그인')

// 본인 비밀번호 변경 — 현재 비밀번호 검증 + 정책 + 새 비밀번호 로그인
r = await call('POST', '/auth/change-password', {
  currentPassword: 'Wrong9!x',
  newPassword: 'Newpw12!',
})
ok(r.status === 401, '현재 비밀번호 불일치 변경 거부(401)')
r = await call('POST', '/auth/change-password', {
  currentPassword: 'ResetX9!',
  newPassword: 'weak',
})
ok(r.status === 400, '약한 새 비밀번호 변경 거부(정책)')
r = await call('POST', '/auth/change-password', {
  currentPassword: 'ResetX9!',
  newPassword: 'Newpw12!',
})
ok(r.status === 200, '본인 비밀번호 변경(200)')
cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0003', password: 'Newpw12!' })
ok(r.status === 200, '변경된 비밀번호로 로그인')

// 구 정책(4자리) 비밀번호 사용자(roster 임포트) → 로그인 시 강제변경 플래그
cookie = ''
r = await call('POST', '/auth/login', {
  username: parsedRoster[0].username,
  password: parsedRoster[0].password,
})
ok(r.status === 200 && r.data.mustChangePassword === true, '구 정책 비밀번호 → 강제 변경 플래그')

// 멤버 추가용 사용자 검색 — 본부(division) 포함(본부별 인원 선택 UI용)
r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
r = await call('GET', '/users/searchable')
ok(
  r.status === 200 && r.data.every((u) => 'division' in u),
  '사용자 검색 결과에 division 포함',
)
ok(
  r.data.find((u) => u.id === '01077770003')?.division === 'road',
  '검색 결과 division 값 정확(road)',
)

// 비로그인 차단
cookie = ''
r = await call('GET', '/auth/me')
ok(r.status === 401, '비로그인 /auth/me 401')

server.close()
console.log(fail === 0 ? '\n✅ AUTH SMOKE PASS' : `\n❌ ${fail} FAIL`)
process.exit(fail ? 1 : 0)
