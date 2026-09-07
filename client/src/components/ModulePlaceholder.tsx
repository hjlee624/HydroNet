// 준비 중 모듈 안내 — fields/전용 화면이 아직 없는 모듈(현재 진척·보고서는 다음 단계)에
// 예정 내용(plan)을 보여준다.
import { MODULE_MAP, type ModuleId } from '../data/modules'
import { useView } from '../state/viewStore'

export function ModulePlaceholder({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const setView = useView((s) => s.setView)
  return (
    <div className="seq-ph">
      <header className="seq-rec__head">
        <div className="seq-rec__title">
          <span className="seq-rec__icon" aria-hidden="true">
            {m.icon}
          </span>
          <div>
            <h1 className="seq-rec__h1">{m.label}</h1>
            <p className="seq-rec__blurb">{m.blurb}</p>
          </div>
        </div>
        <button type="button" className="btn" onClick={() => setView('dashboard')}>
          ← 총괄
        </button>
      </header>
      <div className="seq-ph__body">
        <div className="seq-ph__badge">준비 중</div>
        {m.plan.length > 0 && (
          <ul className="seq-ph__plan">
            {m.plan.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="seq-ph__note">이 모듈은 다음 단계에서 제공됩니다.</p>
      </div>
    </div>
  )
}
