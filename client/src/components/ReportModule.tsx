// 보고서 모듈 — 모든 모듈을 가로질러 핵심 지표를 자동 집계한 주간·월간 보고 초안.
// 공정(일정상 경과·주공정·마일스톤) + 진척 + 기록형 모듈(원가/품질/안전/인허가/리스크…)
// 요약을 한 화면에 모은다. 🖨 인쇄로 PDF 출력. See PACKAGE_PLAN.md.
import { useMemo } from 'react'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import type { ModuleId } from '../data/modules'
import { dateToDay, dayToDate, toISO } from '../engine/dates'

const clampPct = (n: number) => Math.max(0, Math.min(100, n))
const sumVals = (recs: { values: Record<string, string> }[] | undefined, key: string) =>
  (recs ?? []).reduce((s, r) => s + (Number(r.values[key]) || 0), 0)
const countWhere = (recs: { values: Record<string, string> }[] | undefined, key: string, vals: string[]) =>
  (recs ?? []).filter((r) => vals.includes(r.values[key])).length

export function ReportModule() {
  const project = useEditor((s) => s.project)
  const setModule = useShell((s) => s.setModule)

  const r = useMemo(() => {
    const today = dateToDay(project.startDate, new Date())
    const catById = new Map(project.categories.map((c) => [c.id, c]))
    const vis = project.tasks.filter((t) => {
      const c = catById.get(t.categoryId)
      return c && (project.commissioningEnabled || !c.isCommissioning) && !t.hidden && !c.hidden
    })
    const acts = vis.filter((t) => !t.isMilestone)
    const ms = vis.filter((t) => t.isMilestone)
    const starts = vis.map((t) => t.es ?? t.start)
    const ends = vis.map((t) => t.ef ?? t.start + t.duration)
    const startDay = starts.length ? Math.min(...starts) : 0
    const endDay = ends.length ? Math.max(...ends) : 0
    const months = Math.round(((endDay - startDay) / 30.44) * 10) / 10
    const elapsedPct = endDay > startDay ? Math.round(clampPct(((today - startDay) / (endDay - startDay)) * 100)) : 0
    const upcoming = ms.filter((m) => m.start >= today).sort((p, q) => p.start - q.start).slice(0, 3)

    const totDur = acts.reduce((s, t) => s + Math.max(1, t.duration), 0) || 1
    const actualAll = acts.reduce((s, t) => s + clampPct(t.progress ?? 0) * Math.max(1, t.duration), 0) / totDur
    const plannedAll = acts.reduce((s, t) => {
      const st = t.es ?? t.start
      return s + clampPct(((today - st) / Math.max(1, t.duration)) * 100) * Math.max(1, t.duration)
    }, 0) / totDur
    const behind = acts.filter((t) => {
      const st = t.es ?? t.start
      const planned = clampPct(((today - st) / Math.max(1, t.duration)) * 100)
      return clampPct(t.progress ?? 0) - planned <= -10
    }).length

    const mod = (id: ModuleId) => project.modules?.[id]
    const budget = sumVals(mod('cost'), 'budget'), spent = sumVals(mod('cost'), 'spent')
    const highlights = [
      { id: 'cost' as ModuleId, icon: '💰', label: '원가·예산',
        stat: `집행 ${spent.toLocaleString()} / 예산 ${budget.toLocaleString()} 천원`,
        sub: budget > 0 ? `소진율 ${Math.round((spent / budget) * 100)}%` : '예산 미입력', n: (mod('cost') ?? []).length },
      { id: 'progress' as ModuleId, icon: '📈', label: '진척·실적',
        stat: `실적 ${Math.round(actualAll)}% · 계획 ${Math.round(plannedAll)}%`,
        sub: `지연 공정 ${behind}건`, n: acts.length },
      { id: 'resource' as ModuleId, icon: '👷', label: '인력·장비',
        stat: `투입 기록 ${(mod('resource') ?? []).length}건`, sub: '', n: (mod('resource') ?? []).length },
      { id: 'quality' as ModuleId, icon: '✅', label: '품질·검측',
        stat: `부적합(NCR) ${countWhere(mod('quality'), 'type', ['부적합(NCR)'])}건 · 불합격 ${countWhere(mod('quality'), 'status', ['불합격'])}건`,
        sub: '', n: (mod('quality') ?? []).length },
      { id: 'safety' as ModuleId, icon: '🦺', label: '안전관리',
        stat: `사고/아차사고 ${countWhere(mod('safety'), 'type', ['사고/아차사고'])}건 · 고위험 ${countWhere(mod('safety'), 'level', ['상'])}건`,
        sub: '', n: (mod('safety') ?? []).length },
      { id: 'document' as ModuleId, icon: '📄', label: '문서·도면',
        stat: `미승인 ${countWhere(mod('document'), 'status', ['작성중', '제출', '반려'])}건`, sub: '', n: (mod('document') ?? []).length },
      { id: 'permit' as ModuleId, icon: '📝', label: '인허가',
        stat: `미승인 ${countWhere(mod('permit'), 'status', ['준비', '신청', '반려'])}건`, sub: '', n: (mod('permit') ?? []).length },
      { id: 'commissioning' as ModuleId, icon: '🏗️', label: '시운전',
        stat: `불합격 ${countWhere(mod('commissioning'), 'result', ['불합격'])}건`, sub: '', n: (mod('commissioning') ?? []).length },
      { id: 'risk' as ModuleId, icon: '⚠️', label: '리스크·이슈',
        stat: `열림 ${countWhere(mod('risk'), 'status', ['열림', '진행'])}건`, sub: '', n: (mod('risk') ?? []).length },
    ].filter((h) => h.n > 0)

    return { months, startDay, endDay, elapsedPct, acts: acts.length, ms: ms.length, critical: vis.filter((t) => t.critical).length, upcoming, actualAll, plannedAll, behind, highlights, today }
  }, [project])

  return (
    <div className="rec rep">
      <header className="rec__head rep__head">
        <div className="rec__title">
          <span className="rec__icon">📊</span>
          <div>
            <h1 className="rec__h1">보고서</h1>
            <p className="rec__blurb">{project.name || '제목 없음'} · 기준일 {toISO(new Date())}</p>
          </div>
        </div>
        <div className="rec__actions">
          <button className="btn" onClick={() => setModule('dashboard')}>← 대시보드</button>
          <button className="btn btn--primary" onClick={() => window.print()}>🖨 인쇄</button>
        </div>
      </header>

      <section className="rep__sec">
        <h2 className="rep__h2">1. 공정 요약</h2>
        <div className="rep__grid">
          <Stat label="총 공기" value={`${r.months} 개월`} sub={`${r.endDay - r.startDay}일`} />
          <Stat label="시간 경과" value={`${r.elapsedPct}%`} sub="오늘 기준(일정상)" />
          <Stat label="전체 실적" value={`${Math.round(r.actualAll)}%`} sub={`계획 ${Math.round(r.plannedAll)}%`} />
          <Stat label="공정 / 마일스톤" value={`${r.acts} / ${r.ms}`} sub={`주공정 ${r.critical}`} />
          <Stat label="지연 공정" value={`${r.behind}`} sub="계획比 10%p↓" />
        </div>
        {r.upcoming.length > 0 && (
          <ul className="rep__ms">
            {r.upcoming.map((m) => (
              <li key={m.id}>
                <span className="rep__ms-d">{toISO(dayToDate(project.startDate, m.start)).slice(2)}</span>
                <span className="rep__ms-n">{m.name.replace(/^◆\s*/, '')}</span>
                <span className="rep__ms-dd">{m.start - r.today >= 0 ? `D-${m.start - r.today}` : `D+${r.today - m.start}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rep__sec">
        <h2 className="rep__h2">2. 모듈별 현황</h2>
        {r.highlights.length === 0 ? (
          <p className="rec__note" style={{ margin: 0 }}>아직 입력된 모듈 기록이 없습니다. 각 모듈에서 항목을 추가하면 여기에 요약됩니다.</p>
        ) : (
          <div className="rep__mods">
            {r.highlights.map((h) => (
              <button key={h.id} className="rep__mod" onClick={() => setModule(h.id)}>
                <span className="rep__mod-ic">{h.icon}</span>
                <span className="rep__mod-body">
                  <span className="rep__mod-l">{h.label} <span className="rec__count">{h.n}건</span></span>
                  <span className="rep__mod-s">{h.stat}{h.sub && ` · ${h.sub}`}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <p className="rec__note">집계는 입력된 데이터로 실시간 산출됩니다. 주간·월간 템플릿/배포 이력은 순차 고도화됩니다.</p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dcard">
      <div className="dcard__label">{label}</div>
      <div className="dcard__value"><strong>{value}</strong></div>
      {sub && <div className="dcard__sub">{sub}</div>}
    </div>
  )
}
