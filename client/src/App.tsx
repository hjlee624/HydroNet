// Application shell — composes the panels and wires global keyboard shortcuts.

import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { ChartCanvas } from './components/ChartCanvas'
import { Inspector } from './components/Inspector'
import { StatusBar } from './components/StatusBar'
import { ExportDialog } from './components/ExportDialog'
import { useEditor } from './state/store'

export default function App() {
  const [exportOpen, setExportOpen] = useState(false)

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
      if (e.key === 'Escape') s.cancelLinking()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar onExport={() => setExportOpen(true)} />
      <div className="app__body">
        <Sidebar />
        <div className="app__center">
          <ChartCanvas />
          <StatusBar />
        </div>
        <Inspector />
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  )
}
