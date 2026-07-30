// 로그인 게이트 — 서버 모드일 때 로그인 → 프로젝트 선택 → 접속코드 → 편집기.
// 로컬 모드(오프라인 단일 HTML/서버 없음)면 곧장 편집기. ADR-002.
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useAuth } from '../../state/authStore'

const ROLE_LABEL: Record<string, string> = { developer: '개발자', pm: '프로젝트 관리자', user: '사용자' }

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
      <button className="authbar__btn" onClick={exitProject}>프로젝트 변경</button>
      <button className="authbar__btn" onClick={logout}>로그아웃</button>
    </div>
  )
}

function LoginScreen() {
  const login = useAuth((s) => s.login)
  const loading = useAuth((s) => s.loading)
  const error = useAuth((s) => s.error)
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (username && password) login(username.trim(), password)
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">HydroNet</div>
        <div className="auth-title">로그인</div>
        <p className="auth-sub">사내 계정으로 로그인하세요.</p>
        <label className="auth-field">
          <span>아이디</span>
          <input autoFocus value={username} onChange={(e) => setU(e.target.value)} placeholder="사번/ID" />
        </label>
        <label className="auth-field">
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="auth-primary" type="submit" disabled={loading || !username || !password}>
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
  return (
    <div className="auth-screen">
      <div className="auth-card auth-card--wide">
        <div className="auth-title">프로젝트 선택</div>
        <p className="auth-sub">
          {user?.name || user?.id} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role} —
          입장할 프로젝트를 선택하세요.
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
              <li key={p.id}>
                <button className="proj-item" onClick={() => select(p)}>
                  <span className="proj-name">{p.name || p.id}</span>
                  <span className="proj-meta">
                    {ROLE_LABEL[p.role] ?? p.role}
                    {p.role === 'user' && p.hasCode ? ' · 🔒 접속코드' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canCreate && <ProjectCreate />}
        <button className="auth-link" onClick={logout}>로그아웃</button>
      </div>
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
    <form className="proj-create" onSubmit={submit}>
      <label className="auth-field">
        <span>프로젝트 이름</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 양수발전 1호기" />
      </label>
      <label className="auth-field">
        <span>
          접속코드 <em>· 선택(사용자 입장 시 필요, 비우면 코드 없음)</em>
        </span>
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="비워두면 코드 없음" />
      </label>
      <div className="proj-create__actions">
        <button className="auth-primary" type="submit" disabled={loading || !name.trim()}>
          {loading ? '생성 중…' : '생성'}
        </button>
        <button className="auth-link" type="button" onClick={close}>취소</button>
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
          <input autoFocus type="password" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="auth-primary" type="submit" disabled={loading || !code}>
          {loading ? '확인 중…' : '입장'}
        </button>
        <button className="auth-link" type="button" onClick={exitProject}>← 프로젝트 목록</button>
      </form>
    </div>
  )
}
