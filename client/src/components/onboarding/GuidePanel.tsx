// '첫 공정표 완성' 5단계 안내 패널(F06) — 화면 오른쪽 아래 체크리스트.
//
// 이 패널에는 '다음' 버튼이 없다. 각 단계는 installGuideWatchers() 가 편집기·영속 스토어에서
// 관찰한 **실제 변화**로만 체크된다. 대신 각 단계에 '해보기'를 두어 그 일을 할 수 있는 자리로
// 곧장 데려간다(1단계=템플릿 대화상자, 5단계=출력 대화상자).

import { useEffect, useState } from 'react'
import { GUIDE_STEPS, installGuideWatchers, useOnboarding } from '../../state/onboardingStore'
import { useEditor } from '../../state/store'
import { useView } from '../../state/viewStore'
import { ExportDialog } from '../ExportDialog'
import { TemplateDialog } from '../TemplateDialog'

export function GuidePanel() {
  const steps = useOnboarding((s) => s.steps)
  const closeGuide = useOnboarding((s) => s.closeGuide)
  const dismiss = useOnboarding((s) => s.dismiss)
  const resetGuide = useOnboarding((s) => s.resetGuide)
  const uiMode = useEditor((s) => s.uiMode)
  const setView = useView((s) => s.setView)
  const [tplOpen, setTplOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  // 단계 자동 체크 구독 — 패널이 떠 있는 동안만. 해제를 잊으면 구독이 새므로 반드시 반환한다.
  useEffect(() => installGuideWatchers(), [])

  const done = GUIDE_STEPS.filter((s) => steps[s.id]).length
  const allDone = done === GUIDE_STEPS.length

  /** 해당 단계를 '할 수 있는 자리'로 데려간다. 단계를 대신 완료해 주지는 않는다. */
  function tryStep(id: string) {
    if (id === 'sample') {
      setView('schedule')
      setTplOpen(true)
    } else if (id === 'export') {
      // 출력은 라이브 차트 SVG 를 캡처하므로 공정표 화면이어야 한다.
      setView('schedule')
      setExportOpen(true)
    } else {
      setView('schedule')
    }
  }

  return (
    <>
      <aside className="onb-guide" data-export-hide="1" aria-label="첫 공정표 완성 안내">
        <div className="onb-guide__head">
          <span className="onb-guide__title">🧭 첫 공정표 완성</span>
          <span className="onb-guide__count">
            {done}/{GUIDE_STEPS.length}
          </span>
          <button
            className="onb-guide__x"
            type="button"
            onClick={closeGuide}
            title="접기 (진행 상황은 유지됩니다)"
            aria-label="안내 접기"
          >
            ✕
          </button>
        </div>
        <ol className="onb-guide__list">
          {GUIDE_STEPS.map((s, i) => {
            const isDone = steps[s.id]
            return (
              <li key={s.id} className={`onb-guide__item${isDone ? ' is-done' : ''}`}>
                <span className="onb-guide__mark" aria-hidden="true">
                  {isDone ? '✓' : i + 1}
                </span>
                <span className="onb-guide__body">
                  <span className="onb-guide__label">{s.label}</span>
                  <em className="onb-guide__hint">{s.hint}</em>
                </span>
                {!isDone && (
                  <button
                    className="onb-guide__try"
                    type="button"
                    onClick={() => tryStep(s.id)}
                    aria-label={`${s.label} 해보기`}
                  >
                    해보기
                  </button>
                )}
              </li>
            )
          })}
        </ol>
        {allDone && (
          <div className="onb-guide__done">
            🎉 첫 공정표를 끝까지 완성하셨습니다. 이제 전체 기능을 켜고 계속 작업하세요.
          </div>
        )}
        <div className="onb-guide__foot">
          <button
            className="onb-guide__btn"
            type="button"
            onClick={() => useEditor.getState().setUiMode(uiMode === 'pro' ? 'simple' : 'pro')}
          >
            {uiMode === 'pro' ? '간편 모드로 보기' : '전체 기능 보기(전문가 모드)'}
          </button>
          <button className="onb-guide__btn" type="button" onClick={resetGuide}>
            처음부터
          </button>
          <button className="onb-guide__btn onb-guide__btn--quiet" type="button" onClick={dismiss}>
            다시 보지 않기
          </button>
        </div>
      </aside>
      {tplOpen && <TemplateDialog onClose={() => setTplOpen(false)} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </>
  )
}
