// Slim view-control bar above the chart: subset filters (declutter a busy chart),
// bar colour scheme, and a canvas-tool shortcut hint (Z 줌 / H 화면 이동).

import { useEditor, filterActive } from '../state/store'

export function ViewBar() {
  const filter = useEditor((s) => s.filter)
  const colorMode = useEditor((s) => s.colorMode)
  const a = useEditor.getState
  const active = filterActive(filter)

  return (
    <div className="viewbar">
      <span className="viewbar__label">필터</span>
      <button className={`chip ${filter.critical ? 'on' : ''}`} title="주공정(Critical Path)만 표시"
        onClick={() => a().setFilter({ critical: !filter.critical })}>주공정만</button>
      <button className={`chip ${filter.milestone ? 'on' : ''}`} title="마일스톤(◆)만 표시"
        onClick={() => a().setFilter({ milestone: !filter.milestone })}>마일스톤만</button>
      <input className="viewbar__search" placeholder="이름 검색…" value={filter.query}
        onChange={(e) => a().setFilter({ query: e.target.value })} aria-label="이름으로 필터" />
      {active && <button className="btn btn--sm btn--ghost" onClick={() => a().clearFilter()}>필터 해제</button>}

      <span className="viewbar__spacer" />

      <span className="viewbar__label">색상</span>
      <div className="seg seg--sm">
        <button className={colorMode === 'category' ? 'active' : ''} onClick={() => a().setColorMode('category')}>공종색</button>
        <button className={colorMode === 'critical' ? 'active' : ''} onClick={() => a().setColorMode('critical')}>주공정 강조</button>
      </div>

      <span className="viewbar__sep" />

      {/* Canvas-tool shortcut hint (replaces the old 간단/전문가 toggle). */}
      <span className="viewbar__label">단축키</span>
      <span className="viewbar__hint" title="Z: 휠로 확대·축소 / H: 드래그로 화면 이동 / V·Esc: 편집 복귀">
        <kbd className="viewbar__kbd">Z</kbd> 확대·축소
        <span className="viewbar__hint-sep">·</span>
        <kbd className="viewbar__kbd">H</kbd> 화면 이동
      </span>
    </div>
  )
}
