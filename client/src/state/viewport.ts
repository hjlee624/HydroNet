// 화면 폭 분기(F17) — 좁은 화면(태블릿)에서는 좌·우 패널을 서랍으로 접어 도면이
// 쓸 만한 폭을 유지하고, 휴대전화에서는 1차 범위를 조회·검토·진척 입력으로 한정한다.
// 프로젝트 데이터와 무관한 순수 UI 상태(viewStore 와 같은 계층).
//
// 주의 — matchMedia 가 없는 실행 환경(tsx 스모크·jsdom mount-test·구형 웹뷰)에서는
// 항상 데스크톱 경로({narrow:false, mobile:false})로 폴백한다. 기존 3단 레이아웃은
// narrow=false 일 때 한 줄도 달라지지 않아야 한다(회귀 방지).

import { create } from 'zustand'

/** 좌·우 패널을 서랍으로 접는 기준 폭(px). 이 값 이하이면 narrow. */
export const NARROW_MAX = 1100
/** 휴대전화 범위 한정 기준 폭(px). 이 값 이하이면 mobile(=narrow 도 참). */
export const MOBILE_MAX = 760

export interface ViewportState {
  /** 좁은 화면(태블릿 이하) — 좌·우 패널을 서랍으로. */
  narrow: boolean
  /** 휴대전화 — 조회·검토·진척 입력만 노출. */
  mobile: boolean
}

function query(maxWidth: number): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia(`(max-width: ${maxWidth}px)`)
  } catch {
    return null
  }
}

function measure(): ViewportState {
  const mobile = query(MOBILE_MAX)?.matches ?? false
  const narrow = query(NARROW_MAX)?.matches ?? false
  // 휴대전화는 정의상 좁은 화면이기도 하다(브레이크포인트가 어긋나도 불변식 유지).
  return { narrow: narrow || mobile, mobile }
}

export const useViewport = create<ViewportState>()(() => measure())

/**
 * 화면 폭 변화를 구독한다. main.tsx 에서 1회만 호출하고, 해제 함수를 돌려준다
 * (테스트에서 구독을 끊고 스토어를 직접 setState 해 분기를 검증할 수 있게).
 */
export function installViewportWatch(): () => void {
  const list = [query(NARROW_MAX), query(MOBILE_MAX)].filter((m): m is MediaQueryList => !!m)
  if (list.length === 0) return () => {}
  const onChange = () => useViewport.setState(measure())
  onChange()
  for (const m of list) {
    // addEventListener 가 없는 구형 구현(Safari 13 이하)은 addListener 로 폴백.
    if (typeof m.addEventListener === 'function') m.addEventListener('change', onChange)
    else if (typeof m.addListener === 'function') m.addListener(onChange)
  }
  return () => {
    for (const m of list) {
      if (typeof m.removeEventListener === 'function') m.removeEventListener('change', onChange)
      else if (typeof m.removeListener === 'function') m.removeListener(onChange)
    }
  }
}
