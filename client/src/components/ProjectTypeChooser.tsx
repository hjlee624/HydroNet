// 새 사업 시작 — 단계(유형) 선택 화면. 사업 단계를 고르면 그 유형의 공정표/공종
// 프리셋이 세팅된다(설계 단계 → 설계 공정표, 시공 → 시공 공정표).
import { Modal } from './Modal'
import { PROJECT_TYPES, type ProjectTypeDef } from '../data/templates'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { logInfo } from '../state/logger'

function markChosen() {
  try { localStorage.setItem('hydronet:typeChosen', '1') } catch { /* ignore */ }
}

export function ProjectTypeChooser({ onClose }: { onClose: () => void }) {
  const a = useEditor.getState
  const setModule = useShell((s) => s.setModule)

  function pick(t: ProjectTypeDef) {
    a().setProject(t.make())
    void a().save()
    markChosen()
    logInfo(`새 사업 생성: ${t.label} (${t.scheduleLabel})`)
    setModule('schedule')
    onClose()
  }

  return (
    <Modal
      title="새 사업 — 단계 선택"
      sub="사업 단계를 고르면 그 유형의 공정표·공종 프리셋이 세팅됩니다"
      width={760}
      onClose={onClose}
    >
      <div className="ptype-grid">
        {PROJECT_TYPES.map((t) => (
          <button key={t.kind} className="ptype-card" onClick={() => pick(t)}>
            <div className="ptype-card__top">
              <span className="ptype-card__icon">{t.icon}</span>
              <span className="ptype-card__name">{t.label}</span>
              <span className="ptype-card__sched">{t.scheduleLabel}</span>
            </div>
            <p className="ptype-card__desc">{t.desc}</p>
            <div className="ptype-card__tags">
              {t.highlights.map((h) => <span key={h} className="ptype-tag">{h}</span>)}
            </div>
          </button>
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        프리셋은 시작점일 뿐 — 공정표는 자유롭게 편집할 수 있습니다. 단계가 바뀌면 새 사업으로 다시 시작하세요.
      </p>
    </Modal>
  )
}
