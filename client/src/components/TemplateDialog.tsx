// "새 도면" 2단계 템플릿 갤러리.
// 1단계: 도면 유형(ProjectKind) 선택 — PROJECT_TYPES
// 2단계: 시설물 유형(Facility) 선택 — FACILITY_TYPES + 유형별 group 분류
// makeProject(kind, facility) → setProject()로 적용.

import { useState } from 'react'
import { FACILITY_TYPES, type FacilityType } from '../data/facilities'
import { KIND_META, PROJECT_TYPES, type ProjectTypeDef, makeProject } from '../data/templates'
import { logInfo } from '../state/logger'
import { useEditor } from '../state/store'
import { Modal } from './Modal'

const FACILITY_GROUP_LABEL: Record<string, string> = {
  'new-dam': '신규 댐',
  pumped: '양수발전',
  rehab: '안전성 강화·보수',
}

export function TemplateDialog({ onClose }: { onClose: () => void }) {
  const setProject = useEditor((s) => s.setProject)

  const [step, setStep] = useState<1 | 2>(1)
  const [selectedType, setSelectedType] = useState<ProjectTypeDef | null>(null)
  const [selectedFacility, setSelectedFacility] = useState<FacilityType | null>(null)

  function pickType(t: ProjectTypeDef) {
    setSelectedType(t)
    setSelectedFacility(null)
    setStep(2)
  }

  function confirm() {
    if (!selectedType || !selectedFacility) return
    const project = makeProject(selectedType.kind, selectedFacility.key)
    setProject(project)
    logInfo(`새 도면 생성: ${KIND_META[selectedType.kind].label} / ${selectedFacility.label}`)
    onClose()
  }

  // 시설물 유형을 그룹별로 분류
  const facilityGroups = Object.entries(FACILITY_GROUP_LABEL).map(([key, label]) => ({
    key,
    label,
    facilities: FACILITY_TYPES.filter((f) => f.group === key),
  }))

  return (
    <Modal
      title="새 도면"
      sub={step === 1 ? '도면 유형을 선택하세요' : '시설물 유형을 선택하세요'}
      width={720}
      onClose={onClose}
    >
      {/* 진행 단계 표시 */}
      <div className="tpl-steps">
        <span className={step === 1 ? 'tpl-step tpl-step--active' : 'tpl-step tpl-step--done'}>
          <span className="tpl-step__num">1</span> 도면 유형
          {selectedType && <em className="tpl-step__chosen"> · {selectedType.label}</em>}
        </span>
        <span className="tpl-step__sep">›</span>
        <span className={step === 2 ? 'tpl-step tpl-step--active' : 'tpl-step'}>
          <span className="tpl-step__num">2</span> 시설물 유형
          {selectedFacility && <em className="tpl-step__chosen"> · {selectedFacility.label}</em>}
        </span>
      </div>

      {/* 1단계: 도면 유형 */}
      {step === 1 && (
        <div className="tpl-kind-grid">
          {PROJECT_TYPES.map((t) => (
            <button key={t.kind} className="tpl-kind-card" type="button" onClick={() => pickType(t)}>
              <span className="tpl-kind-card__icon">{t.icon}</span>
              <span className="tpl-kind-card__label">{t.label}</span>
              <span className="tpl-kind-card__desc">{t.desc}</span>
              <ul className="tpl-kind-card__points">
                {t.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      )}

      {/* 2단계: 시설물 유형 */}
      {step === 2 && (
        <>
          <button
            className="tpl-back-btn"
            type="button"
            onClick={() => { setStep(1); setSelectedFacility(null) }}
          >
            ← 도면 유형 다시 선택
          </button>
          {facilityGroups.map(({ key, label, facilities }) => (
            <div key={key} className="tpl-facility-group">
              <div className="tpl-facility-group__label">{label}</div>
              <div className="tpl-facility-grid">
                {facilities.map((f) => (
                  <button
                    key={f.key}
                    className={`tpl-facility-card${selectedFacility?.key === f.key ? ' tpl-facility-card--selected' : ''}`}
                    type="button"
                    onClick={() => setSelectedFacility(f)}
                  >
                    <span className="tpl-facility-card__icon">{f.icon}</span>
                    <span className="tpl-facility-card__name">{f.label}</span>
                    <span className="tpl-facility-card__desc">{f.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="tpl-confirm-bar">
            <button
              className="tpl-confirm-btn"
              type="button"
              disabled={!selectedFacility}
              onClick={confirm}
            >
              {selectedFacility
                ? `${selectedType?.label} · ${selectedFacility.label} 도면 만들기`
                : '시설물을 선택하세요'}
            </button>
          </div>
        </>
      )}

      <p className="note" style={{ marginTop: 10 }}>
        새 도면을 만들면 현재 작업은 사라집니다. 저장하지 않은 변경이 있으면 먼저 <b>저장</b>하세요.
      </p>
    </Modal>
  )
}
