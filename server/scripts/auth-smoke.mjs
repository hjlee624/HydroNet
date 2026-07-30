// 인증/RBAC 통합 스모크 — 메모리 어댑터(Postgres 불필요)로 로그인·역할·엑셀임포트·접속코드·멤버십 검증.
// 실행: node server/scripts/auth-smoke.mjs
import express from 'express'
import * as XLSX from 'xlsx'
import { createMemoryRepo } from '../src/auth/repo.js'
import { createAuthRouter, bootstrapDeveloper } from '../src/auth/routes.js'

let fail = 0
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m)
  if (!c) fail++
}

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
  return { status: res.status, data }
}

let r = await call('POST', '/auth/login', { username: boot.id, password: boot.password })
ok(r.status === 200 && r.data.user.role === 'developer', '개발자 부트스트랩 로그인')
r = await call('GET', '/auth/me')
ok(r.status === 200 && r.data.user.id === boot.id, '세션 /auth/me')

// 엑셀(.xlsx) 사용자 임포트
const aoa = [
  ['username', 'name', 'role', 'password'],
  ['pm1', '피엠', 'pm', 'pw-pm'],
  ['u1', '사용자', 'user', 'pw-u'],
]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S')
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
r = await call('POST', '/admin/users/import', { fileBase64: buf.toString('base64') })
ok(r.status === 200 && r.data.imported === 2 && r.data.withPassword === 2, `엑셀 사용자 임포트 ${r.data?.imported}명`)

r = await call('POST', '/admin/projects', { id: 'projA', name: 'A댐', accessCode: 'code-A' })
ok(r.status === 200, '프로젝트 생성 + 접속코드')
r = await call('POST', '/projects/projA/members', { userId: 'pm1', role: 'pm' })
ok(r.status === 200, 'PM 멤버 추가')
r = await call('POST', '/projects/projA/members', { userId: 'u1', role: 'user' })
ok(r.status === 200, 'user 멤버 추가')
r = await call('POST', '/auth/projects/projA/enter', {})
ok(r.status === 200 && !!r.data.token, '개발자: 코드 없이 입장(전체 접근)')

// 사용자(user) — 접속코드 게이트
r = await call('POST', '/auth/login', { username: 'u1', password: 'pw-u' })
ok(r.status === 200 && r.data.user.role === 'user', 'user 로그인')
r = await call('GET', '/auth/projects')
ok(r.status === 200 && r.data.some((p) => p.id === 'projA'), 'user 접근가능 목록에 projA')
r = await call('POST', '/auth/projects/projA/enter', { code: 'wrong' })
ok(r.status === 401, 'user 잘못된 접속코드 거부(401)')
r = await call('POST', '/auth/projects/projA/enter', { code: 'code-A' })
ok(r.status === 200 && !!r.data.token && r.data.projRole === 'user', 'user 올바른 접속코드 → 입장+프로젝트토큰')
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
ok(r.status === 200 && r.data.some((p) => p.id === pmProj && p.role === 'pm'), 'PM 생성 프로젝트가 목록에 pm으로 노출')
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
r = await call('POST', '/auth/projects', { name: 'DEV프로젝트' })
ok(r.status === 201 && !!r.data.project?.id, '개발자 새 프로젝트 생성(201)')

// 비로그인 차단
cookie = ''
r = await call('GET', '/auth/me')
ok(r.status === 401, '비로그인 /auth/me 401')

server.close()
console.log(fail === 0 ? '\n✅ AUTH SMOKE PASS' : `\n❌ ${fail} FAIL`)
process.exit(fail ? 1 : 0)
