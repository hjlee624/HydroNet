// Snapshot/backup client. Live edits flow only through the Y.Doc providers;
// this module never performs a whole-project server write.

import type { Project } from '../types/model'
import { useAuth } from './authStore'
import { canonicalProjectSnapshot } from './crdt'
import { logWarn } from './logger'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

const LS_PREFIX = 'sequence:project:'
const LS_INDEX = 'sequence:index'

let serverOk = true

function projectHeaders(projectId?: string): HeadersInit {
  const entered = useAuth.getState().entered
  return projectId && entered?.id === projectId ? { authorization: `Bearer ${entered.token}` } : {}
}

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
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/snapshot`, {
      credentials: 'include',
      headers: projectHeaders(id),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`load failed ${res.status}`)
    return (await res.json()) as Project
  })
  if (r !== null) return r
  const raw = localStorage.getItem(LS_PREFIX + id)
  return raw ? (JSON.parse(raw) as Project) : null
}

export async function saveProject(project: Project): Promise<void> {
  // Portable local backup only. The server deliberately rejects legacy PUT
  // because a last-writer-wins JSON body could overwrite concurrent CRDT edits.
  const snapshot = canonicalProjectSnapshot(project)
  localStorage.setItem(LS_PREFIX + project.id, JSON.stringify(snapshot))
  const list = lsList().filter((p) => p.id !== project.id)
  list.unshift({ id: project.id, name: project.name, updatedAt: project.meta.updatedAt })
  lsSaveIndex(list)
}

export async function deleteProject(id: string): Promise<void> {
  const r = await tryServer(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: projectHeaders(id),
    })
    if (!res.ok && res.status !== 404) throw new Error(`delete failed ${res.status}`)
    return true
  })
  if (r) return
  localStorage.removeItem(LS_PREFIX + id)
  lsSaveIndex(lsList().filter((p) => p.id !== id))
}

// ── Named temp autosave (recovery after close/reopen) ───────────────────────
// Best-effort and isolated from the main save's serverOk flag, so a server that
// lacks the /api/autosave endpoint never disables the working by-id save.

export interface AutosaveItem {
  file: string
  name: string
  updatedAt: string
  size: number
}

export async function autosaveProject(project: Project): Promise<void> {
  try {
    await fetch('/api/autosave', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...projectHeaders(project.id) },
      body: JSON.stringify(canonicalProjectSnapshot(project)),
    })
  } catch {
    /* offline / endpoint missing — the by-id save + localStorage already cover persistence */
  }
}

export async function listAutosaves(): Promise<{ dir: string; items: AutosaveItem[] }> {
  try {
    const res = await fetch('/api/autosave', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      if (data && Array.isArray(data.items)) return data as { dir: string; items: AutosaveItem[] }
    }
  } catch {
    /* fall through to the by-id store */
  }
  // Fallback: recover from the by-id project store (older server without autosave).
  const projects = await listProjects()
  return {
    dir: '(서버 임시저장 미지원 — 프로젝트 저장소에서 복구)',
    items: projects.map((p) => ({ file: p.id, name: p.name, updatedAt: p.updatedAt, size: 0 })),
  }
}

export async function loadAutosave(file: string): Promise<Project | null> {
  try {
    const entered = useAuth.getState().entered
    const res = await fetch(`/api/autosave/file/${encodeURIComponent(file)}`, {
      credentials: 'include',
      headers: projectHeaders(entered?.id),
    })
    if (res.ok) return (await res.json()) as Project
  } catch {
    /* fall through */
  }
  // Fallback: treat `file` as a by-id project key.
  return loadProject(file)
}

export async function deleteAutosave(file: string): Promise<void> {
  try {
    const entered = useAuth.getState().entered
    await fetch(`/api/autosave/file/${encodeURIComponent(file)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: projectHeaders(entered?.id),
    })
  } catch {
    /* best-effort */
  }
}
