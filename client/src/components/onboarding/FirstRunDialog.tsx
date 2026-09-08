// 첫 실행 의도 선택(F06) — "무엇부터 하시겠어요?"
// 카드 하나를 고르면 **실제로** 모드(useEditor.setUiMode)와 화면(useView.setView)이 바뀌고
// 5단계 가이드가 열린다. 지금까지 setUiMode 는 정의만 있고 호출부가 0건이었다.
//
// 공용 Modal 을 쓰지 않는 이유: Modal 은 '.modal-backdrop' Esc 스택과 keymap.isModalOpen()
// 판정을 공유한다. 이 안내는 앱이 뜨자마자 **상시** 떠 있으므로, 그 스택에 끼면 나중에 열리는
// 도움말·출력 대화상자의 Esc 와 편집기 단축키 판정을 계속 가로챈다. 그래서 자체 오버레이를
// 쓰고, Esc 는 다른 대화상자가 하나도 없을 때만 받는다.

import { useEffect, useRef } from 'react'
import { type UserIntent, useOnboarding } from '../../state/onboardingStore'
import { useEditor } from '../../state/store'
import { useView } from '../../state/viewStore'

const OPTIONS: { id: UserIntent; icon: string; label: string; desc: string }[] = [
  {
    id: 'create',
    icon: '📅',
    label: '공정표 작성',
    desc: '샘플 공정표에서 시작해 우리 현장에 맞게 고칩니다.',
  },
  {
    id: 'edit',
    icon: '📂',
    label: '기존 파일 수정',
    desc: '저장해 둔 .json 공정표를 열어 이어서 작업합니다.',
  },
  {
    id: 'review',
    icon: '👀',
    label: '조회·검토',
    desc: '진행 상황과 총괄 현황을 보기만 합니다.',
  },
]

export function FirstRunDialog() {
  const setIntent = useOnboarding((s) => s.setIntent)
  const dismiss = useOnboarding((s) => s.dismiss)
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // 위에 진짜 대화상자가 떠 있으면 그쪽 몫이다 — 가로채지 않는다.
      if (document.querySelector('.modal-backdrop:not(.is-closing)')) return
      dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  function pick(intent: UserIntent) {
    // 간편 모드는 이번 세션에만 적용된다(store.ts 는 항상 'pro' 로 초기화 — 회귀 방지).
    // 조회·검토는 총괄 대시보드로, 나머지는 공정표 화면으로 보낸다.
    useEditor.getState().setUiMode('simple')
    useView.getState().setView(intent === 'review' ? 'dashboard' : 'schedule')
    setIntent(intent)
  }

  return (
    <div className="onb-overlay" data-export-hide="1">
      <div className="onb-dialog" role="dialog" aria-label="무엇부터 하시겠어요?">
        <div className="onb-dialog__head">
          <h2 className="onb-dialog__title">무엇부터 하시겠어요?</h2>
          <p className="onb-dialog__sub">
            고르신 작업에 맞춰 화면과 메뉴를 정리해 드립니다. 언제든 전문가 모드로 전환할 수
            있습니다.
          </p>
        </div>
        <div className="onb-intent">
          {OPTIONS.map((o, i) => (
            <button
              key={o.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="onb-intent__opt"
              onClick={() => pick(o.id)}
            >
              <span className="onb-intent__icon" aria-hidden="true">
                {o.icon}
              </span>
              <span className="onb-intent__label">{o.label}</span>
              <em className="onb-intent__desc">{o.desc}</em>
            </button>
          ))}
        </div>
        <p className="onb-dialog__note">
          선택하면 화면 오른쪽 아래에 <b>첫 공정표 완성 5단계</b> 안내가 열립니다. 각 단계는 실제로
          해내야 체크됩니다.
        </p>
        <div className="onb-dialog__foot">
          <button className="onb-dialog__skip" type="button" onClick={dismiss}>
            건너뛰기 — 전문가 모드로 시작
          </button>
        </div>
      </div>
    </div>
  )
}
