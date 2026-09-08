// 모듈 레일 — 좌측 세로 네비게이션. GROUPS 순서로 건설사업관리 모듈을 나열하고
// 활성 모듈을 하이라이트한다. 전환은 useView(뷰 스토어) — 프로젝트 데이터와 분리.
import { GROUPS, MODULES, type ModuleId } from '../data/modules'
import { useViewport } from '../state/viewport'
import { useView } from '../state/viewStore'

// 휴대전화 1차 범위(F17): 조회(총괄)·검토(공정표 열람·AI 검토)·진척 입력만 노출한다.
// 편집 중심 모듈은 좁은 터치 화면에서 오조작이 잦아 이번 범위에서 제외한다.
const MOBILE_MODULES: ModuleId[] = ['dashboard', 'schedule', 'progress']

export function ModuleRail() {
  const view = useView((s) => s.view)
  const setView = useView((s) => s.setView)
  const mobile = useViewport((s) => s.mobile)
  return (
    <nav className="mrail" data-export-hide="1" aria-label="모듈">
      {GROUPS.map((group) => {
        const mods = MODULES.filter(
          (m) => m.group === group && (!mobile || MOBILE_MODULES.includes(m.id)),
        )
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
      {mobile && (
        <p className="mrail__note">
          휴대전화에서는 조회·검토·진척 입력만 제공합니다. 편집은 PC에서 하세요.
        </p>
      )}
    </nav>
  )
}
