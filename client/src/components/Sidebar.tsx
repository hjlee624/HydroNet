// Left panel — the 공종(work-type) lanes as a collapsible tree with their
// activities. Add/reorder lanes, add activities & milestones, jump-select.

import { useEditor } from '../state/store'
import type { Category } from '../types/model'

export function Sidebar({ width }: { width: number }) {
  const project = useEditor((s) => s.project)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const a = useEditor.getState

  const categories = [...project.categories]
    .filter((c) => project.commissioningEnabled || !c.isCommissioning)
    .sort((x, y) => x.order - y.order)

  return (
    <aside className="panel panel--left" style={{ width }}>
      <div className="panel__header">
        <span className="panel__title">공종 구성</span>
        <button className="btn btn--sm" onClick={() => a().addCategory()}>＋ 공종</button>
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
  const tasks = allTasks.filter((t) => t.categoryId === cat.id)
  const a = useEditor.getState

  return (
    <div className="cat">
      <div className="cat__row" onClick={() => a().selectCategory(cat.id)}>
        <button className="icon-btn" title={cat.collapsed ? '펼치기' : '접기'} onClick={(e) => { e.stopPropagation(); a().toggleCollapse(cat.id) }}>
          {cat.collapsed ? '▸' : '▾'}
        </button>
        <span className="cat__swatch" style={{ background: cat.color }} />
        <span className={`cat__name ${cat.isCommissioning ? 'commissioning' : ''}`}>{cat.name}</span>
        <span className="cat__count">{tasks.length}</span>
        <button className="icon-btn" title="위로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, -1) }}>↑</button>
        <button className="icon-btn" title="아래로" onClick={(e) => { e.stopPropagation(); a().moveCategory(cat.id, 1) }}>↓</button>
      </div>
      {!cat.collapsed && (
        <div className="cat__tasks">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`cat__task ${t.id === selectedTaskId ? 'selected' : ''} ${t.critical ? 'crit' : ''}`}
              onClick={() => a().selectTask(t.id)}
            >
              <span>{t.isMilestone ? '◆' : '▬'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name.replace(/^◆\s*/, '')}
              </span>
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
