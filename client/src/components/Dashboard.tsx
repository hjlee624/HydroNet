// 사업 대시보드 — cross-module 연계 허브. 모든 KPI는 단일 순수 셀렉터 projectKpis()에서
// 파생(Report·Progress와 동일 산식 → 발산 없음). EVM(SPI/CPI/EAC)으로 공정·진척·원가를
// 한 줄로 묶고, 모듈 경보·예산vs실적 미니바·기준선 표류를 함께 보여 항목 간 연계를 노출한다.
// zustand v5 함정: project 1개만 구독하고 KPI는 useMemo로 파생(셀렉터에서 새 객체 반환 금지).
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { MODULES } from '../data/modules'
import type { ModuleId } from '../data/modules'
import { KIND_META } from '../data/templates'
import { ProjectTypeChooser } from './ProjectTypeChooser'
import { projectKpis, BEHIND_THRESHOLD } from '../engine/kpis'
import { dayToDate, toISO } from '../engine/dates'

const f = (n: number) => Math.round(n).toLocaleString() // 천원/원 표시
const pct = (n: number) => Math.round(n)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}`
const GOOD = 'var(--primary-deep)'
const BAD = 'var(--danger,#c0392b)'

export function Dashboard() {
  const project = useEditor((s) => s.project)
  const setProjectMeta = useEditor((s) => s.setProjectMeta)
  const captureBaseline = useEditor((s) => s.captureBaseline)
  const clearBaseline = useEditor((s) => s.clearBaseline)
  const setModule = useShell((s) => s.setModule)
  const meta = KIND_META[project.kind ?? 'construction']
  // First-ever load → open the 새 사업 chooser as the entry screen.
  const [chooserOpen, setChooserOpen] = useState(() => {
    try { return localStorage.getItem('hydronet:typeChosen') !== '1' } catch { return false }
  })

  const k = useMemo(() => projectKpis(project), [project])
  const { schedule: sc, progress: pr, cost, boq, coverage, evm, alerts, baseline } = k
  const behindCrit = pr.rows.filter((r) => r.critical && r.deltaPct <= BEHIND_THRESHOLD).length

  const card = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div className="dcard">
      <div className="dcard__label">{label}</div>
      <div className="dcard__value">{value}</div>
      {sub != null && <div className="dcard__sub">{sub}</div>}
    </div>
  )

  // 모듈 바로가기 인라인 핵심수치(기록 있을 때만).
  const alertByModule = new Map(alerts.map((a) => [a.module, a]))
  const moduleMetric = (id: ModuleId): string | null => {
    if (id === 'cost') return cost.hasCost ? `소진율 ${cost.burnPct}%` : null
    if (id === 'boq') return boq.hasBoq ? `공사비 ${f(boq.total)}원` : null
    if (id === 'progress') return pr.activityCount ? `실적 ${pct(pr.actualPct)}%` : null
    const a = alertByModule.get(id)
    if (a) return a.text
    const n = project.modules?.[id]?.length ?? 0
    return n > 0 ? `${n}건` : null
  }

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <div className="dash__eyebrow">사업 대시보드 · <span className="dash__kind">{meta.icon} {meta.label}</span></div>
          <input
            className="dash__title dash__title--edit"
            value={project.name}
            onChange={(e) => setProjectMeta({ name: e.target.value })}
            placeholder="제목 없음"
            aria-label="사업명"
            spellCheck={false}
            maxLength={80}
          />
        </div>
        <div className="dash__actions">
          <button className="btn" onClick={() => captureBaseline()} title="현재 일정을 기준선으로 박제해 이후 표류를 측정">⎯ 기준선 저장</button>
          <button className="btn" onClick={() => setChooserOpen(true)}>＋ 새 사업</button>
          <button className="btn btn--primary" onClick={() => setModule('schedule')}>📅 {meta.scheduleLabel} 열기</button>
        </div>
      </header>

      {/* ZONE 1 · EVM 헤드라인 — 공정(PV)·진척(EV)·원가(AC)를 한 줄로 연계 */}
      <section className="dash__hero">
        <div className="dcard dcard--hero" onClick={() => setModule('progress')} role="button" tabIndex={0}>
          <div className="dcard__label">일정성과 SPI <span className="dcard__hint">EV%/PV%</span></div>
          <div className="dcard__value">
            <strong style={{ color: evm.scheduleAvailable ? (evm.spi >= 1 ? GOOD : BAD) : 'var(--stone)' }}>
              {evm.scheduleAvailable ? evm.spi.toFixed(2) : '—'}
            </strong>
          </div>
          <div className="dcard__sub">계획 {pct(pr.plannedPct)}% 대비 편차 {signed(pr.deltaPct)}%p</div>
        </div>

        <div className="dcard dcard--hero" onClick={() => setModule('cost')} role="button" tabIndex={0}>
          <div className="dcard__label">원가성과 CPI <span className="dcard__hint">EV/AC</span></div>
          {evm.costAvailable ? (
            <>
              <div className="dcard__value"><strong style={{ color: evm.cpi >= 1 ? GOOD : BAD }}>{evm.cpi.toFixed(2)}</strong></div>
              <div className="dcard__sub">소진율 {cost.burnPct}% · CV {signed(evm.cv)}천원</div>
            </>
          ) : (
            <>
              <div className="dcard__value"><strong style={{ color: 'var(--stone)' }}>—</strong></div>
              <div className="dcard__sub">프로젝트 예산 미입력 · 클릭해 입력</div>
            </>
          )}
        </div>

        <div className="dcard dcard--hero" onClick={() => setModule('progress')} role="button" tabIndex={0}>
          <div className="dcard__label">전체 실적 <span className="dcard__hint">기간 가중</span></div>
          <div className="dcard__value"><strong>{pct(pr.actualPct)}</strong>%</div>
          <div className="prog__bar"><span style={{ width: `${pr.actualPct}%` }} /></div>
          <div className="dcard__sub">계획 {pct(pr.plannedPct)}% 대비 편차 {signed(pr.deltaPct)}%p · 지연 {pr.behindCount}건</div>
        </div>
      </section>

      {/* ZONE 2 · KPI 스트립 */}
      <section className="dash__cards">
        {card('총 공기', <><strong>{sc.months}</strong> 개월</>, `${sc.durationDays}일`)}
        {card('착수 → 준공(예정)', <>{toISO(dayToDate(project.startDate, sc.startDay))} <span style={{ color: 'var(--stone)' }}>→</span> {toISO(dayToDate(project.startDate, sc.endDay))}</>)}
        {card('시간 경과', <><strong>{sc.elapsedPct}</strong>%</>, '오늘 기준(일정상)')}
        {card('공정 / 마일스톤', <><strong>{sc.activities}</strong> / {sc.milestoneCount}</>, `연결 ${sc.linkCount}`)}
        {card('주공정(CP)', <strong style={{ color: GOOD }}>{sc.criticalCount}</strong>, behindCrit > 0 ? <span style={{ color: BAD }}>지연 CP {behindCrit}건</span> : '임계경로 공정')}
        {card('우기 구간', <strong>{sc.rainyCount}</strong>, '연도별 반복')}
        {baseline && card('기준선 대비(일정)', <strong style={{ color: baseline.finishDriftDays > 0 ? BAD : GOOD }}>{signed(baseline.finishDriftDays)}일</strong>, `착수 ${signed(baseline.startDriftDays)}일 · 이동 ${baseline.slippedCount}/${baseline.trackedCount} · ${baseline.asOf} 기준`)}
      </section>

      <div className="dash__cols">
        {/* ZONE 3a · 모듈 경보 */}
        <section className="dash__panel">
          <h2 className="dash__ph">모듈 경보</h2>
          {alerts.length ? (
            <ul className="dash__alerts">
              {alerts.map((a) => (
                <li key={a.module} className={`dash__alert dash__alert--${a.severity}`} onClick={() => setModule(a.module)} role="button" tabIndex={0}>
                  <span className="dash__alert-ic">{a.icon}</span>
                  <span className="dash__alert-l">{a.label}</span>
                  <span className="dash__alert-t">{a.text}</span>
                  <span className="dash__alert-n">{a.count}</span>
                </li>
              ))}
            </ul>
          ) : <p className="dash__empty">경보 없음 · 양호. 각 모듈에 기록을 입력하면 여기에 집계됩니다.</p>}
        </section>

        {/* ZONE 3b · 예산 vs 실적 (PV/EV/AC 미니바) */}
        <section className="dash__panel">
          <h2 className="dash__ph">예산 vs 실적 (EVM)</h2>
          <div className="dash__evm">
            <EvmBar label="계획 (PV)" value={pr.plannedPct} tone="plan" />
            <EvmBar label="실적 (EV)" value={pr.actualPct} tone="earn" />
            <EvmBar label="집행 (AC)" value={cost.hasCost ? cost.burnPct : 0} tone="cost" muted={!cost.hasCost} />
          </div>
          <p className="dash__evm-cap">
            {cost.hasCost
              ? <>BAC {f(cost.budget)}천원 · 집행 {f(cost.spent)}천원 · SV {signed(evm.sv)}천원{evm.cpi > 0 ? <> · 예상완료(EAC) {f(evm.eac)}천원</> : null}</>
              : <>프로젝트 예산 미입력 — <button className="dash__link" onClick={() => setModule('cost')}>예산 입력</button></>}
            {boq.hasBoq && <> · 공사비(BOQ) {f(boq.total)}원{coverage.available ? ` (${coverage.baseLabel}의 ${coverage.pct}%)` : ''}</>}
          </p>
        </section>
      </div>

      <div className="dash__cols">
        {/* ZONE 4a · 다가오는 마일스톤 */}
        <section className="dash__panel">
          <h2 className="dash__ph">다가오는 마일스톤</h2>
          {sc.upcoming.length ? (
            <ul className="dash__ms">
              {sc.upcoming.map((m) => (
                <li key={m.id} onClick={() => setModule('schedule')}>
                  <span className="dash__ms-d">{toISO(dayToDate(project.startDate, m.startDay)).slice(2)}</span>
                  <span className="dash__ms-n">{m.name.replace(/^◆\s*/, '')}{m.critical && <span className="dash__cp">CP</span>}</span>
                  <span className="dash__ms-dd" style={m.dMinus <= 7 ? { color: BAD } : undefined}>{m.dMinus >= 0 ? `D-${m.dMinus}` : `D+${-m.dMinus}`}</span>
                </li>
              ))}
            </ul>
          ) : <p className="dash__empty">앞으로 예정된 마일스톤이 없습니다.</p>}
        </section>

        {/* ZONE 4b · 모듈 바로가기 (인라인 핵심수치) */}
        <section className="dash__panel">
          <h2 className="dash__ph">모듈 바로가기</h2>
          <div className="dash__mods">
            {MODULES.filter((m) => m.id !== 'dashboard').map((m) => {
              const metric = moduleMetric(m.id)
              return (
                <button key={m.id} className="dash__mod" onClick={() => setModule(m.id)}>
                  <span className="dash__mod-ic">{m.icon}</span>
                  <span className="dash__mod-t">
                    <span className="dash__mod-l">{m.label}{!metric && m.status === 'soon' && <span className="dash__mod-s">예정</span>}</span>
                    <span className="dash__mod-b">{metric ? <span className="dash__mod-m">{metric}</span> : m.blurb}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {baseline && (
        <p className="dash__note">
          기준선: {baseline.asOf} 박제 · 추적 {baseline.trackedCount}개 공정. SPI/SV는 현재 ‘계획선(일정상 경과)’ 기준이며,
          기준선 대비 표류는 위 ‘기준선 대비(일정)’ 카드로 확인하세요. <button className="dash__link" onClick={() => clearBaseline()}>기준선 해제</button>
        </p>
      )}
      {chooserOpen && <ProjectTypeChooser onClose={() => setChooserOpen(false)} />}
    </div>
  )
}

function EvmBar({ label, value, tone, muted }: { label: string; value: number; tone: 'plan' | 'earn' | 'cost'; muted?: boolean }) {
  return (
    <div className={`dash__evm-row${muted ? ' dash__evm-row--muted' : ''}`}>
      <span className="dash__evm-l">{label}</span>
      <span className="dash__evm-track"><span className={`dash__evm-fill dash__evm-fill--${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
      <span className="dash__evm-v">{Math.round(value)}%</span>
    </div>
  )
}
