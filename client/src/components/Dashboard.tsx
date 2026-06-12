// 사업 대시보드 — cross-module overview. Today it surfaces the real schedule
// KPIs (the only live module) + quick links into every module. As modules land,
// their headline metrics get added as cards here.
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { MODULES } from '../data/modules'
import { dateToDay, dayToDate, toISO } from '../engine/dates'

export function Dashboard() {
  const project = useEditor((s) => s.project)
  const setModule = useShell((s) => s.setModule)

  const k = useMemo(() => {
    const vis = project.tasks.filter((t) => {
      const c = project.categories.find((x) => x.id === t.categoryId)
      return c && (project.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
    })
    const starts = vis.map((t) => t.es ?? t.start)
    const ends = vis.map((t) => t.ef ?? t.start + t.duration)
    const startDay = starts.length ? Math.min(...starts) : 0
    const endDay = ends.length ? Math.max(...ends) : 0
    const months = Math.round(((endDay - startDay) / 30.44) * 10) / 10
    const milestones = vis.filter((t) => t.isMilestone)
    const critical = vis.filter((t) => t.critical)
    const todayDay = dateToDay(project.startDate, new Date())
    const elapsedPct = endDay > startDay
      ? Math.round(Math.min(1, Math.max(0, (todayDay - startDay) / (endDay - startDay))) * 100) : 0
    const upcoming = milestones.filter((m) => m.start >= todayDay).sort((p, q) => p.start - q.start).slice(0, 5)
    return { startDay, endDay, months, activities: vis.length - milestones.length, milestones, critical, todayDay, elapsedPct, upcoming }
  }, [project])

  const card = (label: string, value: ReactNode, sub?: string) => (
    <div className="dcard">
      <div className="dcard__label">{label}</div>
      <div className="dcard__value">{value}</div>
      {sub && <div className="dcard__sub">{sub}</div>}
    </div>
  )

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <div className="dash__eyebrow">사업 대시보드 · 건설사업관리</div>
          <h1 className="dash__title">{project.name || '제목 없음'}</h1>
        </div>
        <button className="btn btn--primary" onClick={() => setModule('schedule')}>📅 공정표 열기</button>
      </header>

      <section className="dash__cards">
        {card('총 공기', <><strong>{k.months}</strong> 개월</>, `${k.endDay - k.startDay}일`)}
        {card('착수 → 준공(예정)', <>{toISO(dayToDate(project.startDate, k.startDay))} <span style={{ color: 'var(--stone)' }}>→</span> {toISO(dayToDate(project.startDate, k.endDay))}</>)}
        {card('시간 경과', <><strong>{k.elapsedPct}</strong>%</>, '오늘 기준(일정상)')}
        {card('공정 / 마일스톤', <><strong>{k.activities}</strong> / {k.milestones.length}</>, `연결 ${project.links.length}`)}
        {card('주공정(CP)', <strong style={{ color: 'var(--primary-deep)' }}>{k.critical.length}</strong>, '임계경로 공정')}
        {card('우기 구간', <strong>{project.rainySeasons.length}</strong>, '연도별 반복')}
      </section>

      <div className="dash__cols">
        <section className="dash__panel">
          <h2 className="dash__ph">다가오는 마일스톤</h2>
          {k.upcoming.length ? (
            <ul className="dash__ms">
              {k.upcoming.map((m) => {
                const dd = m.start - k.todayDay
                return (
                  <li key={m.id} onClick={() => setModule('schedule')}>
                    <span className="dash__ms-d">{toISO(dayToDate(project.startDate, m.start)).slice(2)}</span>
                    <span className="dash__ms-n">{m.name.replace(/^◆\s*/, '')}</span>
                    <span className="dash__ms-dd">{dd >= 0 ? `D-${dd}` : `D+${-dd}`}</span>
                  </li>
                )
              })}
            </ul>
          ) : <p className="dash__empty">앞으로 예정된 마일스톤이 없습니다.</p>}
        </section>

        <section className="dash__panel">
          <h2 className="dash__ph">모듈 바로가기</h2>
          <div className="dash__mods">
            {MODULES.filter((m) => m.id !== 'dashboard').map((m) => (
              <button key={m.id} className="dash__mod" onClick={() => setModule(m.id)}>
                <span className="dash__mod-ic">{m.icon}</span>
                <span className="dash__mod-t">
                  <span className="dash__mod-l">{m.label}{m.status === 'soon' && <span className="dash__mod-s">예정</span>}</span>
                  <span className="dash__mod-b">{m.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
