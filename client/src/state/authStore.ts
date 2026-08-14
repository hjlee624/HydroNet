// 인증/세션 상태(zustand) — 서버가 있을 때만 로그인 게이트. 오프라인 단일 HTML(file://)·
// 서버 미탐지 시 'local' 단일사용자 모드로 자동 우회(로그인 없이 편집). ADR-002.
import { create } from 'zustand'

export const loginPhoneDigits = (value: string) => value.replace(/\D/g, '').slice(0, 11)
export const formatLoginPhoneInput = (value: string) => {
  const digits = loginPhoneDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}
export const normalizeLoginSubmission = (value: string) => {
  const digits = value.replace(/\D/g, '')
  return /^010\d{8}$/.test(digits) ? digits : value.trim()
}

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
  /** 활성 여부. 개발자 목록에만 false가 올 수 있다(비활성 프로젝트는 일반 사용자에겐 미노출). */
  active?: boolean
}
export interface EnteredProject {
  id: string
  name: string
  projRole: string
  token: string
}

export interface ProjectMember {
  userId: string
  name: string
  role: 'pm' | 'user'
}

export interface SearchableUser {
  id: string
  name: string
  role: string
}

export interface AdminUser {
  id: string
  name: string
  role: string
  active: boolean
  hasPassword: boolean
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
  /** 현재 프로젝트의 멤버 목록 (개발자 미포함). null = 미로드. */
  projectMembers: ProjectMember[] | null
  membersLoading: boolean
  /** 멤버 추가용 전체 사용자 목록(개발자·PM만 접근). */
  searchableUsers: SearchableUser[]
  /** 관리자 도구용 전체 사용자(개발자 전용). */
  adminUsers: AdminUser[]
  adminLoading: boolean
  adminError: string | null
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProjects: () => Promise<void>
  /** 새 프로젝트 생성(개발자·PM). 성공 시 목록 갱신. */
  createProject: (name: string, accessCode?: string) => Promise<boolean>
  /** 프로젝트 삭제(개발자 전용). 성공 시 목록 갱신. */
  deleteProject: (id: string) => Promise<boolean>
  /** 프로젝트 활성/비활성 전환(개발자 전용). 성공 시 목록 갱신. */
  setProjectActive: (id: string, active: boolean) => Promise<boolean>
  select: (p: ProjectSummary) => Promise<void>
  enter: (code: string) => Promise<void>
  exitProject: () => void
  clearError: () => void
  /** 현재 입장한 프로젝트의 멤버 목록 로드 (개발자 미포함). */
  fetchProjectMembers: () => Promise<void>
  /** 멤버 추가(개발자·PM). */
  addMember: (userId: string, role: 'pm' | 'user') => Promise<void>
  /** 멤버 삭제(개발자·PM). */
  removeMember: (userId: string) => Promise<void>
  /** 멤버 추가용 검색 가능 사용자 목록 로드(개발자·PM). */
  fetchSearchableUsers: () => Promise<void>
  /** 관리자 전체 사용자 목록 로드(개발자 전용). */
  fetchAdminUsers: () => Promise<void>
  /** 사용자 추가·수정(개발자 전용). */
  upsertAdminUser: (u: {
    id: string
    name: string
    role: string
    password?: string
    active?: boolean
  }) => Promise<boolean>
  /** 엑셀/CSV 업로드(개발자 전용). */
  importUsersFile: (base64: string) => Promise<{ imported?: number; error?: string } | null>
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
  j(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

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
  projectMembers: null,
  membersLoading: false,
  searchableUsers: [],
  adminUsers: [],
  adminLoading: false,
  adminError: null,

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
      const r = await post('/api/auth/login', {
        username: normalizeLoginSubmission(username),
        password,
      })
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
    set({
      user: null,
      projects: [],
      selected: null,
      entered: null,
      error: null,
      projectMembers: null,
      searchableUsers: [],
      adminUsers: [],
    })
  },

  refreshProjects: async () => {
    const r = await j('/api/auth/projects')
    if (r.ok && Array.isArray(r.data)) set({ projects: r.data as unknown as ProjectSummary[] })
  },

  createProject: async (name, accessCode) => {
    set({ loading: true, error: null })
    try {
      const r = await post('/api/auth/projects', { name, ...(accessCode ? { accessCode } : {}) })
      if (!r.ok) throw new Error((r.data?.error as string) || '프로젝트 생성에 실패했습니다.')
      await get().refreshProjects()
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '프로젝트 생성 오류' })
      return false
    } finally {
      set({ loading: false })
    }
  },

  deleteProject: async (id) => {
    set({ error: null })
    const r = await j(`/api/auth/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) {
      set({ error: (r.data?.error as string) || '프로젝트 삭제에 실패했습니다.' })
      return false
    }
    await get().refreshProjects()
    return true
  },

  setProjectActive: async (id, active) => {
    set({ error: null })
    const r = await post(`/api/auth/projects/${encodeURIComponent(id)}/active`, { active })
    if (!r.ok) {
      set({ error: (r.data?.error as string) || '프로젝트 상태 변경에 실패했습니다.' })
      return false
    }
    await get().refreshProjects()
    return true
  },

  select: async (p) => {
    set({ selected: p, error: null, projectMembers: null })
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
        projectMembers: null,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '입장 오류' })
    } finally {
      set({ loading: false })
    }
  },

  exitProject: () => set({ selected: null, entered: null, error: null, projectMembers: null }),
  clearError: () => set({ error: null }),

  fetchProjectMembers: async () => {
    const entered = get().entered
    if (!entered) return
    set({ membersLoading: true })
    try {
      const token = entered.token
      const r = await j(`/api/projects/${encodeURIComponent(entered.id)}/members`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
      if (r.ok && Array.isArray(r.data)) {
        // 개발자 역할(developer)은 멤버 목록에서 제외 — 시스템 전체 접근이므로 미표시.
        const members = (r.data as ProjectMember[]).filter(
          (m) => m.role !== ('developer' as string),
        )
        set({ projectMembers: members })
      }
    } finally {
      set({ membersLoading: false })
    }
  },

  addMember: async (userId, role) => {
    const entered = get().entered
    if (!entered) return
    const token = entered.token
    const r = await j(`/api/projects/${encodeURIComponent(entered.id)}/members`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ userId, role }),
    })
    if (!r.ok) throw new Error((r.data?.error as string) || '멤버 추가에 실패했습니다.')
    await get().fetchProjectMembers()
  },

  removeMember: async (userId) => {
    const entered = get().entered
    if (!entered) return
    const token = entered.token
    const r = await j(
      `/api/projects/${encodeURIComponent(entered.id)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    )
    if (!r.ok) throw new Error((r.data?.error as string) || '멤버 삭제에 실패했습니다.')
    await get().fetchProjectMembers()
  },

  fetchSearchableUsers: async () => {
    const r = await j('/api/users/searchable')
    if (r.ok && Array.isArray(r.data)) set({ searchableUsers: r.data as SearchableUser[] })
  },

  fetchAdminUsers: async () => {
    set({ adminLoading: true, adminError: null })
    try {
      const r = await j('/api/admin/users')
      if (r.ok && Array.isArray(r.data)) set({ adminUsers: r.data as AdminUser[] })
      else set({ adminError: (r.data?.error as string) || '사용자 목록을 불러오지 못했습니다.' })
    } finally {
      set({ adminLoading: false })
    }
  },

  upsertAdminUser: async (u) => {
    set({ adminLoading: true, adminError: null })
    try {
      const r = await post('/api/admin/users', u)
      if (!r.ok) throw new Error((r.data?.error as string) || '저장에 실패했습니다.')
      await get().fetchAdminUsers()
      return true
    } catch (e) {
      set({ adminError: e instanceof Error ? e.message : '저장 오류' })
      return false
    } finally {
      set({ adminLoading: false })
    }
  },

  importUsersFile: async (base64) => {
    set({ adminLoading: true, adminError: null })
    try {
      const r = await post('/api/admin/users/import', { fileBase64: base64 })
      if (!r.ok) {
        const msg = (r.data?.error as string) || '업로드에 실패했습니다.'
        set({ adminError: msg })
        return { error: msg }
      }
      await get().fetchAdminUsers()
      return { imported: r.data?.imported as number | undefined }
    } finally {
      set({ adminLoading: false })
    }
  },
}))
