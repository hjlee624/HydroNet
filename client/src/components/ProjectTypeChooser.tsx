// 새 사업 시작 — ① 사업명 입력 → ② 단계(유형) 선택. 단계를 고르면 그 유형의
// 공정표·공종 프리셋이 세팅되고, 입력한 사업명이 대시보드·공정관리(도면 제목)에 모두
// 적용된다(설계 단계 → 설계 공정표, 시공 → 시공 공정표).
import { useState } from 'react'
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
  const [name, setName] = useState('')
  const named = name.trim().length > 0

  // 어떤 경로로 닫히든(선택/✕/Esc/바깥클릭) "이미 보여줬음"을 기억 → 새로고침 나그 루프 방지.
  function close() { markChosen(); onClose() }

  function pick(t: ProjectTypeDef) {
    if (!named) return
    // 새 사업은 현재 사업을 통째로 대체한다 — 모듈 기록(원가·공사비·품질 등)이나 기준선이
    // 있으면 데이터 손실을 경고(저장본은 별 id라 불러오기로 복구 가능, 세션 편집은 소실).
    const cur = a().project
    const hasRecords = cur.modules ? Object.values(cur.modules).some((arr) => arr && arr.length > 0) : false
    if ((hasRecords || cur.baseline) && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('현재 사업의 모든 모듈 기록·기준선이 새 사업으로 대체됩니다. 계속할까요?\n(미리 저장해 둔 파일은 ‘불러오기’로 다시 열 수 있습니다.)')) return
    }
    const p = t.make()
    p.name = name.trim() // 사업명을 대시보드·공정관리(도면 제목)에 일괄 적용
    a().setProject(p)
    logInfo(`새 사업 생성: ${name.trim()} · ${t.label} (${t.scheduleLabel})`)
    setModule('dashboard')
    close()
  }

  return (
    <Modal
      title="새 사업 시작"
      sub="사업명을 입력하고 단계를 고르면 그 유형의 공정표·공종 프리셋이 세팅됩니다"
      width={760}
      onClose={close}
    >
      <label className="ptype-name">
        <span className="ptype-name__label">사업명</span>
        <input
          className="ptype-name__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: OO댐 건설사업 / OO 양수발전 실시설계"
          autoFocus
          spellCheck={false}
          maxLength={80}
        />
      </label>
      <div className="ptype-step">{named ? '② 사업 단계를 선택하세요' : '① 사업명을 먼저 입력하세요'}</div>

      <div className={`ptype-grid${named ? '' : ' ptype-grid--locked'}`}>
        {PROJECT_TYPES.map((t) => (
          <button key={t.kind} className="ptype-card" disabled={!named} onClick={() => pick(t)}>
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
