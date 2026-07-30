// HydroNet = 마일스톤(공정) 편집 전용 앱. 예전의 건설사업관리 패키지 셸(ModuleRail +
// 대시보드·기록형 모듈들)은 SYNC-BUILD로 이관·제거됨 → 이제 마일스톤 편집기 단일 루트.
import { ScheduleModule } from './components/ScheduleModule'

export default function App() {
  return (
    <div className="shell">
      <main className="shell__content">
        <ScheduleModule />
      </main>
    </div>
  )
}
