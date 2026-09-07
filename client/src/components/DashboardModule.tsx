// 프로젝트 총괄 대시보드 — 현재 열린 프로젝트의 일정 개요 허브.
// 예전 HydroNET 대시보드를 Sequence(공정표 전용) 디자인·데이터에 맞춰 이식했다.
// 모든 KPI는 단일 순수 셀렉터 projectKpis(project)에서 파생(공정표와 산식 발산 없음).
import { type ReactNode, useMemo } from 'react'
import { dayToDate, toISO } from '../engine/dates'
import { projectKpis, type ScheduleStatus, sheetSummaries } from '../engine/projectKpis'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'

const STATUS_META: Record<ScheduleStatus, { label: string; cls: string }> = {
  'in-progress': { label: '진행 중', cls: 'seq-dash__chip--go' },
  'not-started': { label: '착수 전', cls: 'seq-dash__chip--wait' },
  overdue: { label: '준공 예정일 경과', cls: 'seq-dash__chip--late' },
  empty: { label: '일정 없음', cls: 'seq-dash__chip--none' },
}

const sheetIcon = (role: string) => (role === 'milestone' ? '◆' : '📅')
const sheetRoleLabel = (role: string) => (role === 'milestone' ? '마일스톤' : '예정공정표')

export function DashboardModule() {
  const project = useEditor((s) => s.project)
  const setView = useView((s) => s.setView)

  const k = useMemo(() => projectKpis(project), [project])
  const sheets = useMemo(() => sheetSummaries(project), [project])
  const status = STATUS_META[k.status]
  const day = (d: number) => toISO(dayToDate(project.startDate, d))

  const kpi = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div className="seq-dash__kpi">
      <div className="seq-dash__kpi-label">{label}</div>
      <div className="seq-dash__kpi-value">{value}</div>
      {sub != null && <div className="seq-dash__kpi-sub">{sub}</div>}
    </div>
  )

  return (
    <div className="seq-dash" data-export-hide="1">
      <header className="seq-dash__head">
        <div className="seq-dash__titlewrap">
          <div className="seq-dash__eyebrow">프로젝트 총괄</div>
          <h1 className="seq-dash__title">{project.name || '제목 없음'}</h1>
          <div className="seq-dash__subline">
            <span className={`seq-dash__chip ${status.cls}`}>{status.label}</span>
            <span className="seq-dash__dot">·</span>
            공정 {k.activities} · 마일스톤 {k.milestoneCount}
            {k.imminentMilestones > 0 && (
              <>
                <span className="seq-dash__dot">·</span>
                <span className="seq-dash__warn">임박 마일스톤 {k.imminentMilestones}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary seq-dash__open"
          onClick={() => setView('schedule')}
        >
          📅 공정표 열기
        </button>
      </header>

      {!k.hasData ? (
        <div className="seq-dash__blank">
          아직 공정이 없습니다.{' '}
          <button type="button" className="seq-dash__link" onClick={() => setView('schedule')}>
            공정표에서 공정을 추가
          </button>
          하면 총괄 지표가 여기에 집계됩니다.
        </div>
      ) : (
        <>
          <section className="seq-dash__kpis">
            {kpi(
              '총 공기',
              <>
                <strong>{k.months}</strong> 개월
              </>,
              `${k.durationDays.toLocaleString()}일`,
            )}
            {kpi(
              '착수 → 준공(예정)',
              <span className="seq-dash__dates">
                {day(k.startDay)} <i>→</i> {day(k.endDay)}
              </span>,
            )}
            {kpi(
              '시간 경과',
              <>
                <strong>{k.elapsedPct}</strong>%
              </>,
              <span className="seq-dash__bar">
                <span style={{ width: `${k.elapsedPct}%` }} />
              </span>,
            )}
            {kpi(
              '공정 / 마일스톤',
              <>
                <strong>{k.activities}</strong> / {k.milestoneCount}
              </>,
              `연결 ${k.linkCount}`,
            )}
            {kpi(
              '주공정 (CP)',
              <strong>{k.criticalCount}</strong>,
              k.overdueMilestones > 0 ? (
                <span className="seq-dash__warn">경과 마일스톤 {k.overdueMilestones}</span>
              ) : (
                '임계경로 공정'
              ),
            )}
            {kpi('우기 구간', <strong>{k.rainyCount}</strong>, '연도별 반복')}
          </section>

          <div className="seq-dash__cols">
            <section className="seq-dash__panel">
              <h2 className="seq-dash__ph">
                다가오는 마일스톤
                {k.imminentMilestones > 0 && (
                  <span className="seq-dash__ph-badge">임박 {k.imminentMilestones}</span>
                )}
              </h2>
              {k.upcoming.length ? (
                <ul className="seq-dash__ms">
                  {k.upcoming.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="seq-dash__ms-row"
                        onClick={() => setView('schedule')}
                      >
                        <span className="seq-dash__ms-date">{day(m.startDay).slice(2)}</span>
                        <span className="seq-dash__ms-name">
                          {m.name}
                          {m.critical && <span className="seq-dash__cp">CP</span>}
                        </span>
                        <span
                          className={`seq-dash__ms-dd${m.dMinus <= 7 ? ' seq-dash__ms-dd--soon' : ''}`}
                        >
                          {m.dMinus >= 0 ? `D-${m.dMinus}` : `D+${-m.dMinus}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="seq-dash__empty">앞으로 예정된 마일스톤이 없습니다.</p>
              )}
            </section>

            <section className="seq-dash__panel">
              <h2 className="seq-dash__ph">공정표 시트</h2>
              <ul className="seq-dash__sheets">
                {sheets.map((s) => (
                  <li key={s.id} className={`seq-dash__sheet${s.active ? ' is-active' : ''}`}>
                    <span className="seq-dash__sheet-ic" aria-hidden="true">
                      {sheetIcon(s.role)}
                    </span>
                    <span className="seq-dash__sheet-body">
                      <span className="seq-dash__sheet-name">
                        {s.name}
                        {s.active && <span className="seq-dash__sheet-cur">현재</span>}
                      </span>
                      <span className="seq-dash__sheet-meta">
                        {sheetRoleLabel(s.role)} · 공정 {s.activities} · 마일스톤 {s.milestones}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="seq-dash__note">
            지표는 현재 공정표(예정·시운전 옵션 반영)에서 자동 집계됩니다. 세부 편집·출력은 우측
            상단
            <button type="button" className="seq-dash__link" onClick={() => setView('schedule')}>
              공정표 열기
            </button>
            에서.
          </p>
        </>
      )}
    </div>
  )
}
