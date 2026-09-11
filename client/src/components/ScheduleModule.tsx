// 공정관리 module — the milestone/CPM editor (the package backbone). This is the
// former App body: panels, resizable widths, fullscreen preview, and the
// schedule-only keyboard shortcuts (active only while this module is mounted).

import { useEffect, useRef, useState } from 'react'
import { isModalOpen, isTextEntry, resolveAction } from '../state/keymap'
import { backupProjectToFile, useEditor } from '../state/store'
import { useViewport } from '../state/viewport'
import { ChartCanvas } from './ChartCanvas'
import { ExportDialog } from './ExportDialog'
import { Inspector } from './Inspector'
import { ProblemList } from './ProblemList'
import { RecalcModal } from './RecalcModal'
import { Resizer } from './Resizer'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'
import { ViewBar } from './ViewBar'

const num = (v: string | null, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
// localStorage can throw (private mode / locked-down / opaque origins) — guard it.
const lsNum = (key: string, fallback: number) => {
  try {
    return num(localStorage.getItem(key), fallback)
  } catch {
    return fallback
  }
}
const lsSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore — non-persistent session */
  }
}

export function ScheduleModule() {
  const [exportOpen, setExportOpen] = useState(false)
  const [fitRequest, setFitRequest] = useState(0)
  const [fitViewRequest, setFitViewRequest] = useState(0)
  const [leftWidth, setLeftWidth] = useState(() => lsNum('sequence:leftW', 288))
  const [rightWidth, setRightWidth] = useState(() => lsNum('sequence:rightW', 300))
  // Fullscreen preview hides the side panels so the chart can be checked
  // full-bleed before printing.
  const [presentation, setPresentation] = useState(false)
  // 좁은 화면(F17): 좌·우 패널을 3단에서 빼 서랍으로 옮긴다. 도면이 쓸 만한 폭을 유지하는 것이
  // 목적이므로 서랍은 한 번에 하나만 열리고, 넓은 화면으로 돌아오면 즉시 닫힌다.
  // narrow=false 인 경로의 렌더 트리는 예전과 완전히 동일하다(회귀 방지).
  const narrow = useViewport((s) => s.narrow)
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null)
  useEffect(() => {
    if (!narrow) setDrawer(null)
  }, [narrow])
  // 시트 탭 이름 더블클릭 인라인 편집(렌더는 sheet-tabs 안에서). tabDone ref로
  // Enter→blur 이중 커밋(undo 2회) 차단 — 사이드바 인라인 편집과 동일 패턴.
  const [editTab, setEditTab] = useState<{ id: string; text: string } | null>(null)
  const tabDone = useRef(false)
  function commitTab() {
    if (!editTab || tabDone.current) return
    tabDone.current = true
    const v = editTab.text.trim()
    if (v) useEditor.getState().renameSheet(editTab.id, v)
    setEditTab(null)
  }
  // 예정공정표 ↔ 마일스톤 시트 탭 (한 사업이 여러 공정표 시트를 가질 때).
  const sheets = useEditor((s) => s.project.sheets)
  const activeSheet = useEditor((s) => s.project.activeSheet)
  const a = useEditor.getState
  const tabs = activeSheet
    ? [
        { id: activeSheet.id, role: activeSheet.role, name: activeSheet.name },
        ...(sheets ?? []).map((s) => ({ id: s.id, role: s.role, name: s.name })),
      ].sort((x, y) => (x.role === 'plan' ? 0 : 1) - (y.role === 'plan' ? 0 : 1))
    : []

  useEffect(() => {
    lsSet('sequence:leftW', String(leftWidth))
  }, [leftWidth])
  useEffect(() => {
    lsSet('sequence:rightW', String(rightWidth))
  }, [rightWidth])

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

  // 단축키 정의는 state/keymap.ts 하나뿐 — 도움말(HelpDialog)·보기막대 힌트(ViewBar)도
  // 같은 정의를 읽는다. 여기서는 resolveAction 이 돌려준 동작만 실행한다: 입력 칸에
  // 커서가 있거나 대화상자가 열려 있으면 편집기 단축키(실행취소·삭제·H/V)는 아예 오지 않고,
  // 대화상자 위에서도 Ctrl+S(저장)만 살아남는다(scope 'global'). Esc 는 입력 칸에서도 온다.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = resolveAction(e, { typing: isTextEntry(e.target), modal: isModalOpen() })
      if (!action) return
      const s = useEditor.getState()

      switch (action) {
        // Ctrl+S 와 상단바 [저장] 버튼은 **같은 경로**를 지나야 한다 — 예전엔 여기서만
        // s.save() 를 직접 불러, 저장에 성공해도 칩이 '파일 백업 없음'으로 남았다.
        case 'save':
          e.preventDefault()
          void backupProjectToFile()
          return
        case 'undo':
          e.preventDefault()
          s.undo()
          return
        case 'redo':
          e.preventDefault()
          s.redo()
          return
        // 공종 다중선택 복사/붙여넣기(왼쪽 사이드바). 대상이 없으면 가로채지 않아
        // 브라우저 기본 복사/붙여넣기가 그대로 남는다.
        case 'copyCategories':
          if (s.selectedCategoryIds.length === 0) return
          e.preventDefault()
          s.copyCategories(s.selectedCategoryIds)
          return
        case 'pasteCategories':
          if (!s.categoryClipboard) return
          e.preventDefault()
          s.pasteCategories()
          return
        case 'deleteSelection':
          if (s.selectedTaskId) {
            e.preventDefault()
            s.deleteTask(s.selectedTaskId)
          } else if (s.selectedLinkId) {
            e.preventDefault()
            s.deleteLink(s.selectedLinkId)
          }
          return
        // 캔버스 도구: H = 화면 이동(드래그), V/Esc = 편집 복귀. 확대/축소는 (불편하던)
        // Z 모드 대신 Ctrl+휠(커서 기준)로 동작한다 — ChartCanvas onWheel.
        case 'panMode':
          e.preventDefault()
          s.setNavMode('pan')
          return
        case 'editMode':
          e.preventDefault()
          s.setNavMode('edit')
          return
        // Esc 는 preventDefault 하지 않는다 — 전체화면 종료 등 브라우저 기본 동작 유지.
        case 'escape':
          s.cancelLinking()
          s.setNavMode('edit')
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar
        onExport={() => setExportOpen(true)}
        onFitChart={() => setFitRequest((request) => request + 1)}
        onToggleFullscreen={toggleFullscreen}
        fullscreen={presentation}
      />
      <div className="app__body">
        {!presentation && !narrow && <Sidebar width={leftWidth} />}
        {!presentation && !narrow && (
          <Resizer side="left" width={leftWidth} setWidth={setLeftWidth} />
        )}
        <div className="app__center">
          {!presentation && narrow && (
            <div className="drawerbar" data-export-hide="1">
              <button
                type="button"
                className={`chip ${drawer === 'left' ? 'on' : ''}`}
                onClick={() => setDrawer(drawer === 'left' ? null : 'left')}
              >
                ☰ 공종 구성
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className={`chip ${drawer === 'right' ? 'on' : ''}`}
                onClick={() => setDrawer(drawer === 'right' ? null : 'right')}
              >
                ⚙ 속성
              </button>
            </div>
          )}
          {!presentation && tabs.length > 1 && (
            <div className="sheet-tabs">
              {tabs.map((t) =>
                editTab?.id === t.id ? (
                  <input
                    key={t.id}
                    autoFocus
                    value={editTab.text}
                    style={{
                      font: 'inherit',
                      padding: '5px 10px',
                      width: 150,
                      border: '1px solid var(--primary)',
                      borderRadius: 7,
                    }}
                    onChange={(e) => setEditTab({ id: t.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitTab()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        tabDone.current = true
                        setEditTab(null)
                      }
                    }}
                    onBlur={commitTab}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    key={t.id}
                    className={`sheet-tab ${t.id === activeSheet!.id ? 'active' : ''}`}
                    onClick={() => a().switchSheet(t.id)}
                    onDoubleClick={() => {
                      tabDone.current = false
                      setEditTab({ id: t.id, text: t.name })
                    }}
                    title="클릭=전환 · 더블클릭=이름 수정"
                  >
                    <span className="sheet-tab__ic">{t.role === 'plan' ? '📋' : '◆'}</span>
                    {t.name}
                  </button>
                ),
              )}
            </div>
          )}
          {!presentation && <ViewBar />}
          <ChartCanvas fitRequest={fitRequest} fitViewRequest={fitViewRequest} />
          {/* 문제 목록 팝오버는 상태바 바로 위에 뜬다(상태바의 ⚠ 버튼으로 토글). */}
          <ProblemList />
          <StatusBar />
        </div>
        {!presentation && !narrow && (
          <Resizer side="right" width={rightWidth} setWidth={setRightWidth} />
        )}
        {!presentation && !narrow && (
          <Inspector
            width={rightWidth}
            onFitChart={() => setFitViewRequest((request) => request + 1)}
          />
        )}
        {/* 서랍(좁은 화면 전용) — 도면 위에 겹쳐 뜨므로 차트 폭을 갉아먹지 않는다. */}
        {!presentation && narrow && drawer && (
          <>
            <button
              type="button"
              className="drawer__backdrop"
              aria-label="서랍 닫기"
              onClick={() => setDrawer(null)}
            />
            <div className={`drawer drawer--${drawer}`} data-export-hide="1">
              <button
                type="button"
                className="drawer__x"
                aria-label="서랍 닫기"
                onClick={() => setDrawer(null)}
              >
                ×
              </button>
              {drawer === 'left' ? (
                <Sidebar width={Math.min(leftWidth, 320)} />
              ) : (
                <Inspector
                  width={Math.min(rightWidth, 320)}
                  onFitChart={() => setFitViewRequest((request) => request + 1)}
                />
              )}
            </div>
          </>
        )}
      </div>
      {exportOpen && (
        <ExportDialog onClose={() => setExportOpen(false)} />
      )}
      <RecalcModal />
    </div>
  )
}
