// Reusable centred modal with a smooth open/close animation, an × close button
// and Esc-to-close. Both the export dialog and the 재계산 popup build on it so
// the chrome and the motion stay consistent.
//
// 키보드 접근성(F11): 열리면 대화상자 안으로 포커스를 넣고, Tab/Shift+Tab 은 대화상자
// 안에서만 순환하며(포커스 가두기), 닫히면 열었던 버튼으로 포커스를 되돌린다.
// 제목은 aria-labelledby 로 role="dialog" 에 연결한다. 대화상자가 떠 있는 동안 도면 단축키는
// state/keymap.ts 의 isModalOpen() 판정으로 비활성화된다(살아남는 건 Ctrl+S 저장 하나뿐).
// 주의 — 아래 두 곳의 '.modal-backdrop' 선택자는 목적이 달라 일부러 다르게 쓴다:
//   • keymap.isModalOpen()  … :not(.is-closing) 없이 전부 센다. 닫힘 애니메이션(CLOSE_MS)
//     동안에도 대화상자는 보이고 포커스를 갖고 있어, 그 사이 편집기 단축키가 되살아나면
//     'Esc 로 닫자마자 Delete' 연타에 선택한 공정이 지워진다.
//   • 아래 Esc 스택 판정  … :not(.is-closing) 로 거른다. 이미 닫히는 중인 대화상자가
//     Esc 를 다시 가로채면 그 아래(뒤에 남은) 대화상자가 닫히지 않는다.

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

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

/** 포커스를 받을 수 있는 요소 선택자(가두기·초기 포커스 대상 산출용). */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ title, sub, width = 460, onClose, children, footer }: ModalProps) {
  const [closing, setClosing] = useState(false)
  const closedRef = useRef(false)
  const titleId = useId()
  const subId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  // 대화상자를 열기 직전에 포커스를 갖고 있던 요소 — 닫을 때 이 자리로 되돌린다.
  const prevFocus = useRef<HTMLElement | null>(null)

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setClosing(true)
    window.setTimeout(onClose, CLOSE_MS)
  }

  /** 대화상자 안의 포커스 가능한 요소 목록(화면에서 감춰진 것 제외 없이 DOM 순서 그대로). */
  function focusables(): HTMLElement[] {
    const box = boxRef.current
    if (!box) return []
    return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
  }

  // 초기 포커스 + 닫힘 후 복귀. 자식이 이미 autoFocus 로 포커스를 잡았으면 건드리지 않는다
  // (TemplateDialog·BoqImportDialog 의 검색 입력 등).
  useEffect(() => {
    prevFocus.current = (document.activeElement as HTMLElement | null) ?? null
    const id = window.setTimeout(() => {
      const box = boxRef.current
      if (!box) return
      if (box.contains(document.activeElement)) return
      const list = focusables()
      const preferred = box.querySelector<HTMLElement>('[data-autofocus]')
      ;(preferred ?? list[0] ?? box).focus()
    }, 0)
    return () => {
      window.clearTimeout(id)
      const prev = prevFocus.current
      if (prev?.isConnected) prev.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // 모달이 겹쳐 떠 있으면 가장 위(마지막에 열린) 것만 반응한다.
      const stack = document.querySelectorAll('.modal-backdrop:not(.is-closing)')
      const mine = boxRef.current?.parentElement
      if (stack.length > 0 && mine && stack[stack.length - 1] !== mine) return
      e.stopPropagation()
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Tab/Shift+Tab 을 대화상자 안에서만 돌린다 — 뒤의 도면·사이드바로 새지 않는다. */
  function onTrapKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const list = focusables()
    if (list.length === 0) {
      e.preventDefault()
      boxRef.current?.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first || !boxRef.current?.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !boxRef.current?.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={`modal-backdrop ${closing ? 'is-closing' : ''}`} onClick={requestClose}>
      <div
        className={`modal modal--anim ${closing ? 'is-closing' : ''}`}
        style={{ width }}
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onTrapKey}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={sub ? subId : undefined}
      >
        <button className="modal__x" title="닫기 (Esc)" aria-label="닫기" onClick={requestClose}>
          ×
        </button>
        <div className="modal__header">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
          {sub && (
            <div className="modal__sub" id={subId}>
              {sub}
            </div>
          )}
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
