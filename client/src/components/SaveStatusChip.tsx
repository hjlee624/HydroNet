// 저장 상태 칩(F01) — '연결됨'이 아니라 '서버가 실제로 기록했다'만 완료로 표시한다.
// 서버 동기화(협업)와 파일 백업(.json)은 성격이 다른 두 가지이므로 칩도 둘로 나눈다.
// 저장 위치 · 마지막 확정 시각 · 복구 동작은 칩을 눌러 여는 한 패널에 모두 모아 둔다.
import { useState } from 'react'
import { useAuth } from '../state/authStore'
import { describeSaveStatus, formatClock, usePersistence } from '../state/persistence'
import { backupProjectToFile, useEditor } from '../state/store'
import { Modal } from './Modal'

export function SaveStatusChip({ onOpenRestore }: { onOpenRestore?: () => void }) {
  // 셀렉터는 전부 원시값 — 매 렌더 새 객체를 만들면 무한 렌더로 화면이 죽는다(mount-test 가드).
  const target = usePersistence((s) => s.target)
  const link = usePersistence((s) => s.link)
  const serverConfirmedAt = usePersistence((s) => s.serverConfirmedAt)
  const serverConfirmedIso = usePersistence((s) => s.serverConfirmedIso)
  const localConfirmedAt = usePersistence((s) => s.localConfirmedAt)
  const pending = usePersistence((s) => s.pending)
  const lastLocalChangeAt = usePersistence((s) => s.lastLocalChangeAt)
  const fileBackupAt = usePersistence((s) => s.fileBackupAt)
  const persistReadOnly = usePersistence((s) => s.readOnly)
  const location = usePersistence((s) => s.location)
  const dirty = useEditor((s) => s.dirty)
  const entered = useAuth((s) => s.entered)
  const [open, setOpen] = useState(false)

  const view = describeSaveStatus({
    target,
    link,
    serverConfirmedAt,
    localConfirmedAt,
    pending,
    lastLocalChangeAt,
    readOnly: persistReadOnly,
  })

  return (
    <>
      <button
        type="button"
        className={`save-state save-state--sync is-${view.tone}`}
        title={`${view.label} — ${view.detail}\n저장 위치: ${location}`}
        aria-label={`저장 상태: ${view.label}`}
        onClick={() => setOpen(true)}
      >
        {view.label}
      </button>
      {/* 툴팁은 라벨과 같은 사실만 말한다. 예전엔 백업이 한 번도 없어도(fileBackupAt===null)
          '마지막 파일 백업 이후 변경 없음'이라며 있지도 않은 백업을 단언해, 바로 옆 라벨
          ('파일 백업 없음')과 같은 요소 안에서 서로를 부정했다. */}
      <span
        className={`save-state save-state--file ${dirty ? 'dirty' : ''}`}
        title={
          dirty
            ? '마지막 파일 백업 이후 변경이 있습니다 — 저장 또는 Ctrl+S'
            : fileBackupAt
              ? '마지막 파일 백업 이후 변경 없음'
              : '이 창에서 파일로 백업한 적이 없습니다'
        }
      >
        {dirty
          ? '● 파일 미백업'
          : fileBackupAt
            ? `파일 백업 ${formatClock(fileBackupAt)}`
            : '파일 백업 없음'}
      </span>

      {open && (
        <Modal title="💾 저장 위치·상태" width={480} onClose={() => setOpen(false)}>
          <div className="save-pop">
            <div className="save-pop__row">
              <span>저장 위치</span>
              <b>{location}</b>
            </div>
            <div className="save-pop__row">
              <span>서버 기록 확정</span>
              <b>{serverConfirmedIso ? new Date(serverConfirmedIso).toLocaleString() : '없음'}</b>
            </div>
            <div className="save-pop__row">
              <span>이 브라우저 기록</span>
              <b>{localConfirmedAt ? new Date(localConfirmedAt).toLocaleString() : '없음'}</b>
            </div>
            <div className="save-pop__row">
              <span>파일 백업(.json)</span>
              <b>
                {fileBackupAt ? new Date(fileBackupAt).toLocaleString() : '이 창에서 기록 없음'}
              </b>
            </div>
            <p className="save-pop__note">
              {view.label} — {view.detail}
            </p>
            <div className="save-pop__actions">
              {/* 파일 백업(.json)은 서버 동기화와 완전히 별개 — 실제로 파일이 써진 경우에만
                  백업 시각이 남는다(backupProjectToFile). */}
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => void backupProjectToFile()}
              >
                📁 파일로 백업(저장)
              </button>
              {entered && onOpenRestore && (
                <button
                  className="btn btn--sm btn--ghost"
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onOpenRestore()
                  }}
                >
                  ⏱ 서버 버전에서 복구…
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
