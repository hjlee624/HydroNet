// 인증/세션 상태(zustand) — 서버가 있을 때만 로그인 게이트. 오프라인 단일 HTML(file://)은
// 'local' 단일사용자 모드로 우회(로그인 없이 편집). ADR-002.
// F05: 서버 대상 배포에서는 /api/health 무응답을 '서버 없음'으로 단정하지 않는다 — 3회 재시도 후
// 실패하면 serverUnreachable 로 표시해 AuthGate 가 장애 안내 + 명시적 선택을 받게 한다.
import { create } from 'zustand'
import { useProjectPrefs } from './projectPrefsStore'

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
/** 이 빌드가 겨냥한 배포 형태. standalone=오프라인 단독 HTML, server=사내 서버 대상. */
export type DeployMode = 'standalone' | 'server'

/**
 * 주입된 배포 플래그를 배포 모드로 해석한다(F05).
 * vite define 이 없는 실행 환경(tsx 스모크·jsdom mount-test)은 애초에 사내 서버를 겨냥한
 * 배포가 아니므로 'standalone' — 서버 장애 안내를 띄울 대상이 아니다.
 */
export function resolveDeployMode(flag: unknown): DeployMode {
  return flag === 'server' ? 'server' : 'standalone'
}

const DEPLOY_MODE: DeployMode = resolveDeployMode(
  typeof __SEQUENCE_DEPLOY__ === 'undefined' ? null : __SEQUENCE_DEPLOY__,
)

/** 서버 대상 배포에서 /api/health 재시도 타임아웃(고정 3회). 무한 백오프는 쓰지 않는다. */
const PROBE_TIMEOUTS = [1500, 2500, 4000] as const
/** 사용자가 '오프라인으로 계속'을 명시적으로 고른 브라우저 표식. */
const OFFLINE_ACK_KEY = 'sequence:offline-ack'

const lsGetSafe = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const lsRemoveSafe = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 저장소 차단(사생활 보호 모드 등) — 지울 것도 없다 */
  }
}
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
  /** 체험존(본부 샘플) — 같은 본부 누구나 배정 없이 입장·편집. */
  sample?: boolean
}
export interface EnteredProject {
  id: string
  name: string
  projRole: string
  token: string
  /** 편집 권한. false면 조회 전용으로 입장(WS 읽기전용). */
  canEdit?: boolean
}

/** 개발자 승인 대기(셀프등록 관리자) · 비밀번호 초기화 요청 공용 항목. */
export interface PendingUser {
  id: string
  name: string
  role: string
  division?: string | null
  /** 요청 접수 시각(epoch ms). 구버전 데이터엔 없을 수 있음(null). */
  requestedAt?: number | null
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
  /** 소속 본부 키(멤버 추가 시 본부별 필터용). 개발자는 null. */
  division?: string | null
}

/** F07 프로젝트 접근 요청. status='expired' 는 서버가 읽기 시점에 계산해 내려주는 값이다. */
export interface AccessRequest {
  id: string
  projectId: string
  projectName?: string
  userId: string
  userName?: string
  division?: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  requestedAt: number
  expiresAt: number
  decidedBy?: string | null
  decidedByName?: string | null
  decidedAt?: number | null
  decisionReason?: string
}

/** 입장 불가 화면에 보여줄 담당자. 전화번호(로그인 ID)는 서버가 내려주지 않는다. */
export interface ProjectContact {
  name: string
  division?: string | null
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
  /** 빌드 시점에 정해지는 배포 형태 — 화면 라벨과 health 실패 처리 정책이 여기서 갈린다. */
  deployMode: DeployMode
  /** 서버 대상 배포인데 /api/health 가 끝내 응답하지 않음(사용자 선택 대기). */
  serverUnreachable: boolean
  /** 이번 init 에서 시도한 health 프로브 횟수(안내 화면 표시용). */
  probeAttempts: number
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
  /** 비밀번호 초기화 요청 목록(개발자 전용). */
  resetRequests: PendingUser[]
  /** 내가 낸 프로젝트 접근 요청(F07) — 카드 배지·요청 화면 상태 표시. */
  myAccessRequests: AccessRequest[]
  /** 내가 처리해야 할 접근 요청(개발자·해당 프로젝트 PM). */
  incomingAccessRequests: AccessRequest[]
  /** 구 정책 비밀번호로 로그인 → 다음 단계에서 강제 변경 필요. */
  mustChangePassword: boolean
  /** 직전 로그인이 5회 초과 잠금(429)이었나 — 초기화 요청 UI 노출용. */
  loginLocked: boolean
  adminLoading: boolean
  adminError: string | null
  init: () => Promise<void>
  /** 서버 연결 실패 화면의 [다시 시도] — 프로브부터 처음처럼 다시 돈다. */
  retryInit: () => Promise<void>
  /** 서버 연결 실패 화면의 [오프라인으로 계속] — 이 브라우저에 선택을 기억한다. */
  continueOffline: () => void
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
  /** 비밀번호 초기화 요청(공개) — 전화번호로. 성공 여부. */
  requestPasswordReset: (phone: string) => Promise<boolean>
  /** 본인 비밀번호 변경(강제변경 상태면 currentPassword 검증 생략). */
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>
  /** 비밀번호 초기화 요청 목록 로드(개발자 전용). */
  fetchResetRequests: () => Promise<void>
  /** 관리자가 사용자 비밀번호 직접 지정(초기화 처리·임의 변경). 성공 시 목록 갱신. */
  adminSetPassword: (id: string, password: string) => Promise<boolean>
  /** 내 요청 + 처리 대상 요청 로드(F07). 로그인 사용자 누구나. */
  fetchAccessRequests: () => Promise<void>
  /** 접근 요청 접수. **성공해도 입장 권한은 생기지 않는다** — 승인만이 권한을 만든다. */
  requestProjectAccess: (
    projectId: string,
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>
  /** 접근 요청 승인/거절(개발자·해당 프로젝트 PM). 거절은 사유 필수. */
  decideAccessRequest: (
    reqId: string,
    approve: boolean,
    decisionReason?: string,
  ) => Promise<{ ok: boolean; error?: string }>
  /** 담당자(PM) 조회 — 입장 불가 화면에서 '누구에게 요청하는지' 안내용. */
  fetchProjectContacts: (projectId: string) => Promise<ProjectContact[]>
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
  /** 사용자 계정 삭제(개발자 전용). 본인 계정은 불가. */
  deleteAdminUser: (id: string) => Promise<boolean>
  /** 엑셀/CSV 업로드(개발자 전용). */
  importUsersFile: (base64: string) => Promise<{ imported?: number; error?: string } | null>
  /** 네이버웍스 알림 연동 테스트(개발자 전용) — 운영자 본인에게 테스트 DM 발송. */
  testNotify: () => Promise<{ ok: boolean; configured?: boolean; error?: string }>
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

/** 서버 존재 여부 프로브(짧은 타임아웃). 실패=응답 없음 — 곧바로 '서버 없음'으로 단정하지 않는다. */
async function probeServer(timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch('/api/health', { signal: ctrl.signal, credentials: 'include' })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  mode: 'checking',
  deployMode: DEPLOY_MODE,
  serverUnreachable: false,
  probeAttempts: 0,
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
  resetRequests: [],
  myAccessRequests: [],
  incomingAccessRequests: [],
  mustChangePassword: false,
  loginLocked: false,
  adminLoading: false,
  adminError: null,

  init: async () => {
    // 오프라인 단독 실행본(단일 HTML)은 서버가 존재하지 않는 배포 — 프로브 없이 로컬 모드.
    if (get().deployMode === 'standalone') {
      set({ mode: 'local', serverUnreachable: false })
      return
    }
    // 서버 대상 배포: 한 번 느렸다고 조용히 로컬로 떨어뜨리지 않는다. 3회 재시도 후에도
    // 응답이 없으면 사용자에게 '장애' 사실을 알리고 명시적 선택을 받는다.
    const acked = lsGetSafe(OFFLINE_ACK_KEY) === '1'
    let hasServer = false
    for (const [index, timeout] of PROBE_TIMEOUTS.entries()) {
      set({ probeAttempts: index + 1 })
      hasServer = await probeServer(timeout)
      if (hasServer) break
    }
    if (!hasServer) {
      // 이미 '오프라인으로 계속'을 고른 브라우저는 매번 막지 않되, 배지로 상태를 계속 알린다.
      set({ mode: 'local', serverUnreachable: !acked })
      return
    }
    // 서버가 돌아왔다 — '오프라인으로 계속' 표식은 그 장애 한 번에 대한 동의였을 뿐이므로
    // 여기서 지운다. 남겨 두면 이후의 **진짜** 장애가 매번 조용히 로컬 단독 모드로 새고
    // (ServerUnreachableScreen 없이), 사용자는 공유 프로젝트라 믿는 로컬 파일에서 하루를 보낸다.
    lsRemoveSafe(OFFLINE_ACK_KEY)
    set({ serverUnreachable: false })
    // 서버 존재 — 기존 세션 있으면 바로 로그인 상태로.
    const me = await j('/api/auth/me').catch(() => ({ status: 0, ok: false, data: null }))
    if (me.ok && me.data?.user) {
      const u = me.data.user as SessionUser
      set({ mode: 'server', user: u, mustChangePassword: !!me.data.mustChangePassword })
      await get().refreshProjects()
      void get().fetchAccessRequests()
      if (u.role === 'developer') await get().fetchPendingApprovals()
    } else {
      set({ mode: 'server', user: null })
    }
  },

  retryInit: async () => {
    set({ mode: 'checking', serverUnreachable: false, probeAttempts: 0 })
    await get().init()
  },

  continueOffline: () => {
    try {
      localStorage.setItem(OFFLINE_ACK_KEY, '1')
    } catch {
      /* 저장소 차단(사생활 보호 모드 등) — 이번 세션에만 적용된다 */
    }
    set({ mode: 'local', serverUnreachable: false })
  },

  login: async (username, password) => {
    set({ loading: true, error: null, loginLocked: false })
    try {
      const r = await post('/api/auth/login', {
        username: normalizeLoginSubmission(username),
        password,
      })
      if (!r.ok) {
        if (r.status === 429) set({ loginLocked: true }) // 5회 초과 잠금 → 초기화 요청 노출
        throw new Error((r.data?.error as string) || '로그인에 실패했습니다.')
      }
      const u = r.data?.user as SessionUser
      set({ user: u, mode: 'server', mustChangePassword: !!r.data?.mustChangePassword })
      await get().refreshProjects()
      void get().fetchAccessRequests()
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
      resetRequests: [],
      myAccessRequests: [],
      incomingAccessRequests: [],
      mustChangePassword: false,
      loginLocked: false,
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

  requestPasswordReset: async (phone) => {
    const r = await post('/api/auth/reset-request', { phone: normalizeLoginSubmission(phone) })
    return r.ok
  },

  changePassword: async (currentPassword, newPassword) => {
    const r = await post('/api/auth/change-password', { currentPassword, newPassword })
    if (!r.ok)
      return { ok: false, error: (r.data?.error as string) || '비밀번호 변경에 실패했습니다.' }
    set({ mustChangePassword: false })
    return { ok: true }
  },

  fetchResetRequests: async () => {
    const r = await j('/api/admin/reset-requests')
    if (r.ok && Array.isArray(r.data)) set({ resetRequests: r.data as unknown as PendingUser[] })
  },

  adminSetPassword: async (id, password) => {
    const r = await post(`/api/admin/users/${encodeURIComponent(id)}/password`, { password })
    if (!r.ok) {
      set({ adminError: (r.data?.error as string) || '비밀번호 설정에 실패했습니다.' })
      return false
    }
    await get().fetchResetRequests()
    await get().fetchAdminUsers()
    return true
  },

  // ── F07 접근 요청 ───────────────────────────────────────────────────────────
  fetchAccessRequests: async () => {
    const r = await j('/api/auth/access-requests').catch(() => ({
      status: 0,
      ok: false,
      data: null,
    }))
    // 서버가 { mine, incoming } 객체를 준다. 배열(스텁·구버전)이면 조용히 무시 — 목록 화면이
    // 빈 배열로 안전하게 동작한다.
    if (!r.ok || !r.data || Array.isArray(r.data)) return
    const d = r.data as { mine?: unknown; incoming?: unknown }
    set({
      myAccessRequests: Array.isArray(d.mine) ? (d.mine as AccessRequest[]) : [],
      incomingAccessRequests: Array.isArray(d.incoming) ? (d.incoming as AccessRequest[]) : [],
    })
  },

  requestProjectAccess: async (projectId, reason) => {
    const r = await post(`/api/auth/projects/${encodeURIComponent(projectId)}/access-request`, {
      reason,
    })
    if (!r.ok) return { ok: false, error: (r.data?.error as string) || '요청에 실패했습니다.' }
    await get().fetchAccessRequests()
    return { ok: true }
  },

  decideAccessRequest: async (reqId, approve, decisionReason) => {
    const r = await post(`/api/auth/access-requests/${encodeURIComponent(reqId)}/decide`, {
      approve,
      ...(decisionReason ? { decisionReason } : {}),
    })
    if (!r.ok) return { ok: false, error: (r.data?.error as string) || '처리에 실패했습니다.' }
    await get().fetchAccessRequests()
    // 승인은 멤버십을 만든다 — 목록의 canEnter/canEdit 이 즉시 바뀌므로 다시 읽는다.
    await get().refreshProjects()
    return { ok: true }
  },

  fetchProjectContacts: async (projectId) => {
    const r = await j(`/api/auth/projects/${encodeURIComponent(projectId)}/contacts`).catch(() => ({
      status: 0,
      ok: false,
      data: null,
    }))
    const managers = (r.data as { managers?: unknown } | null)?.managers
    return r.ok && Array.isArray(managers) ? (managers as ProjectContact[]) : []
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
      // F08 '최근 열기' — 카드 클릭이 아니라 **입장 성공** 시점에만 기록한다.
      useProjectPrefs.getState().pushRecent(sel.id)
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

  deleteAdminUser: async (id) => {
    set({ adminError: null })
    const r = await j(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) {
      set({ adminError: (r.data?.error as string) || '사용자 삭제에 실패했습니다.' })
      return false
    }
    await get().fetchAdminUsers()
    return true
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

  testNotify: async () => {
    const r = await post('/api/admin/notify/test')
    const d = (r.data ?? {}) as { ok?: boolean; configured?: boolean; error?: string }
    return { ok: !!d.ok, configured: d.configured, error: d.error }
  },
}))
