// 서버 버전 복구(F15) — 서버가 CRDT 영속 시점마다 남긴 스냅샷 이력에서 되돌린다.
// 되돌리기는 현재 방 내용을 통째로 덮어쓰는 **파괴적** 동작이라, 미리보기(무엇으로 바뀌는지)와
// 명시적 확인을 반드시 거친다. 자동 복구는 어떤 경우에도 하지 않는다.
import { useCallback, useEffect, useState } from 'react'
import {
  createProjectVersion,
  listProjectVersions,
  loadProjectVersion,
  type ProjectVersion,
} from '../state/api'
import { useAuth } from '../state/authStore'
import { logWarn } from '../state/logger'
import { useEditor } from '../state/store'
import type { Project } from '../types/model'
import { Modal } from './Modal'

/** 버전 스냅샷 한 건을 사람이 확인할 수 있는 한 줄 요약으로. */
function previewOf(project: Project): string {
  const tasks = project.tasks?.length ?? 0
  const categories = project.categories?.length ?? 0
  const updatedAt = project.meta?.updatedAt
    ? new Date(project.meta.updatedAt).toLocaleString()
    : '—'
  return `‘${project.name || project.id}’ · 공종 ${categories} · 공정 ${tasks} · 최종수정 ${updatedAt}`
}

export function RestoreDialog({ onClose }: { onClose: () => void }) {
  const entered = useAuth((s) => s.entered)
  const readOnly = useEditor((s) => s.readOnly)
  const [items, setItems] = useState<ProjectVersion[] | null>(null)
  const [dir, setDir] = useState('')
  const [keep, setKeep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 선택한 버전의 미리보기 — 되돌리기 전에 '무엇으로 바뀌는지'를 먼저 본다.
  const [preview, setPreview] = useState<{ version: string; project: Project } | null>(null)

  const projectId = entered?.id ?? null

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await listProjectVersions(id)
      setItems(data.items)
      setDir(data.dir)
      setKeep(data.keep)
      setError(null)
    } catch (e) {
      setItems([])
      setError(e instanceof Error ? e.message : '버전 목록 오류')
    }
  }, [])

  useEffect(() => {
    if (projectId) void refresh(projectId)
  }, [projectId, refresh])

  if (!entered || !projectId)
    return (
      <Modal title="⏱ 서버 버전에서 복구" width={520} onClose={onClose}>
        <p className="ver-empty">
          서버 협업 프로젝트에 입장한 상태에서만 서버 버전 복구를 사용할 수 있습니다.
        </p>
      </Modal>
    )

  async function openPreview(version: string) {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      const project = await loadProjectVersion(projectId, version)
      if (!project)
        setError('해당 버전을 찾을 수 없습니다(보관 개수 초과로 정리되었을 수 있습니다).')
      else setPreview({ version, project })
    } catch (e) {
      setError(e instanceof Error ? e.message : '버전 열람 오류')
    } finally {
      setBusy(false)
    }
  }

  function restore() {
    if (!preview || readOnly) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `${preview.version} 버전으로 현재 프로젝트 내용을 되돌립니다.\n\n` +
          `바뀔 내용: ${previewOf(preview.project)}\n\n` +
          '현재 내용은 이 버전으로 덮어써지며, 협업 중이면 팀원 모두에게 즉시 반영됩니다.\n' +
          '변경 이력·확정본(감사기록)은 지워지지 않고 그대로 남습니다. 계속할까요?',
      )
    )
      return
    try {
      // setProject 가 아니라 importProjectContent — 방 id 를 유지해야 CollaborationBridge 가
      // 되돌리지 않고, 팀원 모두에게 같은 내용이 동기화된다(파일 불러오기와 같은 경로).
      useEditor.getState().importProjectContent(preview.project)
      onClose()
    } catch (e) {
      logWarn('버전 복구 실패', e)
      setError('복구에 실패했습니다.')
    }
  }

  async function snapshotNow() {
    if (!projectId || readOnly) return
    setBusy(true)
    // 실패 사유(권한 없음 403 · 너무 잦음 429)는 서버 문구를 그대로 보여준다 — 보관 상한이
    // 있는 이력이라 '남겼다'고 지어내면 없는 복구 지점을 믿게 된다.
    const r = await createProjectVersion(projectId)
    if (!r.ok) setError(r.error ?? '버전 저장 실패')
    await refresh(projectId)
    setBusy(false)
  }

  return (
    <Modal
      title="⏱ 서버 버전에서 복구"
      sub={dir ? `보관 위치: ${dir} · 프로젝트당 최근 ${keep}개 유지` : undefined}
      width={560}
      onClose={onClose}
    >
      <div className="ver-head">
        {/* 조회 전용은 버튼 자체를 내린다 — 서버도 403 으로 막지만(projectEditGate),
            누를 수 있는 버튼을 두고 실패시키는 건 권한을 잘못 안내하는 것과 같다. */}
        {!readOnly && (
          <button
            className="btn btn--sm"
            type="button"
            disabled={busy}
            onClick={() => void snapshotNow()}
          >
            ＋ 지금 버전 남기기
          </button>
        )}
        {readOnly && (
          <span className="ver-note">조회 전용 — 버전 남기기·되돌리기는 사용할 수 없습니다.</span>
        )}
      </div>
      {error && <div className="ver-error">{error}</div>}
      {items === null ? (
        <p className="ver-empty">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="ver-empty">
          아직 보관된 버전이 없습니다. 편집이 서버에 기록되면 자동으로 쌓입니다.
        </p>
      ) : (
        <ul className="ver-list">
          {items.map((item) => (
            <li key={item.version} className="ver-item">
              <span className="ver-time">
                {item.savedAt ? new Date(item.savedAt).toLocaleString() : item.version}
              </span>
              <span className="ver-size">{Math.max(1, Math.round(item.size / 1024))} KB</span>
              <button
                className="btn btn--sm btn--ghost"
                type="button"
                disabled={busy}
                onClick={() => void openPreview(item.version)}
              >
                미리보기
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="ver-preview">
          <div className="ver-preview__title">{preview.version} 미리보기</div>
          <div className="ver-preview__body">{previewOf(preview.project)}</div>
          <button
            className="btn btn--sm btn--primary"
            type="button"
            disabled={readOnly}
            title={
              readOnly
                ? '조회 전용 권한입니다'
                : '현재 프로젝트 내용을 이 버전으로 덮어씁니다(확인 필요)'
            }
            onClick={restore}
          >
            이 버전으로 되돌리기
          </button>
        </div>
      )}
    </Modal>
  )
}
