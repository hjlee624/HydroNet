import { AuthGate } from './components/auth/AuthGate'
import { CollaborationBridge } from './components/CollaborationBridge'
import { DashboardModule } from './components/DashboardModule'
import { ModulePlaceholder } from './components/ModulePlaceholder'
import { ModuleRail } from './components/ModuleRail'
import { ProgressModule } from './components/ProgressModule'
import { RecordModule } from './components/RecordModule'
import { ScheduleModule } from './components/ScheduleModule'
import { MODULE_MAP } from './data/modules'
import { type ProjectView, useView } from './state/viewStore'

// 활성 모듈에 따라 콘텐츠 렌더. 대시보드·공정표·진척은 전용, fields 있는 기록형 모듈은 RecordModule,
// 그 외(보고서)는 ModulePlaceholder(다음 단계 제공).
function renderModule(view: ProjectView) {
  if (view === 'dashboard') return <DashboardModule />
  if (view === 'schedule') return <ScheduleModule />
  if (view === 'progress') return <ProgressModule />
  return MODULE_MAP[view]?.fields ? <RecordModule id={view} /> : <ModulePlaceholder id={view} />
}

export default function App() {
  // 좌측 모듈 레일 + 활성 모듈. 프로젝트 데이터는 CollaborationBridge가 하이드레이트하므로
  // ScheduleModule 마운트 여부와 무관하게 모든 뷰가 실데이터를 본다.
  const view = useView((s) => s.view)
  return (
    <AuthGate>
      <CollaborationBridge />
      <div className="shell">
        <ModuleRail />
        <main className="shell__content">{renderModule(view)}</main>
      </div>
    </AuthGate>
  )
}
