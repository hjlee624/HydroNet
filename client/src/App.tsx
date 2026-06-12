// Application shell — the 건설사업관리 패키지 frame: a left module rail switching
// between the dashboard, the 공정관리(schedule) backbone, and the other modules.
import { ModuleRail } from './components/ModuleRail'
import { Dashboard } from './components/Dashboard'
import { ScheduleModule } from './components/ScheduleModule'
import { ProgressModule } from './components/ProgressModule'
import { ReportModule } from './components/ReportModule'
import { RecordModule } from './components/RecordModule'
import { ModulePlaceholder } from './components/ModulePlaceholder'
import { MODULE_MAP, type ModuleId } from './data/modules'
import { useShell } from './state/shell'

export default function App() {
  const module = useShell((s) => s.module)
  return (
    <div className="shell">
      <ModuleRail />
      <main className="shell__content">{renderModule(module)}</main>
    </div>
  )
}

function renderModule(module: ModuleId) {
  switch (module) {
    case 'schedule': return <ScheduleModule />
    case 'dashboard': return <Dashboard />
    case 'progress': return <ProgressModule />
    case 'report': return <ReportModule />
    default:
      // 기록형 모듈(스키마 보유)은 제네릭 표 모듈로, 그 외엔 자리표시로.
      return MODULE_MAP[module]?.fields ? <RecordModule id={module} /> : <ModulePlaceholder id={module} />
  }
}
