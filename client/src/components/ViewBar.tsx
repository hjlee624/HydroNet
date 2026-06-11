// Slim view-control bar above the chart: subset filters (declutter a busy chart),
// bar colour scheme, and the simple/pro (progressive-disclosure) mode toggle.

import { useEditor, filterActive } from '../state/store'

export function ViewBar() {
  const filter = useEditor((s) => s.filter)
  const colorMode = useEditor((s) => s.colorMode)
  const uiMode = useEditor((s) => s.uiMode)
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

      <span className="viewbar__label">보기</span>
      <div className="seg seg--sm" title="간단: 자주 쓰는 기능만 / 전문가: 모든 기능">
        <button className={uiMode === 'simple' ? 'active' : ''} onClick={() => a().setUiMode('simple')}>간단</button>
        <button className={uiMode === 'pro' ? 'active' : ''} onClick={() => a().setUiMode('pro')}>전문가</button>
      </div>
    </div>
  )
}
