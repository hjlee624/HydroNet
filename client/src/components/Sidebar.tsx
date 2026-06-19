// Left panel — the 공종(work-type) lanes as a collapsible tree with their
// activities. Add/reorder/delete lanes, add activities & milestones, jump-select,
// drag activities between lanes, drag lanes to re-order, double-click to rename,
// and toggle per-row chart visibility (ON/OFF).

import { useRef, useState } from 'react'
import type { DragEvent as RDragEvent, MouseEvent as RMouseEvent } from 'react'
import { useEditor, filterActive } from '../state/store'
import type { Category } from '../types/model'

/** Small ON/OFF switch controlling whether a lane/activity shows in the chart. */
function VisToggle({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      className={`sw ${on ? 'on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
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

  return (
    <aside className="panel panel--left" style={{ width }}>
      <div className="panel__header">
        <span className="panel__title">공종 구성</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--steel)' }}>
            <span>전체</span>
            <VisToggle on={allOn} onToggle={() => a().setAllVisible(!allOn)} title="전체 표시 ON/OFF" />
          </span>
          <button className="btn btn--sm" onClick={() => a().addCategory()}>＋ 공종</button>
        </div>
      </div>
      <div className="panel__scroll">
        {categories.map((cat, i) => (
          <CategoryNode
            key={cat.id}
            cat={cat}
            nextId={categories[i + 1]?.id ?? null}
            orderedIds={orderedIds}
            selectedTaskId={selectedTaskId}
          />
        ))}
        {categories.length === 0 && (
          <div className="empty-hint">공종이 없습니다.<br />상단 ＋공종 으로 추가하세요.</div>
        )}
      </div>
    </aside>
  )
}

function CategoryNode({ cat, nextId, orderedIds, selectedTaskId }: { cat: Category; nextId: string | null; orderedIds: string[]; selectedTaskId: string | null }) {
  // Select the stable array ref and filter in the body — returning a fresh
  // `.filter()` array straight from the selector makes zustand v5's snapshot
  // unstable (useSyncExternalStore → infinite re-render → blank screen).
  const allTasks = useEditor((s) => s.project.tasks)
  const filter = useEditor((s) => s.filter)
  const selectedCatIds = useEditor((s) => s.selectedCategoryIds)
  const catAnchor = useEditor((s) => s.selectedCategoryId)
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
    if (catId) { // a 공종 was dropped onto/around this lane → re-order lanes
      e.preventDefault()
      const pos = catDrop ?? 'before'
      setCatDrop(null); setDragOver(false); setDropAt(null)
      if (!filtered && catId !== cat.id) a().reorderCategory(catId, pos === 'before' ? cat.id : nextId)
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
    if (id) a().reorderTask(id, cat.id, null) // dropped on the lane body → end of lane
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
    setDropAt(null); setDragOver(false)
    if (filtered) return
    // Insert before this row (top half) or before the next row (bottom half).
    const pos = target?.taskId === tasks[idx].id ? target.pos : 'before'
    const beforeId = pos === 'before' ? tasks[idx].id : (tasks[idx + 1]?.id ?? null)
    a().reorderTask(id, cat.id, beforeId)
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
      if (set.has(cat.id)) set.delete(cat.id); else set.add(cat.id)
      a().selectCategories(orderedIds.filter((x) => set.has(x)), cat.id)
    } else {
      a().selectCategory(cat.id)
    }
  }
  function removeCategory(e: RMouseEvent) {
    e.stopPropagation()
    const n = allTasks.filter((t) => t.categoryId === cat.id).length
    const msg = `‘${cat.name}’ 공종을 삭제할까요?` + (n > 0 ? `\n포함된 공정 ${n}개도 함께 삭제됩니다.` : '')
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(msg)) return
    a().deleteCategory(cat.id)
  }

  return (
    <div
      className={`cat ${dragOver ? 'cat--drop' : ''} ${cat.hidden ? 'is-hidden' : ''} ${catDrop === 'before' ? 'cat-drop-before' : ''} ${catDrop === 'after' ? 'cat-drop-after' : ''}`}
      onDragOver={onContainerDragOver}
      onDragEnter={(e) => { if (hasType(e, 'text/hn-task')) setDragOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOver(false); setDropAt(null); setCatDrop(null) } }}
      onDrop={onContainerDrop}
    >
      <div
        className={`cat__row ${catSelected ? 'selected' : ''}`}
        draggable={editName === null && !filtered}
        onDragStart={(e) => { e.dataTransfer.setData('text/hn-cat', cat.id); e.dataTransfer.effectAllowed = 'move' }}
        onClick={onRowClick}
        title={filtered ? '필터를 해제하면 드래그로 공종 순서를 바꿀 수 있습니다' : '클릭 선택 · Ctrl=다중 · Shift=범위 · Ctrl+C/V 복사·붙여넣기 · 드래그=순서 · 더블클릭=이름 수정'}
      >
        <button className="icon-btn" title={cat.collapsed ? '펼치기' : '접기'} onClick={(e) => { e.stopPropagation(); a().toggleCollapse(cat.id) }}>
          {cat.collapsed ? '▸' : '▾'}
        </button>
        <span className="cat__swatch" style={{ background: cat.color }} />
        {editName !== null ? (
          <input
            className="cat__edit"
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitName() }
              else if (e.key === 'Escape') { e.preventDefault(); nameDone.current = true; setEditName(null) }
            }}
            onBlur={commitName}
          />
        ) : (
          <span
            className={`cat__name ${cat.isCommissioning ? 'commissioning' : ''}`}
            onDoubleClick={(e) => { e.stopPropagation(); nameDone.current = false; setEditName(cat.name) }}
            title="더블클릭하여 이름 수정"
          >
            {cat.name}
          </span>
        )}
        <VisToggle on={!cat.hidden} onToggle={() => a().toggleCategoryVisible(cat.id)} title="이 공종을 도면에 표시 ON/OFF" />
        <span className="cat__count">{tasks.length}</span>
        <button className="icon-btn" title="위로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, -1) }}>↑</button>
        <button className="icon-btn" title="아래로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, 1) }}>↓</button>
        <button className="icon-btn icon-btn--danger" title="이 공종 삭제" onClick={removeCategory}>✕</button>
      </div>
      {!cat.collapsed && (
        <div className="cat__tasks">
          {tasks.map((t, idx) => (
            <div
              key={t.id}
              className={`cat__task ${t.id === selectedTaskId ? 'selected' : ''} ${t.critical ? 'crit' : ''} ${t.hidden ? 'is-hidden' : ''} ${dropAt?.taskId === t.id ? (dropAt.pos === 'before' ? 'drop-before' : 'drop-after') : ''}`}
              draggable={!filtered && editTask?.id !== t.id}
              onDragStart={(e) => { e.dataTransfer.setData('text/hn-task', t.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => onTaskDragOver(e, t.id)}
              onDrop={(e) => onTaskDrop(e, idx)}
              onClick={() => a().selectTask(t.id)}
              title={filtered ? '필터를 해제하면 드래그로 순서를 변경할 수 있습니다' : '드래그: 순서 변경/다른 공종 이동 · 더블클릭: 이름 수정'}
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
                    if (e.key === 'Enter') { e.preventDefault(); commitTask() }
                    else if (e.key === 'Escape') { e.preventDefault(); taskDone.current = true; setEditTask(null) }
                  }}
                  onBlur={commitTask}
                />
              ) : (
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                  onDoubleClick={(e) => { e.stopPropagation(); taskDone.current = false; setEditTask({ id: t.id, text: t.name.replace(/^◆\s*/, '') }) }}
                >
                  {t.name.replace(/^◆\s*/, '')}
                </span>
              )}
              <VisToggle on={!t.hidden} onToggle={() => a().toggleTaskVisible(t.id)} title="이 공정을 도면에 표시 ON/OFF" />
              <span className="dur">{t.isMilestone ? 'MS' : `${t.duration}일`}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="btn btn--sm btn--ghost" onClick={() => a().addTask(cat.id)}>＋ 공정</button>
            <button className="btn btn--sm btn--ghost" onClick={() => a().addTask(cat.id, { name: '◆ 마일스톤', isMilestone: true, duration: 0 })}>＋ 마일스톤</button>
          </div>
        </div>
      )}
    </div>
  )
}
