// Scaffold view for modules not built yet — communicates what the category will
// hold so the package framework is legible/navigable now. See PACKAGE_PLAN.md.
import { MODULE_MAP, type ModuleId } from '../data/modules'
import { useShell } from '../state/shell'

export function ModulePlaceholder({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const setModule = useShell((s) => s.setModule)

  return (
    <div className="mph">
      <div className="mph__box">
        <div className="mph__icon">{m.icon}</div>
        <h1 className="mph__title">
          {m.label} <span className="mph__soon">준비 중</span>
        </h1>
        <p className="mph__blurb">{m.blurb}</p>
        {m.plan.length > 0 && (
          <>
            <div className="mph__plabel">들어갈 내용</div>
            <ul className="mph__plan">
              {m.plan.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
        <div className="mph__actions">
          <button className="btn" onClick={() => setModule('dashboard')}>
            ← 대시보드
          </button>
          <button className="btn btn--primary" onClick={() => setModule('schedule')}>
            📅 공정표로
          </button>
        </div>
        <p className="mph__note">
          이 모듈은 패키지 큰 틀의 자리표시입니다. 공정(마일스톤)과 연계해 순차 구현됩니다.
        </p>
      </div>
    </div>
  )
}
