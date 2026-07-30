// 인증/세션 상태(zustand) — 서버가 있을 때만 로그인 게이트. 오프라인 단일 HTML(file://)·
// 서버 미탐지 시 'local' 단일사용자 모드로 자동 우회(로그인 없이 편집). ADR-002.
import { create } from 'zustand'

export type AuthMode = 'checking' | 'local' | 'server'
export type UserRole = 'developer' | 'pm' | 'user'
export interface SessionUser {
  id: string
  name: string
  role: UserRole
}
export interface ProjectSummary {
  id: string
  name: string
  role: UserRole | 'pm' | 'user'
  hasCode: boolean
}
export interface EnteredProject {
  id: string
  name: string
  projRole: string
  token: string
}

interface AuthState {
  mode: AuthMode
  user: SessionUser | null
  projects: ProjectSummary[]
  /** 선택했으나 아직 입장(접속코드) 전 */
  selected: ProjectSummary | null
  /** 접속코드 통과 후 입장 완료 */
  entered: EnteredProject | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProjects: () => Promise<void>
  select: (p: ProjectSummary) => Promise<void>
  enter: (code: string) => Promise<void>
  exitProject: () => void
  clearError: () => void
}

const j = async (path: string, init?: RequestInit) => {
  const res = await fetch(path, { credentials: 'include', ...init })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }
  return { status: res.status, ok: res.ok, data: data as Record<string, unknown> | null }
}
const post = (path: string, body?: unknown) =>
  j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

/** 서버 존재 여부 프로브(짧은 타임아웃). 실패=오프라인/로컬. */
async function probeServer(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch('/api/health', { signal: ctrl.signal, credentials: 'include' })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  mode: 'checking',
  user: null,
  projects: [],
  selected: null,
  entered: null,
  loading: false,
  error: null,

  init: async () => {
    const hasServer = await probeServer()
    if (!hasServer) {
      set({ mode: 'local' }) // 오프라인/단일 HTML/테스트 → 로그인 없이 편집
      return
    }
    // 서버 존재 — 기존 세션 있으면 바로 로그인 상태로.
    const me = await j('/api/auth/me').catch(() => ({ status: 0, ok: false, data: null }))
    if (me.ok && me.data?.user) {
      set({ mode: 'server', user: me.data.user as SessionUser })
      await get().refreshProjects()
    } else {
      set({ mode: 'server', user: null })
    }
  },

  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      const r = await post('/api/auth/login', { username, password })
      if (!r.ok) throw new Error((r.data?.error as string) || '로그인에 실패했습니다.')
      set({ user: r.data?.user as SessionUser, mode: 'server' })
      await get().refreshProjects()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '로그인 오류' })
    } finally {
      set({ loading: false })
    }
  },

  logout: async () => {
    await post('/api/auth/logout').catch(() => {})
    set({ user: null, projects: [], selected: null, entered: null, error: null })
  },

  refreshProjects: async () => {
    const r = await j('/api/auth/projects')
    if (r.ok && Array.isArray(r.data)) set({ projects: r.data as unknown as ProjectSummary[] })
  },

  select: async (p) => {
    set({ selected: p, error: null })
    // 개발자·PM은 접속코드 면제 → 바로 입장 시도. 그 외는 접속코드 화면으로.
    if (p.role === 'developer' || p.role === 'pm') await get().enter('')
  },

  enter: async (code) => {
    const sel = get().selected
    if (!sel) return
    set({ loading: true, error: null })
    try {
      const r = await post(`/api/auth/projects/${encodeURIComponent(sel.id)}/enter`, { code })
      if (!r.ok) throw new Error((r.data?.error as string) || '입장에 실패했습니다.')
      set({
        entered: {
          id: (r.data?.project as { id: string }).id,
          name: (r.data?.project as { name: string }).name,
          projRole: r.data?.projRole as string,
          token: r.data?.token as string,
        },
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '입장 오류' })
    } finally {
      set({ loading: false })
    }
  },

  exitProject: () => set({ selected: null, entered: null, error: null }),
  clearError: () => set({ error: null }),
}))
