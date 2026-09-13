// 로그인 게이트 — 서버 모드일 때 로그인 → 프로젝트 선택 → 접속코드 → 편집기.
// 로컬 모드(오프라인 단일 HTML/서버 없음)면 곧장 편집기. ADR-002.
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { DIVISIONS, divisionIcon, divisionLabel } from '../../data/divisions'
import {
  type AccessRequest,
  formatLoginPhoneInput,
  loginPhoneDigits,
  type ProjectContact,
  type ProjectMember,
  type ProjectSummary,
  useAuth,
} from '../../state/authStore'
import {
  filterProjects,
  PROJECT_TABS,
  type ProjectTab,
  useProjectPrefs,
} from '../../state/projectPrefsStore'
import { useView } from '../../state/viewStore'
import { PASSWORD_RULE_TEXT, validatePassword } from '../../utils/password'
import { AdminPanel } from './AdminPanel'
import { AuthBackground } from './AuthBackground'
import { DivisionShowcase } from './DivisionShowcase'

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
  const mustChange = useAuth((s) => s.mustChangePassword)
  const init = useAuth((s) => s.init)
  const deployMode = useAuth((s) => s.deployMode)
  const serverUnreachable = useAuth((s) => s.serverUnreachable)

  useEffect(() => {
    init()
  }, [init])

  // F05: 서버 대상 배포인데 서버가 응답하지 않음 — 조용히 무권한 로컬 편집으로 떨어지지 않는다.
  if (serverUnreachable)
    return (
      <>
        <AuthBackground />
        <ServerUnreachableScreen />
      </>
    )
  if (mode === 'local')
    return (
      <>
        {deployMode === 'standalone' ? (
          <div className="deploy-badge" role="status">
            💾 오프라인 단독 실행본 — 이 PC에만 저장됩니다
          </div>
        ) : (
          <div className="deploy-badge deploy-badge--warn" role="status">
            ⚠ 서버 미연결 — 로컬 모드(이 PC에만 저장, 협업 아님)
          </div>
        )}
        {children}
      </>
    )
  // 구 정책 비밀번호 → 새 정책으로 강제 변경(프로젝트 진입 전 차단).
  if (user && mustChange)
    return (
      <>
        <AuthBackground />
        <ForcedPasswordChange />
      </>
    )
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
  const view = useView((s) => s.view)
  const setView = useView((s) => s.setView)
  const [pwOpen, setPwOpen] = useState(false)
  return (
    <div className="authbar" data-export-hide="1">
      <span className="authbar__proj">📁 {entered?.name}</span>
      <div className="authbar__switch" role="tablist" aria-label="화면 전환">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'dashboard'}
          className={`authbar__seg${view === 'dashboard' ? ' is-on' : ''}`}
          onClick={() => setView('dashboard')}
        >
          📊 총괄
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'schedule'}
          className={`authbar__seg${view === 'schedule' ? ' is-on' : ''}`}
          onClick={() => setView('schedule')}
        >
          📅 공정표
        </button>
      </div>
      <span className="authbar__spacer" />
      <span className="authbar__user">
        {user?.name || user?.id} <em>· {ROLE_LABEL[user?.role ?? ''] ?? user?.role}</em>
      </span>
      <button className="authbar__btn" type="button" onClick={() => setPwOpen(true)}>
        비밀번호 변경
      </button>
      <button className="authbar__btn" type="button" onClick={exitProject}>
        프로젝트 변경
      </button>
      <button className="authbar__btn" type="button" onClick={logout}>
        로그아웃
      </button>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

// 서버 대상 배포인데 /api/health 가 3회 모두 무응답일 때의 안내 화면(F05).
// 조용한 로컬 강등 대신 '무슨 일이 났는지'를 말하고 사용자에게 선택을 넘긴다.
function ServerUnreachableScreen() {
  const retryInit = useAuth((s) => s.retryInit)
  const continueOffline = useAuth((s) => s.continueOffline)
  const attempts = useAuth((s) => s.probeAttempts)
  const checking = useAuth((s) => s.mode) === 'checking'
  const host = typeof window !== 'undefined' ? window.location.host : ''
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-title">서버에 연결할 수 없습니다</div>
        <p className="auth-sub">
          사내 서버<b>{host ? ` (${host})` : ''}</b>가 응답하지 않습니다. 네트워크·VPN·서버 기동
          상태를 확인하세요. (시도 {attempts}회)
        </p>
        <p className="auth-note auth-note--warn">
          지금 그대로 편집하면 <b>협업 프로젝트가 아니라 이 PC의 로컬 작성본</b>이 됩니다. 서버로
          자동 동기화되지 않으니, 서버 복구 후 파일(.json)로 옮겨야 합니다. 이전에 저장해 둔 작업
          파일은 오프라인으로 계속한 뒤 상단바의 <b>불러오기</b>로 열 수 있습니다.
        </p>
        <button
          className="auth-primary"
          type="button"
          disabled={checking}
          onClick={() => void retryInit()}
        >
          {checking ? '연결 확인 중…' : '다시 시도'}
        </button>
        <button className="auth-link" type="button" onClick={continueOffline}>
          오프라인으로 계속 — 이 PC에만 저장
        </button>
      </div>
    </div>
  )
}

function LoginScreen() {
  const login = useAuth((s) => s.login)
  const loading = useAuth((s) => s.loading)
  const error = useAuth((s) => s.error)
  const loginLocked = useAuth((s) => s.loginLocked)
  const requestPasswordReset = useAuth((s) => s.requestPasswordReset)
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const validPhoneId = /^010\d{8}$/.test(loginPhoneDigits(username))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (validPhoneId && password) login(username, password)
  }
  return (
    <div className="auth-screen auth-screen--split">
      <div className="auth-brandmark">
        <span className="auth-brandmark__name">Sequence</span>
        <span className="auth-brandmark__tag">건설 공정 관리 · 예정공정표 · 마일스톤</span>
      </div>
      <div className="auth-split">
        <div className="auth-split__left">
          <DivisionShowcase />
        </div>
        <div className="auth-split__right">
          <form className="auth-card" onSubmit={submit}>
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
            {loginLocked && (
              <div className="auth-reset">
                <p className="auth-note auth-note--warn">
                  로그인 5회 초과로 잠겼습니다. 관리자에게 비밀번호 초기화를 요청할 수 있습니다.
                </p>
                <button
                  className="auth-link"
                  type="button"
                  disabled={resetBusy || !validPhoneId}
                  onClick={async () => {
                    setResetBusy(true)
                    const ok = await requestPasswordReset(username)
                    setResetBusy(false)
                    setResetMsg(
                      ok
                        ? '관리자에게 초기화 요청을 보냈습니다. 처리되면 새 비밀번호를 안내받으세요.'
                        : '요청 전송 실패 — 전화번호(아이디)를 확인하세요.',
                    )
                  }}
                >
                  {resetBusy ? '요청 중…' : '비밀번호 초기화 요청'}
                </button>
                {resetMsg && <div className="auth-note">{resetMsg}</div>}
              </div>
            )}
          </form>
        </div>
      </div>
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
  const pwChk = validatePassword(password)
  const validPw = pwChk.ok
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
              <span>비밀번호</span>
              <input
                type="password"
                autoComplete="new-password"
                maxLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value.slice(0, 12))}
                placeholder={PASSWORD_RULE_TEXT}
              />
            </label>
            {password && !validPw && (
              <div className="auth-note auth-note--warn">{pwChk.reason}</div>
            )}
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

// 구 정책 비밀번호로 로그인 시 강제 변경 화면 — 세션은 인증됨이라 현재 비밀번호 없이 새 비밀번호만.
function ForcedPasswordChange() {
  const changePassword = useAuth((s) => s.changePassword)
  const logout = useAuth((s) => s.logout)
  const user = useAuth((s) => s.user)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pwChk = validatePassword(next)
  const canSubmit = pwChk.ok && next === confirm && !busy
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    const r = await changePassword('', next)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '변경 실패')
    // 성공 시 mustChangePassword=false → AuthGate가 다음 화면으로 전환.
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <div className="auth-title">비밀번호 변경 필요</div>
        <p className="auth-sub">
          <b>{user?.name || user?.id}</b> 님, 보안 정책 변경으로 새 비밀번호 설정이 필요합니다.
        </p>
        <label className="auth-field">
          <span>새 비밀번호</span>
          <input
            type="password"
            autoComplete="new-password"
            maxLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value.slice(0, 12))}
            placeholder={PASSWORD_RULE_TEXT}
            autoFocus
          />
        </label>
        {next && !pwChk.ok && <div className="auth-note auth-note--warn">{pwChk.reason}</div>}
        <label className="auth-field">
          <span>새 비밀번호 확인</span>
          <input
            type="password"
            autoComplete="new-password"
            maxLength={12}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.slice(0, 12))}
          />
        </label>
        {confirm && next !== confirm && (
          <div className="auth-note auth-note--warn">비밀번호가 일치하지 않습니다.</div>
        )}
        {err && <div className="auth-error">{err}</div>}
        <button className="auth-primary" type="submit" disabled={!canSubmit}>
          {busy ? '설정 중…' : '새 비밀번호 설정'}
        </button>
        <button className="auth-link" type="button" onClick={logout}>
          로그아웃
        </button>
      </form>
    </div>
  )
}

// 본인 비밀번호 변경 모달 — 현재 비밀번호 확인 + 새 비밀번호(정책). 대시보드·상단바에서 호출.
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const changePassword = useAuth((s) => s.changePassword)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const pwChk = validatePassword(next)
  const canSubmit = !!cur && pwChk.ok && next === confirm && !busy
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    const r = await changePassword(cur, next)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '변경 실패')
    else setDone(true)
  }
  return (
    <div className="admin-overlay" onClick={onClose}>
      <form
        className="proj-create proj-create--modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="member-panel__header">
          <span className="member-panel__title">🔑 비밀번호 변경</span>
          <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {done ? (
          <div className="register-done">
            <b>비밀번호가 변경되었습니다.</b>
            <p>다음 로그인부터 새 비밀번호를 사용하세요.</p>
            <div className="proj-create__actions">
              <button className="auth-primary" type="button" onClick={onClose}>
                확인
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="auth-field">
              <span>현재 비밀번호</span>
              <input
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>새 비밀번호</span>
              <input
                type="password"
                autoComplete="new-password"
                maxLength={12}
                value={next}
                onChange={(e) => setNext(e.target.value.slice(0, 12))}
                placeholder={PASSWORD_RULE_TEXT}
              />
            </label>
            {next && !pwChk.ok && <div className="auth-note auth-note--warn">{pwChk.reason}</div>}
            <label className="auth-field">
              <span>새 비밀번호 확인</span>
              <input
                type="password"
                autoComplete="new-password"
                maxLength={12}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.slice(0, 12))}
              />
            </label>
            {confirm && next !== confirm && (
              <div className="auth-note auth-note--warn">새 비밀번호가 일치하지 않습니다.</div>
            )}
            {err && <div className="auth-error">{err}</div>}
            <div className="proj-create__actions">
              <button className="auth-primary" type="submit" disabled={!canSubmit}>
                {busy ? '변경 중…' : '변경'}
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
  const [pwOpen, setPwOpen] = useState(false)
  const memberProj = projects.find((p) => p.id === memberProjectId)

  // ── F08 개인 업무 홈: 검색 · 탭 · 즐겨찾기 · 최근 ──
  // 입력은 언제나 서버가 권한으로 걸러 내려준 `projects` 하나뿐이다. filterProjects 는 그 배열에서
  // 고르기만 하므로(부분집합 보장), 어떤 탭·검색어를 써도 권한 범위는 넓어지지 않는다.
  const recent = useProjectPrefs((s) => s.recent)
  const favourites = useProjectPrefs((s) => s.favourites)
  const toggleFavourite = useProjectPrefs((s) => s.toggleFavourite)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<ProjectTab>(isDeveloper ? 'all' : 'mine')
  const filtered = filterProjects(projects, tab, q, recent, favourites)
  const searching = q.trim().length > 0 || tab !== 'all'

  // ── F07 접근 요청 ──
  const myAccessRequests = useAuth((s) => s.myAccessRequests)
  const incomingAccessRequests = useAuth((s) => s.incomingAccessRequests)
  const [accessProjectId, setAccessProjectId] = useState<string | null>(null)
  const accessProj = projects.find((p) => p.id === accessProjectId)
  // 프로젝트별 '가장 최근 내 요청' — 카드 배지와 요청 화면이 같은 사실을 본다.
  const latestRequestFor = (projectId: string): AccessRequest | undefined =>
    myAccessRequests
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.requestedAt - a.requestedAt)[0]

  // 개발자: 왼쪽 본부 목록에서 고른 본부만 프로젝트 표시(초기 미선택 → 안내만).
  const [selectedDiv, setSelectedDiv] = useState<string | null>(null)
  const countByDiv = new Map<string, number>()
  for (const p of projects) {
    const k = p.division ?? ''
    countByDiv.set(k, (countByDiv.get(k) ?? 0) + 1)
  }
  // 검색어·탭이 걸려 있으면 본부 nav 를 우회해 전체(=개발자 권한 범위)에서 찾는다.
  const shownProjects = searching
    ? filtered
    : selectedDiv == null
      ? []
      : projects.filter((p) => (p.division ?? '') === selectedDiv)

  // 스크롤 리빌 — 첫 화면 **밖에서 시작한** 카드만 접어 두었다가 들어올 때 편다. 화면 안의
  // 카드는 CSS 진입 안무가 이미 담당하므로 건드리지 않는다(두 애니메이션이 겹치면 깜빡인다).
  //
  // 안전장치 둘: (1) IntersectionObserver 가 없으면(jsdom·구형 브라우저) 아무것도 하지 않아
  // 카드가 평소대로 보인다. (2) 접는 클래스(js-reveal)는 관찰을 **시작한 뒤에** 붙인다 —
  // 먼저 숨기고 관찰에 실패하면 카드가 영영 안 보인다.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const cards = document.querySelectorAll<HTMLElement>('.proj-grid .proj-card')
    if (!cards.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    for (const card of cards) {
      if (card.dataset.reveal) continue
      card.dataset.reveal = '1'
      if (card.getBoundingClientRect().top <= window.innerHeight) continue
      io.observe(card)
      card.classList.add('js-reveal')
    }
    return () => {
      io.disconnect()
    }
  })

  // 검색바 + 탭 칩. 건수는 현재 검색어를 반영한다(빈 탭을 눌러 헤매지 않도록).
  const toolbar = (
    <div className="proj-filter">
      <input
        className="proj-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="프로젝트 이름 검색"
        aria-label="프로젝트 이름 검색"
      />
      <div className="proj-filter__chips">
        {PROJECT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`proj-filter__chip${tab === t.id ? ' is-on' : ''}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <em>{filterProjects(projects, t.id, q, recent, favourites).length}</em>
          </button>
        ))}
      </div>
    </div>
  )

  // 프로젝트 카드 한 장 — 개발자(본부 필터) 그리드와 일반 그리드가 공용으로 쓴다.
  const renderCard = (p: ProjectSummary, i: number) => {
    const fav = favourites.includes(p.id)
    const isRecent = recent.includes(p.id)
    const myReq = latestRequestFor(p.id)
    const blocked = p.canEnter === false
    return (
      <div
        key={p.id}
        className={`proj-card proj-card--${p.role}${p.active === false ? ' proj-card--inactive' : ''}`}
        // 본부 대표 이미지를 카드 배경 레이어로 넘긴다(CSS 가 아주 옅게 깔고 hover 에서 살린다).
        // `--i` 는 등장 순서 — CSS 가 이 값으로 stagger 지연을 만든다. nth-child 로는 개수만큼
        // 규칙을 써야 하고 상한에서 끊기지만, 이 방식은 카드가 몇 개든 순서대로 흐른다.
        // 인라인 style 인 이유: 본부 키·순번이 런타임 값이라 CSS 만으로는 고를 수 없다.
        style={
          {
            '--i': i,
            ...(p.division ? { '--card-hero': `url(/divisions/hero/${p.division}.jpg)` } : {}),
          } as CSSProperties
        }
      >
        <button
          className="proj-card__main"
          type="button"
          title={
            blocked
              ? '할당된 프로젝트가 아닙니다 — 담당자에게 접근을 요청할 수 있습니다'
              : undefined
          }
          onClick={() => {
            // 미배정이어도 비활성 버튼으로 막지 않는다 — 담당자와 요청 방법을 안내한다(F07).
            if (blocked) setAccessProjectId(p.id)
            else select(p)
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
            {p.active === false && <span className="proj-card__inactive-badge">비활성</span>}
            {p.sample ? (
              <span className="proj-card__badge proj-card__badge--sample">체험존</span>
            ) : blocked ? (
              <span className="proj-card__badge proj-card__badge--muted">미할당</span>
            ) : p.canEdit === false ? (
              <span className="proj-card__badge proj-card__badge--view">조회 전용</span>
            ) : (
              <span className="proj-card__badge proj-card__badge--edit">편집 가능</span>
            )}
            {/* 내 접근 요청 상태(F07) — 요청했다는 사실과 그 결과가 카드에서 바로 보인다. */}
            {blocked && myReq?.status === 'pending' && (
              <span className="proj-card__badge proj-card__badge--req">승인 대기</span>
            )}
            {blocked && myReq?.status === 'rejected' && (
              <span className="proj-card__badge proj-card__badge--req-no">거절됨</span>
            )}
            {blocked && myReq?.status === 'expired' && (
              <span className="proj-card__badge proj-card__badge--req-no">요청 만료</span>
            )}
            {isRecent && !blocked && (
              <span className="proj-card__badge proj-card__badge--recent">🕒 최근</span>
            )}
            {p.role === 'user' && p.hasCode && !blocked && (
              <span className="proj-card__lock" title="접속코드 필요">
                🔒
              </span>
            )}
          </span>
        </button>
        {/* 카드 도구 — 즐겨찾기(전원), 멤버(개발자·PM), 활성토글·삭제(개발자 전용). */}
        <div className="proj-card__tools">
          {/* 즐겨찾기는 개인 설정이라 권한과 무관하게 누구나 쓴다(목록 데이터는 건드리지 않는다). */}
          <button
            className={`proj-card__tool${fav ? ' is-fav' : ''}`}
            type="button"
            title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
            aria-label={`${p.name || p.id} ${fav ? '즐겨찾기 해제' : '즐겨찾기'}`}
            aria-pressed={fav}
            onClick={() => toggleFavourite(p.id)}
          >
            {fav ? '★' : '☆'}
          </button>
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
    )
  }

  return (
    <div className="auth-screen auth-screen--dash">
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
                : ''}
              {canCreate && incomingAccessRequests.length > 0
                ? ` · 접근 요청 ${incomingAccessRequests.length}`
                : ''}{' '}
              —{' '}
              {isDeveloper
                ? '왼쪽에서 본부를 선택하거나 위에서 검색하세요.'
                : '입장할 프로젝트를 선택하세요.'}
            </div>
          </div>
          <div className="proj-dash__actions">
            <button className="proj-dash__logout" type="button" onClick={() => setPwOpen(true)}>
              비밀번호 변경
            </button>
            <button className="proj-dash__logout" type="button" onClick={logout}>
              로그아웃
            </button>
          </div>
        </header>

        {toolbar}

        {error && <div className="auth-error">{error}</div>}

        {isDeveloper ? (
          <div className="proj-dash__body">
            {/* 좌: 본부 목록 — 클릭한 본부의 프로젝트만 우측에 표시. + 개발자 도구. */}
            <nav className="proj-divnav">
              <div className="proj-divnav__title">본부</div>
              <ul className="proj-divnav__list">
                {DIVISIONS.map((d) => (
                  <li key={d.key}>
                    <button
                      type="button"
                      className={`proj-divnav__item${selectedDiv === d.key ? ' is-active' : ''}`}
                      onClick={() => setSelectedDiv(d.key)}
                    >
                      <DivisionSymbol division={d.key} size={18} />
                      <span className="proj-divnav__name">{d.label}</span>
                      <span className="proj-divnav__count">{countByDiv.get(d.key) ?? 0}</span>
                    </button>
                  </li>
                ))}
                {(countByDiv.get('') ?? 0) > 0 && (
                  <li>
                    <button
                      type="button"
                      className={`proj-divnav__item${selectedDiv === '' ? ' is-active' : ''}`}
                      onClick={() => setSelectedDiv('')}
                    >
                      <DivisionSymbol division={null} size={18} />
                      <span className="proj-divnav__name">본부 미지정</span>
                      <span className="proj-divnav__count">{countByDiv.get('') ?? 0}</span>
                    </button>
                  </li>
                )}
              </ul>
              <div className="proj-divnav__tools">
                <button
                  type="button"
                  className="proj-divnav__tool"
                  onClick={() => setAdminOpen(true)}
                >
                  ⚙ 관리자 도구
                </button>
                {pendingApprovals.length > 0 && (
                  <button
                    type="button"
                    className="proj-divnav__tool proj-divnav__tool--pending"
                    onClick={() => setAdminOpen(true)}
                    title="관리자 등록 승인 대기"
                  >
                    🔔 승인 대기 <b>{pendingApprovals.length}</b>
                  </button>
                )}
              </div>
            </nav>
            {/* 우: 선택한 본부의 프로젝트 */}
            <div className="proj-dash__main">
              {!searching && selectedDiv == null ? (
                <div className="proj-dash__hint">
                  왼쪽에서 본부를 선택하면 해당 본부의 프로젝트가 표시됩니다. 위 검색창·필터를 쓰면
                  전체 본부에서 바로 찾습니다.
                </div>
              ) : (
                <>
                  <div className="proj-dash__mainhead">
                    <span className="proj-dash__maintitle">
                      {searching
                        ? '검색 결과'
                        : selectedDiv === ''
                          ? '본부 미지정'
                          : divisionLabel(selectedDiv ?? '')}
                      <span className="proj-dash__maincount"> · {shownProjects.length}</span>
                    </span>
                    <button
                      type="button"
                      className="proj-dash__new"
                      onClick={() => setCreateOpen(true)}
                    >
                      ＋ 새 프로젝트
                    </button>
                  </div>
                  {shownProjects.length === 0 ? (
                    <div className="auth-empty">
                      {searching
                        ? '조건에 맞는 프로젝트가 없습니다.'
                        : '이 본부에 등록된 프로젝트가 없습니다.'}
                    </div>
                  ) : (
                    <div className="proj-grid">{shownProjects.map((p, i) => renderCard(p, i))}</div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : projects.length === 0 && !canCreate ? (
          <div className="auth-empty">접근 가능한 프로젝트가 없습니다. 관리자에게 문의하세요.</div>
        ) : filtered.length === 0 && !canCreate ? (
          <div className="auth-empty">
            조건에 맞는 프로젝트가 없습니다. ‘전체’ 탭을 눌러 본부의 모든 프로젝트를 보세요.
          </div>
        ) : (
          <div className="proj-grid">
            {filtered.map((p, i) => renderCard(p, i))}
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
          </div>
        )}
      </div>

      {createOpen && (
        <ProjectCreateModal
          onClose={() => setCreateOpen(false)}
          defaultDivision={isDeveloper && selectedDiv ? selectedDiv : ''}
        />
      )}
      {memberProj && (
        <div className="admin-overlay" onClick={() => setMemberProjectId(null)}>
          <div className="member-modal" onClick={(e) => e.stopPropagation()}>
            <MemberPanel
              projectId={memberProj.id}
              projectName={memberProj.name}
              canManage={canCreate}
              defaultDivision={memberProj.division ?? ''}
              onClose={() => setMemberProjectId(null)}
            />
          </div>
        </div>
      )}
      {accessProj && (
        <AccessRequestModal
          project={accessProj}
          request={latestRequestFor(accessProj.id)}
          onClose={() => setAccessProjectId(null)}
        />
      )}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

/** 요청/처리 시각 표기 — 승인 대기·초기화 요청 목록과 같은 ko-KR 표기. */
function formatMoment(ms?: number | null): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('ko-KR')
  } catch {
    return '—'
  }
}

// 입장 불가 카드를 눌렀을 때(F07) — 담당자가 누구인지 알려주고, 접근을 요청하게 한다.
// 이 화면에서 하는 어떤 행동도 입장 권한을 만들지 않는다. 승인은 담당 PM·개발자만 한다.
function AccessRequestModal({
  project,
  request,
  onClose,
}: {
  project: ProjectSummary
  request?: AccessRequest
  onClose: () => void
}) {
  const fetchProjectContacts = useAuth((s) => s.fetchProjectContacts)
  const requestProjectAccess = useAuth((s) => s.requestProjectAccess)
  const [contacts, setContacts] = useState<ProjectContact[] | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchProjectContacts(project.id).then((list) => {
      if (alive) setContacts(list)
    })
    return () => {
      alive = false
    }
  }, [project.id, fetchProjectContacts])

  // 배경 클릭 대신 Esc 로 닫는다 — 배경 div 에 onClick 을 달면 키보드로 도달할 수 없는
  // 상호작용이 되어(a11y) 접근성 진단이 늘어난다. 닫기는 Esc · ✕ · [닫기] 세 경로.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 대기 중이면 새 요청을 받지 않는다(서버도 409 로 막는다). 거절·만료는 다시 요청할 수 있다.
  const pending = request?.status === 'pending'
  const canSubmit = !pending && !sent && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    const r = await requestProjectAccess(project.id, reason.trim())
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '요청 실패')
    else setSent(true)
  }

  return (
    <div className="admin-overlay">
      <form className="proj-create proj-create--modal" onSubmit={(e) => void submit(e)}>
        <div className="member-panel__header">
          <span className="member-panel__title">
            🔒 {project.name || project.id} — 입장 권한 없음
          </span>
          <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="access-req">
          <div className="access-req__label">담당자</div>
          {contacts === null ? (
            <div className="member-panel__loading">불러오는 중…</div>
          ) : contacts.length === 0 ? (
            <div className="auth-note auth-note--warn">
              이 프로젝트의 담당 관리자가 아직 지정되지 않았습니다 — 개발자에게 문의하세요.
            </div>
          ) : (
            <ul className="access-req__contacts">
              {contacts.map((c) => (
                <li key={`${c.name}-${c.division ?? ''}`} className="access-req__contact">
                  <DivisionSymbol division={c.division} size={18} />
                  <b>{c.name || '(이름 미등록)'}</b>
                  <em>
                    {divisionLabel(c.division ?? undefined)} · {ROLE_LABEL[c.role] ?? c.role}
                  </em>
                </li>
              ))}
            </ul>
          )}
        </div>

        {request && (
          <div className={`access-req__status access-req__status--${request.status}`}>
            {request.status === 'pending' && (
              <>
                <b>승인 대기 중입니다.</b>
                <p>
                  요청 {formatMoment(request.requestedAt)} · 기한 {formatMoment(request.expiresAt)}
                  <br />
                  승인 전까지는 입장할 수 없습니다.
                </p>
              </>
            )}
            {request.status === 'rejected' && (
              <>
                <b>요청이 거절되었습니다.</b>
                <p>
                  {request.decidedByName ? `${request.decidedByName} · ` : ''}
                  {formatMoment(request.decidedAt)}
                  <br />
                  사유: {request.decisionReason || '(미기재)'}
                </p>
              </>
            )}
            {request.status === 'expired' && (
              <>
                <b>요청 기한이 지났습니다.</b>
                <p>기한 {formatMoment(request.expiresAt)} · 다시 요청할 수 있습니다.</p>
              </>
            )}
            {request.status === 'approved' && (
              <>
                <b>승인되었습니다.</b>
                <p>목록을 새로 고치면 입장할 수 있습니다.</p>
              </>
            )}
          </div>
        )}

        {sent ? (
          <div className="register-done">
            <b>접근 요청을 보냈습니다.</b>
            <p>담당자가 승인하면 입장할 수 있습니다. 승인 전까지 입장은 계속 차단됩니다.</p>
            <div className="proj-create__actions">
              <button className="auth-primary" type="button" onClick={onClose}>
                확인
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="auth-field">
              <span>
                요청 사유 <em>· 선택(최대 300자)</em>
              </span>
              <textarea
                className="access-req__reason"
                rows={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 300))}
                placeholder="예: 3공구 공정표 작성 담당입니다."
                disabled={pending}
              />
            </label>
            {err && <div className="auth-error">{err}</div>}
            <div className="proj-create__actions">
              <button className="auth-primary" type="submit" disabled={!canSubmit}>
                {busy ? '요청 중…' : pending ? '이미 요청함' : '접근 요청'}
              </button>
              <button className="auth-link" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

// ── 멤버 패널 ──────────────────────────────────────────────────────────────────
function MemberPanel({
  projectId,
  projectName,
  canManage,
  defaultDivision,
  onClose,
}: {
  projectId: string
  projectName: string
  canManage: boolean
  /** 프로젝트 소속 본부 — 멤버 추가 시 본부 선택 기본값. */
  defaultDivision?: string | null
  onClose: () => void
}) {
  const entered = useAuth((s) => s.entered)
  const user = useAuth((s) => s.user)

  // 현재 입장 프로젝트와 같을 때만 store 액션 사용 가능. 그 외엔 직접 fetch.
  const storeMembers = useAuth((s) => s.projectMembers)
  const membersLoading = useAuth((s) => s.membersLoading)
  const fetchProjectMembers = useAuth((s) => s.fetchProjectMembers)
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

  // 멤버 추가 UI — 본부 선택 → 소속 인원 체크박스(인원별 권한) → 한 번에 추가.
  const [addMode, setAddMode] = useState(false)
  const [pickDivision, setPickDivision] = useState(defaultDivision ?? '')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [pickRoles, setPickRoles] = useState<Record<string, 'pm' | 'user'>>({})
  const [addBusy, setAddBusy] = useState(false)
  const resetPick = () => {
    setCheckedIds(new Set())
    setPickRoles({})
  }

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

  // 멤버 목록 새로고침(현재 프로젝트=store, 그 외=직접 fetch). 추가/부분추가 후 공용.
  const refreshMembers = async () => {
    if (isCurrent) {
      await fetchProjectMembers()
      return
    }
    setLocalLoading(true)
    try {
      const list = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
        credentials: 'include',
      }).then((r) => r.json())
      setLocalMembers(
        Array.isArray(list)
          ? ((list as { role: string; userId: string; name: string }[]).filter(
              (m) => (m.role as string) !== 'developer',
            ) as ProjectMember[])
          : [],
      )
    } finally {
      setLocalLoading(false)
    }
  }

  // 한 명 추가 — 멤버 엔드포인트는 세션(쿠키) 기반이라 현재/타 프로젝트 모두 동일하게 동작.
  const addOne = async (userId: string, role: 'pm' | 'user') => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (!r.ok) {
      const data = await r.json().catch(() => null)
      throw new Error(data?.error || '멤버 추가에 실패했습니다.')
    }
  }

  // 체크한 인원을 각자 선택한 권한으로 한 번에 추가. 일부 실패해도 목록은 갱신하고 오류만 표시.
  const handleAddBatch = async () => {
    const ids = [...checkedIds]
    if (!ids.length) return
    setAddBusy(true)
    setActionError(null)
    try {
      for (const id of ids) await addOne(id, pickRoles[id] ?? 'user')
      await refreshMembers()
      setAddMode(false)
      resetPick()
    } catch (err) {
      await refreshMembers().catch(() => {})
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

  // 후보: 선택한 본부 소속 · 개발자 제외 · 이미 멤버 제외 · 본인 제외.
  const memberIds = new Set(members?.map((m) => m.userId) ?? [])
  const candidates = searchableUsers.filter(
    (u) =>
      u.role !== 'developer' &&
      !memberIds.has(u.id) &&
      u.id !== user?.id &&
      (u.division ?? '') === pickDivision,
  )
  const toggleCheck = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="member-panel">
      <div className="member-panel__header">
        <span className="member-panel__title">👥 {projectName} 참여 인원</span>
        <button className="member-panel__close" type="button" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      {actionError && <div className="member-panel__error">{actionError}</div>}

      {/* F07: 이 프로젝트로 들어온 접근 요청 — 승인/거절이 여기서 끝난다(담당자 문의 불필요). */}
      {canManage && <AccessRequestQueue projectId={projectId} />}

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

      {/* 멤버 추가 (관리자·개발자만) — 본부 선택 → 소속 인원 체크 → 인원별 권한 → 한 번에 추가 */}
      {canManage &&
        (addMode ? (
          <div className="member-add-panel">
            <label className="member-add-div">
              <span>본부</span>
              <select
                value={pickDivision}
                onChange={(e) => {
                  setPickDivision(e.target.value)
                  resetPick()
                }}
                aria-label="본부 선택"
              >
                <option value="">— 본부 선택 —</option>
                {DIVISIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            {pickDivision === '' ? (
              <div className="member-pick-hint">본부를 선택하면 소속 인원이 표시됩니다.</div>
            ) : candidates.length === 0 ? (
              <div className="member-pick-hint">
                추가할 수 있는 인원이 없습니다 (이미 멤버이거나 소속 인원 없음).
              </div>
            ) : (
              <ul className="member-pick-list">
                {candidates.map((u) => {
                  const on = checkedIds.has(u.id)
                  return (
                    <li key={u.id} className={`member-pick-item${on ? ' is-on' : ''}`}>
                      <label className="member-pick-check">
                        <input type="checkbox" checked={on} onChange={() => toggleCheck(u.id)} />
                        <span className="member-pick-name">{u.name || u.id}</span>
                        {u.name && <span className="member-pick-id">{u.id}</span>}
                      </label>
                      <select
                        className="member-add-role"
                        value={pickRoles[u.id] ?? 'user'}
                        disabled={!on}
                        onChange={(e) =>
                          setPickRoles((prev) => ({
                            ...prev,
                            [u.id]: e.target.value as 'pm' | 'user',
                          }))
                        }
                        aria-label={`${u.name || u.id} 권한`}
                      >
                        <option value="user">사용자</option>
                        <option value="pm">관리자(PM)</option>
                      </select>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="member-add-actions">
              <button
                className="member-add-btn member-add-btn--confirm"
                type="button"
                disabled={!checkedIds.size || addBusy}
                onClick={() => void handleAddBatch()}
              >
                {addBusy ? '추가 중…' : `추가${checkedIds.size ? ` (${checkedIds.size})` : ''}`}
              </button>
              <button
                className="member-add-btn"
                type="button"
                onClick={() => {
                  setAddMode(false)
                  resetPick()
                  setPickDivision(defaultDivision ?? '')
                }}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button className="member-add-toggle" type="button" onClick={() => setAddMode(true)}>
            ＋ 멤버 추가
          </button>
        ))}
    </div>
  )
}

// 이 프로젝트로 들어온 접근 요청 처리(F07) — 관리자 도구의 '승인 대기' 마크업과 같은 결.
// 승인은 멤버십을 만들어 실제로 입장을 열고, 거절은 사유를 반드시 남긴다.
function AccessRequestQueue({ projectId }: { projectId: string }) {
  const incoming = useAuth((s) => s.incomingAccessRequests)
  const fetchAccessRequests = useAuth((s) => s.fetchAccessRequests)
  const decideAccessRequest = useAuth((s) => s.decideAccessRequest)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchAccessRequests()
  }, [fetchAccessRequests])

  const list = incoming.filter((r) => r.projectId === projectId)
  if (list.length === 0) return null

  const decide = async (id: string, approve: boolean, reason?: string) => {
    setBusyId(id)
    setErr(null)
    const r = await decideAccessRequest(id, approve, reason)
    setBusyId(null)
    if (!r.ok) setErr(r.error ?? '처리 실패')
    else {
      setRejectingId(null)
      setRejectReason('')
    }
  }

  return (
    <div className="admin-pending admin-pending--access">
      <div className="admin-pending__title">🙋 접근 요청 ({list.length})</div>
      {err && <div className="member-panel__error">{err}</div>}
      <ul className="admin-pending__list">
        {list.map((r) => (
          <li key={r.id} className="admin-pending__item">
            <span className="admin-pending__name">{r.userName || r.userId}</span>
            <span className="admin-pending__meta">
              {divisionLabel(r.division ?? undefined) || '본부 미지정'} · 🕒{' '}
              {formatMoment(r.requestedAt)} · 기한 {formatMoment(r.expiresAt)}
              {r.reason && <> · “{r.reason}”</>}
              {r.status === 'expired' && <> · 기한 지남</>}
            </span>
            {rejectingId === r.id ? (
              <>
                <input
                  className="access-req__reject"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value.slice(0, 300))}
                  placeholder="거절 사유(필수)"
                  aria-label="거절 사유"
                />
                <button
                  className="admin-btn"
                  type="button"
                  disabled={!rejectReason.trim() || busyId === r.id}
                  onClick={() => void decide(r.id, false, rejectReason.trim())}
                >
                  거절 확정
                </button>
                <button
                  className="admin-btn"
                  type="button"
                  onClick={() => {
                    setRejectingId(null)
                    setRejectReason('')
                  }}
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button
                  className="admin-btn admin-btn--primary"
                  type="button"
                  disabled={busyId === r.id || r.status === 'expired'}
                  onClick={() => void decide(r.id, true)}
                >
                  승인
                </button>
                <button
                  className="admin-btn"
                  type="button"
                  disabled={busyId === r.id || r.status === 'expired'}
                  onClick={() => setRejectingId(r.id)}
                >
                  거절
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// 새 프로젝트 생성(개발자·PM) 모달. 접속코드는 선택 — 비우면 코드 없이 입장.
function ProjectCreateModal({
  onClose,
  defaultDivision,
}: {
  onClose: () => void
  /** 개발자가 특정 본부를 보고 있을 때 그 본부를 기본 선택. */
  defaultDivision?: string
}) {
  const createProject = useAuth((s) => s.createProject)
  const loading = useAuth((s) => s.loading)
  const user = useAuth((s) => s.user)
  const isDeveloper = user?.role === 'developer'
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [division, setDivision] = useState(defaultDivision ?? '')
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
