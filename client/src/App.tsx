// Sequence = 마일스톤(공정) 편집 전용 앱. 서버가 있으면 로그인→프로젝트 선택→접속코드
// 게이트(AuthGate), 오프라인 단일 HTML/서버 없음이면 곧장 편집기(로컬 모드). ADR-002.

import { AuthGate } from './components/auth/AuthGate'
import { CollaborationBridge } from './components/CollaborationBridge'
import { ScheduleModule } from './components/ScheduleModule'
import { useEditor } from './state/store'

/** 조회 전용(편집 권한 없음) 입장 시 상단 배너. 편집은 담당자/개발자만 가능. */
function ReadOnlyBanner() {
  const readOnly = useEditor((s) => s.readOnly)
  if (!readOnly) return null
  return (
    <div className="readonly-banner" role="status">
      🔒 조회 전용 — 이 프로젝트는 열람만 가능합니다. 편집은 담당자(배정 멤버)·개발자만 할 수
      있습니다.
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <CollaborationBridge />
      <div className="shell">
        <ReadOnlyBanner />
        <main className="shell__content">
          <ScheduleModule />
        </main>
      </div>
    </AuthGate>
  )
}
