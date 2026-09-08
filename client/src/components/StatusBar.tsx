// Bottom status bar — project span, total duration, milestone & critical counts,
// 편집 의미론(위치 자유 편집 / 선후행 제약 유지) 전환, 그리고 미해결 일정 문제 목록으로
// 들어가는 입구. 미해결 문제가 있으면 준공·총 공기는 '잠정' 산정으로 표시된다.

import { dayToDate, toISO } from '../engine/dates'
import { useEditor } from '../state/store'

export function StatusBar() {
  const project = useEditor((s) => s.project)
  const warnings = useEditor((s) => s.warnings)
  const problems = useEditor((s) => s.problems)
  const provisional = useEditor((s) => s.provisional)
  const editMode = useEditor((s) => s.editMode)
  const a = useEditor.getState

  const visible = project.tasks.filter((t) => {
    const cat = project.categories.find((c) => c.id === t.categoryId)
    return cat && (project.commissioningEnabled || !cat.isCommissioning) && !t.hidden && !cat.hidden
  })
  const ends = visible.map((t) => t.ef ?? t.start + t.duration)
  const starts = visible.map((t) => t.es ?? t.start)
  const endDay = ends.length ? Math.max(...ends) : 0
  const startDay = starts.length ? Math.min(...starts) : 0
  const months = Math.round(((endDay - startDay) / 30.44) * 10) / 10
  const milestones = visible.filter((t) => t.isMilestone).length
  const critical = visible.filter((t) => t.critical).length
  const provClass = provisional ? ' is-provisional' : ''

  return (
    <div className="statusbar">
      <span className="stat">
        착수 <strong>{toISO(dayToDate(project.startDate, startDay))}</strong>
      </span>
      <span className={`stat${provClass}`}>
        준공 <strong>{toISO(dayToDate(project.startDate, endDay))}</strong>
        {provisional && (
          <span
            className="badge--provisional"
            title="미해결 순환 의존성이 있어 계산 결과가 잠정입니다"
          >
            잠정
          </span>
        )}
      </span>
      <span className={`stat${provClass}`}>
        총 공기 <strong>{months}개월</strong> ({endDay - startDay}일)
      </span>
      <span className="stat">
        공정 <strong>{visible.length - milestones}</strong> · 마일스톤 <strong>{milestones}</strong>{' '}
        · 연결 <strong>{project.links.length}</strong>
      </span>
      <span className="stat">
        주공정 <strong style={{ color: 'var(--primary-deep)' }}>{critical}</strong>
      </span>
      {/* 편집 의미론 — 막대를 옮길 때 지연(lag)을 새 위치로 역산할지, 지연을 그대로 지킬지. */}
      <span
        className="seg seg--sm statusbar__seg"
        title="막대 이동·기간 변경 시 선후행 지연(lag)을 새 위치로 역산할지(자유), 지연을 그대로 유지하고 위치를 제약 안에 붙잡을지(제약 유지)"
      >
        <button
          type="button"
          className={editMode === 'free' ? 'active' : ''}
          onClick={() => a().setEditMode('free')}
        >
          위치 자유 편집
        </button>
        <button
          type="button"
          className={editMode === 'keepLinks' ? 'active' : ''}
          onClick={() => a().setEditMode('keepLinks')}
        >
          선후행 제약 유지
        </button>
      </span>
      <span style={{ flex: 1 }} />
      {problems.length > 0 ? (
        <button
          type="button"
          className="warn warn--btn"
          onClick={() => a().toggleProblems()}
          title="클릭하면 문제 목록이 열립니다 — 공정·연결로 바로 이동할 수 있습니다"
        >
          ⚠ 미해결 문제 {problems.length}건 — 잠정 산정
        </button>
      ) : (
        warnings.length > 0 && <span className="warn">⚠ {warnings[warnings.length - 1]}</span>
      )}
    </div>
  )
}
