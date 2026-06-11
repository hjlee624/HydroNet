// ─────────────────────────────────────────────────────────────────────────────
// HydroNet backend — intentionally thin. Two jobs:
//   1. File-based project persistence (server/data/*.json) so the app works on
//      an offline site PC and ports cleanly to an Electron .exe later.
//   2. Centralised error logging to <repo>/error.log per ABS_RULE.md, so any
//      identified defect is recorded and never silently repeats.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const CLIENT_DIST = path.resolve(ROOT, 'client', 'dist')
const PUBLIC_FONTS = path.resolve(ROOT, 'client', 'public', 'fonts')
const ERROR_LOG = path.resolve(ROOT, 'error.log')
const PORT = process.env.PORT || 4020
// Bind all interfaces by default so other PCs on the LAN can connect.
const HOST = process.env.HOST || '0.0.0.0'

/** Non-internal IPv4 addresses (for printing LAN URLs). */
function lanAddresses() {
  const out = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address)
    }
  }
  return out
}

fssync.mkdirSync(DATA_DIR, { recursive: true })

// ── error.log ──────────────────────────────────────────────────────────────
function appendLog(level, message, context) {
  const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${message}` +
    (context !== undefined ? ` :: ${typeof context === 'string' ? context : safeJson(context)}` : '') + '\n'
  fs.appendFile(ERROR_LOG, line).catch((e) => console.error('error.log 기록 실패:', e))
  if (level === 'error') console.error(line.trimEnd())
}
function safeJson(o) {
  try { return JSON.stringify(o) } catch { return String(o) }
}

// Never crash silently — funnel process-level faults into error.log too.
process.on('uncaughtException', (e) => appendLog('error', 'uncaughtException', { message: e.message, stack: e.stack }))
process.on('unhandledRejection', (r) => appendLog('error', 'unhandledRejection', { reason: String(r) }))

// ── app ──────────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))

const idOk = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)
const fileFor = (id) => path.join(DATA_DIR, `${id}.json`)

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
  tail.then(() => { if (writeChains.get(id) === tail) writeChains.delete(id) })
  return run
}
const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  appendLog('error', `${req.method} ${req.path}`, { message: e.message, stack: e.stack })
  res.status(500).json({ error: '서버 오류가 발생했습니다.' })
})

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'hydronet', time: new Date().toISOString() }))

// Client error funnel → error.log
app.post('/api/log', asyncRoute(async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body]
  for (const e of entries) {
    if (!e) continue
    appendLog(e.level || 'info', `[client] ${e.message ?? ''}`, e.stack || e.context)
  }
  res.json({ ok: true, count: entries.length })
}))

app.get('/api/projects', asyncRoute(async (_req, res) => {
  const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  const summaries = []
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8'))
      summaries.push({ id: p.id, name: p.name, updatedAt: p.meta?.updatedAt ?? null })
    } catch (e) {
      appendLog('warn', `손상된 프로젝트 파일 건너뜀: ${f}`, { message: e.message })
    }
  }
  summaries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  res.json(summaries)
}))

app.get('/api/projects/:id', asyncRoute(async (req, res) => {
  const { id } = req.params
  if (!idOk(id)) return res.status(400).json({ error: '잘못된 ID' })
  try {
    const raw = await fs.readFile(fileFor(id), 'utf8')
    res.type('application/json').send(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
    throw e
  }
}))

app.put('/api/projects/:id', asyncRoute(async (req, res) => {
  const { id } = req.params
  if (!idOk(id)) return res.status(400).json({ error: '잘못된 ID' })
  const project = req.body
  if (!project || project.id !== id) return res.status(400).json({ error: 'ID 불일치' })
  // Unique temp + per-id serialization: atomic against crashes AND safe against
  // concurrent same-id writers (no shared temp path, no interleaving).
  await serializeWrite(id, async () => {
    const tmp = `${fileFor(id)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')
      await fs.rename(tmp, fileFor(id))
    } catch (e) {
      await fs.unlink(tmp).catch(() => {}) // clean up the orphan temp on failure
      throw e
    }
  })
  res.json({ ok: true, id })
}))

app.delete('/api/projects/:id', asyncRoute(async (req, res) => {
  const { id } = req.params
  if (!idOk(id)) return res.status(400).json({ error: '잘못된 ID' })
  try {
    await fs.unlink(fileFor(id))
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
    throw e
  }
}))

// ── Autosave (temp recovery) ────────────────────────────────────────────────
// Named .json snapshots so a user can recover work after closing/reopening.
// Defaults to a per-user folder (no admin needed) so the location is stable
// regardless of whether the server runs elevated. Set HN_AUTOSAVE_DIR to use a
// fixed/shared path (e.g. C:\Program Files\HydroNET — requires write access).
// The resolved path is reported to the client (shown in the 불러오기 dialog).
function resolveAutosaveDir() {
  const candidates = [
    process.env.HN_AUTOSAVE_DIR,
    path.join(os.homedir(), 'HydroNET'),
    path.resolve(DATA_DIR, '..', 'autosave'),
  ].filter(Boolean)
  for (const dir of candidates) {
    try {
      fssync.mkdirSync(dir, { recursive: true })
      fssync.accessSync(dir, fssync.constants.W_OK)
      return dir
    } catch { /* not writable — try the next candidate */ }
  }
  return DATA_DIR
}
const AUTOSAVE_DIR = resolveAutosaveDir()
appendLog('info', `자동 임시저장 폴더: ${AUTOSAVE_DIR}`)

/** Project name → safe .json filename base. */
function safeName(name) {
  const base = String(name ?? 'untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  return base || 'untitled'
}

app.get('/api/autosave', asyncRoute(async (_req, res) => {
  let files = []
  try { files = (await fs.readdir(AUTOSAVE_DIR)).filter((f) => f.endsWith('.json')) } catch { files = [] }
  const items = []
  for (const f of files) {
    try {
      const full = path.join(AUTOSAVE_DIR, f)
      const stat = await fs.stat(full)
      const p = JSON.parse(await fs.readFile(full, 'utf8'))
      items.push({ file: f.replace(/\.json$/, ''), name: p.name ?? f, updatedAt: p.meta?.updatedAt ?? stat.mtime.toISOString(), size: stat.size })
    } catch (e) { appendLog('warn', `임시저장 파일 건너뜀: ${f}`, { message: e.message }) }
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  res.json({ dir: AUTOSAVE_DIR, items })
}))

app.get('/api/autosave/file/:name', asyncRoute(async (req, res) => {
  const name = safeName(req.params.name)
  try {
    const raw = await fs.readFile(path.join(AUTOSAVE_DIR, `${name}.json`), 'utf8')
    res.type('application/json').send(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
    throw e
  }
}))

app.post('/api/autosave', asyncRoute(async (req, res) => {
  const project = req.body
  if (!project || typeof project !== 'object') return res.status(400).json({ error: '잘못된 본문' })
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
}))

app.delete('/api/autosave/file/:name', asyncRoute(async (req, res) => {
  const name = safeName(req.params.name)
  try {
    await fs.unlink(path.join(AUTOSAVE_DIR, `${name}.json`))
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: '없음' })
    throw e
  }
}))

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
app.listen(PORT, HOST, () => {
  appendLog('info', `HydroNet 서버 시작 (host ${HOST}, port ${PORT}, client=${served ? 'dist' : 'api-only'})`)
  console.log('\nHydroNet server listening on all interfaces:')
  console.log(`  Local:  http://127.0.0.1:${PORT}/${served ? '' : '  (API only — run "npm run build" to serve the app)'}`)
  for (const ip of lanAddresses()) console.log(`  LAN:    http://${ip}:${PORT}/`)
  console.log(`\n다른 PC에서 LAN URL이 안 열리면 Windows Defender 방화벽에서 TCP ${PORT} 포트를 허용하세요.\n`)
})
