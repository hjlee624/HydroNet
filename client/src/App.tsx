// Application shell — the 건설사업관리 패키지 frame: a left module rail switching
// between the dashboard, the 공정관리(schedule) backbone, and the other modules.
import { ModuleRail } from './components/ModuleRail'
import { Dashboard } from './components/Dashboard'
import { ScheduleModule } from './components/ScheduleModule'
import { ModulePlaceholder } from './components/ModulePlaceholder'
import { useShell } from './state/shell'

export default function App() {
  const module = useShell((s) => s.module)
  return (
    <div className="shell">
      <ModuleRail />
      <main className="shell__content">
        {module === 'schedule' ? <ScheduleModule />
          : module === 'dashboard' ? <Dashboard />
            : <ModulePlaceholder id={module} />}
      </main>
    </div>
  )
}
