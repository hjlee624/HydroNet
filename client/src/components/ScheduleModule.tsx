// 공정관리 module — the milestone/CPM editor (the package backbone). This is the
// former App body: panels, resizable widths, fullscreen preview, and the
// schedule-only keyboard shortcuts (active only while this module is mounted).

import { useEffect, useState } from 'react'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { Resizer } from './Resizer'
import { ChartCanvas } from './ChartCanvas'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { ViewBar } from './ViewBar'
import { ExportDialog } from './ExportDialog'
import { RecalcModal } from './RecalcModal'
import { useEditor } from '../state/store'

const num = (v: string | null, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
// localStorage can throw (private mode / locked-down / opaque origins) — guard it.
const lsNum = (key: string, fallback: number) => {
  try { return num(localStorage.getItem(key), fallback) } catch { return fallback }
}
const lsSet = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch { /* ignore — non-persistent session */ }
}

export function ScheduleModule() {
  const [exportOpen, setExportOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(() => lsNum('hydronet:leftW', 288))
  const [rightWidth, setRightWidth] = useState(() => lsNum('hydronet:rightW', 300))
  // Fullscreen preview hides the side panels so the chart can be checked
  // full-bleed before printing.
  const [presentation, setPresentation] = useState(false)
  // 예정공정표 ↔ 마일스톤 시트 탭 (한 사업이 여러 공정표 시트를 가질 때).
  const sheets = useEditor((s) => s.project.sheets)
  const activeSheet = useEditor((s) => s.project.activeSheet)
  const a = useEditor.getState
  const tabs = activeSheet
    ? [{ id: activeSheet.id, role: activeSheet.role, name: activeSheet.name },
        ...(sheets ?? []).map((s) => ({ id: s.id, role: s.role, name: s.name }))]
        .sort((x, y) => (x.role === 'plan' ? 0 : 1) - (y.role === 'plan' ? 0 : 1))
    : []

  useEffect(() => { lsSet('hydronet:leftW', String(leftWidth)) }, [leftWidth])
  useEffect(() => { lsSet('hydronet:rightW', String(rightWidth)) }, [rightWidth])

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
      // 공종 다중선택 복사/붙여넣기(왼쪽 사이드바). 입력 중이 아닐 때만 가로챈다.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !typing && s.selectedCategoryIds.length > 0) {
        e.preventDefault(); s.copyCategories(s.selectedCategoryIds); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing && s.categoryClipboard) {
        e.preventDefault(); s.pasteCategories(); return
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
          {!presentation && tabs.length > 1 && (
            <div className="sheet-tabs">
              {tabs.map((t) => (
                <button key={t.id} className={`sheet-tab ${t.id === activeSheet!.id ? 'active' : ''}`} onClick={() => a().switchSheet(t.id)}>
                  <span className="sheet-tab__ic">{t.role === 'plan' ? '📋' : '◆'}</span>{t.name}
                </button>
              ))}
            </div>
          )}
          {!presentation && <ViewBar />}
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
