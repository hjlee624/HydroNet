// 인증/RBAC 라우터 — 로그인·세션·프로젝트 목록·접속코드 입장·관리(엑셀 업로드·멤버). ADR-002.
import express from 'express'
import { nanoid } from 'nanoid'
import {
  notifyAccessRequestSafe,
  notifyProjectCreatedSafe,
  notifyProjectDeletedSafe,
  notifyRegistrationSafe,
  notifyResetRequestSafe,
  sendTestNotification,
} from '../notify/works.js'
import { createBoundedRateLimiter } from '../security.js'
import {
  hashSecret,
  signCollabToken,
  signProjectToken,
  signSession,
  verifySecret,
  verifyToken,
} from './crypto.js'
import { importUsers } from './importUsers.js'
import { validatePassword } from './password.js'
import { normalizeLoginId } from './phone.js'
import {
  accessCodeExempt,
  canAccessAll,
  canAdmin,
  canCreateProject,
  canEditProjectDiv,
  canEnterProjectDiv,
  canManageProject,
  canSeeProject,
  isDeveloper,
  isDivision,
  isRole,
  PROJECT_ROLES,
  sameDivision,
} from './roles.js'

/** F07: 접근 요청 유효기간(7일). 만료는 읽기 시점에 계산한다(백그라운드 잡 없음). */
const ACCESS_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 저장된 status + 만료 시각으로 실제 상태를 정한다. pending 인데 기한이 지났으면 expired.
 *  만료는 저장에도 확정되지만(재요청/결재 시), 확정 전 조회까지 덮도록 읽기에서도 계산한다. */
const effectiveRequestStatus = (r, now = Date.now()) =>
  r.status === 'pending' && Number(r.expiresAt) <= now ? 'expired' : r.status

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
const fail = (status, message, expose = true) =>
  Object.assign(new Error(message), { status, expose })

/** createAuthRouter(repo, {secure}) → { router, requireAuth, requireProjectToken }. */
export function createAuthRouter(repo, opts = {}) {
  const secure = !!opts.secure
  // #14: 멤버/역할·계정 상태 변경 시 '이미 열린' collab 연결을 강제 절단(늦은 바인딩).
  // collab 서버가 아직 안 붙었거나(테스트) 훅이 없으면 조용히 무시 — best-effort.
  const collab = opts.collab
  const revokeProjectAccess = (projectId, userId) => {
    try {
      collab?.revokeProjectAccess?.(projectId, userId)
    } catch {
      /* best-effort: 절단 실패가 API 응답을 막지 않게 */
    }
  }
  const revokeUser = (userId) => {
    try {
      collab?.revokeUser?.(userId)
    } catch {
      /* best-effort */
    }
  }
  const loginLimit = {
    maxFailures: opts.loginRateLimit?.maxFailures ?? 5,
    lockMs: opts.loginRateLimit?.lockMs ?? 15 * 60 * 1000,
    maxTracked: opts.loginRateLimit?.maxTracked ?? 10_000,
  }
  const loginAttempts = new Map()
  let loginAttemptOps = 0
  // 비밀번호 초기화 요청 남용 방지(IP당 5회/10분) — 알림 DoS·전화번호 열거 완화.
  const resetLimiter = createBoundedRateLimiter({
    limit: 5,
    windowMs: 10 * 60 * 1000,
    maxTracked: 5000,
  })
  // F07: 접근 요청 남용 방지(IP당 5회/10분) — 담당자 알림 DoS 완화. reset 과 같은 정책.
  const accessRequestLimiter = createBoundedRateLimiter({
    limit: 5,
    windowMs: 10 * 60 * 1000,
    maxTracked: 5000,
  })
  const setSession = (res, token) =>
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200${secure ? '; Secure' : ''}`,
    )
  const clearSession = (res) =>
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
    )
  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    division: u.division ?? null,
  })
  const attemptKey = (req, userId) =>
    `${req.socket?.remoteAddress || req.ip || 'unknown'}\0${userId}`
  const cleanupLoginAttempts = (now) => {
    loginAttemptOps++
    if (loginAttemptOps % 100 !== 0 && loginAttempts.size <= loginLimit.maxTracked) return
    for (const [key, value] of loginAttempts) {
      if (value.lockedUntil <= now && now - value.updatedAt >= loginLimit.lockMs)
        loginAttempts.delete(key)
    }
    while (loginAttempts.size > loginLimit.maxTracked) {
      const oldest = loginAttempts.keys().next().value
      if (oldest == null) break
      loginAttempts.delete(oldest)
    }
  }
  const rejectLockedLogin = (res, lockedUntil, now) => {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((lockedUntil - now) / 1000))))
    // locked:true — 클라이언트가 '비밀번호 초기화 요청' UI를 노출하도록.
    res
      .status(429)
      .json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', locked: true })
  }
  // 특정 사용자에 대한 로그인 실패/잠금 기록 해제(비밀번호 재설정·변경 시 즉시 잠금 풀기).
  const clearLockout = (userId) => {
    const suffix = `\0${userId}`
    for (const key of loginAttempts.keys()) if (key.endsWith(suffix)) loginAttempts.delete(key)
  }

  // 세션 미들웨어: 쿠키 JWT 검증 → req.user(저장소 최신). 없으면 401.
  const authMw = async (req, res, next) => {
    try {
      const token = parseCookies(req)[COOKIE]
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
      const payload = await verifyToken(token, 'session').catch(() => null)
      if (!payload) return res.status(401).json({ error: '세션이 유효하지 않습니다.' })
      const user = await repo.getUser(payload.sub)
      if (!user || user.active === false)
        return res.status(401).json({ error: '유효하지 않은 계정입니다.' })
      req.user = user
      next()
    } catch {
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
          if (u && u.active !== false && canAccessAll(u)) {
            req.user = u
            return next()
          } // 개발자 전체 접근
        }
      }
      const auth = req.headers.authorization || ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
      if (!bearer) return res.status(401).json({ error: '프로젝트 접속코드 인증이 필요합니다.' })
      const p = await verifyToken(bearer, 'project').catch(() => null)
      if (!p || p.projectId !== projectId)
        return res.status(403).json({ error: '이 프로젝트 접근 권한이 없습니다.' })
      const user = await repo.getUser(p.sub)
      if (!user || user.active === false)
        return res.status(401).json({ error: '유효하지 않은 계정입니다.' })
      const project = await repo.getProject(projectId)
      if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' })
      // 비활성화된 프로젝트는 개발자만(관리·복구용). POST /auth/projects/:id/enter 와 같은 기준.
      // 예전엔 이 게이트가 project.active 를 보지 않아, 비활성화 **전에** 발급된 12시간짜리
      // project grant 로 collab-ticket 을 계속 새로 발급받아 CRDT 방을 편집할 수 있었다.
      if (!canAccessAll(user) && project.active === false)
        return res.status(403).json({ error: '비활성화된 프로젝트입니다.' })
      const membership = canAccessAll(user)
        ? { role: 'developer' }
        : await repo.getMembership(projectId, user.id)
      if (!canEnterProjectDiv(user, project, membership))
        return res.status(403).json({ error: '이 프로젝트 접근 권한이 없습니다.' })
      req.user = user
      req.projectGrant = {
        ...p,
        projRole: membership?.role ?? user.role,
        canEdit: canEditProjectDiv(user, project, membership),
      }
      next()
    } catch {
      res.status(500).json({ error: '서버 오류' })
    }
  }
  const requireAdmin = (req, res, next) =>
    canAdmin(req.user) ? next() : res.status(403).json({ error: '개발자 권한이 필요합니다.' })
  /** PM 또는 개발자 세션인지 확인 — 멤버 추가를 위한 사용자 검색용. */
  const requireManagerSession = (req, res, next) =>
    isDeveloper(req.user) || req.user?.role === 'pm'
      ? next()
      : res.status(403).json({ error: '관리자(PM) 이상 권한이 필요합니다.' })

  const router = express.Router()

  // ── 세션 ──
  router.post(
    '/auth/login',
    wrap(async (req, res) => {
      const { username, password } = req.body || {}
      if (!username || !password) throw fail(400, '아이디와 비밀번호를 입력하세요.')
      const userId = normalizeLoginId(username)
      const key = attemptKey(req, userId)
      const now = Date.now()
      cleanupLoginAttempts(now)
      let previous = loginAttempts.get(key)
      if (previous?.lockedUntil && previous.lockedUntil <= now) {
        loginAttempts.delete(key)
        previous = null
      }
      if (previous?.lockedUntil > now) return rejectLockedLogin(res, previous.lockedUntil, now)

      const user = await repo.getUser(userId)
      const ok =
        user && user.active !== false && (await verifySecret(String(password), user.passwordHash))
      if (!ok) {
        const failures = (previous?.failures ?? 0) + 1
        const lockedUntil = failures >= loginLimit.maxFailures ? now + loginLimit.lockMs : 0
        loginAttempts.set(key, { failures, lockedUntil, updatedAt: now })
        cleanupLoginAttempts(now)
        if (lockedUntil) return rejectLockedLogin(res, lockedUntil, now)
        throw fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
      }
      loginAttempts.delete(key)
      // 구 정책 비밀번호(4자리 등 신 정책 미충족)면 다음 단계에서 강제 변경 유도. 로그인 자체는 성공.
      const mustChangePassword = !!user.mustChangePassword || !validatePassword(password).ok
      if (mustChangePassword && !user.mustChangePassword)
        await repo.upsertUser({ ...user, mustChangePassword: true })
      setSession(res, await signSession(user))
      res.json({ user: publicUser(user), mustChangePassword })
    }),
  )
  router.post('/auth/logout', (_req, res) => {
    clearSession(res)
    res.json({ ok: true })
  })
  router.get('/auth/me', authMw, (req, res) =>
    res.json({ user: publicUser(req.user), mustChangePassword: !!req.user.mustChangePassword }),
  )

  // ── 비밀번호 변경(로그인 본인) — 강제 변경(mustChangePassword) 시 현재 비밀번호 확인 생략. ──
  router.post(
    '/auth/change-password',
    authMw,
    wrap(async (req, res) => {
      const { currentPassword, newPassword } = req.body || {}
      const u = await repo.getUser(req.user.id)
      if (!u) throw fail(404, '사용자를 찾을 수 없습니다.')
      // 강제 변경 상태는 이미 세션 인증됨 → 현재 비밀번호 재확인 생략. 그 외엔 현재 비밀번호 검증.
      if (
        !u.mustChangePassword &&
        !(await verifySecret(String(currentPassword || ''), u.passwordHash))
      )
        throw fail(401, '현재 비밀번호가 올바르지 않습니다.')
      const chk = validatePassword(newPassword)
      if (!chk.ok) throw fail(400, chk.reason)
      await repo.upsertUser({
        ...u,
        passwordHash: await hashSecret(String(newPassword)),
        mustChangePassword: false,
        resetRequested: false,
      })
      clearLockout(u.id)
      res.json({ ok: true })
    }),
  )

  // ── 비밀번호 초기화 요청(공개) — 5회 잠금 등으로 로그인 못할 때. 관리자에게 알림 + 요청 플래그. ──
  router.post(
    '/auth/reset-request',
    wrap(async (req, res) => {
      const id = normalizeLoginId(String(req.body?.phone || ''))
      if (!/^010\d{8}$/.test(id)) throw fail(400, '전화번호(010########)를 정확히 입력하세요.')
      const rl = resetLimiter.consume(req.socket?.remoteAddress || req.ip || 'unknown')
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfter))
        throw fail(429, '초기화 요청이 너무 많습니다. 잠시 후 다시 시도하세요.')
      }
      const u = await repo.getUser(id)
      // 계정 존재 여부와 무관하게 동일 응답(존재 노출 방지). 존재할 때만 플래그·알림.
      // 알림은 await 안 함(fire-and-forget) — 응답 지연으로 계정 존재를 유추 못 하게.
      if (u) {
        await repo.upsertUser({ ...u, resetRequested: true, resetRequestedAt: Date.now() })
        void notifyResetRequestSafe({ name: u.name, id, role: u.role, division: u.division }).catch(
          () => {},
        )
      }
      res.json({ ok: true })
    }),
  )

  // ── 셀프 등록(공개) — 관리자(PM)/사용자 + 본부 선택. 사용자는 즉시 활성, PM은 개발자 승인 대기. ──
  router.post(
    '/auth/register',
    wrap(async (req, res) => {
      const { name, phone, password, role, division } = req.body || {}
      const id = normalizeLoginId(String(phone || ''))
      if (!/^010\d{8}$/.test(id)) throw fail(400, '전화번호(010########)를 정확히 입력하세요.')
      const pwChk = validatePassword(password)
      if (!pwChk.ok) throw fail(400, pwChk.reason)
      if (role !== 'pm' && role !== 'user') throw fail(400, '역할(관리자/사용자)을 선택하세요.')
      if (!isDivision(division)) throw fail(400, '본부를 선택하세요.')
      const isPm = role === 'pm'
      // #38: 검사→삽입 사이 TOCTOU 제거. insertUser는 존재 시 conflict를 던져
      // 동시 등록이 먼저 등록자를 조용히 덮어쓰는 last-write-wins를 막는다.
      try {
        await repo.insertUser({
          id,
          name: String(name || '').trim(),
          role,
          division,
          passwordHash: await hashSecret(String(password)),
          active: !isPm, // 사용자는 즉시 활성, 관리자(PM)는 승인 전까지 비활성
          pending: isPm, // 관리자 등록 → 개발자 승인 대기(/admin/pending 에 즉시 노출)
          pendingAt: isPm ? Date.now() : null, // 승인 요청 시각(관리자 도구 표시용)
        })
      } catch (e) {
        if (e?.code === 'conflict')
          throw fail(409, '이미 등록된 전화번호입니다. 관리자에게 문의하세요.')
        throw e
      }
      // 계정 등록 → 개발자에게 네이버웍스 DM(설정 시). 역할 무관 모두 알림
      // (PM=승인 대기, 사용자=자동 활성). fire-and-forget — 발송 실패해도 등록은 성공.
      // notifyRegistrationSafe 는 절대 throw 안 하지만, 리팩터링 안전망으로 .catch 도 건다.
      void notifyRegistrationSafe({ name, id, role, division }).catch(() => {})
      // 체험존(본부 샘플) 접근은 본부 기준이라 별도 배정 불필요 — 로그인 즉시 열람·편집 가능.
      res.status(201).json({ ok: true, pending: isPm })
    }),
  )

  // ── 멤버 추가용 사용자 검색(개발자·PM 세션 전용) — 아이디·이름만 반환. ──
  router.get(
    '/users/searchable',
    authMw,
    requireManagerSession,
    wrap(async (_req, res) => {
      const users = await repo.listUsers()
      res.json(
        users
          .filter((u) => u.active !== false)
          .map((u) => ({ id: u.id, name: u.name, role: u.role, division: u.division ?? null })),
      )
    }),
  )

  // ── 접근 가능 프로젝트 목록 ──
  router.get(
    '/auth/projects',
    authMw,
    wrap(async (req, res) => {
      const all = await repo.listProjects()
      let list
      if (canAccessAll(req.user)) {
        // 개발자는 전체 본부·전체 프로젝트를 보고 관리(비활성 포함, 항상 입장·편집 가능).
        list = all.map((p) => ({
          id: p.id,
          name: p.name,
          role: 'developer',
          division: p.division ?? null,
          sample: !!p.sample,
          hasCode: !!p.accessCodeHash,
          active: p.active !== false,
          canEnter: true,
          canEdit: true,
        }))
      } else {
        // 같은 본부의 활성 프로젝트는 모두 '목록에 보임'. 입장/편집 가능 여부는 역할·배정으로 갈림:
        //  · 배정 멤버(담당) → 입장+편집 · 같은 본부 PM(미배정) → 입장(조회 전용) · 사용자(미배정) → 목록만
        const mem = await repo.listMembershipsForUser(req.user.id)
        const memById = new Map(mem.map((m) => [m.projectId, m]))
        list = all
          .filter((p) => p.active !== false && sameDivision(req.user, p))
          .map((p) => {
            const m = memById.get(p.id)
            // 체험존(sample)은 같은 본부면 배정 없이 입장·편집.
            const canEdit = !!m || !!p.sample
            const canEnter = !!m || req.user.role === 'pm' || !!p.sample
            return {
              id: p.id,
              name: p.name,
              role: m?.role ?? req.user.role,
              division: p.division ?? null,
              sample: !!p.sample,
              hasCode: !!p.accessCodeHash,
              active: true,
              canEnter,
              canEdit,
            }
          })
      }
      res.json(list)
    }),
  )

  // ── 프로젝트 생성(개발자·PM) ── 서버가 id 생성. PM이 만들면 그 프로젝트 PM으로 자동 등록.
  router.post(
    '/auth/projects',
    authMw,
    wrap(async (req, res) => {
      if (!canCreateProject(req.user))
        throw fail(403, '프로젝트 생성 권한(개발자·프로젝트 관리자)이 필요합니다.')
      const name = String(req.body?.name || '').trim()
      if (!name) throw fail(400, '프로젝트 이름을 입력하세요.')
      // 본부: 개발자는 지정, PM 은 본인 소속 본부로 고정.
      const division = isDeveloper(req.user) ? req.body?.division : req.user.division
      if (!isDivision(division)) throw fail(400, '본부를 선택하세요.')
      const accessCode = req.body?.accessCode
      const id = `p_${nanoid(10)}`
      const accessCodeHash = accessCode ? await hashSecret(String(accessCode)) : undefined
      const projectData = {
        id,
        name,
        division,
        createdBy: req.user.id,
        ...(accessCodeHash ? { accessCodeHash } : {}),
      }
      if (canAccessAll(req.user)) {
        await repo.upsertProject(projectData) // 개발자는 전체 접근이라 멤버십 불필요.
      } else {
        // #38: PM이 만들면 프로젝트 생성 + PM 멤버십을 원자적으로 묶어(트랜잭션/롤백) 멤버십 누락 방지.
        await repo.createProjectWithMember(projectData, {
          userId: req.user.id,
          role: 'pm',
          by: req.user.id,
        })
      }
      // 프로젝트 생성 → 개발자에게 네이버웍스 DM(설정 시). fire-and-forget — 실패해도 생성은 성공.
      void notifyProjectCreatedSafe({
        name,
        id,
        division,
        by: req.user.id,
        byName: req.user.name,
        byRole: req.user.role,
      }).catch(() => {})
      res.status(201).json({ ok: true, project: { id, name } })
    }),
  )

  // ── 프로젝트 삭제·활성/비활성(개발자 전용) ──
  router.delete(
    '/auth/projects/:id',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const project = await repo.getProject(req.params.id)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      await repo.deleteProject(req.params.id) // 멤버십 함께 삭제(memory·pg CASCADE)
      // #20: 라이브 CRDT(ydoc .bin/row)·레거시 시드 JSON·활성 연결까지 정리(고아 방지).
      try {
        await collab?.deleteProjectState?.(req.params.id)
      } catch {
        /* best-effort: ydoc 정리 실패가 삭제 응답을 막지 않게 */
      }
      // 프로젝트 삭제 → 개발자에게 네이버웍스 DM(설정 시). fire-and-forget — 실패해도 삭제는 성공.
      void notifyProjectDeletedSafe({
        name: project.name,
        id: project.id,
        division: project.division,
        by: req.user.id,
        byName: req.user.name,
      }).catch(() => {})
      res.json({ ok: true })
    }),
  )
  router.post(
    '/auth/projects/:id/active',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      if (!(await repo.getProject(req.params.id))) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      const active = req.body?.active !== false
      await repo.setProjectActive(req.params.id, active)
      // 비활성화는 '이미 들어와 있는 사람'에게도 즉시 효력이 있어야 한다 — 멤버 해임(#14)과
      // 같은 처리로 그 방의 활성 WebSocket 연결을 전부 끊는다. 끊지 않으면 관리자가 프로젝트를
      // 끈 뒤에도 열려 있던 CRDT 연결로 계속 편집이 들어온다.
      if (!active) revokeProjectAccess(req.params.id, null)
      res.json({ ok: true, active })
    }),
  )

  // ── 프로젝트 입장(접속코드 검증 → 프로젝트 토큰) ──
  router.post(
    '/auth/projects/:id/enter',
    authMw,
    wrap(async (req, res) => {
      const projectId = req.params.id
      const project = await repo.getProject(projectId)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      // 비활성화된 프로젝트는 개발자만 입장 가능(관리·복구용).
      if (!canAccessAll(req.user) && project.active === false)
        throw fail(403, '비활성화된 프로젝트입니다. 관리자에게 문의하세요.')
      const membership = canAccessAll(req.user)
        ? { role: 'developer' }
        : await repo.getMembership(projectId, req.user.id)
      // 입장 가능: 개발자 · 배정 멤버(담당) · 같은 본부 PM(조회 입장). 사용자는 배정된 프로젝트만.
      if (!canEnterProjectDiv(req.user, project, membership))
        throw fail(403, '이 프로젝트에 입장할 권한이 없습니다. (같은 본부·배정 여부 확인)')
      // 접속코드가 설정된 프로젝트에서만 코드 검증. 개발자·해당 프로젝트 PM·같은 본부 PM 은 면제.
      const codeExempt =
        accessCodeExempt(req.user, membership) ||
        (req.user.role === 'pm' && sameDivision(req.user, project))
      if (!codeExempt && project.accessCodeHash) {
        const code = String(req.body?.code || '')
        if (!(await verifySecret(code, project.accessCodeHash)))
          throw fail(401, '접속코드가 올바르지 않습니다.')
      }
      const canEdit = canEditProjectDiv(req.user, project, membership)
      const projRole = membership?.role ?? req.user.role
      const token = await signProjectToken(req.user.id, projectId, projRole, canEdit)
      res.json({ token, project: { id: project.id, name: project.name }, projRole, canEdit })
    }),
  )

  // 장기 project grant → 5분 collab ticket 교환. WebSocket에는 이 티켓만 전달한다.
  router.post(
    '/auth/projects/:id/collab-ticket',
    requireProjectToken,
    wrap(async (req, res) => {
      const projectId = req.params.id
      const project = await repo.getProject(projectId)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      const userId = String(req.projectGrant?.sub ?? req.user?.id ?? '')
      const user = userId ? await repo.getUser(userId) : null
      if (!user || user.active === false) throw fail(401, '유효하지 않은 계정입니다.')
      // requireProjectToken 이 이미 같은 판정을 하지만, 티켓 발급은 '5분짜리 CRDT 쓰기 권한'을
      // 새로 찍어내는 지점이라 여기서도 명시적으로 막는다(게이트 하나가 바뀌어도 남는 방어선).
      if (!canAccessAll(user) && project.active === false)
        throw fail(403, '비활성화된 프로젝트입니다.')
      const membership = canAccessAll(user)
        ? { role: 'developer' }
        : await repo.getMembership(projectId, user.id)
      if (!canEnterProjectDiv(user, project, membership))
        throw fail(403, '이 프로젝트 접근 권한이 없습니다.')
      // 편집 권한(담당/개발자)만 편집 가능한 collab 티켓 — 그 외는 읽기전용(WS readOnly).
      const canEdit = canEditProjectDiv(user, project, membership)
      const projRole = membership?.role ?? user.role
      res.json({
        ticket: await signCollabToken(user.id, projectId, projRole, canEdit),
        expiresIn: 300,
      })
    }),
  )

  // ── 관리(개발자): 엑셀 업로드·사용자·프로젝트 ──
  router.post(
    '/admin/users/import',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const b64 = req.body?.fileBase64
      if (!b64) throw fail(400, '업로드 파일(fileBase64)이 없습니다.')
      const buffer = Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64')
      const result = await importUsers(repo, buffer)
      res.json({ ok: true, ...result })
    }),
  )
  router.get(
    '/admin/users',
    authMw,
    requireAdmin,
    wrap(async (_req, res) =>
      res.json(
        (await repo.listUsers()).map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          division: u.division ?? null,
          active: u.active,
          pending: !!u.pending,
          hasPassword: !!u.passwordHash,
        })),
      ),
    ),
  )
  router.post(
    '/admin/users',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const { id, name, role, division, password, active } = req.body || {}
      if (!id || !isRole(role)) throw fail(400, 'id·role(developer|pm|user)이 필요합니다.')
      if (password) {
        const chk = validatePassword(password)
        if (!chk.ok) throw fail(400, chk.reason)
      }
      const passwordHash = password ? await hashSecret(String(password)) : undefined
      const normalizedId = normalizeLoginId(id)
      await repo.upsertUser({
        id: normalizedId,
        name: name ?? '',
        role,
        active: active ?? true,
        ...(isDivision(division) ? { division } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      })
      // #14: 관리자가 계정을 비활성화하면 열려 있는 collab 연결 절단.
      if (active === false) revokeUser(normalizedId)
      res.json({ ok: true })
    }),
  )
  // ── 관리자(PM) 등록 승인 대기 목록 + 승인/거절(개발자 전용) ──
  router.get(
    '/admin/pending',
    authMw,
    requireAdmin,
    wrap(async (_req, res) => {
      const users = await repo.listUsers()
      res.json(
        users
          .filter((u) => u.pending)
          .map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role,
            division: u.division ?? null,
            requestedAt: u.pendingAt ?? null,
          })),
      )
    }),
  )
  router.post(
    '/admin/users/:id/approve',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const id = normalizeLoginId(req.params.id)
      const u = await repo.getUser(id)
      if (!u) throw fail(404, '사용자를 찾을 수 없습니다.')
      const approve = req.body?.approve !== false
      // 승인 → 활성화·대기 해제. 거절 → 비활성화(로그인 불가)로 대기에서 제외.
      await repo.upsertUser({
        id,
        name: u.name,
        role: u.role,
        division: u.division,
        active: approve,
        pending: false,
      })
      // #14: 거절(비활성화) 시 열려 있는 collab 연결 절단.
      if (!approve) revokeUser(id)
      res.json({ ok: true, approved: approve })
    }),
  )
  // ── 비밀번호 초기화 요청 목록 + 관리자 직접 재설정(개발자 전용) ──
  router.get(
    '/admin/reset-requests',
    authMw,
    requireAdmin,
    wrap(async (_req, res) => {
      const users = await repo.listUsers()
      res.json(
        users
          .filter((u) => u.resetRequested)
          .map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role,
            division: u.division ?? null,
            requestedAt: u.resetRequestedAt ?? null,
          })),
      )
    }),
  )
  // 관리자가 새 비밀번호를 직접 지정(초기화 요청 처리 · 임의 변경 공용). 요청 플래그·잠금 해제.
  router.post(
    '/admin/users/:id/password',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const id = normalizeLoginId(req.params.id)
      const u = await repo.getUser(id)
      if (!u) throw fail(404, '사용자를 찾을 수 없습니다.')
      const chk = validatePassword(req.body?.password)
      if (!chk.ok) throw fail(400, chk.reason)
      await repo.upsertUser({
        ...u,
        passwordHash: await hashSecret(String(req.body.password)),
        resetRequested: false,
        mustChangePassword: false,
      })
      clearLockout(id)
      res.json({ ok: true })
    }),
  )
  // ── 네이버웍스 알림 연동 테스트(개발자 전용) — 운영자 본인에게 테스트 DM 발송. ──
  router.post(
    '/admin/notify/test',
    authMw,
    requireAdmin,
    wrap(async (_req, res) => {
      res.json(await sendTestNotification()) // { ok, configured, error? } — 200 + 결과 페이로드
    }),
  )

  router.delete(
    '/admin/users/:id',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const id = normalizeLoginId(req.params.id)
      if (id === req.user.id) throw fail(400, '본인 계정은 삭제할 수 없습니다.')
      if (!(await repo.getUser(id))) throw fail(404, '사용자를 찾을 수 없습니다.')
      await repo.deleteUser(id) // 프로젝트 멤버십 함께 삭제(memory 정리 · pg CASCADE)
      // #14: 삭제된 계정의 모든 프로젝트 활성 연결 절단.
      revokeUser(id)
      res.json({ ok: true })
    }),
  )
  router.post(
    '/admin/projects',
    authMw,
    requireAdmin,
    wrap(async (req, res) => {
      const { id, name, accessCode, division } = req.body || {}
      if (!id) throw fail(400, '프로젝트 id가 필요합니다.')
      const accessCodeHash = accessCode ? await hashSecret(String(accessCode)) : undefined
      await repo.upsertProject({
        id: String(id),
        name: name ?? '',
        createdBy: req.user.id,
        ...(isDivision(division) ? { division } : {}),
        ...(accessCodeHash ? { accessCodeHash } : {}),
      })
      res.json({ ok: true })
    }),
  )

  // ── 프로젝트 관리(PM·개발자): 멤버·접속코드 ──
  const manageMw = async (req, res, next) => {
    const membership = canAccessAll(req.user)
      ? { role: 'developer' }
      : await repo.getMembership(req.params.id, req.user.id)
    if (!canManageProject(req.user, membership))
      return res.status(403).json({ error: '프로젝트 관리 권한(PM/개발자)이 필요합니다.' })
    next()
  }
  router.get(
    '/projects/:id/members',
    authMw,
    manageMw,
    wrap(async (req, res) => {
      const members = await repo.listMembers(req.params.id)
      const users = new Map((await repo.listUsers()).map((u) => [u.id, u]))
      res.json(
        members.map((m) => ({
          userId: m.userId,
          name: users.get(m.userId)?.name ?? '',
          role: m.role,
        })),
      )
    }),
  )
  router.post(
    '/projects/:id/members',
    authMw,
    manageMw,
    wrap(async (req, res) => {
      const { userId, role } = req.body || {}
      if (!userId || !PROJECT_ROLES.includes(role))
        throw fail(400, 'userId·role(pm|user)이 필요합니다.')
      const normalizedUserId = normalizeLoginId(userId)
      if (!(await repo.getUser(normalizedUserId))) throw fail(404, '사용자를 찾을 수 없습니다.')
      await repo.addMember(req.params.id, normalizedUserId, role, req.user.id)
      // #14: 역할 변경(강등 포함) 시 활성 연결을 절단 → 재접속 때 최신 권한으로 재적용.
      revokeProjectAccess(req.params.id, normalizedUserId)
      res.json({ ok: true })
    }),
  )
  router.delete(
    '/projects/:id/members/:userId',
    authMw,
    manageMw,
    wrap(async (req, res) => {
      const removedUserId = normalizeLoginId(req.params.userId)
      await repo.removeMember(req.params.id, removedUserId)
      // #14: 해임 즉시 활성 collab 연결 절단 → 열어둔 탭으로 무기한 편집 방지.
      revokeProjectAccess(req.params.id, removedUserId)
      res.json({ ok: true })
    }),
  )
  // ── F07 프로젝트 접근 요청 ────────────────────────────────────────────────────
  // 설계 원칙: **요청은 접근이 아니다.** 아래 라우트 중 어느 것도 입장 판정
  // (canEnterProjectDiv)에 관여하지 않는다. 오직 decide(approve=true)가 만드는
  // 프로젝트 멤버십만이 /auth/projects/:id/enter 를 연다.

  /** 담당자 안내 — 입장 불가 화면에서 '누구에게 요청하는지'를 보여준다. 전화번호는 반환하지 않는다. */
  router.get(
    '/auth/projects/:id/contacts',
    authMw,
    wrap(async (req, res) => {
      const project = await repo.getProject(req.params.id)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      // 목록에 보이는 범위(개발자 또는 같은 본부)에서만 담당자를 알려준다 — 본부 경계 그대로.
      if (!canSeeProject(req.user, project))
        throw fail(403, '이 프로젝트를 조회할 권한이 없습니다.')
      const members = await repo.listMembers(req.params.id)
      const users = new Map((await repo.listUsers()).map((u) => [u.id, u]))
      const managers = members
        .filter((m) => m.role === 'pm')
        .map((m) => ({
          name: users.get(m.userId)?.name ?? '',
          division: users.get(m.userId)?.division ?? null,
          role: 'pm',
        }))
      // 담당 PM 이 아직 없으면 생성자를 폴백으로 안내(개발자가 만든 프로젝트 등).
      if (managers.length === 0 && project.createdBy) {
        const creator = users.get(project.createdBy)
        if (creator)
          managers.push({
            name: creator.name ?? '',
            division: creator.division ?? null,
            role: creator.role ?? 'pm',
          })
      }
      res.json({ managers })
    }),
  )

  /** 접근 요청 접수 — 기록만 남긴다. 응답 성공이 입장 권한을 뜻하지 않는다. */
  router.post(
    '/auth/projects/:id/access-request',
    authMw,
    wrap(async (req, res) => {
      const projectId = req.params.id
      const project = await repo.getProject(projectId)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      if (!canSeeProject(req.user, project))
        throw fail(403, '이 프로젝트를 조회할 권한이 없습니다.')
      if (project.active === false) throw fail(403, '비활성화된 프로젝트입니다.')
      if (await repo.getMembership(projectId, req.user.id))
        throw fail(400, '이미 이 프로젝트에 배정되어 있습니다.')
      const rl = accessRequestLimiter.consume(req.socket?.remoteAddress || req.ip || 'unknown')
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfter))
        throw fail(429, '접근 요청이 너무 많습니다. 잠시 후 다시 시도하세요.')
      }
      const now = Date.now()
      let created
      try {
        created = await repo.createAccessRequest({
          id: `ar_${nanoid(10)}`,
          projectId,
          userId: req.user.id,
          reason: String(req.body?.reason || '').slice(0, 300),
          status: 'pending',
          requestedAt: now,
          expiresAt: now + ACCESS_REQUEST_TTL_MS,
        })
      } catch (e) {
        if (e?.code === 'conflict') throw fail(409, '이미 처리 대기 중인 요청이 있습니다.')
        throw e
      }
      // 담당자 알림(설정 시). fire-and-forget — 발송 실패해도 요청 접수는 성공.
      void notifyAccessRequestSafe({
        projectName: project.name,
        projectId,
        division: project.division,
        name: req.user.name,
        id: req.user.id,
        role: req.user.role,
        reason: created.reason,
      }).catch(() => {})
      res.status(201).json({ ok: true, request: { ...created, status: 'pending' } })
    }),
  )

  /** 내 요청 + 내가 처리할 요청. 만료는 여기서 계산해 status='expired' 로 내려준다. */
  router.get(
    '/auth/access-requests',
    authMw,
    wrap(async (req, res) => {
      const now = Date.now()
      const all = await repo.listAccessRequests()
      const users = new Map((await repo.listUsers()).map((u) => [u.id, u]))
      const projects = new Map((await repo.listProjects()).map((p) => [p.id, p]))
      const decorate = (r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: projects.get(r.projectId)?.name ?? '',
        userId: r.userId,
        userName: users.get(r.userId)?.name ?? '',
        division: users.get(r.userId)?.division ?? null,
        reason: r.reason ?? '',
        status: effectiveRequestStatus(r, now),
        requestedAt: Number(r.requestedAt),
        expiresAt: Number(r.expiresAt),
        decidedBy: r.decidedBy ?? null,
        decidedByName: r.decidedBy ? (users.get(r.decidedBy)?.name ?? '') : null,
        decidedAt: r.decidedAt != null ? Number(r.decidedAt) : null,
        decisionReason: r.decisionReason ?? '',
      })
      const mine = all.filter((r) => r.userId === req.user.id).map(decorate)
      // 처리 대상: 개발자는 전체, 그 외에는 내가 PM 인 프로젝트만(멤버 관리 권한과 같은 기준).
      // 기한이 지난 요청은 처리할 수 없으므로(아래 decide 가 409) 처리 목록에서 뺀다 —
      // 저장 status 가 아니라 만료를 반영한 effectiveRequestStatus 로 거른다.
      let incoming = []
      if (canAccessAll(req.user)) {
        incoming = all.filter((r) => effectiveRequestStatus(r, now) === 'pending').map(decorate)
      } else {
        const managed = new Set(
          (await repo.listMembershipsForUser(req.user.id))
            .filter((m) => m.role === 'pm')
            .map((m) => m.projectId),
        )
        incoming = all
          .filter((r) => effectiveRequestStatus(r, now) === 'pending' && managed.has(r.projectId))
          .map(decorate)
      }
      res.json({ mine, incoming })
    }),
  )

  /** 승인/거절 — 승인만이 접근을 만든다(멤버십 삽입). 거절은 사유가 필수다. */
  router.post(
    '/auth/access-requests/:reqId/decide',
    authMw,
    wrap(async (req, res) => {
      const ar = await repo.getAccessRequest(req.params.reqId)
      if (!ar) throw fail(404, '요청을 찾을 수 없습니다.')
      const project = await repo.getProject(ar.projectId)
      if (!project) throw fail(404, '프로젝트를 찾을 수 없습니다.')
      const membership = canAccessAll(req.user)
        ? { role: 'developer' }
        : await repo.getMembership(ar.projectId, req.user.id)
      if (!canManageProject(req.user, membership))
        throw fail(403, '프로젝트 관리 권한(PM/개발자)이 필요합니다.')
      // 본인 요청을 본인이 결재하면 '요청자·승인자' 기록이 무의미해진다(개발자는 멤버십 없이도
      // 요청을 만들 수 있으므로 실제로 가능한 경로다). 권한 문제가 아니라 기록 신뢰성 문제.
      if (ar.userId === req.user.id) throw fail(403, '본인 요청은 본인이 처리할 수 없습니다.')
      if (ar.status !== 'pending') throw fail(409, '이미 처리된 요청입니다.')
      if (Number(ar.expiresAt) <= Date.now()) {
        // 만료를 저장에 확정한다 — 표시만 바꾸면 담당자 목록에 영원히 남고 재요청도 막힌다.
        await repo.resolveAccessRequest(ar.id, { status: 'expired' })
        throw fail(409, '기한이 지난 요청입니다. 요청자에게 다시 요청하도록 안내하세요.')
      }
      // 승인은 **명시적 true** 만 인정한다 — 빈 본문이 실수로 권한을 부여하지 않도록.
      const approve = req.body?.approve === true
      const decisionReason = String(req.body?.decisionReason || '').slice(0, 300)
      if (!approve && !decisionReason.trim()) throw fail(400, '거절 사유를 입력하세요.')
      if (approve) {
        await repo.addMember(ar.projectId, ar.userId, 'user', req.user.id)
        // #14 와 같은 결: 권한이 바뀌었으니 열린 연결을 끊어 재접속 때 최신 권한을 적용.
        revokeProjectAccess(ar.projectId, ar.userId)
      }
      const saved = await repo.resolveAccessRequest(ar.id, {
        status: approve ? 'approved' : 'rejected',
        decidedBy: req.user.id,
        decidedAt: Date.now(),
        decisionReason: approve ? '' : decisionReason,
      })
      res.json({ ok: true, status: saved?.status ?? (approve ? 'approved' : 'rejected') })
    }),
  )

  router.post(
    '/projects/:id/access-code',
    authMw,
    manageMw,
    wrap(async (req, res) => {
      const code = String(req.body?.code || '')
      if (!code) throw fail(400, '접속코드를 입력하세요.')
      await repo.setProjectAccessCode(req.params.id, await hashSecret(code))
      res.json({ ok: true })
    }),
  )

  return { router, requireAuth: authMw, requireProjectToken }
}

/** 최초 기동 시 사용자가 하나도 없으면 부트스트랩 개발자 계정 시드(env). */
export async function bootstrapDeveloper(repo) {
  const users = await repo.listUsers()
  if (users.length > 0) return null
  const id = process.env.AUTH_BOOTSTRAP_USER || 'admin'
  const pw = process.env.AUTH_BOOTSTRAP_PASSWORD || 'Sequence1!' // 정책 충족(영문+숫자+특수)
  await repo.upsertUser({
    id,
    name: '초기 개발자',
    role: 'developer',
    passwordHash: await hashSecret(pw),
  })
  return { id, password: pw }
}
