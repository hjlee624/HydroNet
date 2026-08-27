// 개발자 전용 관리자 패널 — 전체 사용자 목록·역할 변경·계정 추가·CSV/엑셀 업로드. ADR-002.
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { DIVISIONS, divisionLabel } from '../../data/divisions'
import { PASSWORD_RULE_TEXT, validatePassword } from '../../utils/password'
import { type AdminUser, useAuth } from '../../state/authStore'

const ROLE_OPTS = [
  { value: 'developer', label: '개발자' },
  { value: 'pm', label: '프로젝트 관리자(PM)' },
  { value: 'user', label: '사용자' },
]
const ROLE_LABEL: Record<string, string> = {
  developer: '개발자',
  pm: '관리자',
  user: '사용자',
}
const ROLE_CLASS: Record<string, string> = {
  developer: 'admin-badge admin-badge--dev',
  pm: 'admin-badge admin-badge--pm',
  user: 'admin-badge admin-badge--user',
}

/** 요청 접수 시각 표시 — 예: "8월 27일 오후 2:32". 값이 없으면(구버전 데이터) 빈 문자열. */
const formatRequestedAt = (ts?: number | null): string =>
  ts == null
    ? ''
    : new Date(ts).toLocaleString('ko-KR', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })

interface AddUserForm {
  id: string
  name: string
  role: string
  division: string
  password: string
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const adminUsers = useAuth((s) => s.adminUsers)
  const adminLoading = useAuth((s) => s.adminLoading)
  const adminError = useAuth((s) => s.adminError)
  const fetchAdminUsers = useAuth((s) => s.fetchAdminUsers)
  const upsertAdminUser = useAuth((s) => s.upsertAdminUser)
  const importUsersFile = useAuth((s) => s.importUsersFile)
  const pendingApprovals = useAuth((s) => s.pendingApprovals)
  const fetchPendingApprovals = useAuth((s) => s.fetchPendingApprovals)
  const approveUser = useAuth((s) => s.approveUser)
  const deleteAdminUser = useAuth((s) => s.deleteAdminUser)
  const currentUserId = useAuth((s) => s.user?.id)
  const testNotify = useAuth((s) => s.testNotify)
  const resetRequests = useAuth((s) => s.resetRequests)
  const fetchResetRequests = useAuth((s) => s.fetchResetRequests)
  const adminSetPassword = useAuth((s) => s.adminSetPassword)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddUserForm>({
    id: '',
    name: '',
    role: 'user',
    division: '',
    password: '',
  })
  const [addError, setAddError] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [editingRole, setEditingRole] = useState<string | null>(null) // userId
  // 비밀번호 직접 지정(초기화 요청 처리·임의 변경 공용) — 한 번에 한 사용자만 편집.
  const [pwSetId, setPwSetId] = useState<string | null>(null) // 열린 슬롯 키(reset:id / row:id)
  const [pwSetUserId, setPwSetUserId] = useState('') // 대상 사용자 id
  const [pwSetVal, setPwSetVal] = useState('')
  const [pwSetBusy, setPwSetBusy] = useState(false)
  const [pwSetErr, setPwSetErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetchAdminUsers()
    void fetchPendingApprovals()
    void fetchResetRequests()
  }, [fetchAdminUsers, fetchPendingApprovals, fetchResetRequests])

  const handleRoleChange = async (user: AdminUser, role: string) => {
    setEditingRole(user.id)
    await upsertAdminUser({ id: user.id, name: user.name, role, active: user.active })
    setEditingRole(null)
  }

  const handleToggleActive = async (user: AdminUser) => {
    setEditingRole(user.id)
    await upsertAdminUser({ id: user.id, name: user.name, role: user.role, active: !user.active })
    setEditingRole(null)
  }

  const handleDelete = async (user: AdminUser) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `‘${user.name || user.id}’ 계정을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`,
      )
    )
      return
    setEditingRole(user.id)
    await deleteAdminUser(user.id)
    setEditingRole(null)
  }

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)
    if (!addForm.id.trim()) {
      setAddError('아이디를 입력하세요.')
      return
    }
    if (addForm.password) {
      const chk = validatePassword(addForm.password)
      if (!chk.ok) {
        setAddError(chk.reason ?? '비밀번호 정책을 확인하세요.')
        return
      }
    }
    const ok = await upsertAdminUser({
      id: addForm.id.trim(),
      name: addForm.name.trim(),
      role: addForm.role,
      ...(addForm.division ? { division: addForm.division } : {}),
      ...(addForm.password ? { password: addForm.password } : {}),
      active: true,
    })
    if (ok) {
      setAddOpen(false)
      setAddForm({ id: '', name: '', role: 'user', division: '', password: '' })
    }
  }

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportMsg(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string) ?? ''
      const result = await importUsersFile(base64)
      if (result?.error) setImportMsg(`❌ ${result.error}`)
      else if (result?.imported != null) setImportMsg(`✅ ${result.imported}명 업로드 완료`)
      else setImportMsg('✅ 업로드 완료')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleTestNotify = async () => {
    setNotifyMsg(null)
    setNotifyBusy(true)
    const r = await testNotify()
    setNotifyBusy(false)
    setNotifyMsg(r.ok ? '✅ 네이버웍스 알림 테스트 발송 완료' : `❌ ${r.error || '알림 발송 실패'}`)
  }

  const openPwSet = (key: string, userId: string) => {
    setPwSetId(key)
    setPwSetUserId(userId)
    setPwSetVal('')
    setPwSetErr(null)
  }
  const submitPwSet = async () => {
    const chk = validatePassword(pwSetVal)
    if (!chk.ok) {
      setPwSetErr(chk.reason ?? '비밀번호 정책을 확인하세요.')
      return
    }
    setPwSetBusy(true)
    const ok = await adminSetPassword(pwSetUserId, pwSetVal)
    setPwSetBusy(false)
    if (ok) {
      setPwSetId(null)
      setPwSetVal('')
    } else {
      setPwSetErr('설정 실패 — 다시 시도하세요.')
    }
  }
  // 초기화 요청 목록·사용자 표에서 공용으로 쓰는 인라인 새 비밀번호 입력.
  const pwSetInline = (id: string) =>
    pwSetId === id ? (
      <span className="admin-pw-edit">
        <input
          type="text"
          className="admin-pw-input"
          value={pwSetVal}
          maxLength={12}
          onChange={(e) => setPwSetVal(e.target.value.slice(0, 12))}
          placeholder={PASSWORD_RULE_TEXT}
          aria-label="새 비밀번호"
          // biome-ignore lint/a11y/noAutofocus: 관리자가 방금 연 인라인 입력
          autoFocus
        />
        <button
          className="admin-btn admin-btn--primary"
          type="button"
          disabled={pwSetBusy}
          onClick={() => void submitPwSet()}
        >
          {pwSetBusy ? '…' : '저장'}
        </button>
        <button className="admin-btn" type="button" onClick={() => setPwSetId(null)}>
          취소
        </button>
        {pwSetErr && <span className="admin-pw-edit__err">{pwSetErr}</span>}
      </span>
    ) : null

  return (
    <div className="admin-overlay" role="dialog" aria-modal="true" aria-label="관리자 도구">
      <div className="admin-panel">
        {/* 헤더 */}
        <div className="admin-panel__header">
          <div>
            <div className="admin-panel__title">⚙ 관리자 도구</div>
            <div className="admin-panel__sub">전체 사용자 계정 관리 (개발자 전용)</div>
          </div>
          <button className="admin-close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 도구 모음 */}
        <div className="admin-toolbar">
          <button
            className="admin-btn admin-btn--primary"
            type="button"
            onClick={() => {
              setAddOpen((v) => !v)
              setAddError(null)
            }}
          >
            {addOpen ? '취소' : '＋ 사용자 추가'}
          </button>
          <button
            className="admin-btn"
            type="button"
            onClick={() => fileRef.current?.click()}
            title="엑셀/CSV 파일로 일괄 업로드"
          >
            📂 엑셀/CSV 업로드
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            className="admin-btn"
            type="button"
            onClick={() => void fetchAdminUsers()}
            disabled={adminLoading}
            title="목록 새로고침"
          >
            🔄
          </button>
          <button
            className="admin-btn"
            type="button"
            onClick={() => void handleTestNotify()}
            disabled={notifyBusy}
            title="네이버웍스 알림 연동 테스트 (개발자 본인에게 DM 발송)"
          >
            {notifyBusy ? '발송 중…' : '🔔 알림 테스트'}
          </button>
        </div>

        {/* 새 사용자 추가 폼 */}
        {addOpen && (
          <form className="admin-add-form" onSubmit={(e) => void handleAddSubmit(e)}>
            <div className="admin-add-form__row">
              <label className="admin-field">
                <span>아이디 *</span>
                <input
                  value={addForm.id}
                  onChange={(e) => setAddForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="010-0000-0000 또는 사번"
                  autoFocus
                />
              </label>
              <label className="admin-field">
                <span>이름</span>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="홍길동"
                />
              </label>
              <label className="admin-field">
                <span>역할</span>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                >
                  {ROLE_OPTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>
                  본부 <em>(개발자는 비움)</em>
                </span>
                <select
                  value={addForm.division}
                  onChange={(e) => setAddForm((f) => ({ ...f, division: e.target.value }))}
                >
                  <option value="">— 없음 —</option>
                  {DIVISIONS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>
                  초기 비밀번호 <em>(비워두면 로그인 불가)</em>
                </span>
                <input
                  type="text"
                  maxLength={12}
                  value={addForm.password}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, password: e.target.value.slice(0, 12) }))
                  }
                  placeholder={PASSWORD_RULE_TEXT}
                />
              </label>
            </div>
            {addError && <div className="admin-error">{addError}</div>}
            <div className="admin-add-form__actions">
              <button
                className="admin-btn admin-btn--primary"
                type="submit"
                disabled={adminLoading}
              >
                {adminLoading ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        )}

        {/* 관리자(PM) 셀프등록 승인 대기 */}
        {pendingApprovals.length > 0 && (
          <div className="admin-pending">
            <div className="admin-pending__title">
              🔔 관리자 승인 대기 ({pendingApprovals.length})
            </div>
            <ul className="admin-pending__list">
              {pendingApprovals.map((p) => (
                <li key={p.id} className="admin-pending__item">
                  <span className="admin-pending__name">{p.name || p.id}</span>
                  <span className="admin-pending__meta">
                    {p.id} · {divisionLabel(p.division ?? undefined) || '본부 미지정'}
                    {p.requestedAt != null && <> · 🕒 {formatRequestedAt(p.requestedAt)}</>}
                  </span>
                  <button
                    className="admin-btn admin-btn--primary"
                    type="button"
                    onClick={() => void approveUser(p.id, true)}
                  >
                    승인
                  </button>
                  <button
                    className="admin-btn"
                    type="button"
                    onClick={() => void approveUser(p.id, false)}
                  >
                    거절
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 비밀번호 초기화 요청 */}
        {resetRequests.length > 0 && (
          <div className="admin-pending admin-pending--reset">
            <div className="admin-pending__title">
              🔑 비밀번호 초기화 요청 ({resetRequests.length})
            </div>
            <ul className="admin-pending__list">
              {resetRequests.map((p) => (
                <li key={p.id} className="admin-pending__item">
                  <span className="admin-pending__name">{p.name || p.id}</span>
                  <span className="admin-pending__meta">
                    {p.id} · {divisionLabel(p.division ?? undefined) || '본부 미지정'}
                    {p.requestedAt != null && <> · 🕒 {formatRequestedAt(p.requestedAt)}</>}
                  </span>
                  {pwSetId === `reset:${p.id}` ? (
                    pwSetInline(`reset:${p.id}`)
                  ) : (
                    <button
                      className="admin-btn admin-btn--primary"
                      type="button"
                      onClick={() => openPwSet(`reset:${p.id}`, p.id)}
                    >
                      새 비밀번호 지정
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 알림 메시지 */}
        {(notifyMsg || adminError || importMsg) && (
          <div
            className={
              (notifyMsg ?? adminError ?? importMsg ?? '').startsWith('✅')
                ? 'admin-msg admin-msg--ok'
                : 'admin-msg admin-msg--err'
            }
          >
            {notifyMsg ?? adminError ?? importMsg}
          </div>
        )}

        {/* 사용자 목록 */}
        {adminLoading && !adminUsers.length ? (
          <div className="admin-loading">사용자 목록 불러오는 중…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>이름</th>
                  <th>본부</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>비밀번호</th>
                  <th>삭제</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((u) => (
                  <tr
                    key={u.id}
                    className={editingRole === u.id ? 'admin-row admin-row--busy' : 'admin-row'}
                  >
                    <td className="admin-cell-id">{u.id}</td>
                    <td>{u.name || <span className="admin-empty">-</span>}</td>
                    <td>
                      {divisionLabel(u.division ?? undefined) || (
                        <span className="admin-empty">-</span>
                      )}
                    </td>
                    <td>
                      <select
                        className="admin-role-select"
                        value={u.role}
                        disabled={editingRole === u.id}
                        onChange={(e) => void handleRoleChange(u, e.target.value)}
                        aria-label={`${u.id} 역할`}
                      >
                        {ROLE_OPTS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {ROLE_LABEL[o.value]}
                          </option>
                        ))}
                      </select>
                      <span className={ROLE_CLASS[u.role] ?? 'admin-badge'}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td>
                      <button
                        className={
                          u.active
                            ? 'admin-toggle admin-toggle--on'
                            : 'admin-toggle admin-toggle--off'
                        }
                        type="button"
                        disabled={editingRole === u.id}
                        onClick={() => void handleToggleActive(u)}
                        title={u.active ? '비활성화' : '활성화'}
                      >
                        {u.active ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td>
                      {pwSetId === `row:${u.id}` ? (
                        pwSetInline(`row:${u.id}`)
                      ) : (
                        <span className="admin-pw-cell">
                          <span className={u.hasPassword ? 'admin-pw-set' : 'admin-pw-none'}>
                            {u.hasPassword ? '설정됨' : '미설정'}
                          </span>
                          <button
                            className="admin-btn admin-btn--xs"
                            type="button"
                            disabled={editingRole === u.id}
                            onClick={() => openPwSet(`row:${u.id}`, u.id)}
                            title="비밀번호 변경"
                          >
                            변경
                          </button>
                        </span>
                      )}
                    </td>
                    <td>
                      {u.id === currentUserId ? (
                        <span className="admin-empty">-</span>
                      ) : (
                        <button
                          className="admin-del-btn"
                          type="button"
                          disabled={editingRole === u.id}
                          onClick={() => void handleDelete(u)}
                          title="사용자 삭제"
                          aria-label={`${u.name || u.id} 삭제`}
                        >
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!adminUsers.length && (
                  <tr>
                    <td colSpan={7} className="admin-empty-row">
                      사용자가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
