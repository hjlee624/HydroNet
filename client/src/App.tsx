// HydroNet = 마일스톤(공정) 편집 전용 앱. 서버가 있으면 로그인→프로젝트 선택→접속코드
// 게이트(AuthGate), 오프라인 단일 HTML/서버 없음이면 곧장 편집기(로컬 모드). ADR-002.

import { AuthGate } from './components/auth/AuthGate'
import { CollaborationBridge } from './components/CollaborationBridge'
import { ScheduleModule } from './components/ScheduleModule'

export default function App() {
  return (
    <AuthGate>
      <CollaborationBridge />
      <div className="shell">
        <main className="shell__content">
          <ScheduleModule />
        </main>
      </div>
    </AuthGate>
  )
}
