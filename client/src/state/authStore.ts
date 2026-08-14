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
  /** 소속 본부 키(divisions.ts). 개발자는 null=전체. */
  division?: string | null
}
export interface ProjectSummary {
  id: string
  name: string
  role: UserRole | 'pm' | 'user'
  hasCode: boolean
  /** 활성 여부. 개발자 목록에만 false가 올 수 있다(비활성 프로젝트는 일반 사용자에겐 미노출). */
  active?: boolean
  /** 프로젝트 소속 본부 키. */
  division?: string | null
  /** 입장 가능(개발자·담당·같은 본부 PM). 사용자는 배정 프로젝트만 true. */
  canEnter?: boolean
  /** 편집 가능(개발자·담당). false면 입장해도 조회 전용. */
  canEdit?: boolean
}
export interface EnteredProject {
  id: string
  name: string
  projRole: string
  token: string
  /** 편집 권한. false면 조회 전용으로 입장(WS 읽기전용). */
  canEdit?: boolean
}

/** 개발자 승인 대기(셀프등록 관리자) 항목. */
export interface PendingUser {
  id: string
  name: string
  role: string
  division?: string | null
}
/** 셀프 등록 입력. */
export interface RegisterInput {
  name: string
  phone: string
  password: string
  role: 'pm' | 'user'
  division: string
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
  division?: string | null
  active: boolean
  pending?: boolean
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
  /** 개발자 승인 대기(셀프등록 관리자) 목록 — 대시보드/관리자도구 알림 배지. */
  pendingApprovals: PendingUser[]
  adminLoading: boolean
  adminError: string | null
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProjects: () => Promise<void>
  /** 새 프로젝트 생성(개발자·PM). division 은 개발자만 지정(PM 은 본인 본부로 고정). */
  createProject: (name: string, accessCode?: string, division?: string) => Promise<boolean>
  /** 프로젝트 삭제(개발자 전용). 성공 시 목록 갱신. */
  deleteProject: (id: string) => Promise<boolean>
  /** 프로젝트 활성/비활성 전환(개발자 전용). 성공 시 목록 갱신. */
  setProjectActive: (id: string, active: boolean) => Promise<boolean>
  /** 셀프 등록(공개) — 사용자 즉시 활성, 관리자(PM)는 개발자 승인 대기. */
  register: (input: RegisterInput) => Promise<{ ok: boolean; pending?: boolean; error?: string }>
  /** 개발자 승인 대기(관리자 셀프등록) 목록 로드(개발자 전용). */
  fetchPendingApprovals: () => Promise<void>
  /** 관리자 셀프등록 승인/거절(개발자 전용). 성공 시 목록 갱신. */
  approveUser: (id: string, approve: boolean) => Promise<boolean>
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
    division?: string
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
  pendingApprovals: [],
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
      const u = me.data.user as SessionUser
      set({ mode: 'server', user: u })
      await get().refreshProjects()
      if (u.role === 'developer') await get().fetchPendingApprovals()
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
      const u = r.data?.user as SessionUser
      set({ user: u, mode: 'server' })
      await get().refreshProjects()
      if (u?.role === 'developer') await get().fetchPendingApprovals()
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
      pendingApprovals: [],
    })
  },

  refreshProjects: async () => {
    const r = await j('/api/auth/projects')
    if (r.ok && Array.isArray(r.data)) set({ projects: r.data as unknown as ProjectSummary[] })
  },

  createProject: async (name, accessCode, division) => {
    set({ loading: true, error: null })
    try {
      const r = await post('/api/auth/projects', {
        name,
        ...(accessCode ? { accessCode } : {}),
        ...(division ? { division } : {}),
      })
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

  register: async (input) => {
    const r = await post('/api/auth/register', {
      name: input.name,
      phone: input.phone,
      password: input.password,
      role: input.role,
      division: input.division,
    })
    if (!r.ok) return { ok: false, error: (r.data?.error as string) || '등록에 실패했습니다.' }
    return { ok: true, pending: !!r.data?.pending }
  },

  fetchPendingApprovals: async () => {
    const r = await j('/api/admin/pending')
    if (r.ok && Array.isArray(r.data)) set({ pendingApprovals: r.data as unknown as PendingUser[] })
  },

  approveUser: async (id, approve) => {
    const r = await post(`/api/admin/users/${encodeURIComponent(id)}/approve`, { approve })
    if (!r.ok) {
      set({ adminError: (r.data?.error as string) || '승인 처리에 실패했습니다.' })
      return false
    }
    await get().fetchPendingApprovals()
    return true
  },

  select: async (p) => {
    set({ selected: p, error: null, projectMembers: null })
    // 개발자·PM은 코드 면제, 그리고 접속코드가 없는 프로젝트는 사용자도 바로 입장.
    // 코드가 설정된 프로젝트를 고른 일반 사용자만 접속코드 화면으로 넘어간다.
    if (p.role === 'developer' || p.role === 'pm' || !p.hasCode) await get().enter('')
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
          canEdit: r.data?.canEdit !== false,
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
