// 로그인 게이트 — 서버 모드일 때 로그인 → 프로젝트 선택 → 접속코드 → 편집기.
// 로컬 모드(오프라인 단일 HTML/서버 없음)면 곧장 편집기. ADR-002.
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { DIVISIONS, divisionIcon, divisionLabel } from '../../data/divisions'
import {
  formatLoginPhoneInput,
  loginPhoneDigits,
  type ProjectMember,
  type ProjectSummary,
  useAuth,
} from '../../state/authStore'
import { AdminPanel } from './AdminPanel'
import { AuthBackground } from './AuthBackground'

/** 본부 심볼(원형) — 이미지 애셋 + 색 원 폴백. presence 배지와 동일한 결. */
function DivisionSymbol({ division, size = 28 }: { division?: string | null; size?: number }) {
  const icon = divisionIcon(division ?? undefined)
  return (
    <span className="div-symbol" style={{ width: size, height: size }} aria-hidden="true">
      {icon ? <img src={icon} alt="" width={size} height={size} /> : '🏢'}
    </span>
  )
}

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

  if (mode === 'local') return <>{children}</> // 오프라인/단일 HTML — 로그인 없이 편집
  if (user && entered)
    return (
      <div className="auth-app">
        <AuthBar />
        <div className="auth-app__body">{children}</div>
      </div>
    )

  // 로그인 전 화면들(연결 확인·로그인·프로젝트 선택·접속코드)은 공통 모션그래픽 배경 위에 띄운다.
  let screen: ReactNode
  if (mode === 'checking') {
    screen = (
      <div className="auth-screen">
        <div className="auth-card auth-card--slim">연결 확인 중…</div>
      </div>
    )
  } else if (!user) {
    screen = <LoginScreen />
  } else if (selected && selected.role === 'user' && selected.hasCode) {
    screen = <AccessCodeScreen />
  } else {
    screen = <ProjectSelectScreen />
  }
  return (
    <>
      <AuthBackground />
      {screen}
    </>
  )
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
  const [registerOpen, setRegisterOpen] = useState(false)
  const validPhoneId = /^010\d{8}$/.test(loginPhoneDigits(username))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (validPhoneId && password) login(username, password)
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">Sequence</div>
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
        <button className="auth-link" type="button" onClick={() => setRegisterOpen(true)}>
          사용자 등록
        </button>
      </form>
      {registerOpen && <RegisterModal onClose={() => setRegisterOpen(false)} />}
    </div>
  )
}

// 셀프 등록 — 관리자(PM)/사용자 + 본부 선택, 이름, 전화번호(ID), 비밀번호 4자리.
// 사용자는 즉시 로그인 가능, 관리자는 개발자 승인 후 로그인 가능(개발자 대시보드에 알림).
function RegisterModal({ onClose }: { onClose: () => void }) {
  const register = useAuth((s) => s.register)
  const [role, setRole] = useState<'user' | 'pm'>('user')
  const [division, setDivision] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ pending: boolean } | null>(null)

  const validPhone = /^010\d{8}$/.test(loginPhoneDigits(phone))
  const validPw = /^\d{4}$/.test(password)
  const canSubmit = validPhone && validPw && !!division && !!name.trim() && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    const r = await register({ name: name.trim(), phone, password, role, division })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '등록 실패')
    else setDone({ pending: !!r.pending })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <form
        className="proj-create proj-create--modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="member-panel__header">
          <span className="member-panel__title">＋ 사용자 등록</span>
          <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {done ? (
          <div className="register-done">
            {done.pending ? (
              <>
                <b>관리자 등록 신청이 접수되었습니다.</b>
                <p>개발자 승인 후 로그인할 수 있습니다. 승인 알림이 개발자에게 전달되었습니다.</p>
              </>
            ) : (
              <>
                <b>사용자 등록이 완료되었습니다.</b>
                <p>지금 바로 전화번호와 비밀번호로 로그인하세요.</p>
              </>
            )}
            <div className="proj-create__actions">
              <button className="auth-primary" type="button" onClick={onClose}>
                확인
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="register-role">
              <button
                type="button"
                className={`register-role__opt${role === 'user' ? ' is-on' : ''}`}
                onClick={() => setRole('user')}
              >
                사용자
                <em>할당된 프로젝트 편집</em>
              </button>
              <button
                type="button"
                className={`register-role__opt${role === 'pm' ? ' is-on' : ''}`}
                onClick={() => setRole('pm')}
              >
                관리자
                <em>본부 프로젝트 관리(개발자 승인 필요)</em>
              </button>
            </div>
            <label className="auth-field">
              <span>본부</span>
              <select value={division} onChange={(e) => setDivision(e.target.value)}>
                <option value="">— 본부 선택 —</option>
                {DIVISIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>이름</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </label>
            <label className="auth-field">
              <span>전화번호 (아이디)</span>
              <input
                inputMode="numeric"
                maxLength={13}
                value={phone}
                onChange={(e) => setPhone(formatLoginPhoneInput(e.target.value))}
                placeholder="010-0000-0000"
              />
            </label>
            <label className="auth-field">
              <span>비밀번호 (숫자 4자리)</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="숫자 4자리"
              />
            </label>
            {err && <div className="auth-error">{err}</div>}
            <div className="proj-create__actions">
              <button className="auth-primary" type="submit" disabled={!canSubmit}>
                {busy ? '등록 중…' : '등록'}
              </button>
              <button className="auth-link" type="button" onClick={onClose}>
                취소
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

// 프로젝트 이름 키워드로 대표 아이콘 추정(데이터 없이 시각 구분용). 토목 전 분야. 미매칭은 순환 폴백.
function projectIcon(name: string, index: number): string {
  const n = name || ''
  if (/도로|포장|교차로|IC|JCT|공항|활주로/.test(n)) return '🛣'
  if (/교량|대교|육교|고가|거더|사장교|현수교/.test(n)) return '🌉'
  if (/터널|지하차도|개착/.test(n)) return '🚇'
  if (/항만|방파제|안벽|부두|준설|매립|호안/.test(n)) return '⚓'
  if (/철도|궤도|노반|정거장|전철|지하철/.test(n)) return '🚄'
  if (/단지|택지|산업|부지|조성|정지/.test(n)) return '🏘'
  if (/하천|제방|방조제|하구|배수|펌프|저수|댐|용수|수로|취수|정수|상수|하수|관로|물/.test(n))
    return '🌊'
  if (/양수|발전|변전|송전|전력|전기/.test(n)) return '⚡'
  if (/옹벽|사면|보강|지반|기초|말뚝/.test(n)) return '🧱'
  if (/시공|공사|구조물|굴착|축조/.test(n)) return '🏗'
  const fallback = ['🏗', '🛣', '🌉', '🌊', '🏘', '🚄']
  return fallback[index % fallback.length]
}

function ProjectSelectScreen() {
  const projects = useAuth((s) => s.projects)
  const select = useAuth((s) => s.select)
  const error = useAuth((s) => s.error)
  const logout = useAuth((s) => s.logout)
  const user = useAuth((s) => s.user)
  const canCreate = user?.role === 'developer' || user?.role === 'pm'
  const isDeveloper = user?.role === 'developer'
  const pendingApprovals = useAuth((s) => s.pendingApprovals)
  const deleteProject = useAuth((s) => s.deleteProject)
  const setProjectActive = useAuth((s) => s.setProjectActive)
  const onDeleteProject = async (p: ProjectSummary) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`‘${p.name || p.id}’ 프로젝트를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)
    )
      return
    await deleteProject(p.id)
  }
  const onToggleActive = async (p: ProjectSummary) => {
    // 비활성 상태면 활성화, 활성 상태면 비활성화.
    await setProjectActive(p.id, p.active === false)
  }

  const [memberProjectId, setMemberProjectId] = useState<string | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const memberProj = projects.find((p) => p.id === memberProjectId)

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card--dash">
        <header className="proj-dash__head">
          <div className="proj-dash__greet">
            <div className="proj-dash__hello">
              안녕하세요, <b>{user?.name || user?.id}</b> 님
            </div>
            <div className="proj-dash__sub">
              {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              {user?.division
                ? ` · ${divisionLabel(user.division)}`
                : isDeveloper
                  ? ' · 전체 본부'
                  : ''}
              {` · 프로젝트 ${projects.length}`}
              {isDeveloper && pendingApprovals.length > 0
                ? ` · 승인 대기 ${pendingApprovals.length}`
                : ''}{' '}
              — 입장할 프로젝트를 선택하세요.
            </div>
          </div>
          <button className="proj-dash__logout" type="button" onClick={logout}>
            로그아웃
          </button>
        </header>

        {error && <div className="auth-error">{error}</div>}

        {projects.length === 0 && !canCreate ? (
          <div className="auth-empty">접근 가능한 프로젝트가 없습니다. 관리자에게 문의하세요.</div>
        ) : (
          <div className="proj-grid">
            {projects.map((p, i) => (
              <div
                key={p.id}
                className={`proj-card proj-card--${p.role}${p.active === false ? ' proj-card--inactive' : ''}`}
              >
                <button
                  className="proj-card__main"
                  type="button"
                  disabled={p.canEnter === false}
                  title={
                    p.canEnter === false ? '할당된 프로젝트가 아닙니다 (입장 불가)' : undefined
                  }
                  onClick={() => {
                    if (p.canEnter !== false) select(p)
                  }}
                >
                  <span className="proj-card__icon" aria-hidden="true">
                    {projectIcon(p.name, i)}
                  </span>
                  <span className="proj-card__name">{p.name || p.id}</span>
                  {p.division && (
                    <span className="proj-card__div">
                      <DivisionSymbol division={p.division} size={16} />
                      {divisionLabel(p.division)}
                    </span>
                  )}
                  <span className="proj-card__foot">
                    {p.active === false && (
                      <span className="proj-card__inactive-badge">비활성</span>
                    )}
                    {p.canEnter === false ? (
                      <span className="proj-card__badge proj-card__badge--muted">미할당</span>
                    ) : p.canEdit === false ? (
                      <span className="proj-card__badge proj-card__badge--view">조회 전용</span>
                    ) : (
                      <span className="proj-card__badge proj-card__badge--edit">편집 가능</span>
                    )}
                    {p.role === 'user' && p.hasCode && p.canEnter !== false && (
                      <span className="proj-card__lock" title="접속코드 필요">
                        🔒
                      </span>
                    )}
                  </span>
                </button>
                {/* 카드 도구 — 멤버(개발자·PM), 활성토글·삭제(개발자 전용). */}
                <div className="proj-card__tools">
                  {canCreate && (
                    <button
                      className="proj-card__tool"
                      type="button"
                      title="참여 인원 보기·관리"
                      aria-label={`${p.name} 멤버 관리`}
                      onClick={() => setMemberProjectId(p.id)}
                    >
                      👥
                    </button>
                  )}
                  {isDeveloper && (
                    <button
                      className="proj-card__tool"
                      type="button"
                      title={p.active === false ? '활성화' : '비활성화'}
                      aria-label={p.active === false ? '프로젝트 활성화' : '프로젝트 비활성화'}
                      onClick={() => void onToggleActive(p)}
                    >
                      {p.active === false ? '▶' : '⏸'}
                    </button>
                  )}
                  {isDeveloper && (
                    <button
                      className="proj-card__tool proj-card__tool--danger"
                      type="button"
                      title="프로젝트 삭제"
                      aria-label={`${p.name} 삭제`}
                      onClick={() => void onDeleteProject(p)}
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
            ))}
            {canCreate && (
              <button
                className="proj-card proj-card--action"
                type="button"
                onClick={() => setCreateOpen(true)}
              >
                <span className="proj-card__icon" aria-hidden="true">
                  ＋
                </span>
                <span className="proj-card__name">새 프로젝트</span>
              </button>
            )}
            {isDeveloper && (
              <button
                className="proj-card proj-card--action"
                type="button"
                onClick={() => setAdminOpen(true)}
              >
                <span className="proj-card__icon" aria-hidden="true">
                  ⚙
                </span>
                <span className="proj-card__name">관리자 도구</span>
              </button>
            )}
            {isDeveloper && pendingApprovals.length > 0 && (
              <button
                className="proj-card proj-card--action proj-card--pending"
                type="button"
                onClick={() => setAdminOpen(true)}
                title="관리자 등록 승인 대기"
              >
                <span className="proj-card__icon" aria-hidden="true">
                  🔔
                </span>
                <span className="proj-card__name">
                  관리자 승인 대기 <b>{pendingApprovals.length}</b>
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {createOpen && <ProjectCreateModal onClose={() => setCreateOpen(false)} />}
      {memberProj && (
        <div className="admin-overlay" onClick={() => setMemberProjectId(null)}>
          <div className="member-modal" onClick={(e) => e.stopPropagation()}>
            <MemberPanel
              projectId={memberProj.id}
              projectName={memberProj.name}
              canManage={canCreate}
              onClose={() => setMemberProjectId(null)}
            />
          </div>
        </div>
      )}
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
          setLocalMembers(
            Array.isArray(data)
              ? ((data as { role: string; userId: string; name: string }[]).filter(
                  (m) => (m.role as string) !== 'developer',
                ) as ProjectMember[])
              : [],
          )
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
        const list = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
          credentials: 'include',
        }).then((r2) => r2.json())
        setLocalMembers(
          Array.isArray(list)
            ? ((list as { role: string; userId: string; name: string }[]).filter(
                (m) => (m.role as string) !== 'developer',
              ) as ProjectMember[])
            : [],
        )
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
        const r = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
          {
            method: 'DELETE',
            credentials: 'include',
          },
        )
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error(d?.error || '삭제 오류')
        }
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
        <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
          ✕
        </button>
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
          {!members?.length && <li className="member-empty">등록된 멤버가 없습니다.</li>}
        </ul>
      )}

      {/* 멤버 추가 (관리자·개발자만) */}
      {canManage &&
        (addMode ? (
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
            <button
              className="member-add-btn member-add-btn--confirm"
              type="submit"
              disabled={!addUserId || addBusy}
            >
              {addBusy ? '…' : '추가'}
            </button>
            <button
              className="member-add-btn"
              type="button"
              onClick={() => {
                setAddMode(false)
                setAddUserId('')
              }}
            >
              취소
            </button>
          </form>
        ) : (
          <button className="member-add-toggle" type="button" onClick={() => setAddMode(true)}>
            ＋ 멤버 추가
          </button>
        ))}
    </div>
  )
}

// 새 프로젝트 생성(개발자·PM) 모달. 접속코드는 선택 — 비우면 코드 없이 입장.
function ProjectCreateModal({ onClose }: { onClose: () => void }) {
  const createProject = useAuth((s) => s.createProject)
  const loading = useAuth((s) => s.loading)
  const user = useAuth((s) => s.user)
  const isDeveloper = user?.role === 'developer'
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [division, setDivision] = useState('')
  // 개발자는 본부를 선택, PM 은 본인 본부로 고정.
  const effectiveDivision = isDeveloper ? division : (user?.division ?? '')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !effectiveDivision) return
    if (await createProject(name.trim(), code.trim() || undefined, effectiveDivision)) onClose()
  }
  return (
    <div className="admin-overlay" onClick={onClose}>
      <form
        className="proj-create proj-create--modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="member-panel__header">
          <span className="member-panel__title">＋ 새 프로젝트 만들기</span>
          <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <label className="auth-field">
          <span>본부</span>
          {isDeveloper ? (
            <select value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">— 본부 선택 —</option>
              {DIVISIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            <input value={divisionLabel(user?.division ?? undefined)} disabled />
          )}
        </label>
        <label className="auth-field">
          <span>프로젝트 이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: ○○ 도로 확장공사"
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
          <button
            className="auth-primary"
            type="submit"
            disabled={loading || !name.trim() || !effectiveDivision}
          >
            {loading ? '생성 중…' : '생성'}
          </button>
          <button className="auth-link" type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </div>
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
