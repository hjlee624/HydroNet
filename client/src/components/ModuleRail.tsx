// Left module rail — switches between the package modules (categories). Collapses
// to icons; hides entirely during the schedule's fullscreen preview.
import { useEffect, useState } from 'react'
import { MODULES, GROUPS } from '../data/modules'
import { useShell } from '../state/shell'

export function ModuleRail() {
  const module = useShell((s) => s.module)
  const railOpen = useShell((s) => s.railOpen)
  const a = useShell.getState
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  if (fullscreen) return null

  return (
    <nav className={`rail ${railOpen ? '' : 'rail--mini'}`}>
      <div className="rail__brand">
        {railOpen ? (
          <span className="rail__mark">
            Hydro<em>Net</em>
          </span>
        ) : (
          <span className="rail__mark rail__mark--mini">
            H<em>N</em>
          </span>
        )}
        <button
          className="rail__toggle"
          title={railOpen ? '레일 접기' : '레일 펴기'}
          onClick={() => a().toggleRail()}
        >
          {railOpen ? '«' : '»'}
        </button>
      </div>
      <div className="rail__scroll">
        {GROUPS.map((g) => {
          const items = MODULES.filter((m) => m.group === g)
          if (!items.length) return null
          return (
            <div className="rail__group" key={g}>
              {railOpen && <div className="rail__ghead">{g}</div>}
              {items.map((m) => (
                <button
                  key={m.id}
                  className={`rail__item ${module === m.id ? 'active' : ''}`}
                  title={`${m.label} — ${m.blurb}`}
                  onClick={() => a().setModule(m.id)}
                >
                  <span className="rail__icon">{m.icon}</span>
                  {railOpen && <span className="rail__label">{m.label}</span>}
                  {railOpen && m.status === 'soon' && <span className="rail__soon">예정</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
