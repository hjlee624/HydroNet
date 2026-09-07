// 프로젝트 총괄 대시보드 — 현재 열린 프로젝트의 현황 허브.
// 모든 KPI는 단일 순수 셀렉터 projectKpis(project)에서 파생(공정표·진척·보고서와 산식 발산 없음).
// 일정(총공기·주공정·마일스톤) + 진척/원가 EVM(공정·진척·원가 연계) + 모듈 경보 + 기준선 표류.
import { type ReactNode, useMemo } from 'react'
import { dayToDate, toISO } from '../engine/dates'
import { projectKpis, type ScheduleStatus, sheetSummaries } from '../engine/projectKpis'
import { useEditor } from '../state/store'
import type { ProjectView } from '../state/viewStore'
import { useView } from '../state/viewStore'

const STATUS_META: Record<ScheduleStatus, { label: string; cls: string }> = {
  'in-progress': { label: '진행 중', cls: 'seq-dash__chip--go' },
  'not-started': { label: '착수 전', cls: 'seq-dash__chip--wait' },
  overdue: { label: '준공 예정일 경과', cls: 'seq-dash__chip--late' },
  empty: { label: '일정 없음', cls: 'seq-dash__chip--none' },
}
const sheetIcon = (role: string) => (role === 'milestone' ? '◆' : '📅')
const sheetRoleLabel = (role: string) => (role === 'milestone' ? '마일스톤' : '예정공정표')
const f = (n: number) => Math.round(n).toLocaleString()
const pct = (n: number) => Math.round(n)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}`
const GOOD = 'var(--primary-deep)'
const BAD = '#c0271a'

export function DashboardModule() {
  const project = useEditor((s) => s.project)
  const captureBaseline = useEditor((s) => s.captureBaseline)
  const clearBaseline = useEditor((s) => s.clearBaseline)
  const readOnly = useEditor((s) => s.readOnly)
  const setView = useView((s) => s.setView)

  const k = useMemo(() => projectKpis(project), [project])
  const sheets = useMemo(() => sheetSummaries(project), [project])
  const sc = k.schedule
  const pr = k.progress
  const { cost, boq, coverage, evm, alerts, baseline } = k
  const status = STATUS_META[sc.status]
  const day = (d: number) => toISO(dayToDate(project.startDate, d))
  const go = (v: ProjectView) => setView(v)

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
            공정 {sc.activities} · 마일스톤 {sc.milestoneCount}
            {sc.imminentMilestones > 0 && (
              <>
                <span className="seq-dash__dot">·</span>
                <span className="seq-dash__warn">임박 마일스톤 {sc.imminentMilestones}</span>
              </>
            )}
          </div>
        </div>
        <div className="seq-dash__headbtns">
          {!readOnly && (
            <button
              type="button"
              className="btn"
              title="현재 일정을 기준선으로 박제해 이후 표류를 측정"
              onClick={() => captureBaseline()}
            >
              ⎯ 기준선 저장
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => go('schedule')}>
            📅 공정표 열기
          </button>
        </div>
      </header>

      {!sc.hasData ? (
        <div className="seq-dash__blank">
          아직 공정이 없습니다.{' '}
          <button type="button" className="seq-dash__link" onClick={() => go('schedule')}>
            공정표에서 공정을 추가
          </button>
          하면 총괄 지표가 여기에 집계됩니다.
        </div>
      ) : (
        <>
          {/* ZONE 1 · 성과지표(EVM) — 공정(PV)·진척(EV)·원가(AC) 연계 */}
          <section className="seq-dash__hero">
            <button type="button" className="seq-dash__herocard" onClick={() => go('progress')}>
              <div className="seq-dash__kpi-label">
                일정성과 SPI <span className="seq-dash__hint">실적%/계획%</span>
              </div>
              <div className="seq-dash__hero-v">
                <strong
                  style={{
                    color: evm.scheduleAvailable ? (evm.spi >= 1 ? GOOD : BAD) : 'var(--stone)',
                  }}
                >
                  {evm.scheduleAvailable ? evm.spi.toFixed(2) : '—'}
                </strong>
              </div>
              <div className="seq-dash__kpi-sub">
                계획 {pct(pr.plannedPct)}% 대비 편차 {signed(pr.deltaPct)}%p
              </div>
            </button>
            <button type="button" className="seq-dash__herocard" onClick={() => go('cost')}>
              <div className="seq-dash__kpi-label">
                원가성과 CPI <span className="seq-dash__hint">EV/AC</span>
              </div>
              <div className="seq-dash__hero-v">
                <strong
                  style={{
                    color: evm.costAvailable ? (evm.cpi >= 1 ? GOOD : BAD) : 'var(--stone)',
                  }}
                >
                  {evm.costAvailable && evm.cpi > 0 ? evm.cpi.toFixed(2) : '—'}
                </strong>
              </div>
              <div className="seq-dash__kpi-sub">
                {cost.hasCost ? (
                  <>
                    소진율 {cost.burnPct}% · CV {signed(evm.cv)}천원
                  </>
                ) : (
                  '프로젝트 예산 미입력 · 클릭해 입력'
                )}
              </div>
            </button>
            <button type="button" className="seq-dash__herocard" onClick={() => go('progress')}>
              <div className="seq-dash__kpi-label">
                전체 실적 <span className="seq-dash__hint">기간 가중</span>
              </div>
              <div className="seq-dash__hero-v">
                <strong>{pct(pr.actualPct)}</strong>%
              </div>
              <span className="seq-dash__bar">
                <span style={{ width: `${pr.actualPct}%` }} />
              </span>
              <div className="seq-dash__kpi-sub">
                계획 {pct(pr.plannedPct)}% · 지연 {pr.behindCount}건
              </div>
            </button>
          </section>

          {/* ZONE 2 · 일정 KPI 스트립 */}
          <section className="seq-dash__kpis">
            {kpi(
              '총 공기',
              <>
                <strong>{sc.months}</strong> 개월
              </>,
              `${sc.durationDays.toLocaleString()}일`,
            )}
            {kpi(
              '착수 → 준공(예정)',
              <span className="seq-dash__dates">
                {day(sc.startDay)} <i>→</i> {day(sc.endDay)}
              </span>,
            )}
            {kpi(
              '시간 경과',
              <>
                <strong>{sc.elapsedPct}</strong>%
              </>,
              <span className="seq-dash__bar">
                <span style={{ width: `${sc.elapsedPct}%` }} />
              </span>,
            )}
            {kpi(
              '공정 / 마일스톤',
              <>
                <strong>{sc.activities}</strong> / {sc.milestoneCount}
              </>,
              `연결 ${sc.linkCount}`,
            )}
            {kpi(
              '주공정 (CP)',
              <strong>{sc.criticalCount}</strong>,
              baseline ? (
                <span style={{ color: baseline.finishDriftDays > 0 ? BAD : GOOD }}>
                  기준선比 {signed(baseline.finishDriftDays)}일
                </span>
              ) : (
                '임계경로 공정'
              ),
            )}
            {kpi('우기 구간', <strong>{sc.rainyCount}</strong>, '연도별 반복')}
          </section>

          <div className="seq-dash__cols">
            {/* ZONE 3a · 모듈 경보 */}
            <section className="seq-dash__panel">
              <h2 className="seq-dash__ph">모듈 경보</h2>
              {alerts.length ? (
                <ul className="seq-dash__alerts">
                  {alerts.map((a) => (
                    <li key={a.module}>
                      <button
                        type="button"
                        className={`seq-dash__alert seq-dash__alert--${a.severity}`}
                        onClick={() => go(a.module as ProjectView)}
                      >
                        <span className="seq-dash__alert-ic">{a.icon}</span>
                        <span className="seq-dash__alert-l">{a.label}</span>
                        <span className="seq-dash__alert-t">{a.text}</span>
                        <span className="seq-dash__alert-n">{a.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="seq-dash__empty">
                  경보 없음 · 양호. 각 모듈에 기록을 입력하면 여기에 집계됩니다.
                </p>
              )}
            </section>

            {/* ZONE 3b · 예산 vs 실적 (EVM) */}
            <section className="seq-dash__panel">
              <h2 className="seq-dash__ph">예산 vs 실적 (EVM)</h2>
              <div className="seq-dash__evm">
                <EvmBar label="계획 (PV)" value={pr.plannedPct} tone="plan" />
                <EvmBar label="실적 (EV)" value={pr.actualPct} tone="earn" />
                <EvmBar
                  label="집행 (AC)"
                  value={cost.hasCost ? cost.burnPct : 0}
                  tone="cost"
                  muted={!cost.hasCost}
                />
              </div>
              <p className="seq-dash__evm-cap">
                {cost.hasCost ? (
                  <>
                    BAC {f(cost.budget)}천원 · 집행 {f(cost.spent)}천원 · SV {signed(evm.sv)}천원
                    {evm.cpi > 0 ? <> · 예상완료(EAC) {f(evm.eac)}천원</> : null}
                  </>
                ) : (
                  <>
                    프로젝트 예산 미입력 —{' '}
                    <button type="button" className="seq-dash__link" onClick={() => go('cost')}>
                      예산 입력
                    </button>
                  </>
                )}
                {boq.hasBoq && (
                  <>
                    {' · '}공사비(BOQ) {f(boq.total)}원
                    {coverage.available ? ` (${coverage.baseLabel}의 ${coverage.pct}%)` : ''}
                  </>
                )}
              </p>
            </section>
          </div>

          <div className="seq-dash__cols">
            {/* ZONE 4a · 다가오는 마일스톤 */}
            <section className="seq-dash__panel">
              <h2 className="seq-dash__ph">
                다가오는 마일스톤
                {sc.imminentMilestones > 0 && (
                  <span className="seq-dash__ph-badge">임박 {sc.imminentMilestones}</span>
                )}
              </h2>
              {sc.upcoming.length ? (
                <ul className="seq-dash__ms">
                  {sc.upcoming.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="seq-dash__ms-row"
                        onClick={() => go('schedule')}
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

            {/* ZONE 4b · 공정표 시트 */}
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

          {baseline ? (
            <p className="seq-dash__note">
              기준선 {baseline.asOf} 박제 · 추적 {baseline.trackedCount}개 공정 · 이동{' '}
              {baseline.slippedCount}개 · 준공 표류 {signed(baseline.finishDriftDays)}일.
              {!readOnly && (
                <>
                  {' '}
                  <button type="button" className="seq-dash__link" onClick={() => clearBaseline()}>
                    기준선 해제
                  </button>
                </>
              )}
            </p>
          ) : (
            <p className="seq-dash__note">
              성과지표(EVM)는 <b>진척·실적</b>과 <b>프로젝트 예산</b> 입력 시 채워집니다. 좌측
              모듈에서 입력하세요.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function EvmBar({
  label,
  value,
  tone,
  muted,
}: {
  label: string
  value: number
  tone: 'plan' | 'earn' | 'cost'
  muted?: boolean
}) {
  return (
    <div className={`seq-dash__evm-row${muted ? ' is-muted' : ''}`}>
      <span className="seq-dash__evm-l">{label}</span>
      <span className="seq-dash__evm-track">
        <span
          className={`seq-dash__evm-fill seq-dash__evm-fill--${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className="seq-dash__evm-v">{Math.round(value)}%</span>
    </div>
  )
}
