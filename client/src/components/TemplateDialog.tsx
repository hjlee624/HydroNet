// "새 도면" 3단계 템플릿 갤러리.
// 1단계: 도면 유형(ProjectKind) 선택 — PROJECT_TYPES (검색 가능)
// 2단계: 시설물 유형(Facility) 선택 — FACILITY_TYPES + 분야(FACILITY_GROUPS) (검색 가능)
// 3단계: 유형별 시공 공정표(샘플) 미리보기 → 이 템플릿으로 시작
// makeProject(kind, facility) → setProject()로 적용.

import { useMemo, useState } from 'react'
import {
  FACILITY_GROUPS,
  FACILITY_TYPES,
  type FacilityType,
  facilityPreview,
  hasFacilityScheme,
} from '../data/facilities'
import { KIND_META, makeProject, PROJECT_TYPES, type ProjectTypeDef } from '../data/templates'
import { useAuth } from '../state/authStore'
import { logInfo } from '../state/logger'
import { useEditor } from '../state/store'
import { Modal } from './Modal'

/** 대소문자·공백 무시 부분일치 — 여러 필드 중 하나라도 검색어를 포함하면 매치. */
function matches(q: string, ...fields: (string | undefined)[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle))
}

export function TemplateDialog({ onClose }: { onClose: () => void }) {
  const setProject = useEditor((s) => s.setProject)
  const importProjectContent = useEditor((s) => s.importProjectContent)
  const currentName = useEditor((s) => s.project.name)
  const entered = useAuth((s) => s.entered)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedType, setSelectedType] = useState<ProjectTypeDef | null>(null)
  const [selectedFacility, setSelectedFacility] = useState<FacilityType | null>(null)
  const [q1, setQ1] = useState('') // 도면 유형 검색어
  const [q2, setQ2] = useState('') // 시설물 유형 검색어

  function pickType(t: ProjectTypeDef) {
    setSelectedType(t)
    setSelectedFacility(null)
    setStep(2)
  }

  function confirm() {
    if (!selectedType || !selectedFacility) return
    const project = makeProject(selectedType.kind, selectedFacility.key)
    if (entered) {
      // 협업/서버 프로젝트: setProject 로 새 문서를 열면 CollaborationBridge 가 현재 방으로
      // 되돌려 템플릿이 버려진다. 대신 현재 프로젝트(방)의 내용을 이 템플릿으로 덮어써
      // 진행 중이던 작업을 교체하고 팀원 모두에게 동기화·영속한다.
      if (
        typeof window !== 'undefined' &&
        !window.confirm(
          '현재 프로젝트의 모든 공정 작업을 이 템플릿으로 교체합니다. 협업 중이면 팀원 모두에게 반영됩니다. 계속할까요?',
        )
      )
        return
      project.name = currentName || project.name // 프로젝트 정체성(이름) 유지, 공정 내용만 교체
      importProjectContent(project)
    } else {
      setProject(project)
    }
    logInfo(`새 도면 생성: ${KIND_META[selectedType.kind].label} / ${selectedFacility.label}`)
    onClose()
  }

  // 1단계: 검색어로 도면 유형 필터
  const kinds = PROJECT_TYPES.filter((t) => matches(q1, t.label, t.desc, t.highlights.join(' ')))

  // 2단계: 분야(그룹)별 시설물 — 검색어로 필터, 빈 그룹은 숨김
  const facilityGroups = FACILITY_GROUPS.map((g) => ({
    ...g,
    facilities: FACILITY_TYPES.filter(
      (f) => f.group === g.key && matches(q2, f.label, f.desc, g.label),
    ),
  })).filter((g) => g.facilities.length > 0)
  const facilityHits = facilityGroups.reduce((n, g) => n + g.facilities.length, 0)

  // 3단계: 선택 시설물의 시공 공정표(샘플) 요약
  const preview = useMemo(
    () => (selectedFacility ? facilityPreview(selectedFacility.key) : null),
    [selectedFacility],
  )

  const sub =
    step === 1
      ? '도면 유형을 선택하세요'
      : step === 2
        ? '시설물 유형을 선택하세요 (검색 가능)'
        : '이 유형의 시공 공정표(샘플)입니다 — 여기서 바로 시작하세요'

  return (
    <Modal title="새 도면" sub={sub} width={step === 3 ? 860 : 760} onClose={onClose}>
      {/* 진행 단계 표시 */}
      <div className="tpl-steps">
        <span className={step === 1 ? 'tpl-step tpl-step--active' : 'tpl-step tpl-step--done'}>
          <span className="tpl-step__num">1</span> 도면 유형
          {selectedType && <em className="tpl-step__chosen"> · {selectedType.label}</em>}
        </span>
        <span className="tpl-step__sep">›</span>
        <span
          className={
            step === 2
              ? 'tpl-step tpl-step--active'
              : step === 3
                ? 'tpl-step tpl-step--done'
                : 'tpl-step'
          }
        >
          <span className="tpl-step__num">2</span> 시설물 유형
          {selectedFacility && <em className="tpl-step__chosen"> · {selectedFacility.label}</em>}
        </span>
        <span className="tpl-step__sep">›</span>
        <span className={step === 3 ? 'tpl-step tpl-step--active' : 'tpl-step'}>
          <span className="tpl-step__num">3</span> 공정표 미리보기
        </span>
      </div>

      {/* 1단계: 도면 유형 */}
      {step === 1 && (
        <>
          <input
            className="tpl-search"
            type="search"
            value={q1}
            onChange={(e) => setQ1(e.target.value)}
            placeholder="도면 유형 검색 (예: 실시설계, 시공, 타당성)"
            aria-label="도면 유형 검색"
          />
          {kinds.length === 0 ? (
            <div className="tpl-empty">‘{q1}’ 에 맞는 도면 유형이 없습니다.</div>
          ) : (
            <div className="tpl-kind-grid">
              {kinds.map((t) => (
                <button
                  key={t.kind}
                  className="tpl-kind-card"
                  type="button"
                  onClick={() => pickType(t)}
                >
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
        </>
      )}

      {/* 2단계: 시설물 유형 */}
      {step === 2 && (
        <>
          <button
            className="tpl-back-btn"
            type="button"
            onClick={() => {
              setStep(1)
              setSelectedFacility(null)
            }}
          >
            ← 도면 유형 다시 선택
          </button>
          <input
            className="tpl-search"
            type="search"
            value={q2}
            onChange={(e) => setQ2(e.target.value)}
            placeholder="시설물 검색 (예: 교량, 터널, 하수, 옹벽, 도로, 댐)"
            aria-label="시설물 유형 검색"
          />
          {q2.trim() && <div className="tpl-search-count">{facilityHits}개 결과</div>}
          {facilityGroups.length === 0 ? (
            <div className="tpl-empty">‘{q2}’ 에 맞는 시설물이 없습니다.</div>
          ) : (
            facilityGroups.map(({ key, label, facilities }) => (
              <div key={key} className="tpl-facility-group">
                <div className="tpl-facility-group__label">{label}</div>
                <div className="tpl-facility-grid">
                  {facilities.map((f) => (
                    <button
                      key={f.key}
                      className={`tpl-facility-card${selectedFacility?.key === f.key ? ' tpl-facility-card--selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedFacility(f)}
                      onDoubleClick={() => {
                        setSelectedFacility(f)
                        setStep(3)
                      }}
                    >
                      <span className="tpl-facility-card__icon">{f.icon}</span>
                      <span className="tpl-facility-card__name">{f.label}</span>
                      <span className="tpl-facility-card__desc">{f.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          <div className="tpl-confirm-bar">
            <button
              className="tpl-confirm-btn"
              type="button"
              disabled={!selectedFacility}
              onClick={() => setStep(3)}
            >
              {selectedFacility
                ? `${selectedFacility.label} 공정표 미리보기 →`
                : '시설물을 선택하세요'}
            </button>
          </div>
        </>
      )}

      {/* 3단계: 공정표 미리보기 */}
      {step === 3 && selectedType && selectedFacility && preview && (
        <>
          <button className="tpl-back-btn" type="button" onClick={() => setStep(2)}>
            ← 시설물 다시 선택
          </button>
          <div className="tpl-preview">
            <div className="tpl-preview__head">
              <span className="tpl-preview__icon">{selectedFacility.icon}</span>
              <div>
                <div className="tpl-preview__title">
                  {selectedType.label} · {selectedFacility.label}
                </div>
                <div className="tpl-preview__meta">
                  총 공기 약 <b>{preview.totalMonths}</b>개월 · 공종{' '}
                  <b>{preview.categories.length}</b>종 · 공정 <b>{preview.taskCount}</b>개
                </div>
              </div>
            </div>

            {hasFacilityScheme(selectedFacility.key) ? (
              <>
                {/* 미니 공정표(공종별 기간 막대) */}
                <div className="tpl-gantt">
                  {preview.categories.map((c) => {
                    const total = preview.totalDays || 1
                    const left = (c.startDay / total) * 100
                    const width = Math.max(1.5, ((c.endDay - c.startDay) / total) * 100)
                    return (
                      <div key={c.name} className="tpl-gantt__row">
                        <span className="tpl-gantt__label" title={c.name}>
                          {c.name}
                        </span>
                        <span className="tpl-gantt__track">
                          <span
                            className="tpl-gantt__bar"
                            style={{ left: `${left}%`, width: `${width}%`, background: c.color }}
                          />
                        </span>
                        <span className="tpl-gantt__count">{c.taskCount}</span>
                      </div>
                    )
                  })}
                </div>

                {/* 주요 마일스톤 */}
                {preview.milestones.length > 0 && (
                  <div className="tpl-ms">
                    <div className="tpl-ms__label">주요 마일스톤</div>
                    <div className="tpl-ms__list">
                      {preview.milestones.map((m) => (
                        <span key={`${m.name}-${m.day}`} className="tpl-ms__item">
                          <b>◆ {m.name}</b>
                          <em>{m.month}개월</em>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="tpl-empty">
                이 유형의 시공 공정표 샘플을 준비 중입니다 — 시작하면 빈 공정표로 열립니다.
              </div>
            )}
          </div>

          <div className="tpl-confirm-bar">
            <button className="tpl-confirm-btn" type="button" onClick={confirm}>
              이 템플릿으로 시작 →
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
