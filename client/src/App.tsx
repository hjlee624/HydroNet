import { useEffect } from 'react'
import { AuthGate } from './components/auth/AuthGate'
import { CollaborationBridge } from './components/CollaborationBridge'
import { DashboardModule } from './components/DashboardModule'
import { HistoryModule } from './components/HistoryModule'
import { ModulePlaceholder } from './components/ModulePlaceholder'
import { ModuleRail } from './components/ModuleRail'
import { FirstRunDialog } from './components/onboarding/FirstRunDialog'
import { GuidePanel } from './components/onboarding/GuidePanel'
import { ProgressModule } from './components/ProgressModule'
import { RecordModule } from './components/RecordModule'
import { ReportModule } from './components/ReportModule'
import { ScheduleModule } from './components/ScheduleModule'
import { MODULE_MAP } from './data/modules'
import { useAuth } from './state/authStore'
import { useOnboarding } from './state/onboardingStore'
import { useProjectPrefs } from './state/projectPrefsStore'
import { useEditor } from './state/store'
import { type ProjectView, useView } from './state/viewStore'

// 활성 모듈에 따라 콘텐츠 렌더. 대시보드·공정표·진척·변경이력·보고서는 전용, fields 있는 기록형
// 모듈은 RecordModule, 그 외는 ModulePlaceholder.
function renderModule(view: ProjectView) {
  if (view === 'dashboard') return <DashboardModule />
  if (view === 'schedule') return <ScheduleModule />
  if (view === 'progress') return <ProgressModule />
  if (view === 'history') return <HistoryModule />
  if (view === 'report') return <ReportModule />
  return MODULE_MAP[view]?.fields ? <RecordModule id={view} /> : <ModulePlaceholder id={view} />
}

/**
 * 변경 이력(F13)의 작성자를 store 에 주입한다. store 가 authStore 를 직접 import 하면 순환이라
 * 로그인 상태를 아는 이 자리에서 넘긴다. 로그인 전/로컬 단독 모드는 store 기본값('나')을 쓴다.
 */
function ChangeActorBridge() {
  const user = useAuth((s) => s.user)
  useEffect(() => {
    if (!user) return
    useEditor.getState().setChangeActor({ id: user.id, name: user.name })
  }, [user])
  return null
}

/**
 * 온보딩(F06)·개인 목록 설정(F08)의 사용자 스코프를 맞춘다. 로그인 전/로컬 단독 모드는 'local'
 * 키를 쓰고, 로그인하면 그 사용자 키로 갈아탄다(첫 실행 여부·최근·즐겨찾기가 계정별로 분리).
 */
function OnboardingBridge() {
  const uid = useAuth((s) => s.user?.id)
  useEffect(() => {
    useOnboarding.getState().initForUser(uid ?? 'local')
    useProjectPrefs.getState().initForUser(uid ?? 'local')
  }, [uid])
  return null
}

export default function App() {
  // 좌측 모듈 레일 + 활성 모듈. 프로젝트 데이터는 CollaborationBridge가 하이드레이트하므로
  // ScheduleModule 마운트 여부와 무관하게 모든 뷰가 실데이터를 본다.
  const view = useView((s) => s.view)
  // 첫 실행 안내(의도 선택) → 5단계 가이드. 둘 다 편집기 위에 겹쳐 뜬다.
  const firstRun = useOnboarding((s) => !s.seen)
  const guideOpen = useOnboarding((s) => s.guideOpen)
  return (
    <AuthGate>
      <CollaborationBridge />
      <ChangeActorBridge />
      <OnboardingBridge />
      <div className="shell">
        <ModuleRail />
        <main className="shell__content">{renderModule(view)}</main>
      </div>
      {firstRun && <FirstRunDialog />}
      {guideOpen && <GuidePanel />}
    </AuthGate>
  )
}
