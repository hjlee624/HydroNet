// Interaction layer over ChartSvg: drag-to-move bars, drag-to-link from the
// finish anchor, click selection, and zoom-aware layout. Pointer math maps
// client coordinates into chart-content space (the paper is rendered 1:1).
//
// Photoshop-style navigation tools (store.navMode): in 'zoom' the mouse wheel
// zooms centred on the cursor; in 'pan' a drag scrolls the view. Editing
// gestures (move/resize/link/select) only run in 'edit'. Esc returns to edit.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import { useEditor, filterActive } from '../state/store'
import { computeLayout } from '../engine/layout'
import { routeLinks } from '../engine/routing'
import { dateToDay, dayToDate, daysInMonth } from '../engine/dates'
import { ChartSvg, type LinkingGhost } from './ChartSvg'

type Drag =
  | { kind: 'move'; taskId: string; grabOffsetDays: number; started: boolean }
  | { kind: 'resize'; taskId: string; edge: 'start' | 'end'; startDay: number; endDay: number; started: boolean }
  | { kind: 'logo'; index: number; rightEdge: number; ratio: number; started: boolean }
  | { kind: 'link'; fromId: string }
  | { kind: 'rainy'; seasonId: string; edge: 'start' | 'end'; started: boolean }
  | null

export function ChartCanvas() {
  const project = useEditor((s) => s.project)
  const zoom = useEditor((s) => s.zoom)
  const navMode = useEditor((s) => s.navMode)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)
  const selectedTextRole = useEditor((s) => s.selectedTextRole)
  const linking = useEditor((s) => s.linking)
  const filter = useEditor((s) => s.filter)
  const colorMode = useEditor((s) => s.colorMode)

  const wrapRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const zoomAnchor = useRef<{ cX: number; cY: number; clientX: number; clientY: number; z: number } | null>(null)
  const renameDone = useRef(false)
  const [ghost, setGhost] = useState<LinkingGhost | null>(null)
  const [panning, setPanning] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  // Layout is computed at base scale; zoom is applied as a uniform CSS
  // transform on the paper so the WHOLE milestone (bars, text, arrows, header)
  // scales together — not just the horizontal axis.
  const model = useMemo(() => computeLayout(project, filter), [project, filter])

  const routed = useMemo(() => routeLinks(model, project.links), [model, project.links])

  // "오늘" line position (content coords), or null when today is off-domain.
  const todayX = useMemo(() => {
    const x = model.xOf(dateToDay(project.startDate, new Date()))
    return x >= model.labelWidth && x <= model.contentWidth ? x : null
  }, [project.startDate, model])

  const editLt = editing ? model.tasks.find((t) => t.task.id === editing.id) : null

  function toContent(clientX: number, clientY: number) {
    const rect = paperRef.current!.getBoundingClientRect()
    // rect reflects the scaled box; divide by zoom to get unscaled model coords.
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  // ── Zoom-to-cursor: after a wheel-driven zoom commits, shift scroll so the
  //    content point that was under the cursor stays under the cursor. ──
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    if (!a) return
    zoomAnchor.current = null
    const wrap = wrapRef.current, paper = paperRef.current
    if (!wrap || !paper) return
    const r = paper.getBoundingClientRect()
    wrap.scrollLeft += (r.left + a.cX * a.z) - a.clientX
    wrap.scrollTop += (r.top + a.cY * a.z) - a.clientY
  }, [zoom])

  // Native (non-passive) wheel listener so we can preventDefault while zooming.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    function onWheel(e: WheelEvent) {
      const st = useEditor.getState()
      if (st.navMode !== 'zoom') return // leave normal scroll alone
      e.preventDefault()
      const paper = paperRef.current
      if (!paper) return
      const z1 = st.zoom
      const r = paper.getBoundingClientRect()
      const cX = (e.clientX - r.left) / z1
      const cY = (e.clientY - r.top) / z1
      const z2 = Math.min(6, Math.max(0.25, z1 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      if (Math.abs(z2 - z1) < 1e-4) return
      zoomAnchor.current = { cX, cY, clientX: e.clientX, clientY: e.clientY, z: z2 }
      st.setZoom(z2)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // ── Hand-tool panning (navMode === 'pan') ──
  function onWrapPointerDown(e: RPointerEvent) {
    if (useEditor.getState().navMode !== 'pan') return
    const wrap = wrapRef.current
    if (!wrap) return
    e.preventDefault()
    panRef.current = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }
    setPanning(true)
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)
  }
  function onPanMove(e: PointerEvent) {
    const p = panRef.current, wrap = wrapRef.current
    if (!p || !wrap) return
    wrap.scrollLeft = p.sl - (e.clientX - p.x)
    wrap.scrollTop = p.st - (e.clientY - p.y)
  }
  function onPanUp() {
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanUp)
    panRef.current = null
    setPanning(false)
  }

  function onTaskPointerDown(e: RPointerEvent, id: string) {
    if (useEditor.getState().navMode !== 'edit') return // let zoom/pan take over
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    const task = project.tasks.find((t) => t.id === id)
    if (!task) return
    store.selectTask(id)
    const { x } = toContent(e.clientX, e.clientY)
    const dayAtPointer = model.dayOf(x)
    // History is captured lazily on the first real move, so a plain click that
    // merely selects a bar does not push an empty undo step.
    dragRef.current = { kind: 'move', taskId: id, grabOffsetDays: dayAtPointer - task.start, started: false }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onBarResizePointerDown(e: RPointerEvent, id: string, edge: 'start' | 'end') {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    const task = project.tasks.find((t) => t.id === id)
    if (!task) return
    store.selectTask(id)
    dragRef.current = {
      kind: 'resize', taskId: id, edge,
      startDay: task.start, endDay: task.start + task.duration, started: false,
    }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onLogoResizePointerDown(e: RPointerEvent, index: number) {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const lg = model.logos.find((l) => l.index === index)
    if (!lg) return
    // Right edge stays anchored; dragging the bottom-left grip scales the box.
    dragRef.current = { kind: 'logo', index, rightEdge: lg.x + lg.w, ratio: lg.h / lg.w, started: false }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onRainyResizePointerDown(e: RPointerEvent, seasonId: string, edge: 'start' | 'end') {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { kind: 'rainy', seasonId, edge, started: false }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onAnchorPointerDown(e: RPointerEvent, id: string) {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    store.startLinking(id)
    dragRef.current = { kind: 'link', fromId: id }
    const { x, y } = toContent(e.clientX, e.clientY)
    setGhostFrom(id, x, y)
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function setGhostFrom(fromId: string, x: number, y: number) {
    const src = model.tasks.find((t) => t.task.id === fromId)
    if (src) setGhost({ x1: src.endX, y1: src.cy, x2: x, y2: y })
  }

  function onWindowMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    // If the user switched to a zoom/pan tool mid-drag (keyboard), abort the
    // edit gesture cleanly instead of continuing to mutate the model.
    if (useEditor.getState().navMode !== 'edit') {
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      dragRef.current = null
      setGhost(null)
      if (drag.kind === 'link') useEditor.getState().cancelLinking()
      return
    }
    const { x, y } = toContent(e.clientX, e.clientY)
    if (drag.kind === 'move') {
      if (!drag.started) { drag.started = true; useEditor.getState().beginGesture() }
      const newStart = model.dayOf(x) - drag.grabOffsetDays
      useEditor.getState().setTaskStartLive(drag.taskId, newStart)
    } else if (drag.kind === 'resize') {
      if (!drag.started) { drag.started = true; useEditor.getState().beginGesture() }
      const day = model.dayOf(x)
      if (drag.edge === 'end') {
        useEditor.getState().setTaskSpanLive(drag.taskId, drag.startDay, day - drag.startDay)
      } else {
        const s = Math.max(0, Math.min(drag.endDay - 1, Math.round(day)))
        useEditor.getState().setTaskSpanLive(drag.taskId, s, drag.endDay - s)
      }
    } else if (drag.kind === 'logo') {
      if (!drag.started) { drag.started = true; useEditor.getState().beginGesture() }
      const newW = Math.max(40, Math.min(900, drag.rightEdge - x))
      useEditor.getState().setLogoSize(drag.index, newW, newW * drag.ratio)
    } else if (drag.kind === 'rainy') {
      if (!drag.started) { drag.started = true; useEditor.getState().beginGesture() }
      const date = dayToDate(project.startDate, Math.round(model.dayOf(x)))
      const m = date.getMonth() + 1
      const d = Math.min(date.getDate(), daysInMonth(2001, m - 1)) // non-leap day model
      // setRainySeason keeps start ≤ end and reuses (month, day) for every year,
      // so dragging one edge of any year moves all years identically.
      if (drag.edge === 'start') useEditor.getState().setRainySeason({ startMonth: m, startDay: d })
      else useEditor.getState().setRainySeason({ endMonth: m, endDay: d })
    } else {
      setGhostFrom(drag.fromId, x, y)
    }
  }

  function onWindowUp(e: PointerEvent) {
    const drag = dragRef.current
    window.removeEventListener('pointermove', onWindowMove)
    window.removeEventListener('pointerup', onWindowUp)
    dragRef.current = null
    setGhost(null)
    if (!drag) return
    if (drag.kind === 'link') {
      const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      const target = el?.closest('[data-task-id]') as HTMLElement | null
      const toId = target?.getAttribute('data-task-id')
      const store = useEditor.getState()
      if (toId && toId !== drag.fromId) store.completeLinking(toId)
      else store.cancelLinking()
    }
  }

  // ── Inline rename (double-click a bar/milestone) + create-on-double-click ──
  function commitRename() {
    if (!editing || renameDone.current) return
    renameDone.current = true
    const name = editing.name.trim()
    if (name) useEditor.getState().updateTask(editing.id, { name })
    setEditing(null)
  }
  function onTaskDoubleClick(_: RMouseEvent, id: string) {
    if (useEditor.getState().navMode !== 'edit') return
    const t = project.tasks.find((x) => x.id === id)
    if (!t) return
    useEditor.getState().selectTask(id)
    renameDone.current = false
    setEditing({ id, name: t.name })
  }
  function onPaperDoubleClick(e: RMouseEvent) {
    if (useEditor.getState().navMode !== 'edit') return // task dbl-clicks stop propagation
    // While a filter is active the lanes are a subset and a freshly-created
    // (non-matching) task would be filtered straight back out — no bar, no
    // rename box. Skip quick-add until the filter is cleared.
    if (filterActive(useEditor.getState().filter)) return
    const { x, y } = toContent(e.clientX, e.clientY)
    if (x < model.labelWidth) return
    const cat = model.categories.find((c) => y >= c.y && y < c.y + c.height)
    if (!cat) return
    const day = Math.max(0, Math.round(model.dayOf(x)))
    const id = useEditor.getState().addTask(cat.id, { start: day, duration: 30 })
    const t = useEditor.getState().project.tasks.find((x2) => x2.id === id)
    renameDone.current = false
    setEditing({ id, name: t?.name ?? '새 공정' })
  }

  const navClass = navMode === 'zoom' ? ' nav-zoom' : navMode === 'pan' ? ` nav-pan${panning ? ' panning' : ''}` : ''

  return (
    <div className="canvas-host">
      {navMode !== 'edit' && (
        <div className="nav-mode-badge" data-export-hide="1">
          <span>{navMode === 'zoom' ? '🔍 줌 모드 · 스크롤로 확대/축소' : '✋ 이동 모드 · 드래그로 화면 이동'}</span>
          <span className="nav-mode-esc">Esc 해제</span>
        </div>
      )}
      <div
        ref={wrapRef}
        className={`canvas-wrap${navClass}`}
        onPointerDown={onWrapPointerDown}
        onClick={() => { if (useEditor.getState().navMode === 'edit') useEditor.getState().selectTask(null) }}
      >
        <div className="paper-scale" style={{ width: model.contentWidth * zoom, height: model.contentHeight * zoom }}>
          <div
            ref={paperRef}
            className="paper"
            style={{ width: model.contentWidth, height: model.contentHeight, transform: `scale(${zoom})` }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={onPaperDoubleClick}
          >
            <ChartSvg
              model={model}
              routed={routed}
              project={project}
              selectedTaskId={selectedTaskId}
              selectedLinkId={selectedLinkId}
              selectedTextRole={selectedTextRole}
              showCriticalPath={project.view.showCriticalPath}
              showGrid={project.view.showGrid}
              colorMode={colorMode}
              todayX={todayX}
              linkingGhost={linking ? ghost : null}
              onTaskPointerDown={onTaskPointerDown}
              onAnchorPointerDown={onAnchorPointerDown}
              onBarResizePointerDown={onBarResizePointerDown}
              onLogoResizePointerDown={onLogoResizePointerDown}
              onTaskClick={(_, id) => { if (useEditor.getState().navMode === 'edit') useEditor.getState().selectTask(id) }}
              onTaskDoubleClick={onTaskDoubleClick}
              onLinkClick={(_, id) => { if (useEditor.getState().navMode === 'edit') useEditor.getState().selectLink(id) }}
              onTextClick={(role) => { if (useEditor.getState().navMode === 'edit') useEditor.getState().selectTextRole(role) }}
              onRainyResizePointerDown={onRainyResizePointerDown}
              onBackgroundClick={() => { if (useEditor.getState().navMode === 'edit') useEditor.getState().selectTask(null) }}
            />
            {editing && editLt && (
              <input
                className="inline-rename"
                autoFocus
                value={editing.name}
                style={{
                  left: editLt.x,
                  top: (editLt.isMilestone ? editLt.cy - 24 : editLt.y - 19),
                }}
                onChange={(e) => setEditing({ id: editing.id, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  else if (e.key === 'Escape') { e.preventDefault(); renameDone.current = true; setEditing(null) }
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
