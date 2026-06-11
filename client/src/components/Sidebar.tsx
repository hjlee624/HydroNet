// Left panel — the 공종(work-type) lanes as a collapsible tree with their
// activities. Add/reorder lanes, add activities & milestones, jump-select,
// drag activities between lanes, and toggle per-row chart visibility (ON/OFF).

import { useState } from 'react'
import type { DragEvent as RDragEvent } from 'react'
import { useEditor } from '../state/store'
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

  function onDrop(e: RDragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const id = e.dataTransfer.getData('text/hn-task')
    if (!id) return
    // Same-lane drop is a no-op (don't pollute undo / dirty / autosave).
    const t = a().project.tasks.find((x) => x.id === id)
    if (t && t.categoryId !== cat.id) a().updateTask(id, { categoryId: cat.id })
  }

  return (
    <div
      className={`cat ${dragOver ? 'cat--drop' : ''} ${cat.hidden ? 'is-hidden' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
      onDrop={onDrop}
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
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`cat__task ${t.id === selectedTaskId ? 'selected' : ''} ${t.critical ? 'crit' : ''} ${t.hidden ? 'is-hidden' : ''}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/hn-task', t.id); e.dataTransfer.effectAllowed = 'move' }}
              onClick={() => a().selectTask(t.id)}
              title="드래그해서 다른 공종으로 이동"
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
