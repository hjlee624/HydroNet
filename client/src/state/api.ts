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

// ── 서버 버전 보관(프로젝트 ID 기준) — F15 ─────────────────────────────────
// 옛 임시저장(/api/autosave)은 파일명을 '프로젝트 이름'으로 잡아 동명 프로젝트끼리
// 서로를 덮어썼고 이력도 남지 않았다. 신규 경로는 ID 폴더 + 시각 버전이며,
// 전역 serverOk 플래그(tryServer)를 건드리지 않는다 — 이 기능이 없는 구서버에
// 붙어도 by-id 저장 경로가 죽지 않게.

/** 서버가 CRDT 영속 시점마다 남긴 버전 스냅샷 한 건. */
export interface ProjectVersion {
  /** 파일명이자 식별자 — 'YYYYMMDDTHHMMSSZ'. */
  version: string
  /** 보관 시각(ISO). */
  savedAt: string
  /** 스냅샷 JSON 바이트 크기. */
  size: number
}

export async function listProjectVersions(
  projectId: string,
): Promise<{ dir: string; keep: number; items: ProjectVersion[] }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`, {
    credentials: 'include',
    headers: projectHeaders(projectId),
  })
  if (!res.ok) throw new Error(`버전 목록을 불러오지 못했습니다 (${res.status})`)
  const data = (await res.json()) as { dir?: string; keep?: number; items?: ProjectVersion[] }
  return {
    dir: typeof data.dir === 'string' ? data.dir : '',
    keep: typeof data.keep === 'number' ? data.keep : 0,
    items: Array.isArray(data.items) ? data.items : [],
  }
}

export async function loadProjectVersion(
  projectId: string,
  version: string,
): Promise<Project | null> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(version)}`,
    { credentials: 'include', headers: projectHeaders(projectId) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`버전을 불러오지 못했습니다 (${res.status})`)
  return (await res.json()) as Project
}

/** 지금 서버에 있는 라이브 CRDT 상태를 버전으로 한 건 남긴다(사용자 명시 조작). */
export async function createProjectVersion(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`, {
    method: 'POST',
    credentials: 'include',
    headers: projectHeaders(projectId),
  })
  if (res.ok) return { ok: true }
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return { ok: false, error: data?.error ?? `버전 저장에 실패했습니다 (${res.status})` }
}
