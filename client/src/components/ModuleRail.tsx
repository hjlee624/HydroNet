// 모듈 레일 — 좌측 세로 네비게이션. GROUPS 순서로 건설사업관리 모듈을 나열하고
// 활성 모듈을 하이라이트한다. 전환은 useView(뷰 스토어) — 프로젝트 데이터와 분리.
import { useEffect, useState } from 'react'
import { GROUPS, MODULES, type ModuleId } from '../data/modules'
import { useViewport } from '../state/viewport'
import { useView } from '../state/viewStore'

// 휴대전화 1차 범위(F17): 조회(총괄)·검토(공정표 열람·AI 검토)·진척 입력만 노출한다.
// 편집 중심 모듈은 좁은 터치 화면에서 오조작이 잦아 이번 범위에서 제외한다.
const MOBILE_MODULES: ModuleId[] = ['dashboard', 'schedule', 'progress']

// 접힘 상태는 기기별 취향이라 프로젝트가 아니라 localStorage 에 둔다(협업으로 퍼지면 안 됨).
const FOLD_KEY = 'sequence:rail-collapsed'
const initialCollapsed = () => {
  try {
    return localStorage.getItem(FOLD_KEY) === '1'
  } catch {
    return false // 프라이빗 모드 등 — 기본은 펼침
  }
}

export function ModuleRail() {
  const view = useView((s) => s.view)
  const setView = useView((s) => s.setView)
  const mobile = useViewport((s) => s.mobile)
  // 접으면 아이콘만 남는다(1100px 미만에서 이미 쓰던 모양). 레일을 통째로 감추지 않는 건
  // 모듈 전환이 여기서만 되기 때문 — 접어도 한 번 클릭으로 이동할 수 있어야 한다.
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  useEffect(() => {
    try {
      localStorage.setItem(FOLD_KEY, collapsed ? '1' : '0')
    } catch {
      /* 비영속 세션 — 무시 */
    }
  }, [collapsed])
  return (
    <nav
      className={`mrail${collapsed ? ' mrail--collapsed' : ''}`}
      data-export-hide="1"
      aria-label="모듈"
    >
      <div className="mrail__brand">
        <span className="mrail__brand-mark"><em>Seq</em>uence</span>
        <span className="mrail__brand-sub">건설 공정표</span>
      </div>
      <button
        type="button"
        className="mrail__fold"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
        aria-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
        aria-expanded={!collapsed}
      >
        <span className="mrail__fold-ic" aria-hidden="true">
          {collapsed ? '»' : '«'}
        </span>
        <span className="mrail__label">접기</span>
      </button>
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
                aria-label={m.label}
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
        <p className="mrail__note" title="휴대전화에서는 조회·검토·진척 입력만 제공합니다. 편집은 PC에서 하세요.">
          조회<br />검토<br />진척
        </p>
      )}
    </nav>
  )
}
