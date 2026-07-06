// Reusable centred modal with a smooth open/close animation, an × close button
// and Esc-to-close. Both the export dialog and the 재계산 popup build on it so
// the chrome and the motion stay consistent.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  sub?: string
  width?: number
  onClose: () => void
  children: ReactNode
  /** Custom footer; receives the animated close fn. Omit for a single 닫기 button. */
  footer?: ReactNode | ((close: () => void) => ReactNode)
}

const CLOSE_MS = 170 // keep in sync with the .is-closing animation duration

export function Modal({ title, sub, width = 460, onClose, children, footer }: ModalProps) {
  const [closing, setClosing] = useState(false)
  const closedRef = useRef(false)

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setClosing(true)
    window.setTimeout(onClose, CLOSE_MS)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`modal-backdrop ${closing ? 'is-closing' : ''}`} onClick={requestClose}>
      <div
        className={`modal modal--anim ${closing ? 'is-closing' : ''}`}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="modal__x" title="닫기 (Esc)" aria-label="닫기" onClick={requestClose}>
          ×
        </button>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          {sub && <div className="modal__sub">{sub}</div>}
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">
          {footer !== undefined ? (
            typeof footer === 'function' ? (
              footer(requestClose)
            ) : (
              footer
            )
          ) : (
            <button className="btn" onClick={requestClose}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
