// Draggable vertical divider for resizing the side panels.
import { useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'

interface Props {
  side: 'left' | 'right'
  width: number
  setWidth: (w: number) => void
  min?: number
  max?: number
}

export function Resizer({ side, width, setWidth, min = 200, max = 560 }: Props) {
  const [dragging, setDragging] = useState(false)

  function onDown(e: RPointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX
      const next = side === 'left' ? startW + delta : startW - delta
      setWidth(Math.max(min, Math.min(max, Math.round(next))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`resizer ${dragging ? 'dragging' : ''}`}
      onPointerDown={onDown}
      role="separator"
      aria-orientation="vertical"
      title="드래그하여 패널 너비 조절"
    />
  )
}
