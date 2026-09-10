// Top application bar — brand, project name, history, schedule actions, zoom,
// commissioning toggle and the export entry point.

import { useEffect, useState } from 'react'
import { useAuth } from '../state/authStore'
import { openProjectFromFile } from '../state/fileIO'
import { logWarn } from '../state/logger'
import { backupProjectToFile, useEditor } from '../state/store'
import { HelpDialog } from './HelpDialog'
import { RestoreDialog } from './RestoreDialog'
import { ReviewDialog } from './ReviewDialog'
import { SaveStatusChip } from './SaveStatusChip'
import { TemplateDialog } from './TemplateDialog'

interface TopBarProps {
  onExport: () => void
  onFitChart: () => void
  onToggleFullscreen: () => void
  fullscreen: boolean
}

export function TopBar({ onExport, onFitChart, onToggleFullscreen, fullscreen }: TopBarProps) {
  const name = useEditor((s) => s.project.name)
  const readOnly = useEditor((s) => s.readOnly)
  const zoom = useEditor((s) => s.zoom)
  const commissioning = useEditor((s) => s.project.commissioningEnabled)
  const autoCascade = useEditor((s) => s.autoCascade)
  const uiMode = useEditor((s) => s.uiMode)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)

  const a = useEditor.getState
  const pro = uiMode === 'pro'

  // 새 도면 권한: 로컬 모드이거나 개발자이거나 프로젝트 PM인 경우만 허용.
  const authMode = useAuth((s) => s.mode)
  const authUser = useAuth((s) => s.user)
  const entered = useAuth((s) => s.entered)
  const enteredRole = entered?.projRole
  const canCreateNew =
    authMode === 'local' || authUser?.role === 'developer' || enteredRole === 'pm'

  const [helpOpen, setHelpOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  // 사용자가 고른 .json 파일을 열어 현재 사업으로 교체(요구: 원하는 경로에서 불러오기).
  async function onLoadFromFile() {
    try {
      const p = await openProjectFromFile()
      if (!p) return
      if (entered) {
        // 협업 프로젝트 입장 중: 새 문서로 바꾸면 CollaborationBridge가 즉시 현재 방으로
        // 되돌려 파일이 폐기된다. 대신 불러온 내용을 현재 방에 덮어써 로드+동기화한다.
        if (
          typeof window !== 'undefined' &&
          !window.confirm(
            '현재 프로젝트 내용을 불러온 파일로 교체합니다. 협업 중이면 팀원 모두에게 반영됩니다. 계속할까요?',
          )
        )
          return
        a().importProjectContent(p)
      } else {
        a().setProject(p)
      }
    } catch (e) {
      logWarn('불러오기 실패', e)
      if (typeof window !== 'undefined')
        window.alert(
          '불러오기에 실패했습니다. 올바른 Sequence 프로젝트(.json) 파일인지 확인하세요.',
        )
    }
  }

  // Local text state for the zoom field so multi-digit entry isn't clamped on
  // every keystroke; commit (apply) only on blur / Enter.
  const [zoomText, setZoomText] = useState(() => String(Math.round(zoom * 100)))
  useEffect(() => {
    setZoomText(String(Math.round(zoom * 100)))
  }, [zoom])
  function commitZoom() {
    const v = Number(zoomText)
    if (Number.isFinite(v) && v > 0) a().setZoom(v / 100)
    else setZoomText(String(Math.round(zoom * 100)))
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">
          <em>Seq</em>uence
        </span>
        <span className="brand__sub">건설 공정표</span>
      </div>

      <input
        className="topbar__project"
        value={name}
        onChange={(e) => a().setProjectMeta({ name: e.target.value })}
        spellCheck={false}
        aria-label="프로젝트 이름"
      />

      {/* 휴대전화 1차 범위는 조회·검토·진척 입력이다(F17). 편집·취입·계산 같은 데스크톱
          전용 컨트롤에는 data-narrow-hide="1" 을 달아 좁은 화면에서 CSS 로 감춘다 —
          로직은 그대로이고, 넓은 화면에서는 아무것도 달라지지 않는다. */}
      <div className="topbar__actions topbar__actions--primary">
        {canCreateNew && (
          <button
            className="btn btn--sm btn--ghost"
            data-narrow-hide="1"
            title="템플릿을 골라 새 도면 시작"
            onClick={() => setNewOpen(true)}
          >
            ＋ 새 도면
          </button>
        )}
        <button
          className="btn btn--sm"
          title="작업 파일(.json)을 원하는 경로에 백업 저장 (Ctrl+S) — 서버 동기화와는 별개입니다"
          onClick={() => void backupProjectToFile()}
        >
          저장
        </button>
        <button
          className="btn btn--sm btn--ghost"
          data-narrow-hide="1"
          title="원하는 경로의 작업 파일(.json) 불러오기"
          onClick={() => void onLoadFromFile()}
        >
          불러오기
        </button>
        <button
          className="btn btn--sm btn--ghost"
          title="외부 AI(GPT·Gemini 등)로 공사기간 적정성을 검토받고 제안을 반영"
          onClick={() => setReviewOpen(true)}
        >
          🤖 AI 검토
        </button>
        <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
        <button
          className="btn btn--icon btn--sm"
          data-narrow-hide="1"
          title="실행 취소 (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => a().undo()}
        >
          ↶
        </button>
        <button
          className="btn btn--icon btn--sm"
          data-narrow-hide="1"
          title="다시 실행 (Ctrl+Y)"
          disabled={!canRedo}
          onClick={() => a().redo()}
        >
          ↷
        </button>
      </div>

      <div className="topbar__spacer">
        {readOnly && (
          <span className="topbar__readonly" role="status" title="편집 권한 없음 — 열람만 가능">
            🔒 조회 전용
          </span>
        )}
      </div>

      <div className="topbar__actions topbar__actions--secondary">
        <div className="topbar__group">
          <label
            className="toggle"
            data-narrow-hide="1"
            title="선행 공정 변경 시 후행 공정 자동 이동"
          >
            <input
              type="checkbox"
              checked={autoCascade}
              onChange={(e) => a().setAutoCascade(e.target.checked)}
            />
            연쇄 자동
          </label>
          {pro && (
            <button
              className="btn btn--sm"
              data-narrow-hide="1"
              title="연결을 위반하는 공정만 뒤로 정렬"
              onClick={() => a().cascadeNow()}
            >
              일정 정렬
            </button>
          )}
          {pro && (
            <button
              className="btn btn--sm"
              data-narrow-hide="1"
              title="모든 공정을 최조기 일정으로 재계산"
              onClick={() => a().rescheduleNow()}
            >
              재계산
            </button>
          )}
          <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />

          <label className="toggle" data-narrow-hide="1" title="시운전 공정 포함/제외">
            <input
              type="checkbox"
              checked={commissioning}
              onChange={() => a().toggleCommissioning()}
            />
            시운전
          </label>
          <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />

          <div className="zoomctl" data-narrow-hide="1" title="배율 (전체 확대/축소)">
            <button
              className="btn btn--sm"
              type="button"
              title="현재 시트의 가로·세로 전체를 화면에 맞춤"
              onClick={onFitChart}
            >
              전체 맞춤
            </button>
            <button
              className="btn btn--icon btn--sm"
              type="button"
              title="축소"
              onClick={() => a().setZoom(zoom - 0.1)}
            >
              −
            </button>
            <input
              className="zoom-slider"
              type="range"
              min={2}
              max={400}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => a().setZoom(Number(e.target.value) / 100)}
              aria-label="배율 슬라이더"
            />
            <input
              className="zoom-num"
              type="number"
              min={2}
              max={600}
              step={5}
              value={zoomText}
              onChange={(e) => setZoomText(e.target.value)}
              onBlur={commitZoom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              aria-label="배율 입력"
            />
            <span className="zoom-pct">%</span>
            <button
              className="btn btn--icon btn--sm"
              type="button"
              title="확대"
              onClick={() => a().setZoom(zoom + 0.1)}
            >
              ＋
            </button>
          </div>
        </div>

        <div className="topbar__group topbar__group--output">
          <SaveStatusChip onOpenRestore={() => setRestoreOpen(true)} />
          <button
            className="btn btn--sm btn--dark"
            title="사용 방법 · 단축키"
            aria-label="도움말"
            onClick={() => setHelpOpen(true)}
          >
            ? 도움말
          </button>
          <button
            className="btn btn--sm"
            data-narrow-hide="1"
            title="출력 전 전체 화면 미리보기 (Esc 종료)"
            onClick={onToggleFullscreen}
          >
            {fullscreen ? '⤢ 종료' : '⤢ 전체 화면'}
          </button>
          <button className="btn btn--primary" onClick={onExport}>
            도면 출력
          </button>
        </div>
      </div>

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {newOpen && <TemplateDialog onClose={() => setNewOpen(false)} />}
      {reviewOpen && <ReviewDialog onClose={() => setReviewOpen(false)} />}
      {restoreOpen && <RestoreDialog onClose={() => setRestoreOpen(false)} />}
    </header>
  )
}
