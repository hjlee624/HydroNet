// Bottom status bar — project span, total duration, milestone & critical counts,
// and the latest scheduling warning (cycles etc.).

import { useEditor } from '../state/store'
import { dayToDate, toISO } from '../engine/dates'

export function StatusBar() {
  const project = useEditor((s) => s.project)
  const warnings = useEditor((s) => s.warnings)

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

  return (
    <div className="statusbar">
      <span className="stat">
        착수 <strong>{toISO(dayToDate(project.startDate, startDay))}</strong>
      </span>
      <span className="stat">
        준공 <strong>{toISO(dayToDate(project.startDate, endDay))}</strong>
      </span>
      <span className="stat">
        총 공기 <strong>{months}개월</strong> ({endDay - startDay}일)
      </span>
      <span className="stat">
        공정 <strong>{visible.length - milestones}</strong> · 마일스톤 <strong>{milestones}</strong>{' '}
        · 연결 <strong>{project.links.length}</strong>
      </span>
      <span className="stat">
        주공정 <strong style={{ color: 'var(--primary-deep)' }}>{critical}</strong>
      </span>
      <span style={{ flex: 1 }} />
      {warnings.length > 0 && <span className="warn">⚠ {warnings[warnings.length - 1]}</span>}
    </div>
  )
}
