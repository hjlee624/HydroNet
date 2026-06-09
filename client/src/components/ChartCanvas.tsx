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
  | { kind: 'move'; taskId: string; grabOffsetDays: number }
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

  const model = useMemo(() => {
    const eff = { ...project, view: { ...project.view, pxPerDay: project.view.pxPerDay * zoom } }
    return computeLayout(eff)
  }, [project, zoom])

  const routed = useMemo(() => routeLinks(model, project.links), [model, project.links])

  function toContent(clientX: number, clientY: number) {
    const rect = paperRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function onTaskPointerDown(e: RPointerEvent, id: string) {
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    const task = project.tasks.find((t) => t.id === id)
    if (!task) return
    store.selectTask(id)
    store.beginGesture()
    const { x } = toContent(e.clientX, e.clientY)
    const dayAtPointer = model.dayOf(x)
    dragRef.current = { kind: 'move', taskId: id, grabOffsetDays: dayAtPointer - task.start }
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
      const newStart = model.dayOf(x) - drag.grabOffsetDays
      useEditor.getState().setTaskStartLive(drag.taskId, newStart)
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
      <div
        ref={paperRef}
        className="paper"
        style={{ width: model.contentWidth, height: model.contentHeight }}
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
          onTaskClick={(_, id) => useEditor.getState().selectTask(id)}
          onLinkClick={(_, id) => useEditor.getState().selectLink(id)}
          onBackgroundClick={() => useEditor.getState().selectTask(null)}
        />
      </div>
    </div>
  )
}
