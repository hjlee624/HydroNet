// Interaction layer over ChartSvg: drag-to-move bars, drag-to-link from the
// finish anchor, click selection, and zoom-aware layout. Pointer math maps
// client coordinates into chart-content space (the paper is rendered 1:1).

import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import { useEditor } from '../state/store'
import { computeLayout } from '../engine/layout'
import { routeLinks } from '../engine/routing'
import { ChartSvg, type LinkingGhost } from './ChartSvg'

type Drag =
  | { kind: 'move'; taskId: string; grabOffsetDays: number; started: boolean }
  | { kind: 'resize'; taskId: string; edge: 'start' | 'end'; startDay: number; endDay: number; started: boolean }
  | { kind: 'link'; fromId: string }
  | null

export function ChartCanvas() {
  const project = useEditor((s) => s.project)
  const zoom = useEditor((s) => s.zoom)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)
  const linking = useEditor((s) => s.linking)

  const paperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const [ghost, setGhost] = useState<LinkingGhost | null>(null)

  // Layout is computed at base scale; zoom is applied as a uniform CSS
  // transform on the paper so the WHOLE milestone (bars, text, arrows, header)
  // scales together — not just the horizontal axis.
  const model = useMemo(() => computeLayout(project), [project])

  const routed = useMemo(() => routeLinks(model, project.links), [model, project.links])

  function toContent(clientX: number, clientY: number) {
    const rect = paperRef.current!.getBoundingClientRect()
    // rect reflects the scaled box; divide by zoom to get unscaled model coords.
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  function onTaskPointerDown(e: RPointerEvent, id: string) {
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

  function onAnchorPointerDown(e: RPointerEvent, id: string) {
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

  return (
    <div className="canvas-wrap" onClick={() => useEditor.getState().selectTask(null)}>
      <div className="paper-scale" style={{ width: model.contentWidth * zoom, height: model.contentHeight * zoom }}>
      <div
        ref={paperRef}
        className="paper"
        style={{ width: model.contentWidth, height: model.contentHeight, transform: `scale(${zoom})` }}
        onClick={(e) => e.stopPropagation()}
      >
        <ChartSvg
          model={model}
          routed={routed}
          project={project}
          selectedTaskId={selectedTaskId}
          selectedLinkId={selectedLinkId}
          showCriticalPath={project.view.showCriticalPath}
          showGrid={project.view.showGrid}
          linkingGhost={linking ? ghost : null}
          onTaskPointerDown={onTaskPointerDown}
          onAnchorPointerDown={onAnchorPointerDown}
          onBarResizePointerDown={onBarResizePointerDown}
          onTaskClick={(_, id) => useEditor.getState().selectTask(id)}
          onLinkClick={(_, id) => useEditor.getState().selectLink(id)}
          onBackgroundClick={() => useEditor.getState().selectTask(null)}
        />
      </div>
      </div>
    </div>
  )
}
