// Persistence client. Talks to the thin Express backend for file-based storage,
// and transparently falls back to localStorage when the server isn't running
// (standalone client / future offline Electron build).

import type { Project } from '../types/model'
import { logWarn } from './logger'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

const LS_PREFIX = 'hydronet:project:'
const LS_INDEX = 'hydronet:index'

let serverOk = true

async function tryServer<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!serverOk) return null
  try {
    return await fn()
  } catch (e) {
    serverOk = false
    logWarn('서버에 연결할 수 없어 로컬 저장소로 전환합니다.', e)
    return null
  }
}

// ── localStorage fallback ──
function lsList(): ProjectSummary[] {
  try {
    return JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]')
  } catch {
    return []
  }
}
function lsSaveIndex(list: ProjectSummary[]) {
  localStorage.setItem(LS_INDEX, JSON.stringify(list))
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await tryServer(async () => {
    const res = await fetch('/api/projects')
    if (!res.ok) throw new Error(`list failed ${res.status}`)
    return (await res.json()) as ProjectSummary[]
  })
  return r ?? lsList()
}

export async function loadProject(id: string): Promise<Project | null> {
  const r = await tryServer(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`load failed ${res.status}`)
    return (await res.json()) as Project
  })
  if (r !== null) return r
  const raw = localStorage.getItem(LS_PREFIX + id)
  return raw ? (JSON.parse(raw) as Project) : null
}

export async function saveProject(project: Project): Promise<void> {
  const r = await tryServer(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
    if (!res.ok) throw new Error(`save failed ${res.status}`)
    return true
  })
  if (r) return
  // fallback
  localStorage.setItem(LS_PREFIX + project.id, JSON.stringify(project))
  const list = lsList().filter((p) => p.id !== project.id)
  list.unshift({ id: project.id, name: project.name, updatedAt: project.meta.updatedAt })
  lsSaveIndex(list)
}

export async function deleteProject(id: string): Promise<void> {
  const r = await tryServer(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`delete failed ${res.status}`)
    return true
  })
  if (r) return
  localStorage.removeItem(LS_PREFIX + id)
  lsSaveIndex(lsList().filter((p) => p.id !== id))
}
