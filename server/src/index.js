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
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const CLIENT_DIST = path.resolve(ROOT, 'client', 'dist')
const ERROR_LOG = path.resolve(ROOT, 'error.log')
const PORT = process.env.PORT || 4000

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

// Serve the built client when present (production / Electron).
if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(CLIENT_DIST, 'index.html'))
  })
}

app.listen(PORT, () => {
  appendLog('info', `HydroNet 서버 시작 (port ${PORT})`)
  console.log(`HydroNet server ▸ http://localhost:${PORT}`)
})
