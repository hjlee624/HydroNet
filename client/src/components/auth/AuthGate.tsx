// 로그인 게이트 — 서버 모드일 때 로그인 → 프로젝트 선택 → 접속코드 → 편집기.
// 로컬 모드(오프라인 단일 HTML/서버 없음)면 곧장 편집기. ADR-002.
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { type ProjectMember, formatLoginPhoneInput, loginPhoneDigits, useAuth } from '../../state/authStore'
import { AdminPanel } from './AdminPanel'

const ROLE_LABEL: Record<string, string> = {
  developer: '개발자',
  pm: '프로젝트 관리자',
  user: '사용자',
}
const PROJ_ROLE_LABEL: Record<string, string> = {
  developer: '개발자',
  pm: '관리자',
  user: '사용자',
}

export function AuthGate({ children }: { children: ReactNode }) {
  const mode = useAuth((s) => s.mode)
  const user = useAuth((s) => s.user)
  const selected = useAuth((s) => s.selected)
  const entered = useAuth((s) => s.entered)
  const init = useAuth((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  if (mode === 'checking') {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--slim">연결 확인 중…</div>
      </div>
    )
  }
  if (mode === 'local') return <>{children}</> // 오프라인/단일 HTML — 로그인 없이 편집
  if (!user) return <LoginScreen />
  if (entered)
    return (
      <div className="auth-app">
        <AuthBar />
        <div className="auth-app__body">{children}</div>
      </div>
    )
  // 로그인은 됐으나 아직 프로젝트 입장 전
  if (selected && selected.role === 'user') return <AccessCodeScreen />
  return <ProjectSelectScreen />
}

function AuthBar() {
  const user = useAuth((s) => s.user)
  const entered = useAuth((s) => s.entered)
  const exitProject = useAuth((s) => s.exitProject)
  const logout = useAuth((s) => s.logout)
  return (
    <div className="authbar" data-export-hide="1">
      <span className="authbar__proj">📁 {entered?.name}</span>
      <span className="authbar__spacer" />
      <span className="authbar__user">
        {user?.name || user?.id} <em>· {ROLE_LABEL[user?.role ?? ''] ?? user?.role}</em>
      </span>
      <button className="authbar__btn" type="button" onClick={exitProject}>
        프로젝트 변경
      </button>
      <button className="authbar__btn" type="button" onClick={logout}>
        로그아웃
      </button>
    </div>
  )
}

function LoginScreen() {
  const login = useAuth((s) => s.login)
  const loading = useAuth((s) => s.loading)
  const error = useAuth((s) => s.error)
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const validPhoneId = /^010\d{8}$/.test(loginPhoneDigits(username))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (validPhoneId && password) login(username, password)
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">HydroNet</div>
        <div className="auth-title">로그인</div>
        <p className="auth-sub">사내 계정으로 로그인하세요.</p>
        <label className="auth-field">
          <span>아이디</span>
          <input
            inputMode="numeric"
            autoComplete="username"
            maxLength={13}
            value={username}
            onChange={(e) => setU(formatLoginPhoneInput(e.target.value))}
            placeholder="010-0000-0000"
            aria-label="전화번호 아이디"
          />
        </label>
        <label className="auth-field">
          <span>비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setP(e.target.value)}
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button
          className="auth-primary"
          type="submit"
          disabled={loading || !validPhoneId || !password}
        >
          {loading ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}

function ProjectSelectScreen() {
  const projects = useAuth((s) => s.projects)
  const select = useAuth((s) => s.select)
  const error = useAuth((s) => s.error)
  const logout = useAuth((s) => s.logout)
  const user = useAuth((s) => s.user)
  const canCreate = user?.role === 'developer' || user?.role === 'pm'
  const isDeveloper = user?.role === 'developer'

  const [memberProjectId, setMemberProjectId] = useState<string | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card--wide">
        <div className="auth-title">프로젝트 선택</div>
        <p className="auth-sub">
          {user?.name || user?.id} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role} — 입장할
          프로젝트를 선택하세요.
        </p>
        {error && <div className="auth-error">{error}</div>}
        {projects.length === 0 ? (
          <div className="auth-empty">
            {canCreate
              ? '아직 프로젝트가 없습니다. 아래에서 새로 만드세요.'
              : '접근 가능한 프로젝트가 없습니다. 관리자에게 문의하세요.'}
          </div>
        ) : (
          <ul className="proj-list">
            {projects.map((p) => (
              <li key={p.id} className="proj-list__item">
                <button className="proj-item" type="button" onClick={() => select(p)}>
                  <span className="proj-name">{p.name || p.id}</span>
                  <span className="proj-meta">
                    {PROJ_ROLE_LABEL[p.role] ?? p.role}
                    {p.role === 'user' && p.hasCode ? ' · 🔒 접속코드' : ''}
                  </span>
                </button>
                {/* 멤버 보기 버튼 — 관리 권한(개발자·PM) 있을 때만 */}
                {canCreate && (
                  <button
                    className="proj-members-btn"
                    type="button"
                    title="참여 인원 보기·관리"
                    onClick={() => setMemberProjectId(memberProjectId === p.id ? null : p.id)}
                    aria-label={`${p.name} 멤버 관리`}
                  >
                    👥
                  </button>
                )}
                {/* 멤버 패널 — 해당 프로젝트만 펼침 */}
                {memberProjectId === p.id && (
                  <MemberPanel
                    projectId={p.id}
                    projectName={p.name}
                    canManage={canCreate}
                    onClose={() => setMemberProjectId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canCreate && <ProjectCreate />}
        {/* 개발자 전용 관리자 도구 버튼 */}
        {isDeveloper && (
          <button
            className="admin-open-btn"
            type="button"
            onClick={() => setAdminOpen(true)}
          >
            ⚙ 관리자 도구
          </button>
        )}
        <button className="auth-link" type="button" onClick={logout}>
          로그아웃
        </button>
      </div>
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </div>
  )
}

// ── 멤버 패널 ──────────────────────────────────────────────────────────────────
function MemberPanel({
  projectId,
  projectName,
  canManage,
  onClose,
}: {
  projectId: string
  projectName: string
  canManage: boolean
  onClose: () => void
}) {
  const entered = useAuth((s) => s.entered)
  const user = useAuth((s) => s.user)

  // 현재 입장 프로젝트와 같을 때만 store 액션 사용 가능. 그 외엔 직접 fetch.
  const storeMembers = useAuth((s) => s.projectMembers)
  const membersLoading = useAuth((s) => s.membersLoading)
  const fetchProjectMembers = useAuth((s) => s.fetchProjectMembers)
  const addMember = useAuth((s) => s.addMember)
  const removeMember = useAuth((s) => s.removeMember)
  const searchableUsers = useAuth((s) => s.searchableUsers)
  const fetchSearchableUsers = useAuth((s) => s.fetchSearchableUsers)

  // 이 패널이 현재 entered 프로젝트와 같은가 — 같으면 store 공유, 아니면 독립 로컬 상태.
  const isCurrent = entered?.id === projectId
  const [localMembers, setLocalMembers] = useState<ProjectMember[] | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const members = isCurrent ? storeMembers : localMembers
  const loading = isCurrent ? membersLoading : localLoading

  // 멤버 추가 UI
  const [addMode, setAddMode] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<'pm' | 'user'>('user')
  const [addBusy, setAddBusy] = useState(false)

  useEffect(() => {
    if (isCurrent) {
      void fetchProjectMembers()
    } else {
      // 다른 프로젝트 — 직접 fetch (entered 토큰 없으면 개발자 세션으로 접근)
      setLocalLoading(true)
      fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data: ProjectMember[]) => {
          // 개발자 역할 필터링
          setLocalMembers(Array.isArray(data) ? (data as {role:string;userId:string;name:string}[]).filter((m) => (m.role as string) !== 'developer') as ProjectMember[] : [])
        })
        .catch(() => setLocalMembers([]))
        .finally(() => setLocalLoading(false))
    }
    if (canManage) void fetchSearchableUsers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!addUserId.trim()) return
    setAddBusy(true)
    setActionError(null)
    try {
      if (isCurrent) {
        await addMember(addUserId.trim(), addRole)
      } else {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: addUserId.trim(), role: addRole }),
        })
        const data = await r.json().catch(() => null)
        if (!r.ok) throw new Error(data?.error || '멤버 추가에 실패했습니다.')
        // 목록 갱신
        setLocalLoading(true)
        const list = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, { credentials: 'include' }).then((r2) => r2.json())
        setLocalMembers(Array.isArray(list) ? (list as {role:string;userId:string;name:string}[]).filter((m) => (m.role as string) !== 'developer') as ProjectMember[] : [])
        setLocalLoading(false)
      }
      setAddMode(false)
      setAddUserId('')
      setAddRole('user')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '추가 오류')
    } finally {
      setAddBusy(false)
    }
  }

  const handleRemove = async (userId: string) => {
    setActionError(null)
    try {
      if (isCurrent) {
        await removeMember(userId)
      } else {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || '삭제 오류') }
        setLocalMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? prev)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '삭제 오류')
    }
  }

  // 자기 자신은 드롭다운에서 제외 (이미 멤버인 사람도 제외)
  const memberIds = new Set(members?.map((m) => m.userId) ?? [])
  const addableUsers = searchableUsers.filter(
    (u) => u.role !== 'developer' && !memberIds.has(u.id) && u.id !== user?.id,
  )

  return (
    <div className="member-panel">
      <div className="member-panel__header">
        <span className="member-panel__title">👥 {projectName} 참여 인원</span>
        <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">✕</button>
      </div>

      {actionError && <div className="member-panel__error">{actionError}</div>}

      {loading ? (
        <div className="member-panel__loading">불러오는 중…</div>
      ) : (
        <ul className="member-list">
          {(members ?? []).map((m) => (
            <li key={m.userId} className="member-item">
              <span className={`member-role-badge member-role-badge--${m.role}`}>
                {PROJ_ROLE_LABEL[m.role] ?? m.role}
              </span>
              <span className="member-name">{m.name || m.userId}</span>
              <span className="member-id">{m.name ? m.userId : ''}</span>
              {canManage && (
                <button
                  className="member-remove-btn"
                  type="button"
                  title="멤버 삭제"
                  onClick={() => void handleRemove(m.userId)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
          {!members?.length && (
            <li className="member-empty">등록된 멤버가 없습니다.</li>
          )}
        </ul>
      )}

      {/* 멤버 추가 (관리자·개발자만) */}
      {canManage && (
        addMode ? (
          <form className="member-add-form" onSubmit={(e) => void handleAdd(e)}>
            <select
              className="member-add-select"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              aria-label="추가할 사용자 선택"
            >
              <option value="">— 사용자 선택 —</option>
              {addableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} (${u.id})` : u.id}
                </option>
              ))}
            </select>
            <select
              className="member-add-role"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as 'pm' | 'user')}
              aria-label="역할 선택"
            >
              <option value="pm">관리자(PM)</option>
              <option value="user">사용자</option>
            </select>
            <button className="member-add-btn member-add-btn--confirm" type="submit" disabled={!addUserId || addBusy}>
              {addBusy ? '…' : '추가'}
            </button>
            <button className="member-add-btn" type="button" onClick={() => { setAddMode(false); setAddUserId('') }}>
              취소
            </button>
          </form>
        ) : (
          <button className="member-add-toggle" type="button" onClick={() => setAddMode(true)}>
            ＋ 멤버 추가
          </button>
        )
      )}
    </div>
  )
}

// 새 프로젝트 생성(개발자·PM). 접속코드는 선택 — 비우면 코드 없이 입장.
function ProjectCreate() {
  const createProject = useAuth((s) => s.createProject)
  const loading = useAuth((s) => s.loading)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const close = () => {
    setOpen(false)
    setName('')
    setCode('')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (await createProject(name.trim(), code.trim() || undefined)) close()
  }
  if (!open) {
    return (
      <button className="proj-create__toggle" type="button" onClick={() => setOpen(true)}>
        ＋ 새 프로젝트 만들기
      </button>
    )
  }
  return (
    <form className="proj-create" onSubmit={(e) => void submit(e)}>
      <label className="auth-field">
        <span>프로젝트 이름</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 양수발전 1호기"
        />
      </label>
      <label className="auth-field">
        <span>
          접속코드 <em>· 선택(사용자 입장 시 필요, 비우면 코드 없음)</em>
        </span>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="비워두면 코드 없음"
        />
      </label>
      <div className="proj-create__actions">
        <button className="auth-primary" type="submit" disabled={loading || !name.trim()}>
          {loading ? '생성 중…' : '생성'}
        </button>
        <button className="auth-link" type="button" onClick={close}>
          취소
        </button>
      </div>
    </form>
  )
}

function AccessCodeScreen() {
  const selected = useAuth((s) => s.selected)
  const enter = useAuth((s) => s.enter)
  const exitProject = useAuth((s) => s.exitProject)
  const loading = useAuth((s) => s.loading)
  const error = useAuth((s) => s.error)
  const [code, setCode] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code) enter(code)
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-title">접속코드 입력</div>
        <p className="auth-sub">
          <b>{selected?.name || selected?.id}</b> 프로젝트의 접속코드를 입력하세요.
        </p>
        <label className="auth-field">
          <span>접속코드</span>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="auth-primary" type="submit" disabled={loading || !code}>
          {loading ? '확인 중…' : '입장'}
        </button>
        <button className="auth-link" type="button" onClick={exitProject}>
          ← 프로젝트 목록
        </button>
      </form>
    </div>
  )
}
