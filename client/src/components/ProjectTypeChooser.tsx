// 새 사업 시작 — ① 사업명 입력 → ② 설계 단계 선택 → ③ 시설물 유형 선택 → 시작.
// 설계 단계(타당성/기본/실시/시공)와 시설물 유형(콘크리트댐·필댐·양수발전 등)을 함께
// 고르면 그 조합의 공정표·공종 프리셋이 세팅된다(예정공정표 + 시공 마일스톤). 입력한
// 사업명이 대시보드·공정관리(도면 제목)에 일괄 적용된다.
import { useState } from 'react'
import { Modal } from './Modal'
import { PROJECT_TYPES, makeProject } from '../data/templates'
import { FACILITY_TYPES } from '../data/facilities'
import type { ProjectKind } from '../types/model'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { logInfo } from '../state/logger'

function markChosen() {
  try {
    localStorage.setItem('hydronet:typeChosen', '1')
  } catch {
    /* ignore */
  }
}

export function ProjectTypeChooser({ onClose }: { onClose: () => void }) {
  const a = useEditor.getState
  const setModule = useShell((s) => s.setModule)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProjectKind | null>(null)
  const [facility, setFacility] = useState<string | null>(null)
  const named = name.trim().length > 0
  const ready = named && !!kind && !!facility

  // 어떤 경로로 닫히든(시작/✕/Esc/바깥클릭) "이미 보여줬음"을 기억 → 새로고침 나그 루프 방지.
  function close() {
    markChosen()
    onClose()
  }

  function start() {
    if (!ready || !kind || !facility) return
    // 새 사업은 현재 사업을 통째로 대체한다 — 모듈 기록(원가·공사비·품질 등)이나 기준선이
    // 있으면 데이터 손실을 경고(저장본은 별 id라 불러오기로 복구 가능, 세션 편집은 소실).
    const cur = a().project
    const hasRecords = cur.modules
      ? Object.values(cur.modules).some((arr) => arr && arr.length > 0)
      : false
    if (
      (hasRecords || cur.baseline) &&
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function'
    ) {
      if (
        !window.confirm(
          '현재 사업의 모든 모듈 기록·기준선이 새 사업으로 대체됩니다. 계속할까요?\n(미리 저장해 둔 파일은 ‘불러오기’로 다시 열 수 있습니다.)',
        )
      )
        return
    }
    const p = makeProject(kind, facility)
    p.name = name.trim() // 사업명을 대시보드·공정관리(도면 제목)에 일괄 적용
    a().setProject(p)
    const kindLabel = PROJECT_TYPES.find((t) => t.kind === kind)?.label ?? ''
    const facLabel = FACILITY_TYPES.find((f) => f.key === facility)?.label ?? ''
    logInfo(`새 사업 생성: ${name.trim()} · ${kindLabel} · ${facLabel}`)
    setModule('dashboard')
    close()
  }

  const stepMsg = !named
    ? '① 사업명을 먼저 입력하세요'
    : !kind
      ? '② 설계 단계를 선택하세요'
      : !facility
        ? '③ 시설물 유형을 선택하세요'
        : '✓ 아래 ‘이 설정으로 시작’을 누르세요'

  return (
    <Modal
      title="새 사업 시작"
      sub="사업명·설계 단계·시설물 유형을 고르면 그 조합의 공정표·공종 프리셋이 세팅됩니다"
      width={860}
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
      <div className="ptype-step">{stepMsg}</div>

      <div className="ptype-section-title">② 설계 단계</div>
      <div className={`ptype-grid${named ? '' : ' ptype-grid--locked'}`}>
        {PROJECT_TYPES.map((t) => (
          <button
            key={t.kind}
            className="ptype-card"
            disabled={!named}
            style={
              kind === t.kind
                ? {
                    outline: '2.5px solid var(--primary)',
                    outlineOffset: '-1px',
                    borderColor: 'var(--primary)',
                  }
                : undefined
            }
            onClick={() => setKind(t.kind)}
          >
            <div className="ptype-card__top">
              <span className="ptype-card__icon">{t.icon}</span>
              <span className="ptype-card__name">{t.label}</span>
              <span className="ptype-card__sched">{t.scheduleLabel}</span>
            </div>
            <p className="ptype-card__desc">{t.desc}</p>
            <div className="ptype-card__tags">
              {t.highlights.map((h) => (
                <span key={h} className="ptype-tag">
                  {h}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="ptype-section-title" style={{ marginTop: 16 }}>
        ③ 시설물 유형
      </div>
      <div className={`ptype-grid${named ? '' : ' ptype-grid--locked'}`}>
        {FACILITY_TYPES.map((f) => (
          <button
            key={f.key}
            className="ptype-card"
            disabled={!named}
            style={
              facility === f.key
                ? {
                    outline: '2.5px solid var(--primary)',
                    outlineOffset: '-1px',
                    borderColor: 'var(--primary)',
                  }
                : undefined
            }
            onClick={() => setFacility(f.key)}
          >
            <div className="ptype-card__top">
              <span className="ptype-card__icon">{f.icon}</span>
              <span className="ptype-card__name">{f.label}</span>
            </div>
            <p className="ptype-card__desc">{f.desc}</p>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button
          className="btn btn--dark"
          disabled={!ready}
          style={{ minWidth: 180, opacity: ready ? 1 : 0.5 }}
          onClick={start}
        >
          이 설정으로 시작
        </button>
        <p className="note" style={{ margin: 0 }}>
          프리셋은 시작점일 뿐 — 공정표는 자유롭게 편집할 수 있습니다. 단계·유형이 바뀌면 새
          사업으로 다시 시작하세요.
        </p>
      </div>
    </Modal>
  )
}
