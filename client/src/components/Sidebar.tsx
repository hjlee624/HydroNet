// Left panel — the 공종(work-type) lanes as a collapsible tree with their
// activities. Add/reorder lanes, add activities & milestones, jump-select,
// drag activities between lanes, and toggle per-row chart visibility (ON/OFF).

import { useState } from 'react'
import type { DragEvent as RDragEvent } from 'react'
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
        {categories.map((cat) => (
          <CategoryNode key={cat.id} cat={cat} selectedTaskId={selectedTaskId} />
        ))}
        {categories.length === 0 && (
          <div className="empty-hint">공종이 없습니다.<br />상단 ＋공종 으로 추가하세요.</div>
        )}
      </div>
    </aside>
  )
}

function CategoryNode({ cat, selectedTaskId }: { cat: Category; selectedTaskId: string | null }) {
  // Select the stable array ref and filter in the body — returning a fresh
  // `.filter()` array straight from the selector makes zustand v5's snapshot
  // unstable (useSyncExternalStore → infinite re-render → blank screen).
  const allTasks = useEditor((s) => s.project.tasks)
  const filter = useEditor((s) => s.filter)
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
  // While a filter is active the lane list is a SUBSET, so an insertion position
  // computed from it is ambiguous against the full array (where do the hidden
  // neighbours go?). Disable drag-reorder while filtered, exactly as the chart
  // does — clear the filter to rearrange.
  const filtered = filterActive(filter)

  function onCatDrop(e: RDragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    setDropAt(null)
    if (filtered) return
    const id = e.dataTransfer.getData('text/hn-task')
    if (id) a().reorderTask(id, cat.id, null) // dropped on the lane body → end of lane
  }

  function onTaskDragOver(e: RDragEvent<HTMLDivElement>, taskId: string) {
    if (filtered) return
    e.preventDefault()
    e.stopPropagation() // show a precise insertion line, not the whole-lane highlight
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    setDropAt((prev) => (prev?.taskId === taskId && prev.pos === pos ? prev : { taskId, pos }))
  }

  function onTaskDrop(e: RDragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData('text/hn-task')
    const target = dropAt
    setDropAt(null); setDragOver(false)
    if (filtered || !id) return
    // Insert before this row (top half) or before the next row (bottom half).
    const pos = target?.taskId === tasks[idx].id ? target.pos : 'before'
    const beforeId = pos === 'before' ? tasks[idx].id : (tasks[idx + 1]?.id ?? null)
    a().reorderTask(id, cat.id, beforeId)
  }

  return (
    <div
      className={`cat ${dragOver ? 'cat--drop' : ''} ${cat.hidden ? 'is-hidden' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOver(false); setDropAt(null) } }}
      onDrop={onCatDrop}
    >
      <div className="cat__row" onClick={() => a().selectCategory(cat.id)}>
        <button className="icon-btn" title={cat.collapsed ? '펼치기' : '접기'} onClick={(e) => { e.stopPropagation(); a().toggleCollapse(cat.id) }}>
          {cat.collapsed ? '▸' : '▾'}
        </button>
        <span className="cat__swatch" style={{ background: cat.color }} />
        <span className={`cat__name ${cat.isCommissioning ? 'commissioning' : ''}`}>{cat.name}</span>
        <VisToggle on={!cat.hidden} onToggle={() => a().toggleCategoryVisible(cat.id)} title="이 공종을 도면에 표시 ON/OFF" />
        <span className="cat__count">{tasks.length}</span>
        <button className="icon-btn" title="위로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, -1) }}>↑</button>
        <button className="icon-btn" title="아래로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, 1) }}>↓</button>
      </div>
      {!cat.collapsed && (
        <div className="cat__tasks">
          {tasks.map((t, idx) => (
            <div
              key={t.id}
              className={`cat__task ${t.id === selectedTaskId ? 'selected' : ''} ${t.critical ? 'crit' : ''} ${t.hidden ? 'is-hidden' : ''} ${dropAt?.taskId === t.id ? (dropAt.pos === 'before' ? 'drop-before' : 'drop-after') : ''}`}
              draggable={!filtered}
              onDragStart={(e) => { e.dataTransfer.setData('text/hn-task', t.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => onTaskDragOver(e, t.id)}
              onDrop={(e) => onTaskDrop(e, idx)}
              onClick={() => a().selectTask(t.id)}
              title={filtered ? '필터를 해제하면 드래그로 순서를 변경할 수 있습니다' : '드래그: 같은 공종 안 순서 변경 · 다른 공종으로 이동'}
            >
              <span>{t.isMilestone ? '◆' : '▬'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {t.name.replace(/^◆\s*/, '')}
              </span>
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
