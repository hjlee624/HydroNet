// App-shell navigation state: which package module (category) is active, and the
// module rail's open/collapsed state. Persisted to localStorage (guarded).
import { create } from 'zustand'
import type { ModuleId } from '../data/modules'

function lsGet(key: string, fallback: string): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

interface ShellState {
  module: ModuleId
  railOpen: boolean
  setModule: (m: ModuleId) => void
  toggleRail: () => void
}

/** 첫 진입(사업 단계 미선택)이면 마지막 경로가 무엇이든 대시보드로 부팅 — 새 사업
 *  모달이 대시보드 위에서만 뜨므로, 게이트를 모듈 스위치 위로 올려 첫 화면을 보장한다. */
function initialModule(): ModuleId {
  const chosen = lsGet('hydronet:typeChosen', '') === '1'
  if (!chosen) return 'dashboard'
  return lsGet('hydronet:module', 'dashboard') as ModuleId
}

export const useShell = create<ShellState>((set) => ({
  module: initialModule(),
  railOpen: lsGet('hydronet:railOpen', '1') === '1',
  setModule: (m) => {
    lsSet('hydronet:module', m)
    set({ module: m })
  },
  toggleRail: () =>
    set((s) => {
      const railOpen = !s.railOpen
      lsSet('hydronet:railOpen', railOpen ? '1' : '0')
      return { railOpen }
    }),
}))
