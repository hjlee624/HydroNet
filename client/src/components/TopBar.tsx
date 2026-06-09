// Top application bar — brand, project name, history, schedule actions, zoom,
// commissioning toggle and the export entry point.

import { useEditor } from '../state/store'

export function TopBar({ onExport }: { onExport: () => void }) {
  const name = useEditor((s) => s.project.name)
  const dirty = useEditor((s) => s.dirty)
  const zoom = useEditor((s) => s.zoom)
  const commissioning = useEditor((s) => s.project.commissioningEnabled)
  const autoCascade = useEditor((s) => s.autoCascade)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)

  const a = useEditor.getState

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">Hydro<em>Net</em></span>
        <span className="brand__sub">수력 마일스톤</span>
      </div>

      <input
        className="topbar__project"
        value={name}
        onChange={(e) => a().setProjectMeta({ name: e.target.value })}
        spellCheck={false}
        aria-label="프로젝트 이름"
      />

      <div className="topbar__actions">
        <button className="btn btn--sm btn--ghost" onClick={() => a().newProject()}>새로</button>
        <button className="btn btn--sm btn--ghost" onClick={() => a().loadSample()}>샘플</button>
        <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />
        <button className="btn btn--icon btn--sm" title="실행 취소 (Ctrl+Z)" disabled={!canUndo} onClick={() => a().undo()}>↶</button>
        <button className="btn btn--icon btn--sm" title="다시 실행 (Ctrl+Y)" disabled={!canRedo} onClick={() => a().redo()}>↷</button>
      </div>

      <div className="topbar__spacer" />

      <div className="topbar__actions">
        <label className="toggle" title="선행 공정 변경 시 후행 공정 자동 이동">
          <input type="checkbox" checked={autoCascade} onChange={(e) => a().setAutoCascade(e.target.checked)} />
          연쇄 자동
        </label>
        <button className="btn btn--sm" title="연결을 위반하는 공정만 뒤로 정렬" onClick={() => a().cascadeNow()}>일정 정렬</button>
        <button className="btn btn--sm" title="모든 공정을 최조기 일정으로 재계산" onClick={() => a().rescheduleNow()}>재계산</button>
        <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />

        <label className="toggle" title="시운전 공정 포함/제외">
          <input type="checkbox" checked={commissioning} onChange={() => a().toggleCommissioning()} />
          시운전
        </label>
        <span style={{ width: 1, height: 22, background: 'var(--hairline)' }} />

        <div className="topbar__actions" title="확대/축소">
          <button className="btn btn--icon btn--sm" onClick={() => a().setZoom(zoom - 0.2)}>−</button>
          <span style={{ fontSize: 12, color: 'var(--steel)', width: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="btn btn--icon btn--sm" onClick={() => a().setZoom(zoom + 0.2)}>＋</button>
        </div>

        <span className={`save-state ${dirty ? 'dirty' : ''}`}>{dirty ? '● 저장 중…' : '저장됨'}</span>
        <button className="btn btn--primary" onClick={onExport}>도면 출력</button>
      </div>
    </header>
  )
}
