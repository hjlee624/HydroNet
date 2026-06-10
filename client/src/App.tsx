// Application shell — composes the panels, resizable side widths, the
// fullscreen preview mode, and global keyboard shortcuts.

import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Resizer } from './components/Resizer'
import { ChartCanvas } from './components/ChartCanvas'
import { Inspector } from './components/Inspector'
import { StatusBar } from './components/StatusBar'
import { ExportDialog } from './components/ExportDialog'
import { RecalcModal } from './components/RecalcModal'
import { useEditor } from './state/store'

const num = (v: string | null, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export default function App() {
  const [exportOpen, setExportOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(() => num(localStorage.getItem('hydronet:leftW'), 288))
  const [rightWidth, setRightWidth] = useState(() => num(localStorage.getItem('hydronet:rightW'), 300))
  // Fullscreen preview hides the side panels so the chart can be checked
  // full-bleed before printing.
  const [presentation, setPresentation] = useState(false)

  useEffect(() => { localStorage.setItem('hydronet:leftW', String(leftWidth)) }, [leftWidth])
  useEffect(() => { localStorage.setItem('hydronet:rightW', String(rightWidth)) }, [rightWidth])

  useEffect(() => {
    const onFs = () => setPresentation(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch {
      // Fullscreen API unavailable (e.g. permissions) → fall back to panel hide.
      setPresentation((p) => !p)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      const s = useEditor.getState()

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); void s.save(); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); s.undo(); return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); s.redo(); return
      }
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (s.selectedTaskId) { e.preventDefault(); s.deleteTask(s.selectedTaskId) }
        else if (s.selectedLinkId) { e.preventDefault(); s.deleteLink(s.selectedLinkId) }
      }
      // Photoshop-style canvas tools: Z = zoom (wheel), H = pan (drag), V/Esc = edit.
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') { e.preventDefault(); s.setNavMode('zoom'); return }
        if (k === 'h') { e.preventDefault(); s.setNavMode('pan'); return }
        if (k === 'v') { e.preventDefault(); s.setNavMode('edit'); return }
      }
      if (e.key === 'Escape') { s.cancelLinking(); s.setNavMode('edit') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar onExport={() => setExportOpen(true)} onToggleFullscreen={toggleFullscreen} fullscreen={presentation} />
      <div className="app__body">
        {!presentation && <Sidebar width={leftWidth} />}
        {!presentation && <Resizer side="left" width={leftWidth} setWidth={setLeftWidth} />}
        <div className="app__center">
          <ChartCanvas />
          <StatusBar />
        </div>
        {!presentation && <Resizer side="right" width={rightWidth} setWidth={setRightWidth} />}
        {!presentation && <Inspector width={rightWidth} />}
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      <RecalcModal />
    </div>
  )
}
