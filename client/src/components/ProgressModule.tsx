// 진척·실적 모듈 — 공정별 실적 진척률(%)·담당자·실적 착수/완료일 입력 + 계획 대비 실적 비교.
// 계획%/실적%/지연/전체진척은 모두 공유 셀렉터 projectKpis(대시보드와 동일 산식)에서 가져온다
// → 두 화면의 '계획/실적/지연' 정의가 어긋나지 않는다. 지연 공정은 붉게 강조. 조회 전용은 입력 비활성.
//
// 단위 규약(화면에도 그대로 적어 둔다 — 읽는 사람이 %와 %p를 헷갈리면 판단이 바뀐다):
//  · 계획% · 실적% 는 **진도율(%)** 이다.
//  · 편차 = 실적% − 계획% 이며 두 비율의 차이라 단위가 **%p(퍼센트포인트)** 다. '몇 % 늦었다'가 아니다.
import { useMemo } from 'react'
import { toISO } from '../engine/dates'
import {
  BEHIND_THRESHOLD,
  CUMULATIVE_BEHIND_THRESHOLD,
  type ProgressRow,
  projectKpis,
} from '../engine/projectKpis'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'
import type { Task } from '../types/model'

export function ProgressModule() {
  const project = useEditor((s) => s.project)
  const setProgress = useEditor((s) => s.setTaskProgress)
  const setActuals = useEditor((s) => s.setTaskActuals)
  const readOnly = useEditor((s) => s.readOnly)
  const setView = useView((s) => s.setView)

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
      notStarted: k.progress.notStartedButDue,
      overdue: k.progress.overdueFinish,
      groups,
    }
  }, [project])

  const deltaAll = data.actualAll - data.plannedAll

  return (
    <div className="seq-rec seq-prog">
      <header className="seq-rec__head">
        <div className="seq-rec__title">
          <span className="seq-rec__icon" aria-hidden="true">
            📈
          </span>
          <div>
            <h1 className="seq-rec__h1">진척·실적</h1>
            <p className="seq-rec__blurb">공정별 실적 진척률 입력 · 계획 대비 실적</p>
          </div>
        </div>
        <div className="seq-rec__actions">
          <button type="button" className="btn" onClick={() => setView('dashboard')}>
            ← 총괄
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setView('schedule')}>
            📅 공정표
          </button>
        </div>
      </header>

      <section className="seq-dash__kpis seq-prog__kpis">
        <div className="seq-dash__kpi">
          <div className="seq-dash__kpi-label">전체 실적</div>
          <div className="seq-dash__kpi-value">
            <strong>{Math.round(data.actualAll)}</strong>%
          </div>
          <span className="seq-dash__bar">
            <span style={{ width: `${data.actualAll}%` }} />
          </span>
          <div className="seq-dash__kpi-sub">계획 {Math.round(data.plannedAll)}% · 기간 가중</div>
        </div>
        <div className="seq-dash__kpi">
          <div className="seq-dash__kpi-label">계획 대비</div>
          <div
            className="seq-dash__kpi-value"
            style={{ color: deltaAll < 0 ? '#c0271a' : 'var(--primary-deep)' }}
          >
            <strong>
              {deltaAll >= 0 ? '+' : ''}
              {Math.round(deltaAll)}
            </strong>
            %p
          </div>
          <div className="seq-dash__kpi-sub">
            {deltaAll < 0 ? '일정 대비 지연' : '일정 대비 양호'} · 사업 누계 경보 임계{' '}
            {CUMULATIVE_BEHIND_THRESHOLD}%p
          </div>
        </div>
        <div className="seq-dash__kpi">
          <div className="seq-dash__kpi-label">지연 공정</div>
          <div className="seq-dash__kpi-value">
            <strong>{data.behind}</strong>
          </div>
          <div className="seq-dash__kpi-sub">
            계획比 {BEHIND_THRESHOLD}%p↓ · 미착수 {data.notStarted} · 미완료 초과 {data.overdue}
          </div>
        </div>
        <div className="seq-dash__kpi">
          <div className="seq-dash__kpi-label">완료 공정</div>
          <div className="seq-dash__kpi-value">
            <strong>{data.doneCnt}</strong> / {data.rows.length}
          </div>
          <div className="seq-dash__kpi-sub">실적 100%</div>
        </div>
      </section>

      {data.rows.length === 0 ? (
        <div className="seq-rec__empty">
          <p>표시할 공정이 없습니다. 공정표에서 공정을 추가하세요.</p>
        </div>
      ) : (
        <div className="seq-rec__tablewrap">
          <table className="seq-rec__table seq-prog__table">
            <thead>
              <tr>
                <th className="seq-rec__wide">공정</th>
                <th>기간(일)</th>
                <th>계획%</th>
                <th>실적%</th>
                <th className="seq-rec__wide">실적 입력</th>
                <th title="실적% − 계획%. 두 비율의 차이라 단위는 %p(퍼센트포인트)입니다.">
                  편차(%p)
                </th>
                <th>담당자</th>
                <th>실적 착수</th>
                <th>실적 완료</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <GroupRows
                  key={g.cat.id}
                  name={g.cat.name}
                  color={g.cat.color}
                  items={g.items}
                  readOnly={readOnly}
                  setProgress={setProgress}
                  setActuals={setActuals}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="seq-rec__foot">
        실적%·담당자·실적일자는 사업에 자동 저장·동기화됩니다. <b>계획%</b>는 오늘 날짜 기준 각
        공정의 경과율(진도율, %)이고, <b>편차</b>는 실적% − 계획% 라 단위가 <b>%p(퍼센트포인트)</b>
        입니다 — '{BEHIND_THRESHOLD}%p 지연'은 '{Math.abs(BEHIND_THRESHOLD)}% 늦었다'가 아니라 계획
        진도율보다 {Math.abs(BEHIND_THRESHOLD)}퍼센트포인트 아래라는 뜻입니다. 실적%를 100으로
        올리면 실적 완료일이 비어 있을 때 오늘 날짜로 자동 기록됩니다.
      </p>
    </div>
  )
}

function GroupRows({
  name,
  color,
  items,
  readOnly,
  setProgress,
  setActuals,
}: {
  name: string
  color: string
  items: ProgressRow[]
  readOnly: boolean
  setProgress: (id: string, p: number) => void
  setActuals: (
    id: string,
    patch: Partial<Pick<Task, 'owner' | 'actualStart' | 'actualFinish'>>,
  ) => void
}) {
  // 실적 100% 로 올릴 때 완료일이 비어 있으면 오늘로 자동 기록 — 주간 집계가 '지난주 완료'를
  // 세려면 날짜가 필요한데, 담당자가 %만 올리고 날짜를 빼먹는 일이 실무에서 가장 흔하다.
  const onProgress = (row: ProgressRow, value: number): void => {
    setProgress(row.id, value)
    if (value >= 100 && !row.actualFinish) setActuals(row.id, { actualFinish: toISO(new Date()) })
  }
  return (
    <>
      <tr className="seq-prog__grouprow">
        <td colSpan={9}>
          <span className="seq-prog__swatch" style={{ background: color }} /> {name}
        </td>
      </tr>
      {items.map((r) => (
        <tr key={r.id} className={r.deltaPct <= BEHIND_THRESHOLD ? 'seq-prog__behind' : ''}>
          <td className="seq-rec__wide">
            {r.name}
            {r.critical && (
              <span className="seq-prog__cp" title="주공정">
                CP
              </span>
            )}
          </td>
          <td>{r.duration}</td>
          <td>{Math.round(r.plannedPct)}</td>
          <td>
            <strong>{Math.round(r.actualPct)}</strong>
          </td>
          <td className="seq-rec__wide">
            <div className="seq-prog__inrow">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={r.actualPct}
                disabled={readOnly}
                onChange={(e) => onProgress(r, Number(e.target.value))}
              />
              <input
                className="seq-rec__in seq-prog__pctin"
                type="number"
                min={0}
                max={100}
                value={Math.round(r.actualPct)}
                readOnly={readOnly}
                onChange={(e) => onProgress(r, Number(e.target.value))}
              />
            </div>
          </td>
          <td style={{ color: r.deltaPct < 0 ? '#c0271a' : 'var(--stone)' }}>
            {r.deltaPct >= 0 ? '+' : ''}
            {Math.round(r.deltaPct)}
          </td>
          <td>
            <input
              className="seq-rec__in"
              type="text"
              value={r.owner ?? ''}
              disabled={readOnly}
              placeholder="담당자"
              onChange={(e) => setActuals(r.id, { owner: e.target.value })}
            />
          </td>
          <td>
            <input
              className="seq-rec__in"
              type="date"
              value={r.actualStart ?? ''}
              disabled={readOnly}
              onChange={(e) => setActuals(r.id, { actualStart: e.target.value })}
            />
          </td>
          <td>
            <input
              className="seq-rec__in"
              type="date"
              value={r.actualFinish ?? ''}
              disabled={readOnly}
              onChange={(e) => setActuals(r.id, { actualFinish: e.target.value })}
            />
          </td>
        </tr>
      ))}
    </>
  )
}
