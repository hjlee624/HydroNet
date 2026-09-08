// 인증/RBAC 통합 스모크 — 메모리 어댑터(Postgres 불필요)로 로그인·역할·엑셀임포트·접속코드·멤버십 검증.
// 실행: node server/scripts/auth-smoke.mjs

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import * as XLSX from 'xlsx'
import { hashSecret, verifySecret, verifyToken } from '../src/auth/crypto.js'
import { importUsers, parseRosterFile, UserImportValidationError } from '../src/auth/importUsers.js'
import { createPgRepo } from '../src/auth/pgRepo.js'
import { canonicalPhoneId, formatPhoneId, normalizeLoginId } from '../src/auth/phone.js'
import { createMemoryRepo } from '../src/auth/repo.js'
import { bootstrapDeveloper, createAuthRouter } from '../src/auth/routes.js'
import { buildAccessRequestText } from '../src/notify/works.js'
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
ok(r.status === 200 && r.data.every((u) => 'division' in u), '사용자 검색 결과에 division 포함')
ok(
  r.data.find((u) => u.id === '01077770003')?.division === 'road',
  '검색 결과 division 값 정확(road)',
)

// ── F07 프로젝트 접근 요청(요청 → 대기 → 승인/거절 → 만료) ────────────────────
// 핵심 계약: **요청은 접근이 아니다.** 승인(멤버십 생성) 전까지 /enter 는 계속 403.
// 이 블록은 메모리(파일) 어댑터를 실제로 돌린다. pg 어댑터는 아래에서 인터페이스 동형만 확인.
cookie = ''
r = await call('POST', '/auth/register', {
  name: '미배정사용자',
  phone: '010-8888-0001',
  password: 'Pass12!@',
  role: 'user',
  division: 'water-res',
})
ok(r.status === 201, '같은 본부 미배정 사용자 등록')
r = await call('POST', '/auth/login', { username: '010-8888-0001', password: 'Pass12!@' })
ok(r.status === 200, '미배정 사용자 로그인')
const unassignedCookie = cookie

r = await call('GET', '/auth/projects')
const projACard = r.data?.find?.((p) => p.id === 'projA')
ok(
  r.status === 200 && projACard && projACard.canEnter === false && projACard.canEdit === false,
  '미배정 사용자 목록에 projA 노출 + canEnter=false',
)

r = await call('GET', '/auth/projects/projA/contacts')
const contactsJson = JSON.stringify(r.data ?? {})
ok(
  r.status === 200 && r.data.managers.some((m) => m.name === '피엠' && m.role === 'pm'),
  '입장 불가 화면 담당자 조회 — 담당 PM 이름 노출',
)
ok(
  !/\d{11}|\d{3}-\d{4}-\d{4}/.test(contactsJson),
  '담당자 응답에 전화번호(로그인 ID) 미포함(개인정보 최소화)',
)

cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0003', password: 'Newpw12!' })
ok(r.status === 200, '타 본부(road) 사용자 로그인')
r = await call('GET', '/auth/projects/projA/contacts')
ok(r.status === 403, '타 본부 사용자 담당자 조회 거부(403) — 본부 경계 유지')

cookie = unassignedCookie
r = await call('POST', '/auth/projects/projA/access-request', { reason: '공정표 작성 담당입니다.' })
ok(r.status === 201 && r.data.request?.status === 'pending', '접근 요청 접수(201·대기)')
const firstRequestId = r.data?.request?.id
r = await call('POST', '/auth/projects/projA/access-request', { reason: '중복' })
ok(r.status === 409, '대기 중 중복 요청 거부(409)')

// ★ 핵심 회귀 방어선: 대기 중 요청은 입장을 절대 열지 않는다.
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(r.status === 403, '대기 중 요청 상태에서도 /enter 403 (요청 ≠ 접근)')
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 && r.data.mine.length === 1 && r.data.mine[0].status === 'pending',
  '요청자 본인 목록에 대기 상태 노출',
)

cookie = ''
r = await call('POST', '/auth/login', { username: 'pm1', password: 'pw-pm' })
r = await call('GET', '/auth/access-requests')
const incoming = r.data?.incoming?.find?.((x) => x.id === firstRequestId)
ok(
  r.status === 200 &&
    incoming &&
    incoming.userName === '미배정사용자' &&
    typeof incoming.requestedAt === 'number' &&
    typeof incoming.expiresAt === 'number' &&
    incoming.expiresAt > incoming.requestedAt,
  '담당 PM 처리 목록에 요청자·요청시각·만료시각 노출',
)
const pmCookie = cookie

cookie = ''
r = await call('POST', '/auth/login', { username: '010-7777-0002', password: 'Pass12!@' })
r = await call('POST', `/auth/access-requests/${firstRequestId}/decide`, { approve: true })
ok(r.status === 403, '무관한 제3자 PM 의 승인 거부(403)')
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 && r.data.incoming.length === 0,
  '무관한 PM 의 처리 목록은 비어 있음(권한 범위)',
)

cookie = pmCookie
r = await call('POST', `/auth/access-requests/${firstRequestId}/decide`, {})
ok(r.status === 400, '거절 사유 없는 처리 거부(400)')
r = await call('POST', `/auth/access-requests/${firstRequestId}/decide`, {
  approve: false,
  decisionReason: '해당 공구 담당이 아닙니다.',
})
ok(r.status === 200 && r.data.status === 'rejected', '담당 PM 거절 처리(200)')

cookie = unassignedCookie
r = await call('GET', '/auth/access-requests')
const rejected = r.data?.mine?.find?.((x) => x.id === firstRequestId)
ok(
  rejected?.status === 'rejected' &&
    rejected.decidedBy === 'pm1' &&
    rejected.decidedByName === '피엠' &&
    typeof rejected.decidedAt === 'number' &&
    rejected.decisionReason === '해당 공구 담당이 아닙니다.',
  '거절 기록 — 승인자·처리시각·거절 사유 영속',
)
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(r.status === 403, '거절 후에도 /enter 403')

r = await call('POST', '/auth/projects/projA/access-request', { reason: '담당 확인했습니다.' })
ok(r.status === 201, '거절 후 재요청 허용(201)')
const secondRequestId = r.data?.request?.id
cookie = pmCookie
r = await call('POST', `/auth/access-requests/${secondRequestId}/decide`, { approve: true })
ok(r.status === 200 && r.data.status === 'approved', '담당 PM 승인 처리(200)')

cookie = unassignedCookie
r = await call('GET', '/auth/projects')
const grantedCard = r.data?.find?.((p) => p.id === 'projA')
ok(
  grantedCard?.canEnter === true && grantedCard?.canEdit === true,
  '승인 후 목록 canEnter/canEdit=true',
)
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(r.status === 200 && !!r.data.token, '승인 후 /enter 200 — 승인만이 접근을 만든다')
r = await call('POST', '/auth/projects/projA/access-request', { reason: '이미 멤버' })
ok(r.status === 400, '이미 배정된 프로젝트 재요청 거부(400)')

// 만료 — 기한이 지난 대기 요청은 목록에서 'expired', 처리 시 409.
cookie = ''
r = await call('POST', '/auth/register', {
  name: '만료요청자',
  phone: '010-8888-0002',
  password: 'Pass12!@',
  role: 'user',
  division: 'water-res',
})
ok(r.status === 201, '만료 검증용 사용자 등록')
const expiredNow = Date.now()
await repo.createAccessRequest({
  id: 'ar_expired_test',
  projectId: 'projA',
  userId: '01088880002',
  reason: '기한 경과 요청',
  status: 'pending',
  requestedAt: expiredNow - 8 * 24 * 3600 * 1000,
  expiresAt: expiredNow - 24 * 3600 * 1000,
})
r = await call('POST', '/auth/login', { username: '010-8888-0002', password: 'Pass12!@' })
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 && r.data.mine.find((x) => x.id === 'ar_expired_test')?.status === 'expired',
  '기한 지난 요청은 읽기 시점에 expired 로 표기',
)
cookie = pmCookie
// 저장 status 가 아직 'pending' 인 시점에도 처리 목록에서는 빠져야 한다(만료 기준 필터).
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 && !r.data.incoming.some((x) => x.id === 'ar_expired_test'),
  '기한 지난 요청은 담당 PM 처리 목록에서 제외(저장 status 가 pending 이어도)',
)
r = await call('POST', '/auth/access-requests/ar_expired_test/decide', { approve: true })
ok(r.status === 409, '만료된 요청 승인 거부(409)')
ok(
  (await repo.getAccessRequest('ar_expired_test'))?.status === 'expired',
  '만료 요청 결재 시도 시 저장 status 를 expired 로 확정(큐 자가 정리)',
)
r = await call('POST', '/auth/projects/projA/enter', {})
cookie = ''
r = await call('POST', '/auth/login', { username: '010-8888-0002', password: 'Pass12!@' })
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(r.status === 403, '만료 요청자는 여전히 입장 불가(403)')

// ★ 회귀 방어선(C1): 만료가 막다른 골목이 되면 안 된다. 담당자 부재로 요청이 한 번 지나간
// 사용자는 재요청으로 다시 줄을 설 수 있어야 한다(F07 완료 기준 — 문의 없이 첫 프로젝트 도달).
r = await call('POST', '/auth/projects/projA/access-request', {
  reason: '기한이 지나 다시 요청합니다.',
})
ok(
  r.status === 201 && r.data.request?.status === 'pending',
  '만료 후 재요청 허용(201) — 영구 잠금 없음',
)
const renewedRequestId = r.data?.request?.id
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 &&
    r.data.mine.find((x) => x.id === 'ar_expired_test')?.status === 'expired' &&
    r.data.mine.find((x) => x.id === renewedRequestId)?.status === 'pending',
  '만료 이력은 남고 새 요청만 대기 상태',
)
cookie = pmCookie
r = await call('GET', '/auth/access-requests')
ok(
  r.status === 200 &&
    r.data.incoming.some((x) => x.id === renewedRequestId) &&
    !r.data.incoming.some((x) => x.id === 'ar_expired_test'),
  '재요청만 담당 PM 처리 목록에 노출(만료 행은 제외)',
)

// ★ 실제 사고 시나리오: 담당자가 자리를 비워 **아무도 결재하지 않은 채** 기한만 지난 요청.
// 위 케이스는 decide(409) 가 만료를 저장에 확정한 뒤 재요청했지만, 여기선 그 손길조차 없다 —
// 저장소가 만료를 스스로 인정하지 않으면 사용자는 그 프로젝트에 영영 도달하지 못한다.
// 접근 요청 라우트는 IP당 5회/10분 제한이라 위 케이스로 예산이 찼다. 같은 repo 를 쓰는 별도
// 라우터/서버(=별도 카운터)에서 돌려 제한이 아니라 만료 로직을 재는 테스트로 만든다.
{
  const { router: router2 } = createAuthRouter(repo, { secure: false })
  const app2 = express()
  app2.use(express.json({ limit: '8mb' }))
  app2.use('/api', router2)
  const server2 = app2.listen(0)
  await new Promise((done) => server2.once('listening', done))
  const base2 = `http://127.0.0.1:${server2.address().port}/api`
  let cookie2 = ''
  const call2 = async (method, p, body) => {
    const res2 = await fetch(base2 + p, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie2 ? { cookie: cookie2 } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const sc = res2.headers.get('set-cookie')
    if (sc) cookie2 = sc.split(';')[0]
    let data = null
    try {
      data = await res2.json()
    } catch {}
    return { status: res2.status, data }
  }
  try {
    let r2 = await call2('POST', '/auth/register', {
      name: '방치요청자',
      phone: '010-8888-0003',
      password: 'Pass12!@',
      role: 'user',
      division: 'water-res',
    })
    ok(r2.status === 201, '방치 시나리오용 사용자 등록')
    await repo.createAccessRequest({
      id: 'ar_abandoned',
      projectId: 'projA',
      userId: '01088880003',
      reason: '담당자 부재로 방치된 요청',
      status: 'pending',
      requestedAt: expiredNow - 8 * 24 * 3600 * 1000,
      expiresAt: expiredNow - 24 * 3600 * 1000,
    })
    r2 = await call2('POST', '/auth/login', { username: '010-8888-0003', password: 'Pass12!@' })
    ok(r2.status === 200, '방치 요청자 로그인')
    r2 = await call2('POST', '/auth/projects/projA/access-request', {
      reason: '아무도 처리하지 않아 다시 요청합니다.',
    })
    ok(
      r2.status === 201,
      '아무도 결재하지 않은 만료 요청도 재요청 허용(201) — 저장소가 만료를 인정',
    )
    ok(
      (await repo.getAccessRequest('ar_abandoned'))?.status === 'expired',
      '재요청 시 방치된 만료 행이 expired 로 확정(대기 행 중복 없음)',
    )
    const stillPending = (await repo.listAccessRequests()).filter(
      (x) => x.projectId === 'projA' && x.userId === '01088880003' && x.status === 'pending',
    )
    ok(stillPending.length === 1, '같은 프로젝트·사용자 대기 요청은 여전히 하나만')
  } finally {
    server2.close()
  }
}

// ★ 회귀 방어선(C2): 개발자는 미배정 프로젝트에도 본인 요청을 만들 수 있고(멤버십 검사만 통과)
// 결재 권한은 canAccessAll 로 항상 있다 → 자기결재가 실제로 가능한 경로다.
// 권한 상승은 아니지만 '요청자·승인자' 감사 기록이 한 사람으로 무너진다.
cookie = developerCookie
r = await call('POST', '/auth/projects/projA/access-request', { reason: '개발자 본인 요청' })
ok(r.status === 201, '개발자(미배정)도 접근 요청 생성 가능 — 자기결재 경로가 실재함')
const selfRequestId = r.data?.request?.id
r = await call('POST', `/auth/access-requests/${selfRequestId}/decide`, { approve: true })
ok(r.status === 403 && /본인 요청/.test(r.data?.error ?? ''), '본인 요청 자기 승인 거부(403)')
r = await call('POST', `/auth/access-requests/${selfRequestId}/decide`, {
  approve: false,
  decisionReason: '자기 거절도 금지',
})
ok(r.status === 403, '본인 요청 자기 거절도 거부(403) — 승인·거절 모두 제3자만')
ok((await repo.getMembership('projA', boot.id)) === null, '자기 승인 차단 후 멤버십도 생기지 않음')
cookie = pmCookie
r = await call('POST', `/auth/access-requests/${selfRequestId}/decide`, {
  approve: false,
  decisionReason: '개발자는 이미 전체 접근 권한이 있습니다.',
})
ok(
  r.status === 200 && r.data.status === 'rejected',
  '같은 요청도 제3자(담당 PM)는 정상 처리(200) — 차단이 자기결재에만 걸림',
)

// 비로그인 접근 요청 라우트 차단
cookie = ''
r = await call('POST', '/auth/projects/projA/access-request', { reason: 'x' })
ok(r.status === 401, '비로그인 접근 요청 401')
r = await call('GET', '/auth/access-requests')
ok(r.status === 401, '비로그인 접근 요청 목록 401')

// 메모리(파일) 어댑터 영속 — 요청자·승인자·만료·사유가 JSON 재적재 후에도 남는가.
{
  const arFile = path.join(os.tmpdir(), `seq-auth-smoke-${process.pid}.json`)
  try {
    const fileRepo = createMemoryRepo(arFile)
    await fileRepo.upsertUser({ id: 'ar_u', name: '요청자', role: 'user', division: 'road' })
    await fileRepo.upsertUser({ id: 'ar_pm', name: '결재자', role: 'pm', division: 'road' })
    await fileRepo.upsertProject({ id: 'ar_p', name: '요청대상', division: 'road' })
    await fileRepo.upsertProject({ id: 'ar_p2', name: '요청대상2', division: 'road' })
    // 기한이 남은(살아 있는) 대기 요청이어야 중복이 막힌다 — 만료 행은 아래에서 따로 검증.
    const arNow = Date.now()
    const arLive = arNow + 7 * 24 * 3600 * 1000
    await fileRepo.createAccessRequest({
      id: 'ar_1',
      projectId: 'ar_p',
      userId: 'ar_u',
      reason: '사유',
      status: 'pending',
      requestedAt: arNow,
      expiresAt: arLive,
    })
    let dup = null
    await fileRepo
      .createAccessRequest({
        id: 'ar_2',
        projectId: 'ar_p',
        userId: 'ar_u',
        reason: '중복',
        status: 'pending',
        requestedAt: arNow + 1,
        expiresAt: arLive + 1,
      })
      .catch((e) => {
        dup = e
      })
    ok(dup?.code === 'conflict', 'repo.js: 같은 프로젝트·사용자 대기 요청 중복 차단(conflict)')

    // ★ 만료된 대기 행은 재요청을 막지 않는다 — 막으면 사용자가 그 프로젝트에 영영 못 간다.
    await fileRepo.createAccessRequest({
      id: 'ar_stale',
      projectId: 'ar_p2',
      userId: 'ar_u',
      reason: '기한 경과',
      status: 'pending',
      requestedAt: arNow - 8 * 24 * 3600 * 1000,
      expiresAt: arNow - 24 * 3600 * 1000,
    })
    let renewed = null
    let renewErr = null
    await fileRepo
      .createAccessRequest({
        id: 'ar_fresh',
        projectId: 'ar_p2',
        userId: 'ar_u',
        reason: '재요청',
        status: 'pending',
        requestedAt: arNow,
        expiresAt: arLive,
      })
      .then((row) => {
        renewed = row
      })
      .catch((e) => {
        renewErr = e
      })
    ok(
      renewErr === null && renewed?.id === 'ar_fresh',
      'repo.js: 만료된 대기 요청이 있어도 재요청 허용(conflict 아님)',
    )
    ok(
      (await fileRepo.getAccessRequest('ar_stale'))?.status === 'expired',
      'repo.js: 재요청 시 만료 행 status 를 expired 로 확정(표시용 아님)',
    )
    await fileRepo.resolveAccessRequest('ar_1', {
      status: 'rejected',
      decidedBy: 'ar_pm',
      decidedAt: 1500,
      decisionReason: '범위 밖',
    })
    const reloaded = await createMemoryRepo(arFile).getAccessRequest('ar_1')
    ok(
      reloaded?.userId === 'ar_u' &&
        reloaded.decidedBy === 'ar_pm' &&
        reloaded.decidedAt === 1500 &&
        reloaded.expiresAt === arLive &&
        reloaded.decisionReason === '범위 밖' &&
        reloaded.status === 'rejected',
      'repo.js: 요청자·승인자·만료·거절사유 파일 영속 왕복',
    )
    const afterProjectDelete = createMemoryRepo(arFile)
    await afterProjectDelete.deleteProject('ar_p')
    const leftover = await afterProjectDelete.listAccessRequests()
    ok(
      leftover.every((x) => x.projectId !== 'ar_p') &&
        leftover.some((x) => x.projectId === 'ar_p2'),
      'repo.js: 프로젝트 삭제 시 해당 프로젝트 접근 요청만 정리(pg CASCADE 와 동일)',
    )
  } finally {
    fs.rmSync(arFile, { force: true })
  }
}

// pg 어댑터 동형성 — 라우트는 어댑터 무관 전제(repo.js:1-12)라 한쪽만 있으면 운영에서 크래시.
{
  const pgRepo = createPgRepo('postgres://unused:unused@127.0.0.1:1/none')
  try {
    const memoryRepo = createMemoryRepo(null)
    const required = [
      'createAccessRequest',
      'listAccessRequests',
      'getAccessRequest',
      'resolveAccessRequest',
    ]
    ok(
      required.every((m) => typeof pgRepo[m] === 'function' && typeof memoryRepo[m] === 'function'),
      'pgRepo.js/repo.js 양쪽에 접근 요청 4개 메서드 구현(연결 없이 시그니처 확인)',
    )
    // 만료 확정 규칙은 두 어댑터가 같아야 한다. pg 는 여기서 연결할 수 없으므로 쿼리문으로 확인 —
    // 삽입 전 같은 트랜잭션에서 기한 지난 대기 행을 expired 로 바꾸는가.
    const pgCreateSrc = pgRepo.createAccessRequest.toString()
    ok(
      /BEGIN/.test(pgCreateSrc) &&
        /COMMIT/.test(pgCreateSrc) &&
        /status='expired'/.test(pgCreateSrc) &&
        /expires_at <= \$3/.test(pgCreateSrc),
      'pgRepo.js: 삽입과 같은 트랜잭션에서 만료 행 확정(연결 없이 쿼리문 확인)',
    )
    // 'expired' 가 CHECK 제약에 없으면 pg 운영에서 만료 쓰기가 전부 실패한다(신규+기존 DB 양쪽).
    const schemaSql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
    ok(
      (schemaSql.match(/status IN \('pending','approved','rejected','expired'\)/g) ?? []).length >=
        2,
      "schema.sql: access_requests.status 'expired' 허용 — 신규 정의 + 기존 DB 마이그레이션",
    )
  } finally {
    await pgRepo.pool.end().catch(() => {})
  }
}

// 알림 본문(순수 함수) — 승인 전까지 차단된다는 사실을 담당자에게 그대로 전달한다.
{
  const text = buildAccessRequestText({
    projectName: 'A댐',
    division: 'water-res',
    name: '미배정사용자',
    id: '01088880001',
    role: 'user',
    reason: '공정표 작성 담당입니다.',
  })
  ok(
    text.includes('A댐') &&
      text.includes('수자원본부') &&
      text.includes('010-8888-0001') &&
      text.includes('승인 전까지 입장은 계속 차단됩니다'),
    '접근 요청 알림 본문에 프로젝트·요청자·차단 사실 포함',
  )
}

// 비로그인 차단
cookie = ''
r = await call('GET', '/auth/me')
ok(r.status === 401, '비로그인 /auth/me 401')

server.close()
console.log(fail === 0 ? '\n✅ AUTH SMOKE PASS' : `\n❌ ${fail} FAIL`)
process.exit(fail ? 1 : 0)
