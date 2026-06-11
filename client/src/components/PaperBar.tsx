// Live "sheet" bar under the chart: paper size / orientation / text size and a
// one-click "fill the sheet (no margin)". Changing the spec re-fits immediately,
// so you edit while seeing exactly how the milestone lands on the chosen sheet.

import { useMemo } from 'react'
import { useEditor } from '../state/store'
import { computeLayout } from '../engine/layout'
import { paperMm, PAPER_SIZES } from '../engine/paper'
import type { Orientation, PaperSize } from '../types/model'

export function PaperBar() {
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  const paper = project.paper
  const fontScale = project.view.fontScale ?? 1

  // How far the drawing aspect is from the sheet — i.e. the export margin.
  const offPct = useMemo(() => {
    const m = computeLayout(project)
    const { w, h } = paperMm(paper.size, paper.orientation)
    const contentAspect = m.contentWidth / m.contentHeight
    const paperAspect = w / h
    return Math.round((Math.abs(contentAspect - paperAspect) / paperAspect) * 100)
  }, [project, paper.size, paper.orientation])

  // Changing the sheet auto-fits so the chart conforms live (aspect + text size).
  // beginGesture() first so the whole paper+view rewrite is one undoable step
  // (the view layer is otherwise history:false; this gives Ctrl+Z a way back).
  function setSize(size: PaperSize) { a().beginGesture(); a().setPaper({ size }); a().fitToPaper() }
  function setOrient(orientation: Orientation) { a().beginGesture(); a().setPaper({ orientation }); a().fitToPaper() }

  return (
    <div className="paperbar">
      <span className="paperbar__label">용지</span>
      <select className="select paperbar__select" value={paper.size} onChange={(e) => setSize(e.target.value as PaperSize)} aria-label="용지 규격">
        {PAPER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="seg seg--sm">
        <button className={paper.orientation === 'landscape' ? 'active' : ''} onClick={() => setOrient('landscape')}>가로</button>
        <button className={paper.orientation === 'portrait' ? 'active' : ''} onClick={() => setOrient('portrait')}>세로</button>
      </div>

      <span className="paperbar__sep" />

      <span className="paperbar__label">글자 크기</span>
      <input
        className="paperbar__range"
        type="range" min={50} max={600} step={10}
        value={Math.round(fontScale * 100)}
        onChange={(e) => a().setView({ fontScale: Number(e.target.value) / 100 })}
        aria-label="글자 크기 배율"
      />
      <span className="paperbar__pct">{Math.round(fontScale * 100)}%</span>

      <span className="paperbar__spacer" />

      {offPct <= 1 ? (
        <span className="paperbar__ok" title="도면이 용지 비율에 맞아 여백 없이 출력됩니다">✓ 여백 없음</span>
      ) : (
        <>
          <span className="paperbar__warn">여백 약 {offPct}%</span>
          <button className="btn btn--sm" title="도면 비율을 용지에 맞춰 여백 없이 채우고 글자 크기를 조정" onClick={() => a().fitToPaper()}>
            ⤢ 여백 없이 맞춤
          </button>
        </>
      )}
    </div>
  )
}
