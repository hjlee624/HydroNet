// 보고서 모듈 — 모든 모듈을 가로질러 핵심 지표를 자동 집계한 보고 초안.
// 일정·진척·원가·공사비·모듈경보를 전부 공유 셀렉터 projectKpis에서 가져온다(대시보드와
// 동일 수치 → 발산 없음). 🖨 인쇄로 PDF 출력.
import { useMemo } from 'react'
import { MODULE_MAP, type ModuleId } from '../data/modules'
import { dayToDate, toISO } from '../engine/dates'
import { projectKpis } from '../engine/projectKpis'
import { useEditor } from '../state/store'
import { type ProjectView, useView } from '../state/viewStore'

const f = (n: number) => Math.round(n).toLocaleString()
const r0 = (n: number) => Math.round(n)

interface ModHighlight {
  id: ModuleId
  icon: string
  label: string
  stat: string
  sub: string
  n: number
}

export function ReportModule() {
  const project = useEditor((s) => s.project)
  const setView = useView((s) => s.setView)

  const k = useMemo(() => projectKpis(project), [project])
  const { schedule: sc, progress: pr, cost, boq, coverage, alerts } = k
  const alertByModule = new Map(alerts.map((a) => [a.module, a]))

  const highlights: ModHighlight[] = []
  if (cost.hasCost)
    highlights.push({
      id: 'cost',
      icon: '💰',
      label: '프로젝트 예산',
      stat: `집행 ${f(cost.spent)} / 예산 ${f(cost.budget)} 천원`,
      sub: cost.budget > 0 ? `소진율 ${cost.burnPct}%` : '예산 미입력',
      n: cost.itemCount,
    })
  if (boq.hasBoq)
    highlights.push({
      id: 'boq',
      icon: '🧮',
      label: '공사 사업비',
      stat: `공사비 합계 ${f(boq.total)} 원`,
      sub: coverage.available
        ? `${coverage.baseLabel}의 ${coverage.pct}%`
        : `내역 ${boq.itemCount}건`,
      n: boq.itemCount,
    })
  if (pr.activityCount)
    highlights.push({
      id: 'progress',
      icon: '📈',
      label: '진척·실적',
      stat: `실적 ${r0(pr.actualPct)}% · 계획 ${r0(pr.plannedPct)}%`,
      sub: `지연 공정 ${pr.behindCount}건`,
      n: pr.activityCount,
    })
  for (const id of [
    'resource',
    'quality',
    'safety',
    'document',
    'permit',
    'commissioning',
    'risk',
  ] as ModuleId[]) {
    const n = project.modules?.[id]?.length ?? 0
    if (n === 0) continue
    const def = MODULE_MAP[id]
    const a = alertByModule.get(id)
    highlights.push({
      id,
      icon: def.icon,
      label: def.label,
      stat: a ? a.text : `기록 ${n}건`,
      sub: '',
      n,
    })
  }

  const upcoming = sc.upcoming.slice(0, 3)

  return (
    <div className="seq-rec seq-rep">
      <header className="seq-rec__head">
        <div className="seq-rec__title">
          <span className="seq-rec__icon" aria-hidden="true">
            📊
          </span>
          <div>
            <h1 className="seq-rec__h1">보고서</h1>
            <p className="seq-rec__blurb">
              {project.name || '제목 없음'} · 기준일 {toISO(new Date())}
            </p>
          </div>
        </div>
        <div className="seq-rec__actions">
          <button type="button" className="btn" onClick={() => setView('dashboard')}>
            ← 총괄
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            🖨 인쇄
          </button>
        </div>
      </header>

      <section className="seq-rep__sec">
        <h2 className="seq-rep__h2">1. 공정 요약</h2>
        <div className="seq-dash__kpis seq-rep__grid">
          <Stat
            label="총 공기"
            value={`${sc.months} 개월`}
            sub={`${sc.durationDays.toLocaleString()}일`}
          />
          <Stat label="시간 경과" value={`${sc.elapsedPct}%`} sub="오늘 기준(일정상)" />
          <Stat
            label="전체 실적"
            value={`${r0(pr.actualPct)}%`}
            sub={`계획 ${r0(pr.plannedPct)}%`}
          />
          <Stat
            label="공정 / 마일스톤"
            value={`${sc.activities} / ${sc.milestoneCount}`}
            sub={`주공정 ${sc.criticalCount}`}
          />
          <Stat label="지연 공정" value={`${pr.behindCount}`} sub="계획比 10%p↓" />
        </div>
        {upcoming.length > 0 && (
          <ul className="seq-rep__ms">
            {upcoming.map((m) => (
              <li key={m.id}>
                <span className="seq-rep__ms-d">
                  {toISO(dayToDate(project.startDate, m.startDay)).slice(2)}
                </span>
                <span className="seq-rep__ms-n">{m.name}</span>
                <span className="seq-rep__ms-dd">
                  {m.dMinus >= 0 ? `D-${m.dMinus}` : `D+${-m.dMinus}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="seq-rep__sec">
        <h2 className="seq-rep__h2">2. 모듈별 현황</h2>
        {highlights.length === 0 ? (
          <p className="seq-rec__foot" style={{ margin: 0 }}>
            아직 입력된 모듈 기록이 없습니다. 각 모듈에서 항목을 추가하면 여기에 요약됩니다.
          </p>
        ) : (
          <div className="seq-rep__mods">
            {highlights.map((h) => (
              <button
                key={h.id}
                type="button"
                className="seq-rep__mod"
                onClick={() => setView(h.id as ProjectView)}
              >
                <span className="seq-rep__mod-ic">{h.icon}</span>
                <span className="seq-rep__mod-body">
                  <span className="seq-rep__mod-l">
                    {h.label} <span className="seq-rec__count">{h.n}건</span>
                  </span>
                  <span className="seq-rep__mod-s">
                    {h.stat}
                    {h.sub && ` · ${h.sub}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <p className="seq-rec__foot">
        집계는 입력된 데이터로 실시간 산출됩니다. 주간·월간 템플릿·배포 이력은 순차 고도화됩니다.
      </p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="seq-dash__kpi">
      <div className="seq-dash__kpi-label">{label}</div>
      <div className="seq-dash__kpi-value">
        <strong>{value}</strong>
      </div>
      {sub && <div className="seq-dash__kpi-sub">{sub}</div>}
    </div>
  )
}
