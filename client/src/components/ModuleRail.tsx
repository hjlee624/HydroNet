// 모듈 레일 — 좌측 세로 네비게이션. GROUPS 순서로 건설사업관리 모듈을 나열하고
// 활성 모듈을 하이라이트한다. 전환은 useView(뷰 스토어) — 프로젝트 데이터와 분리.
import { GROUPS, MODULES } from '../data/modules'
import { useView } from '../state/viewStore'

export function ModuleRail() {
  const view = useView((s) => s.view)
  const setView = useView((s) => s.setView)
  return (
    <nav className="mrail" data-export-hide="1" aria-label="모듈">
      {GROUPS.map((group) => {
        const mods = MODULES.filter((m) => m.group === group)
        if (!mods.length) return null
        return (
          <div className="mrail__group" key={group}>
            <div className="mrail__glabel">{group}</div>
            {mods.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mrail__item${view === m.id ? ' is-active' : ''}`}
                title={m.blurb}
                aria-current={view === m.id ? 'page' : undefined}
                onClick={() => setView(m.id)}
              >
                <span className="mrail__ic" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="mrail__label">{m.label}</span>
              </button>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
