// 진척·실적 모듈 — 공정별 실적 진척률(%) 입력 + 계획(일정상 경과) 대비 실적 비교.
// 계획%/실적%/지연/전체진척은 모두 공유 셀렉터 projectKpis(대시보드·보고서와 동일 산식)에서
// 가져온다 → 세 화면의 '계획/실적/지연' 정의가 절대 어긋나지 않는다. 지연 공정은 붉게 강조.
import { useMemo } from 'react'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { projectKpis, BEHIND_THRESHOLD, type ProgressRow } from '../engine/kpis'

export function ProgressModule() {
  const project = useEditor((s) => s.project)
  const setProgress = useEditor((s) => s.setTaskProgress)
  const setModule = useShell((s) => s.setModule)

  const data = useMemo(() => {
    const k = projectKpis(project)
    const rows = k.progress.rows
    const groups = project.categories
      .filter((c) => rows.some((r) => r.categoryId === c.id))
      .map((c) => ({ cat: c, items: rows.filter((r) => r.categoryId === c.id) }))
    return {
      rows,
      plannedAll: k.progress.plannedPct,
      actualAll: k.progress.actualPct,
      behind: k.progress.behindCount,
      doneCnt: k.progress.doneCount,
      groups,
    }
  }, [project])

  return (
    <div className="rec prog">
      <header className="rec__head">
        <div className="rec__title">
          <span className="rec__icon">📈</span>
          <div>
            <h1 className="rec__h1">진척·실적</h1>
            <p className="rec__blurb">공정별 실적 진척률 입력 · 계획 대비 실적</p>
          </div>
        </div>
        <div className="rec__actions">
          <button className="btn" onClick={() => setModule('dashboard')}>
            ← 대시보드
          </button>
          <button className="btn btn--primary" onClick={() => setModule('schedule')}>
            📅 공정표
          </button>
        </div>
      </header>

      <section className="prog__kpis">
        <div className="dcard">
          <div className="dcard__label">전체 실적</div>
          <div className="dcard__value">
            <strong>{Math.round(data.actualAll)}</strong>%
          </div>
          <div className="prog__bar">
            <span style={{ width: `${data.actualAll}%` }} />
          </div>
          <div className="dcard__sub">계획 {Math.round(data.plannedAll)}% · 기간 가중</div>
        </div>
        <div className="dcard">
          <div className="dcard__label">계획 대비</div>
          <div
            className="dcard__value"
            style={{
              color:
                data.actualAll - data.plannedAll < 0
                  ? 'var(--danger,#c0392b)'
                  : 'var(--primary-deep)',
            }}
          >
            <strong>
              {data.actualAll - data.plannedAll >= 0 ? '+' : ''}
              {Math.round(data.actualAll - data.plannedAll)}
            </strong>
            %p
          </div>
          <div className="dcard__sub">
            {data.actualAll - data.plannedAll < 0 ? '일정 대비 지연' : '일정 대비 양호'}
          </div>
        </div>
        <div className="dcard">
          <div className="dcard__label">지연 공정</div>
          <div className="dcard__value">
            <strong>{data.behind}</strong>
          </div>
          <div className="dcard__sub">계획比 10%p↓</div>
        </div>
        <div className="dcard">
          <div className="dcard__label">완료 공정</div>
          <div className="dcard__value">
            <strong>{data.doneCnt}</strong> / {data.rows.length}
          </div>
          <div className="dcard__sub">실적 100%</div>
        </div>
      </section>

      {data.rows.length === 0 ? (
        <div className="rec__empty">
          <p>표시할 공정이 없습니다. 공정표에서 공정을 추가하세요.</p>
        </div>
      ) : (
        <div className="rec__tablewrap">
          <table className="rec__table prog__table">
            <thead>
              <tr>
                <th className="rec__wide">공정</th>
                <th>기간(일)</th>
                <th>계획%</th>
                <th>실적%</th>
                <th className="rec__wide">실적 입력</th>
                <th>편차</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <GroupRows
                  key={g.cat.id}
                  name={g.cat.name}
                  color={g.cat.color}
                  items={g.items}
                  setProgress={setProgress}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="rec__note">
        실적%는 사업에 자동 저장됩니다. 계획%는 오늘 날짜 기준 각 공정의 경과율입니다.
      </p>
    </div>
  )
}

function GroupRows({
  name,
  color,
  items,
  setProgress,
}: {
  name: string
  color: string
  items: ProgressRow[]
  setProgress: (id: string, p: number) => void
}) {
  return (
    <>
      <tr className="prog__grouprow">
        <td colSpan={6}>
          <span className="prog__swatch" style={{ background: color }} /> {name}
        </td>
      </tr>
      {items.map((r) => (
        <tr key={r.id} className={r.deltaPct <= BEHIND_THRESHOLD ? 'prog__behind' : ''}>
          <td className="rec__wide">
            {r.name}
            {r.critical && (
              <span className="prog__cp" title="주공정">
                CP
              </span>
            )}
          </td>
          <td>{r.duration}</td>
          <td>{Math.round(r.plannedPct)}</td>
          <td>
            <strong>{Math.round(r.actualPct)}</strong>
          </td>
          <td className="rec__wide">
            <div className="prog__inrow">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={r.actualPct}
                onChange={(e) => setProgress(r.id, Number(e.target.value))}
              />
              <input
                className="rec__in prog__pctin"
                type="number"
                min={0}
                max={100}
                value={Math.round(r.actualPct)}
                onChange={(e) => setProgress(r.id, Number(e.target.value))}
              />
            </div>
          </td>
          <td style={{ color: r.deltaPct < 0 ? 'var(--danger,#c0392b)' : 'var(--stone)' }}>
            {r.deltaPct >= 0 ? '+' : ''}
            {Math.round(r.deltaPct)}
          </td>
        </tr>
      ))}
    </>
  )
}
