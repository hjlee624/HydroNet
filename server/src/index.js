// ─────────────────────────────────────────────────────────────────────────────
// Sequence backend — intentionally thin. Two jobs:
//   1. File-based project persistence (server/data/*.json) so the app works on
//      an offline site PC and ports cleanly to an Electron .exe later.
//   2. Centralised error logging to <repo>/error.log per ABS_RULE.md, so any
//      identified defect is recorded and never silently repeats.
// ─────────────────────────────────────────────────────────────────────────────

import fssync from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import { assertJwtSecret, jwtSecretConfigured, verifyToken } from './auth/crypto.js'
import { createPgRepo } from './auth/pgRepo.js'
import { createMemoryRepo } from './auth/repo.js'
import { canAccessAll, canAdmin, canEnterProject } from './auth/roles.js'
import { bootstrapDeveloper, createAuthRouter } from './auth/routes.js'
import { bootstrapSampleProjects } from './auth/sampleProjects.js'
import { attachCollaborationServer } from './collab/index.js'
import { decodeProjectFromState } from './collab/seed.js'
import { reviewProviderStatus, runReview } from './llm/review.js'
import {
  createBoundedRateLimiter,
  createHttpOriginPolicy,
  normalizeClientLogEntries,
  resolveAuthBackendConfig,
} from './security.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = path.resolve(process.env.HN_DATA_DIR || path.resolve(__dirname, '..', 'data'))
const CLIENT_DIST = path.resolve(ROOT, 'client', 'dist')
const PUBLIC_FONTS = path.resolve(ROOT, 'client', 'public', 'fonts')
const ERROR_LOG = path.resolve(process.env.HN_ERROR_LOG || path.resolve(ROOT, 'error.log'))
const PORT = Number(process.env.PORT || 4020)
// Bind all interfaces by default so other PCs on the LAN can connect.
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_ENABLED = process.env.AUTH_ENABLED !== '0'
const { backend: AUTH_BACKEND, databaseUrl: DATABASE_URL } = resolveAuthBackendConfig(process.env)

/** Non-internal IPv4 addresses (for printing LAN URLs). */
function lanAddresses() {
  const out = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
        out.push(i.address)
    }
  }
  return out
}

fssync.mkdirSync(DATA_DIR, { recursive: true })

// ── error.log ──────────────────────────────────────────────────────────────
function appendLog(level, message, context) {
  const line =
    `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${message}` +
    (context !== undefined
      ? ` :: ${typeof context === 'string' ? context : safeJson(context)}`
      : '') +
    '\n'
  fs.appendFile(ERROR_LOG, line).catch((e) => console.error('error.log 기록 실패:', e))
  if (level === 'error') console.error(line.trimEnd())
}
function safeJson(o) {
  try {
    return JSON.stringify(o)
  } catch {
    return String(o)
  }
}

// Never crash silently — funnel process-level faults into error.log too.
process.on('uncaughtException', (e) =>
  appendLog('error', 'uncaughtException', { message: e.message, stack: e.stack }),
)
process.on('unhandledRejection', (r) =>
  appendLog('error', 'unhandledRejection', { reason: String(r) }),
)

// ── app ──────────────────────────────────────────────────────────────────────
const app = express()
// Apply exactly the same explicit/same-origin LAN policy as the WebSocket upgrade.
const isAllowedHttpOrigin = createHttpOriginPolicy(process.env.COLLAB_ALLOWED_ORIGINS)
app.use((req, res, next) => {
  if (isAllowedHttpOrigin(req)) return next()
  res.status(403).json({ error: 'Origin is not allowed.' })
})
app.use(
  cors({
    origin: (origin, callback) => callback(null, Boolean(origin)),
    credentials: true,
  }),
)
// The client log funnel has a much smaller parsing budget than project snapshots.
app.use('/api/log', express.json({ limit: '32kb' }))
app.use(express.json({ limit: '12mb' }))
app.use((error, _req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' })
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }
  next(error)
})

// ── 인증/RBAC (ADR-002) — 서버가 있을 때 로그인 게이트. 오프라인 단일 HTML은 클라가 로컬 모드로 우회. ──
const authRepo =
  AUTH_BACKEND === 'pg'
    ? createPgRepo(DATABASE_URL)
    : createMemoryRepo(path.join(DATA_DIR, 'auth.json'))
if (authRepo.backend !== AUTH_BACKEND) {
  throw new Error(
    `Auth repository backend mismatch: configured=${AUTH_BACKEND}, actual=${authRepo.backend}`,
  )
}
const secureCookie = process.env.AUTH_SECURE_COOKIE === '1' || process.env.NODE_ENV === 'production'
// 협업 서버 제어 훅(startServer에서 채워짐). 라우터는 import 시점, collab은 startServer에서 붙으므로
// 늦은 바인딩용 간접 객체를 공유한다. #14(연결 강제절단)·#19(라이브 스냅샷)·#20(삭제 정리)에 사용.
const collabControl = {}
const { router: authRouter, requireAuth } = createAuthRouter(authRepo, {
  secure: secureCookie,
  collab: collabControl,
})
const listGate = AUTH_ENABLED ? requireAuth : (_req, _res, next) => next()
const logGate = AUTH_ENABLED
  ? requireAuth
  : (_req, res) => res.status(404).json({ error: 'Client logging is disabled.' })
const clientLogLimiter = createBoundedRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxTracked: 5_000,
})
const clientLogRateGate = (req, res, next) => {
  const actor = req.user?.id || 'anonymous'
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const result = clientLogLimiter.consume(`${ip}\0${actor}`)
  if (result.allowed) return next()
  res.setHeader('Retry-After', String(result.retryAfter))
  res.status(429).json({ error: 'Client log rate limit exceeded.' })
}
if (AUTH_ENABLED) {
  app.use('/api', authRouter)
  bootstrapDeveloper(authRepo)
    .then(
      (b) =>
        b &&
        appendLog(
          'info',
          `부트스트랩 개발자 계정: ${b.id} (초기 비밀번호는 AUTH_BOOTSTRAP_PASSWORD로 지정 권장)`,
        ),
    )
    .catch((e) => appendLog('error', 'auth bootstrap', { message: e.message }))
  // 본부별 예시 프로젝트 시드(온보딩용). 이미 있으면 건너뜀.
  bootstrapSampleProjects(authRepo, DATA_DIR)
    .then((c) => c.length && appendLog('info', `본부별 샘플 프로젝트 생성: ${c.length}건`))
    .catch((e) => appendLog('error', 'sample bootstrap', { message: e.message }))
  appendLog(
    'info',
    `인증 활성(backend=${authRepo.backend}). 오프라인/단일HTML은 클라 로컬 모드로 우회.`,
  )
}

const idOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)
const fileFor = (id) => path.join(DATA_DIR, `${id}.json`)

const sessionCookie = (req) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === 'hn_session') return decodeURIComponent(value.join('='))
  }
  return null
}

async function resolveProjectAccess(req, projectId) {
  if (!AUTH_ENABLED) return { user: null, projectId, projRole: 'local' }
  if (!idOk(projectId)) return null

  const project = await authRepo.getProject(projectId)
  if (!project) return null

  const cookie = sessionCookie(req)
  if (cookie) {
    const session = await verifyToken(cookie, 'session').catch(() => null)
    const user = session?.sub ? await authRepo.getUser(String(session.sub)) : null
    if (user && user.active !== false && canAccessAll(user)) {
      return { user, projectId, projRole: 'developer' }
    }
  }

  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null
  const grant = token ? await verifyToken(token, 'project').catch(() => null) : null
  if (!grant?.sub || grant.projectId !== projectId) return null

  const user = await authRepo.getUser(String(grant.sub))
  if (!user || user.active === false) return null
  const membership = canAccessAll(user)
    ? { projectId, userId: user.id, role: 'developer' }
    : await authRepo.getMembership(projectId, user.id)
  if (!canEnterProject(user, membership)) return null
  return { user, projectId, projRole: canAccessAll(user) ? 'developer' : membership.role }
}

const projectDeniedStatus = (req) =>
  sessionCookie(req) || String(req.headers.authorization || '').startsWith('Bearer ') ? 403 : 401

const projectGate = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req, req.params.id)
    if (!access)
      return res
        .status(projectDeniedStatus(req))
        .json({ error: '이 프로젝트 접근 권한이 없습니다.' })
    req.user = access.user
    req.projectGrant = access
    next()
  } catch (error) {
    next(error)
  }
}

// Per-id write serialization. Concurrent PUTs for the same project (multiple
// tabs, auto-save racing a manual save, client retries) are chained so their
// write→rename pairs never interleave. Combined with a unique temp filename
// per write, this rules out the shared-temp corruption / lost-write race.
const writeChains = new Map()
function serializeWrite(id, task) {
  const prev = writeChains.get(id) ?? Promise.resolve()
  const run = prev.then(task, task) // run regardless of the previous outcome
  const tail = run.catch(() => {})
  writeChains.set(id, tail)
  tail.then(() => {
    if (writeChains.get(id) === tail) writeChains.delete(id)
  })
  return run
}
const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    appendLog('error', `${req.method} ${req.path}`, { message: e.message, stack: e.stack })
    res.status(500).json({ error: '서버 오류가 발생했습니다.' })
  })

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'sequence', time: new Date().toISOString() }),
)

// Client error funnel → error.log
app.post(
  '/api/log',
  logGate,
  clientLogRateGate,
  asyncRoute(async (req, res) => {
    let entries
    try {
      entries = normalizeClientLogEntries(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    for (const entry of entries) {
      appendLog(entry.level, `[client:${req.user.role}] ${entry.message}`, entry.detail)
    }
    res.json({ ok: true, count: entries.length })
  }),
)

// ── 실시간 AI 검토 프록시(검토서 Part A) — BYO 키로 3사 LLM 호출 ──
// 반영은 여전히 앱 내 승인 게이트(ReviewDialog)를 거친다 — 모델은 '제안'만.
app.get('/api/review/providers', listGate, (_req, res) => res.json(reviewProviderStatus()))

app.post(
  '/api/review/complete',
  listGate,
  asyncRoute(async (req, res) => {
    const { provider, model, prompt } = req.body || {}
    if (typeof prompt !== 'string' || !prompt.trim())
      return res.status(400).json({ error: '검토 요청 내용(prompt)이 비어 있습니다.' })
    try {
      const out = await runReview({ provider, model, prompt })
      res.json(out)
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 502
      appendLog('warn', 'review/complete 실패', { provider, code: e?.code, message: e?.message })
      res.status(status).json({ error: e?.message || 'LLM 호출에 실패했습니다.', code: e?.code })
    }
  }),
)

app.get(
  '/api/projects',
  listGate,
  asyncRoute(async (req, res) => {
    const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
    const summaries = []
    for (const f of files) {
      try {
        const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8'))
        if (!idOk(p.id)) continue
        if (AUTH_ENABLED && !canAccessAll(req.user)) {
          const membership = await authRepo.getMembership(p.id, req.user.id)
          if (!membership) continue
        }
        summaries.push({ id: p.id, name: p.name, updatedAt: p.meta?.updatedAt ?? null })
      } catch (e) {
        appendLog('warn', `손상된 프로젝트 파일 건너뜀: ${f}`, { message: e.message })
      }
    }
    summaries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    res.json(summaries)
  }),
)

const sendProjectSnapshot = asyncRoute(async (req, res) => {
  const { id } = req.params
  if (!idOk(id)) return res.status(400).json({ error: '잘못된 ID' })
  // #19: 라이브 CRDT(ydoc)가 권위 소스. 있으면 정규 JSON으로 직렬화해 반환한다.
  // (기존엔 최초 시드 JSON만 반환해 백업/복구 시 협업 이력이 통째로 소실됐다.)
  try {
    const state = await collabControl.fetchLiveState?.(id)
    if (state?.length) {
      const project = decodeProjectFromState(state, id)
      return res.type('application/json').send(JSON.stringify(project))
    }
  } catch (e) {
    appendLog('warn', `라이브 스냅샷 직렬화 실패 — 레거시 JSON로 폴백: ${id}`, {
      message: e.message,
    })
  }
  // 폴백: ydoc가 아직 없거나(협업 미개시) 디코드 실패 시 최초 시드 JSON.
  try {
    const raw = await fs.readFile(fileFor(id), 'utf8')
    res.type('application/json').send(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
    throw e
  }
})

app.get('/api/projects/:id', projectGate, sendProjectSnapshot)
app.get('/api/projects/:id/snapshot', projectGate, sendProjectSnapshot)

app.put('/api/projects/:id', projectGate, (_req, res) => {
  res.setHeader('Allow', 'GET')
  res.status(405).json({
    error:
      '전체 JSON PUT 저장은 종료되었습니다. 실시간 편집은 /collab을 사용하고 백업은 snapshot GET을 사용하세요.',
    snapshot: '/api/projects/:id/snapshot',
  })
})

app.delete(
  '/api/projects/:id',
  projectGate,
  asyncRoute(async (req, res) => {
    const { id } = req.params
    if (!idOk(id)) return res.status(400).json({ error: '잘못된 ID' })
    if (AUTH_ENABLED && !canAdmin(req.user)) {
      return res.status(403).json({ error: '프로젝트 삭제는 개발자 권한이 필요합니다.' })
    }
    // #20: 레거시 시드 JSON뿐 아니라 라이브 CRDT(ydoc .bin/row)·활성 연결까지 함께 정리.
    if (collabControl.deleteProjectState) {
      const existed =
        (await fs.access(fileFor(id)).then(
          () => true,
          () => false,
        )) ||
        (await collabControl
          .fetchLiveState?.(id)
          .then((s) => !!s?.length)
          .catch(() => false))
      await collabControl.deleteProjectState(id)
      if (!existed) return res.status(404).json({ error: '없음' })
      return res.json({ ok: true })
    }
    try {
      await fs.unlink(fileFor(id))
      res.json({ ok: true })
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
      throw e
    }
  }),
)

// ── Autosave (temp recovery) ────────────────────────────────────────────────
// Named .json snapshots so a user can recover work after closing/reopening.
// Default = C:\ProgramData\Sequence — a FIXED, username-independent path that is
// writable without admin and is the standard Windows location for shared app
// data (so it is identical on every PC, unlike C:\Users\<name>). Falls back to a
// per-user folder, then server/data. Set HN_AUTOSAVE_DIR to force any path.
// The resolved path is reported to the client (shown in the 불러오기 dialog).
function resolveAutosaveDir() {
  const programData = process.env.ProgramData || process.env.ALLUSERSPROFILE
  const candidates = [
    process.env.HN_AUTOSAVE_DIR,
    programData ? path.join(programData, 'Sequence') : null,
    path.join(os.homedir(), 'Sequence'),
    path.resolve(DATA_DIR, '..', 'autosave'),
  ].filter(Boolean)
  for (const dir of candidates) {
    try {
      fssync.mkdirSync(dir, { recursive: true })
      fssync.accessSync(dir, fssync.constants.W_OK)
      return dir
    } catch {
      /* not writable — try the next candidate */
    }
  }
  return DATA_DIR
}
const AUTOSAVE_DIR = resolveAutosaveDir()
appendLog('info', `자동 임시저장 폴더: ${AUTOSAVE_DIR}`)

/** Project name → safe .json filename base. */
function safeName(name) {
  const base = String(name ?? 'untitled')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return base || 'untitled'
}

app.get(
  '/api/autosave',
  listGate,
  asyncRoute(async (req, res) => {
    let files = []
    try {
      files = (await fs.readdir(AUTOSAVE_DIR)).filter((f) => f.endsWith('.json'))
    } catch {
      files = []
    }
    const items = []
    for (const f of files) {
      try {
        const full = path.join(AUTOSAVE_DIR, f)
        const stat = await fs.stat(full)
        const p = JSON.parse(await fs.readFile(full, 'utf8'))
        if (AUTH_ENABLED && !canAccessAll(req.user)) {
          if (!idOk(p.id)) continue
          const membership = await authRepo.getMembership(p.id, req.user.id)
          if (!membership) continue
        }
        items.push({
          file: f.replace(/\.json$/, ''),
          name: p.name ?? f,
          updatedAt: p.meta?.updatedAt ?? stat.mtime.toISOString(),
          size: stat.size,
        })
      } catch (e) {
        appendLog('warn', `임시저장 파일 건너뜀: ${f}`, { message: e.message })
      }
    }
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    res.json({ dir: AUTOSAVE_DIR, items })
  }),
)

app.get(
  '/api/autosave/file/:name',
  asyncRoute(async (req, res) => {
    const name = safeName(req.params.name)
    try {
      const raw = await fs.readFile(path.join(AUTOSAVE_DIR, `${name}.json`), 'utf8')
      const project = JSON.parse(raw)
      const access = idOk(project?.id) ? await resolveProjectAccess(req, project.id) : null
      if (!access)
        return res
          .status(projectDeniedStatus(req))
          .json({ error: '이 프로젝트 접근 권한이 없습니다.' })
      res.type('application/json').send(raw)
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
      throw e
    }
  }),
)

app.post(
  '/api/autosave',
  asyncRoute(async (req, res) => {
    const project = req.body
    if (!project || typeof project !== 'object' || !idOk(project.id))
      return res.status(400).json({ error: '잘못된 본문' })
    const access = await resolveProjectAccess(req, project.id)
    if (!access)
      return res
        .status(projectDeniedStatus(req))
        .json({ error: '이 프로젝트 접근 권한이 없습니다.' })
    const name = safeName(project.name)
    const file = path.join(AUTOSAVE_DIR, `${name}.json`)
    await serializeWrite(`autosave:${name}`, async () => {
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
      try {
        await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')
        await fs.rename(tmp, file)
      } catch (e) {
        await fs.unlink(tmp).catch(() => {})
        throw e
      }
    })
    res.json({ ok: true, file: name, dir: AUTOSAVE_DIR })
  }),
)

app.delete(
  '/api/autosave/file/:name',
  asyncRoute(async (req, res) => {
    const name = safeName(req.params.name)
    try {
      const file = path.join(AUTOSAVE_DIR, `${name}.json`)
      const project = JSON.parse(await fs.readFile(file, 'utf8'))
      const access = idOk(project?.id) ? await resolveProjectAccess(req, project.id) : null
      if (!access)
        return res
          .status(projectDeniedStatus(req))
          .json({ error: '이 프로젝트 접근 권한이 없습니다.' })
      await fs.unlink(file)
      res.json({ ok: true })
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
      throw e
    }
  }),
)

// Serve fonts straight from public/fonts so dropping the KoPub OTF files in
// works WITHOUT a rebuild — every LAN client's browser then downloads them via
// @font-face. (In the built client these also exist under dist/fonts.)
if (fssync.existsSync(PUBLIC_FONTS)) app.use('/fonts', express.static(PUBLIC_FONTS))

// Serve the built client when present (production / Electron).
if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    // A path with a file extension that wasn't served by static is a genuine
    // miss (e.g. a missing /fonts/*.otf) — return 404, not the SPA shell, so a
    // missing font fails cleanly instead of loading HTML as a font.
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.status(404).end()
    res.sendFile(path.join(CLIENT_DIST, 'index.html'))
  })
}

const served = fssync.existsSync(CLIENT_DIST)

export { app, authRepo }

export async function startServer(options = {}) {
  // #18: 운영 모드(secure)에서 AUTH_JWT_SECRET 미설정이면 기동 거부. dev 미설정이면 경고.
  assertJwtSecret({ secure: secureCookie })
  if (!jwtSecretConfigured()) {
    appendLog(
      'warn',
      'AUTH_JWT_SECRET 미설정 — 프로세스별 랜덤 키 사용. 서버 재시작 시 모든 세션·프로젝트·collab 티켓이 무효화되어 전원 재로그인이 필요합니다. 운영에서는 server/.env에 AUTH_JWT_SECRET(16자 이상)을 설정하세요(start-lan.bat이 최초 실행 시 자동 생성).',
    )
  }
  const port = Number(options.port ?? PORT)
  const host = options.host ?? HOST
  const server = http.createServer(app)
  const collab = attachCollaborationServer(server, {
    repo: authRepo,
    authBackend: authRepo.backend,
    dataDir: DATA_DIR,
    allowedOrigins: options.allowedOrigins,
    timeout: options.collabTimeout,
    logger: {
      error(message, error) {
        appendLog('error', message, { message: error?.message, stack: error?.stack })
      },
    },
  })
  // 늦은 바인딩: 라우터/스냅샷/삭제 경로가 실행 시점에 collab 제어를 쓸 수 있게 연결.
  collabControl.revokeProjectAccess = (projectId, userId) =>
    collab.revokeProjectAccess(projectId, userId)
  collabControl.revokeUser = (userId) => collab.revokeUser(userId)
  collabControl.fetchLiveState = (id) => collab.fetchLiveState(id)
  collabControl.deleteProjectState = (id) => collab.deleteProjectState(id)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const actualPort = server.address().port
  appendLog(
    'info',
    `Sequence 서버 시작 (host ${host}, port ${actualPort}, client=${served ? 'dist' : 'api-only'})`,
  )
  console.log('\nSequence server listening on all interfaces:')
  console.log(
    `  Local:  http://127.0.0.1:${actualPort}/${served ? '' : '  (API only — run "npm run build" to serve the app)'}`,
  )
  for (const ip of lanAddresses()) console.log(`  LAN:    http://${ip}:${actualPort}/`)
  console.log(
    `\n다른 PC에서 LAN URL이 안 열리면 Windows Defender 방화벽에서 TCP ${actualPort} 포트를 허용하세요.\n`,
  )

  let closePromise
  return {
    app,
    server,
    collab,
    authRepo,
    port: actualPort,
    close() {
      closePromise ??= (async () => {
        const httpClosed = new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
        await collab.destroy()
        await httpClosed
      })()
      return closePromise
    },
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const runtime = await startServer()
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await runtime.close()
    if (authRepo.pool) await authRepo.pool.end()
  }
  process.once('SIGINT', stop)
  process.once('SIGQUIT', stop)
  process.once('SIGTERM', stop)
}
