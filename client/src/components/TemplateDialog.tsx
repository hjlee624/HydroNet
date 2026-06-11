// "새 도면" template gallery — pick a starting point instead of a blank canvas.

import { useEditor } from '../state/store'
import { Modal } from './Modal'
import { TEMPLATES } from '../data/templates'
import { logInfo } from '../state/logger'

export function TemplateDialog({ onClose }: { onClose: () => void }) {
  const a = useEditor.getState

  function pick(t: (typeof TEMPLATES)[number]) {
    a().setProject(t.make())
    void a().save() // persist the new doc so it survives a close/reopen
    logInfo(`새 도면 생성: ${t.name}`)
    onClose()
  }

  return (
    <Modal title="새 도면" sub="템플릿을 골라 시작하세요" width={640} onClose={onClose}>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <button key={t.key} className="tpl-card" onClick={() => pick(t)}>
            <span className="tpl-card__name">{t.name}</span>
            <span className="tpl-card__desc">{t.desc}</span>
          </button>
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>현재 작업은 자동 임시저장되어 있으며, 새 도면을 만들어도 <b>불러오기</b>로 되살릴 수 있습니다.</p>
    </Modal>
  )
}
