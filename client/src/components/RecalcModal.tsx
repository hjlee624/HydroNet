// Shows what a 재계산 / 일정 정렬 pass changed: each moved 공정 with its old → new
// start date and the day delta. Driven by store.recalcReport; closing clears it.

import { useEditor } from '../state/store'
import { Modal } from './Modal'
import { dayToDate, toISO } from '../engine/dates'

export function RecalcModal() {
  const report = useEditor((s) => s.recalcReport)
  const a = useEditor.getState
  if (!report) return null

  const title = report.kind === 'reschedule' ? '재계산 결과' : '일정 정렬 결과'
  const fmt = (day: number) => toISO(dayToDate(report.startDate, day))
  const sub = report.totalMoved > 0
    ? `${report.totalMoved}개 공정의 시작일이 변경되었습니다.`
    : '변경된 공정이 없습니다.'

  return (
    <Modal title={title} sub={sub} width={540} onClose={() => a().closeRecalcReport()}>
      {report.changes.length === 0 ? (
        <p className="note" style={{ fontSize: 13, padding: '6px 0 10px' }}>
          모든 공정이 이미 최적(최조기) 위치에 있어 이동된 공정이 없습니다.
        </p>
      ) : (
        <div className="recalc-list">
          {report.changes.map((c) => (
            <div className="recalc-row" key={c.id}>
              <span className="recalc-name" title={c.name}>{c.name.replace(/^◆\s*/, '')}</span>
              <span className="recalc-dates">
                <span className="recalc-from">{fmt(c.oldStart)}</span>
                <span className="recalc-arrow">→</span>
                <span className="recalc-to">{fmt(c.newStart)}</span>
              </span>
              <span className={`recalc-delta ${c.deltaDays > 0 ? 'pos' : 'neg'}`}>
                {c.deltaDays > 0 ? `+${c.deltaDays}` : c.deltaDays}일
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
