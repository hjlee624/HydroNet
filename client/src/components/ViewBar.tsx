// Slim view-control bar above the chart: subset filters (declutter a busy chart),
// bar colour scheme, and a canvas-tool shortcut hint (Ctrl+휠 확대·축소 / H 화면 이동).
// 힌트 문구는 state/keymap.ts 의 hint 항목에서 생성한다 — 도움말·실제 동작과 항상 일치.

import { ALL_SHORTCUTS } from '../state/keymap'
import { filterActive, useEditor } from '../state/store'

const HINTS = ALL_SHORTCUTS.filter((d) => d.hint)
const HINT_TITLE = ALL_SHORTCUTS.map((d) => `${d.keys.join('+')}: ${d.label}`).join(' / ')

/** 좌·우 패널 접기 토글. 넓은 화면에서만 넘어온다 — 좁은 화면은 서랍(drawerbar)이 같은 일을
 *  이미 하므로 ScheduleModule 이 undefined 를 넘겨 이 묶음을 통째로 뺀다. */
export interface PanelToggles {
  left: boolean
  right: boolean
  toggleLeft: () => void
  toggleRight: () => void
}

export function ViewBar({ panels }: { panels?: PanelToggles } = {}) {
  const filter = useEditor((s) => s.filter)
  const colorMode = useEditor((s) => s.colorMode)
  const a = useEditor.getState
  const active = filterActive(filter)

  return (
    <div className="viewbar">
      <span className="viewbar__label">필터</span>
      <button
        className={`chip ${filter.critical ? 'on' : ''}`}
        title="주공정(Critical Path)만 표시"
        onClick={() => a().setFilter({ critical: !filter.critical })}
      >
        주공정만
      </button>
      <button
        className={`chip ${filter.milestone ? 'on' : ''}`}
        title="마일스톤(◆)만 표시"
        onClick={() => a().setFilter({ milestone: !filter.milestone })}
      >
        마일스톤만
      </button>
      <input
        className="viewbar__search"
        placeholder="이름 검색…"
        value={filter.query}
        onChange={(e) => a().setFilter({ query: e.target.value })}
        aria-label="이름으로 필터"
      />
      {active && (
        <button className="btn btn--sm btn--ghost" onClick={() => a().clearFilter()}>
          필터 해제
        </button>
      )}

      <span className="viewbar__spacer" />

      {/* 패널 접기 — 화면이 정보로 빽빽할 때 좌·우를 접어 도면에 폭을 넘긴다.
          켜짐(주황) = 패널 보임. 좁은 화면 서랍 칩과 같은 표기·같은 의미. */}
      {panels && (
        <>
          <span className="viewbar__label">패널</span>
          <button
            type="button"
            className={`chip ${panels.left ? 'on' : ''}`}
            title="왼쪽 공종 구성 패널 접기/펼치기"
            aria-pressed={panels.left}
            onClick={panels.toggleLeft}
          >
            ☰ 공종 구성
          </button>
          <button
            type="button"
            className={`chip ${panels.right ? 'on' : ''}`}
            title="오른쪽 속성 패널(도면·프로젝트 / 텍스트 / 공정 속성 / 연결 속성) 접기/펼치기"
            aria-pressed={panels.right}
            onClick={panels.toggleRight}
          >
            ⚙ 속성
          </button>
          <span className="viewbar__sep" />
        </>
      )}

      <span className="viewbar__label">색상</span>
      <div className="seg seg--sm">
        <button
          className={colorMode === 'category' ? 'active' : ''}
          onClick={() => a().setColorMode('category')}
        >
          공정색
        </button>
        <button
          className={colorMode === 'critical' ? 'active' : ''}
          onClick={() => a().setColorMode('critical')}
        >
          주공정 강조
        </button>
      </div>

      {/* 단축키 힌트는 키보드가 있는 화면에서만 뜻이 있다 — 좁은 화면(F17)에서는
          data-narrow-hide 로 통째로 감춰 도면 폭을 남긴다(넓은 화면은 그대로). */}
      <span className="viewbar__hintwrap" data-narrow-hide="1">
        <span className="viewbar__sep" />
        <span className="viewbar__label">단축키</span>
        <span className="viewbar__hint" title={HINT_TITLE}>
          {HINTS.map((d, i) => (
            <span key={d.label}>
              {i > 0 && <span className="viewbar__hint-sep">·</span>}
              {d.keys.map((key, ki) => (
                <span key={key}>
                  {ki > 0 && '+'}
                  <kbd className="viewbar__kbd">{key}</kbd>
                </span>
              ))}{' '}
              {d.short ?? d.label}
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}
