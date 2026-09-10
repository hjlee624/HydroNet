// Left panel — the 공종(work-type) lanes as a collapsible tree with their
// activities. Add/reorder/delete lanes, add activities & milestones, jump-select,
// drag activities between lanes, drag lanes to re-order, double-click to rename,
// and toggle per-row chart visibility (ON/OFF).

import { Fragment, useRef, useState } from 'react'
import type { DragEvent as RDragEvent, MouseEvent as RMouseEvent } from 'react'
import { useEditor, filterActive } from '../state/store'
import { PALETTE_MAX, type Category } from '../types/model'
import { planMirrorView, type MirrorRow } from '../engine/mirror'

/** Small ON/OFF switch controlling whether a lane/activity shows in the chart. */
function VisToggle({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      className={`sw ${on ? 'on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span className="sw__knob" />
    </button>
  )
}

export function Sidebar({ width }: { width: number }) {
  const project = useEditor((s) => s.project)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const a = useEditor.getState

  const categories = [...project.categories]
    .filter((c) => project.commissioningEnabled || !c.isCommissioning)
    .sort((x, y) => x.order - y.order)

  const allOn = !project.categories.some((c) => c.hidden) && !project.tasks.some((t) => t.hidden)
  const orderedIds = categories.map((c) => c.id) // 표시 순서 — Shift 범위선택·다중선택 기준

  // 예정공정표↔마일스톤 연동(요구사항 4): 활성 시트가 마일스톤이고 plan 시트가 있을 때만
  // 토글 노출. mv는 미러 ON일 때 예정 공종/공정(숨김 포함)을 표시 공종별로 묶어 돌려준다.
  const canMirror =
    project.activeSheet?.role === 'milestone' && !!project.sheets?.some((s) => s.role === 'plan')
  const mirrorOn = !!project.view.mirrorPlan && canMirror
  const mv = planMirrorView(project)
  const planOnlyCats = mv ? mv.cats.filter((c) => c.planOnly) : []

  return (
    <aside className="panel panel--left" style={{ width }}>
      <div className="panel__header">
        <span className="panel__title">공종 구성</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--steel)',
            }}
          >
            <span>전체</span>
            <VisToggle
              on={allOn}
              onToggle={() => a().setAllVisible(!allOn)}
              title="전체 표시 ON/OFF"
            />
          </span>
          <button className="btn btn--sm" onClick={() => a().addCategory()}>
            ＋ 공종
          </button>
        </div>
      </div>
      {canMirror && (
        <label
          className="mirror-bar toggle"
          title="예정공정표의 공종·공정을 마일스톤에 함께 표시합니다(표시 전용). 개별 공정은 🔗 행의 스위치로 마일스톤에서만 숨길 수 있습니다."
        >
          <input type="checkbox" checked={mirrorOn} onChange={() => a().toggleMirrorPlan()} />
          예정공정표 공정 함께 표시
        </label>
      )}
      <div className="panel__scroll">
        {categories.map((cat, i) => (
          <CategoryNode
            key={cat.id}
            cat={cat}
            nextId={categories[i + 1]?.id ?? null}
            orderedIds={orderedIds}
            selectedTaskId={selectedTaskId}
            mirrorRows={mv?.tasksByCat.get(cat.id) ?? []}
          />
        ))}
        {planOnlyCats.map((c) => (
          <MirrorOnlyNode key={c.id} cat={c} rows={mv!.tasksByCat.get(c.id) ?? []} />
        ))}
        {categories.length === 0 && planOnlyCats.length === 0 && (
          <div className="empty-hint">
            공종이 없습니다.
            <br />
            상단 ＋공종 으로 추가하세요.
          </div>
        )}
      </div>
    </aside>
  )
}

/** 예정공정표 연동 공정 한 줄(표시 전용) — 🔗 + 이름 + 마일스톤 표시 토글(view.mirrorHidden). */
function MirrorRowView({ row }: { row: MirrorRow }) {
  const a = useEditor.getState
  return (
    <div
      className={`cat__task cat__task--mirror ${row.hidden ? 'is-hidden' : ''}`}
      title="예정공정표에서 연동된 공정(표시 전용) · 스위치로 마일스톤 표시/숨김"
    >
      <span>🔗</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {row.name.replace(/^◆\s*/, '')}
      </span>
      <VisToggle
        on={!row.hidden}
        onToggle={() => a().toggleMirrorHidden(row.id)}
        title="이 예정 공정을 마일스톤에 표시 ON/OFF"
      />
      <span className="dur">{row.isMilestone ? 'MS' : `${row.duration}일`}</span>
    </div>
  )
}

/** 예정공정표에만 있는(마일스톤 자체 공종과 이름이 안 겹치는) 공종을 연동 표시하는 읽기전용 노드. */
function MirrorOnlyNode({
  cat,
  rows,
}: {
  cat: { id: string; name: string; color: string }
  rows: MirrorRow[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="cat cat--mirror">
      <div className="cat__row" title="예정공정표에서 연동된 공종(표시 전용)">
        <button
          className="icon-btn"
          title={collapsed ? '펼치기' : '접기'}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="cat__swatch" style={{ background: cat.color }} />
        <span className="cat__name">🔗 {cat.name}</span>
        <span className="cat__count">{rows.length}</span>
      </div>
      {!collapsed && (
        <div className="cat__tasks">
          {rows.map((m) => (
            <MirrorRowView key={m.id} row={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryNode({
  cat,
  nextId,
  orderedIds,
  selectedTaskId,
  mirrorRows,
}: {
  cat: Category
  nextId: string | null
  orderedIds: string[]
  selectedTaskId: string | null
  mirrorRows: MirrorRow[]
}) {
  // Select the stable array ref and filter in the body — returning a fresh
  // `.filter()` array straight from the selector makes zustand v5's snapshot
  // unstable (useSyncExternalStore → infinite re-render → blank screen).
  const allTasks = useEditor((s) => s.project.tasks)
  const filter = useEditor((s) => s.filter)
  const selectedCatIds = useEditor((s) => s.selectedCategoryIds)
  const catAnchor = useEditor((s) => s.selectedCategoryId)
  // 공종 색상 팝오버가 쓰는 공용 즐겨찾기 팔레트(공정 속성 Palette와 동일한 project.palette).
  const palette = useEditor((s) => s.project.palette)
  const catSelected = selectedCatIds.includes(cat.id)
  const tasks = allTasks.filter((t) => {
    if (t.categoryId !== cat.id) return false
    if (filter.critical && !t.critical) return false
    if (filter.milestone && !t.isMilestone) return false
    const q = filter.query.trim().toLowerCase()
    if (q && !t.name.toLowerCase().includes(q)) return false
    return true
  })
  const a = useEditor.getState
  const [dragOver, setDragOver] = useState(false)
  const [dropAt, setDropAt] = useState<{ taskId: string; pos: 'before' | 'after' } | null>(null)
  // Category drag-reorder: where a dragged 공종 would drop relative to THIS lane.
  const [catDrop, setCatDrop] = useState<'before' | 'after' | null>(null)
  // Double-click rename state (lane name / one activity name). The *Done refs guard
  // against the Enter-then-blur double commit (which would push two undo steps),
  // mirroring the chart's inline rename.
  const [editName, setEditName] = useState<string | null>(null)
  const [editTask, setEditTask] = useState<{ id: string; text: string } | null>(null)
  // 행별 ➕ 삽입 메뉴가 열린 공정 id(그 행 바로 아래에 공정/세부공정/마일스톤 삽입).
  const [insertAt, setInsertAt] = useState<string | null>(null)
  // 공종 색상 편집 팝오버(스와치 클릭 → 컬러맵 + 공용 팔레트) 열림 여부.
  const [colorOpen, setColorOpen] = useState(false)
  const nameDone = useRef(false)
  const taskDone = useRef(false)
  // While a filter is active the lane list is a SUBSET, so an insertion position
  // computed from it is ambiguous against the full array (where do the hidden
  // neighbours go?). Disable drag-reorder while filtered, exactly as the chart
  // does — clear the filter to rearrange.
  const filtered = filterActive(filter)

  // ── Drag types: activities use 'text/hn-task', lanes use 'text/hn-cat'. The
  //    lane container handles both; task rows handle only task drags and let a
  //    lane drag bubble up to the container. ──
  const hasType = (e: RDragEvent, type: string) => Array.from(e.dataTransfer.types).includes(type)

  function onContainerDragOver(e: RDragEvent<HTMLDivElement>) {
    if (hasType(e, 'text/hn-cat')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      setCatDrop((prev) => (prev === pos ? prev : pos))
    } else {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  function onContainerDrop(e: RDragEvent<HTMLDivElement>) {
    const catId = e.dataTransfer.getData('text/hn-cat')
    if (catId) {
      // a 공종 was dropped onto/around this lane → re-order lanes
      e.preventDefault()
      const pos = catDrop ?? 'before'
      setCatDrop(null)
      setDragOver(false)
      setDropAt(null)
      if (!filtered && catId !== cat.id) {
        const beforeId = pos === 'before' ? cat.id : nextId
        // If the dragged 공종 belongs to a multi-selection, move the whole group at
        // once (Shift/Ctrl 다중선택), preserving their relative order; else single.
        const sel = a().selectedCategoryIds
        if (sel.length > 1 && sel.includes(catId)) a().reorderCategories(sel, beforeId)
        else a().reorderCategory(catId, beforeId)
      }
      return
    }
    onLaneTaskDrop(e) // otherwise it's an activity dropped on the lane body
  }

  function onLaneTaskDrop(e: RDragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    setDropAt(null)
    if (filtered) return
    const id = e.dataTransfer.getData('text/hn-task')
    // Row-aware move (matches the chart) → new last row of the lane. Using the row
    // model keeps the sidebar order and the chart's vertical position in lock-step,
    // even for preset lanes whose tasks all carry an explicit row.
    if (id) a().moveTaskToRow(id, cat.id, null, 'below')
  }

  function onTaskDragOver(e: RDragEvent<HTMLDivElement>, taskId: string) {
    if (!hasType(e, 'text/hn-task')) return // lane drag → let it bubble to the container
    if (filtered) return
    e.preventDefault()
    e.stopPropagation() // show a precise insertion line, not the whole-lane highlight
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    setDropAt((prev) => (prev?.taskId === taskId && prev.pos === pos ? prev : { taskId, pos }))
  }

  function onTaskDrop(e: RDragEvent<HTMLDivElement>, idx: number) {
    const id = e.dataTransfer.getData('text/hn-task')
    if (!id) return // lane drag (or unknown) → let it bubble to the lane container
    e.preventDefault()
    e.stopPropagation()
    const target = dropAt
    setDropAt(null)
    setDragOver(false)
    if (filtered) return
    // Insert before this row (top half) or before the next row (bottom half).
    const pos = target?.taskId === tasks[idx].id ? target.pos : 'before'
    const beforeId = pos === 'before' ? tasks[idx].id : (tasks[idx + 1]?.id ?? null)
    // Give the task its own row just above the anchor's row (or the lane end when no
    // anchor) — row-aware so the chart follows the sidebar drop exactly.
    a().moveTaskToRow(id, cat.id, beforeId, beforeId ? 'above' : 'below')
  }

  function commitName() {
    if (editName === null || nameDone.current) return
    nameDone.current = true
    const v = editName.trim()
    if (v) a().updateCategory(cat.id, { name: v })
    setEditName(null)
  }
  function commitTask() {
    if (!editTask || taskDone.current) return
    taskDone.current = true
    const v = editTask.text.trim()
    if (v) a().updateTask(editTask.id, { name: v })
    setEditTask(null)
  }
  // 새 세부공정의 시작일·공기. 상위 공정은 세부공정이 생기면 차트에서 막대가 숨겨지므로 —
  //  · 첫 세부공정: 상위 공정의 시작·공기를 그대로 이어받아 그 막대를 자연스레 대체한다.
  //  · 이후 세부공정: 이미 붙은 세부공정들 **끝**에 이어 붙인다(공기 30 기본).
  function subInit(parentId: string): { start: number; duration: number } {
    const subs = tasks.filter((t) => t.parentId === parentId)
    if (subs.length)
      return { start: subs.reduce((m, t) => Math.max(m, t.start + t.duration), 0), duration: 30 }
    const parent = tasks.find((t) => t.id === parentId)
    return parent ? { start: parent.start, duration: parent.duration } : { start: 0, duration: 30 }
  }
  // WBS 트리: 공종 > 공정 > 세부공정. 세부공정은 parentId로 상위 공정에 **고정**된다 — 배열 순서나
  // 다른 공정 이동과 무관하게 항상 자기 상위 공정 아래에 붙는다. 렌더 순서 = 상위 공정(배열 순서)마다
  // 그 바로 아래에 자식(parentId=상위 id)들을(배열 순서) 들여쓰기로.
  const childrenOf = new Map<string, typeof tasks>()
  for (const t of tasks) {
    if (!t.parentId) continue
    const arr = childrenOf.get(t.parentId)
    if (arr) arr.push(t)
    else childrenOf.set(t.parentId, [t])
  }
  const renderList: Array<{ task: (typeof tasks)[number]; child: boolean }> = []
  for (const t of tasks) {
    if (t.parentId) continue // 자식은 상위 공정 아래에서 렌더
    renderList.push({ task: t, child: false })
    for (const c of childrenOf.get(t.id) ?? []) renderList.push({ task: c, child: true })
  }
  // 방어: 상위 공정이 사라진 고아 세부공정(있으면)도 최상위로 노출해 사라지지 않게 한다.
  for (const t of tasks)
    if (t.parentId && !tasks.some((x) => x.id === t.parentId))
      renderList.push({ task: t, child: false })
  // 한 공정 줄(드래그 재배치·인라인 편집·표시토글). idx = 전체 tasks 배열 내 위치(드롭 기준).
  // child=true면 세부공정(부모 공정 아래 한 단 더 들여쓰기).
  const renderTaskRow = (t: (typeof tasks)[number], idx: number, child = false) => (
    <div
      key={t.id}
      className={`cat__task ${child ? 'cat__task--child' : ''} ${t.id === selectedTaskId ? 'selected' : ''} ${t.critical ? 'crit' : ''} ${t.hidden ? 'is-hidden' : ''} ${dropAt?.taskId === t.id ? (dropAt.pos === 'before' ? 'drop-before' : 'drop-after') : ''}`}
      draggable={!filtered && editTask?.id !== t.id}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/hn-task', t.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => onTaskDragOver(e, t.id)}
      onDrop={(e) => onTaskDrop(e, idx)}
      onClick={() => a().selectTask(t.id)}
      title={
        filtered
          ? '필터를 해제하면 드래그로 순서를 변경할 수 있습니다'
          : '드래그: 순서 변경/다른 공종 이동 · 더블클릭: 이름 수정'
      }
    >
      <span>{t.isMilestone ? '◆' : '▬'}</span>
      {editTask?.id === t.id ? (
        <input
          className="cat__edit"
          autoFocus
          style={{ flex: 1 }}
          value={editTask.text}
          onChange={(e) => setEditTask({ id: t.id, text: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTask()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              taskDone.current = true
              setEditTask(null)
            }
          }}
          onBlur={commitTask}
        />
      ) : (
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            taskDone.current = false
            setEditTask({ id: t.id, text: t.name.replace(/^◆\s*/, '') })
          }}
        >
          {t.name.replace(/^◆\s*/, '')}
        </span>
      )}
      <button
        className="cat__insert"
        title="이 아래에 공정/세부공종/마일스톤 삽입"
        onClick={(e) => {
          e.stopPropagation()
          setInsertAt(insertAt === t.id ? null : t.id)
        }}
      >
        ＋
      </button>
      <VisToggle
        on={!t.hidden}
        onToggle={() => a().toggleTaskVisible(t.id)}
        title="이 공정을 도면에 표시 ON/OFF"
      />
      <span className="dur">{t.isMilestone ? 'MS' : `${t.duration}일`}</span>
      <button
        className="cat__del"
        title="이 공정 삭제"
        onClick={(e) => {
          e.stopPropagation()
          const kids = tasks.filter((x) => (x.subName ?? '').trim() === t.name).length
          if (
            kids > 0 &&
            typeof window !== 'undefined' &&
            !window.confirm(`‘${t.name}’ 공정과 세부공정 ${kids}개를 삭제할까요?`)
          )
            return
          a().deleteTask(t.id)
        }}
      >
        ✕
      </button>
    </div>
  )
  // 행별 ➕ 삽입 메뉴 — 기준 공정 바로 아래에 끼워 넣는다.
  //  · ＋공정/＋마일스톤: 기준 공정의 세부공종을 **상속**해 같은 그룹에 붙는다(없으면 직속).
  //  · ＋세부공종: 기준 공정 자체를 새 세부공종으로 **감싼다**(그 공정에 세부공종을 부여) —
  //    연속-런 그룹핑이라 그 자리에서 바로 세부공종으로 묶여 보인다(맨 아래로 안 감).
  const insertMenu = (afterId: string) => {
    const anchor = tasks.find((t) => t.id === afterId)
    // 기준 공정의 상위 id(anchor가 세부공정이면 그 상위, 평면이면 anchor 자신)를 상속해 같은 상위 밑에.
    const parentId = anchor?.parentId ?? anchor?.id ?? ''
    return (
      <div className="cat__insertmenu">
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => {
            a().addTask(cat.id, anchor?.parentId ? { parentId: anchor.parentId } : undefined, {
              afterId,
            })
            setInsertAt(null)
          }}
        >
          ＋공정
        </button>
        <button
          className="btn btn--sm btn--ghost"
          title="이 공정의 하위에 세부공정을 추가합니다"
          onClick={() => {
            // 세부공정은 parentId로 상위 공정에 **고정**된다. 상위 공정 줄 끝에 이어 붙이고, 첫
            // 세부공정이면 상위 공정 시작·공기를 이어받아 그 막대(차트에서 숨김)를 대체한다.
            const nid = a().addTask(
              cat.id,
              { name: '새 세부공정', parentId, ...subInit(parentId) },
              { afterId },
            )
            taskDone.current = false
            setEditTask({ id: nid, text: '새 세부공정' })
            setInsertAt(null)
          }}
        >
          ＋세부공정
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => {
            a().addTask(
              cat.id,
              {
                name: '◆ 마일스톤',
                isMilestone: true,
                duration: 0,
                ...(anchor?.parentId ? { parentId: anchor.parentId } : {}),
              },
              { afterId },
            )
            setInsertAt(null)
          }}
        >
          ＋마일스톤
        </button>
      </div>
    )
  }
  // 공종 선택: 일반=단일, Ctrl/⌘=토글 누적, Shift=기준(anchor)부터 범위. 복붙(Ctrl+C/V)
  // 대상이 된다.
  function onRowClick(e: RMouseEvent) {
    const i = orderedIds.indexOf(cat.id)
    if (e.shiftKey && catAnchor && orderedIds.includes(catAnchor)) {
      const ai = orderedIds.indexOf(catAnchor)
      const [lo, hi] = ai <= i ? [ai, i] : [i, ai]
      a().selectCategories(orderedIds.slice(lo, hi + 1), catAnchor) // 기준 공종은 유지
    } else if (e.ctrlKey || e.metaKey) {
      const set = new Set(selectedCatIds)
      if (set.has(cat.id)) set.delete(cat.id)
      else set.add(cat.id)
      a().selectCategories(
        orderedIds.filter((x) => set.has(x)),
        cat.id,
      )
    } else {
      a().selectCategory(cat.id)
    }
  }
  function removeCategory(e: RMouseEvent) {
    e.stopPropagation()
    const n = allTasks.filter((t) => t.categoryId === cat.id).length
    const msg =
      `‘${cat.name}’ 공종을 삭제할까요?` + (n > 0 ? `\n포함된 공정 ${n}개도 함께 삭제됩니다.` : '')
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      !window.confirm(msg)
    )
      return
    a().deleteCategory(cat.id)
  }

  return (
    <div
      className={`cat ${dragOver ? 'cat--drop' : ''} ${cat.hidden ? 'is-hidden' : ''} ${catDrop === 'before' ? 'cat-drop-before' : ''} ${catDrop === 'after' ? 'cat-drop-after' : ''}`}
      onDragOver={onContainerDragOver}
      onDragEnter={(e) => {
        if (hasType(e, 'text/hn-task')) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false)
          setDropAt(null)
          setCatDrop(null)
        }
      }}
      onDrop={onContainerDrop}
    >
      <div
        className={`cat__row ${catSelected ? 'selected' : ''}`}
        draggable={editName === null && !filtered}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/hn-cat', cat.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={onRowClick}
        title={
          filtered
            ? '필터를 해제하면 드래그로 공종 순서를 바꿀 수 있습니다'
            : '클릭 선택 · Ctrl=다중 · Shift=범위 · Ctrl+C/V 복사·붙여넣기 · 드래그=순서 · 더블클릭=이름 수정'
        }
      >
        <button
          className="icon-btn"
          title={cat.collapsed ? '펼치기' : '접기'}
          onClick={(e) => {
            e.stopPropagation()
            a().toggleCollapse(cat.id)
          }}
        >
          {cat.collapsed ? '▸' : '▾'}
        </button>
        {/* 색상 스와치 클릭 → 컬러맵 + 공용 팔레트 팝오버. 고르면 이 공종의 모든 공정 색도 함께 바뀐다. */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="cat__swatch"
            style={{ background: cat.color, cursor: 'pointer', border: 'none', padding: 0 }}
            title="클릭하여 공종 색상 변경 — 하위 공정 색도 모두 함께 바뀝니다"
            onClick={(e) => {
              e.stopPropagation()
              setColorOpen((v) => !v)
            }}
          />
          {colorOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setColorOpen(false)
                }}
              />
              <div
                className="cat-colorpop"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  zIndex: 41,
                  width: 176,
                  background: 'var(--canvas)',
                  border: '1px solid var(--hairline-strong)',
                  borderRadius: 8,
                  padding: 10,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--slate)', marginBottom: 6 }}>공종 표식 색상</div>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(cat.color) ? cat.color : '#7c93a8'}
                  onChange={(e) => a().setCategoryColor(cat.id, e.target.value)}
                  style={{
                    width: '100%',
                    height: 30,
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--slate)', margin: '8px 0 4px' }}>
                  즐겨찾기 (공정 속성과 공유)
                </div>
                <div className="palette">
                  {Array.from({ length: PALETTE_MAX }).map((_, i) => {
                    const c = (palette ?? [])[i]
                    return c ? (
                      <button
                        key={i}
                        type="button"
                        className="palette__sw"
                        style={{ background: c }}
                        title={`${c} · 클릭 적용 / 우클릭 삭제`}
                        onClick={() => a().setCategoryColor(cat.id, c)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          a().removePaletteColor(i)
                        }}
                      />
                    ) : (
                      <button
                        key={i}
                        type="button"
                        className="palette__sw palette__sw--empty"
                        title="현재 공종 표식 색을 즐겨찾기에 추가"
                        onClick={() => a().addPaletteColor(cat.color)}
                      >
                        ＋
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        {editName !== null ? (
          <input
            className="cat__edit"
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitName()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                nameDone.current = true
                setEditName(null)
              }
            }}
            onBlur={commitName}
          />
        ) : (
          <span
            className={`cat__name ${cat.isCommissioning ? 'commissioning' : ''}`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              nameDone.current = false
              setEditName(cat.name)
            }}
            title="더블클릭하여 이름 수정"
          >
            {cat.name}
          </span>
        )}
        <VisToggle
          on={!cat.hidden}
          onToggle={() => a().toggleCategoryVisible(cat.id)}
          title="이 공종을 도면에 표시 ON/OFF"
        />
        <span className="cat__count">{tasks.length}</span>
        <button
          className="icon-btn"
          title="위로"
          onClick={(e) => {
            e.stopPropagation()
            a().moveCategory(cat.id, -1)
          }}
        >
          ↑
        </button>
        <button
          className="icon-btn"
          title="아래로"
          onClick={(e) => {
            e.stopPropagation()
            a().moveCategory(cat.id, 1)
          }}
        >
          ↓
        </button>
        <button className="icon-btn icon-btn--danger" title="이 공종 삭제" onClick={removeCategory}>
          ✕
        </button>
      </div>
      {!cat.collapsed && (
        <div className="cat__tasks">
          {/* WBS 트리: 공종 > 공정 > 세부공정. 세부공정(child)은 parentId로 상위 공정에 고정돼,
              배열 순서·다른 공정 이동과 무관하게 항상 상위 공정 바로 아래에 들여쓰기로 붙는다. */}
          {renderList.map(({ task: t, child }) => (
            <Fragment key={t.id}>
              {renderTaskRow(t, tasks.indexOf(t), child)}
              {insertAt === t.id && insertMenu(t.id)}
            </Fragment>
          ))}
          {/* 예정공정표 연동 공정(표시 전용) — 같은 이름 공종 아래로 함께 표시. */}
          {mirrorRows.map((m) => (
            <MirrorRowView key={`mir-${m.id}`} row={m} />
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <button className="btn btn--sm btn--ghost" onClick={() => a().addTask(cat.id)}>
              ＋ 공정
            </button>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() =>
                a().addTask(cat.id, { name: '◆ 마일스톤', isMilestone: true, duration: 0 })
              }
            >
              ＋ 마일스톤
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
