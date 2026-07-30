// 인증/RBAC 라우터 — 로그인·세션·프로젝트 목록·접속코드 입장·관리(엑셀 업로드·멤버). ADR-002.
import express from 'express'
import { hashSecret, verifySecret, signSession, signProjectToken, verifyToken } from './crypto.js'
import { importUsers } from './importUsers.js'
import {
  canAccessAll, canEnterProject, accessCodeExempt, canManageProject, canAdmin, isRole, PROJECT_ROLES,
} from './roles.js'

const COOKIE = 'hn_session'
const parseCookies = (req) => {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (res.headersSent) return
    res.status(e.status || 500).json({ error: e.expose ? e.message : '서버 오류' })
  })
const fail = (status, message, expose = true) => Object.assign(new Error(message), { status, expose })

/** createAuthRouter(repo, {secure}) → { router, requireAuth, requireProjectToken }. */
export function createAuthRouter(repo, opts = {}) {
  const secure = !!opts.secure
  const setSession = (res, token) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200${secure ? '; Secure' : ''}`)
  const clearSession = (res) =>
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`)
  const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role })

  // 세션 미들웨어: 쿠키 JWT 검증 → req.user(저장소 최신). 없으면 401.
  const authMw = async (req, res, next) => {
    try {
      const token = parseCookies(req)[COOKIE]
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
      const payload = await verifyToken(token, 'session').catch(() => null)
      if (!payload) return res.status(401).json({ error: '세션이 유효하지 않습니다.' })
      const user = await repo.getUser(payload.sub)
      if (!user || user.active === false) return res.status(401).json({ error: '유효하지 않은 계정입니다.' })
      req.user = user
      next()
    } catch (e) {
      res.status(500).json({ error: '서버 오류' })
    }
  }
  // 프로젝트 데이터 접근 게이트: developer 세션 OR :id에 대한 프로젝트 토큰(Bearer).
  const requireProjectToken = async (req, res, next) => {
    try {
      const projectId = req.params.id
      const cookieTok = parseCookies(req)[COOKIE]
      if (cookieTok) {
        const s = await verifyToken(cookieTok, 'session').catch(() => null)
        if (s) {
          const u = await repo.getUser(s.sub)
          if (u && canAccessAll(u)) { req.user = u; return next() } // 개발자 전체 접근
        }
      }
      const auth = req.headers.authorization || ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
      if (!bearer) return res.status(401).json({ error: '프로젝트 접속코드 인증이 필요합니다.' })
      const p = await verifyToken(bearer, 'project').catch(() => null)
      if (!p || p.projectId !== projectId) return res.status(403).json({ error: '이 프로젝트 접근 권한이 없습니다.' })
      req.projectGrant = p
      next()
    } catch {
      res.status(500).json({ error: '서버 오류' })
    }
  }
  const requireAdmin = (req, res, next) => (canAdmin(req.user) ? next() : res.status(403).json({ error: '개발자 권한이 필요합니다.' }))

  const router = express.Router()

  // ── 세션 ──
  router.post('/auth/login', wrap(async (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) throw fail(400, '아이디와 비밀번호를 입력하세요.')
    const user = await repo.getUser(String(username))
    const ok = user && user.active !== false && (await verifySecret(String(password), user.passwordHash))
    if (!ok) throw fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
    setSession(res, await signSession(user))
    res.json({ user: publicUser(user) })
  }))
  router.post('/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }) })
  router.get('/auth/me', authMw, (req, res) => res.json({ user: publicUser(req.user) }))

  // ── 접근 가능 프로젝트 목록 ──
  router.get('/auth/projects', authMw, wrap(async (req, res) => {
    const all = await repo.listProjects()
    let list
    if (canAccessAll(req.user)) {
      list = all.map((p) => ({ id: p.id, name: p.name, role: 'developer', hasCode: !!p.accessCodeHash }))
    } else {
      const mem = await repo.listMembershipsForUser(req.user.id)
      const byId = new Map(all.map((p) => [p.id, p]))
      list = mem.filter((m) => byId.has(m.projectId)).map((m) => {
        const p = byId.get(m.projectId)
        return { id: p.id, name: p.name, role: m.role, hasCode: !!p.accessCodeHash }
      })
    }
    res.json(list)
  }))

  // ── 프로젝트 입장(접속코드 검증 → 프로젝트 토큰) ──
  router.post('/auth/projects/:id/enter', authMw, wrap(async (req, res) => {
    const projectId = req.params.id
    const project = await repo.getProject(projectId)
    if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
    const membership = canAccessAll(req.user) ? { role: 'developer' } : await repo.getMembership(projectId, req.user.id)
    if (!canEnterProject(req.user, membership)) throw fail(403, '이 프로젝트 접근 권한이 없습니다.')
    if (!accessCodeExempt(req.user, membership)) {
      const code = String((req.body || {}).code || '')
      if (!project.accessCodeHash) throw fail(403, '이 프로젝트에 접속코드가 설정되지 않았습니다. 관리자에게 문의하세요.')
      if (!(await verifySecret(code, project.accessCodeHash))) throw fail(401, '접속코드가 올바르지 않습니다.')
    }
    const projRole = membership.role
    const token = await signProjectToken(req.user.id, projectId, projRole)
    res.json({ token, project: { id: project.id, name: project.name }, projRole })
  }))

  // ── 관리(개발자): 엑셀 업로드·사용자·프로젝트 ──
  router.post('/admin/users/import', authMw, requireAdmin, wrap(async (req, res) => {
    const b64 = (req.body || {}).fileBase64
    if (!b64) throw fail(400, '업로드 파일(fileBase64)이 없습니다.')
    const buffer = Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64')
    const result = await importUsers(repo, buffer)
    res.json({ ok: true, ...result })
  }))
  router.get('/admin/users', authMw, requireAdmin, wrap(async (_req, res) =>
    res.json((await repo.listUsers()).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active, hasPassword: !!u.passwordHash }))),
  ))
  router.post('/admin/users', authMw, requireAdmin, wrap(async (req, res) => {
    const { id, name, role, password, active } = req.body || {}
    if (!id || !isRole(role)) throw fail(400, 'id·role(developer|pm|user)이 필요합니다.')
    const passwordHash = password ? await hashSecret(String(password)) : undefined
    await repo.upsertUser({ id: String(id), name: name ?? '', role, active: active ?? true, ...(passwordHash ? { passwordHash } : {}) })
    res.json({ ok: true })
  }))
  router.post('/admin/projects', authMw, requireAdmin, wrap(async (req, res) => {
    const { id, name, accessCode } = req.body || {}
    if (!id) throw fail(400, '프로젝트 id가 필요합니다.')
    const accessCodeHash = accessCode ? await hashSecret(String(accessCode)) : undefined
    await repo.upsertProject({ id: String(id), name: name ?? '', createdBy: req.user.id, ...(accessCodeHash ? { accessCodeHash } : {}) })
    res.json({ ok: true })
  }))

  // ── 프로젝트 관리(PM·개발자): 멤버·접속코드 ──
  const manageMw = async (req, res, next) => {
    const membership = canAccessAll(req.user) ? { role: 'developer' } : await repo.getMembership(req.params.id, req.user.id)
    if (!canManageProject(req.user, membership)) return res.status(403).json({ error: '프로젝트 관리 권한(PM/개발자)이 필요합니다.' })
    next()
  }
  router.get('/projects/:id/members', authMw, manageMw, wrap(async (req, res) => {
    const members = await repo.listMembers(req.params.id)
    const users = new Map((await repo.listUsers()).map((u) => [u.id, u]))
    res.json(members.map((m) => ({ userId: m.userId, name: users.get(m.userId)?.name ?? '', role: m.role })))
  }))
  router.post('/projects/:id/members', authMw, manageMw, wrap(async (req, res) => {
    const { userId, role } = req.body || {}
    if (!userId || !PROJECT_ROLES.includes(role)) throw fail(400, 'userId·role(pm|user)이 필요합니다.')
    if (!(await repo.getUser(String(userId)))) throw fail(404, '사용자를 찾을 수 없습니다.')
    await repo.addMember(req.params.id, String(userId), role, req.user.id)
    res.json({ ok: true })
  }))
  router.delete('/projects/:id/members/:userId', authMw, manageMw, wrap(async (req, res) => {
    await repo.removeMember(req.params.id, req.params.userId)
    res.json({ ok: true })
  }))
  router.post('/projects/:id/access-code', authMw, manageMw, wrap(async (req, res) => {
    const code = String((req.body || {}).code || '')
    if (!code) throw fail(400, '접속코드를 입력하세요.')
    await repo.setProjectAccessCode(req.params.id, await hashSecret(code))
    res.json({ ok: true })
  }))

  return { router, requireAuth: authMw, requireProjectToken }
}

/** 최초 기동 시 사용자가 하나도 없으면 부트스트랩 개발자 계정 시드(env). */
export async function bootstrapDeveloper(repo) {
  const users = await repo.listUsers()
  if (users.length > 0) return null
  const id = process.env.AUTH_BOOTSTRAP_USER || 'admin'
  const pw = process.env.AUTH_BOOTSTRAP_PASSWORD || 'hydronet'
  await repo.upsertUser({ id, name: '초기 개발자', role: 'developer', passwordHash: await hashSecret(pw) })
  return { id, password: pw }
}
