// App-shell navigation state: which package module (category) is active, and the
// module rail's open/collapsed state. Persisted to localStorage (guarded).
import { create } from 'zustand'
import type { ModuleId } from '../data/modules'

function lsGet(key: string, fallback: string): string {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || fallback } catch { return fallback }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) } catch { /* ignore */ }
}

interface ShellState {
  module: ModuleId
  railOpen: boolean
  setModule: (m: ModuleId) => void
  toggleRail: () => void
}

export const useShell = create<ShellState>((set) => ({
  module: lsGet('hydronet:module', 'dashboard') as ModuleId,
  railOpen: lsGet('hydronet:railOpen', '1') === '1',
  setModule: (m) => { lsSet('hydronet:module', m); set({ module: m }) },
  toggleRail: () => set((s) => {
    const railOpen = !s.railOpen
    lsSet('hydronet:railOpen', railOpen ? '1' : '0')
    return { railOpen }
  }),
}))
