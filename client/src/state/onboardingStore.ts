// 첫 진입 온보딩(F06) — 의도 선택 + '첫 공정표 완성' 5단계 안내.
//
// 설계 원칙 두 가지:
//  1) 단계는 **실제 상태 변화**로만 완료된다. '다음' 버튼으로 넘길 수 있는 안내는 안내가 아니라
//     연극이므로, 아래 installGuideWatchers() 가 편집기/영속 스토어를 구독해 자동으로 체크한다.
//  2) uiMode 는 여기에 **저장하지 않는다**. store.ts 는 2026-06-22 회귀('간편 모드에 갇힘')를
//     막으려고 초기값을 'pro' 로 고정해 두었다 — 그 결정을 되돌리지 않고, 간편 모드는 이번
//     세션에만 적용한다(가이드 패널에 항상 '전문가 모드' 탈출구를 둔다).
//
// 영속 대상은 { seen, intent, steps } 뿐이며 사용자별 localStorage 키를 쓴다(viewStore.ts 패턴).

import { create } from 'zustand'
import { usePersistence } from './persistence'
import { useEditor } from './store'

/** 첫 실행 의도 — 무엇부터 하려는지. 이 선택이 초기 모드·화면을 정한다. */
export type UserIntent = 'create' | 'edit' | 'review'

/** '첫 공정표 완성' 5단계. 순서는 GUIDE_STEPS 를 따른다. */
export type GuideStep = 'sample' | 'edit' | 'link' | 'save' | 'export'

export const GUIDE_STEPS: { id: GuideStep; label: string; hint: string }[] = [
  {
    id: 'sample',
    label: '샘플(템플릿) 선택',
    hint: '시설물 유형을 고르면 표준 공정표가 깔립니다.',
  },
  { id: 'edit', label: '공정 하나 수정', hint: '막대를 끌거나 기간·이름을 바꿔 보세요.' },
  {
    id: 'link',
    label: '공정 연결',
    hint: '앞 공정에서 뒤 공정으로 화살표를 이으면 일정이 따라옵니다.',
  },
  { id: 'save', label: '저장 확인', hint: '저장이 실제로 끝났는지 확인합니다.' },
  { id: 'export', label: 'PDF 출력', hint: '보고용 PDF로 내보내면 첫 공정표가 완성됩니다.' },
]

const EMPTY_STEPS: Record<GuideStep, boolean> = {
  sample: false,
  edit: false,
  link: false,
  save: false,
  export: false,
}

const keyFor = (uid: string) => `sequence:onboarding:${uid || 'local'}`

interface Persisted {
  seen: boolean
  intent: UserIntent | null
  steps: Record<GuideStep, boolean>
}

function load(uid: string): Persisted {
  try {
    const raw = localStorage.getItem(keyFor(uid))
    if (!raw) return { seen: false, intent: null, steps: { ...EMPTY_STEPS } }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      seen: !!parsed.seen,
      intent: parsed.intent ?? null,
      steps: { ...EMPTY_STEPS, ...(parsed.steps ?? {}) },
    }
  } catch {
    // 저장소 차단(사생활 보호 모드) · 손상된 JSON — 첫 실행처럼 시작한다.
    return { seen: false, intent: null, steps: { ...EMPTY_STEPS } }
  }
}

function save(uid: string, data: Persisted): void {
  try {
    localStorage.setItem(keyFor(uid), JSON.stringify(data))
  } catch {
    /* 비브라우저/프라이빗 모드 — 이번 세션에만 적용된다 */
  }
}

interface OnboardingState {
  /** 이 상태가 어느 사용자 것인가(로그인 전·로컬 단독은 'local'). */
  uid: string
  intent: UserIntent | null
  /** 첫 실행 안내를 이미 봤는가 — true 면 FirstRunDialog 를 띄우지 않는다. */
  seen: boolean
  steps: Record<GuideStep, boolean>
  guideOpen: boolean
  initForUser: (uid: string) => void
  setIntent: (intent: UserIntent) => void
  /** 실제 상태 변화가 확인됐을 때만 호출한다(사용자의 '다음' 클릭으로 호출하지 말 것). */
  markStep: (step: GuideStep) => void
  openGuide: () => void
  closeGuide: () => void
  /** 첫 실행 안내를 닫고 다시 띄우지 않는다(가이드 패널도 닫는다). */
  dismiss: () => void
  /** 5단계를 처음부터 다시 — 체크만 지우고 seen 은 유지한다. */
  resetGuide: () => void
}

export const useOnboarding = create<OnboardingState>()((set, get) => ({
  uid: 'local',
  ...load('local'),
  guideOpen: false,

  initForUser: (uid) => {
    const next = uid || 'local'
    if (get().uid === next) return
    set({ uid: next, ...load(next), guideOpen: false })
  },

  setIntent: (intent) => {
    const { uid, steps } = get()
    save(uid, { seen: true, intent, steps })
    set({ intent, seen: true, guideOpen: true })
  },

  markStep: (step) => {
    const { uid, steps, intent, seen } = get()
    if (steps[step]) return // 이미 완료 — 불필요한 렌더/쓰기 방지
    const next = { ...steps, [step]: true }
    save(uid, { seen, intent, steps: next })
    set({ steps: next })
  },

  openGuide: () => set({ guideOpen: true }),
  closeGuide: () => set({ guideOpen: false }),

  dismiss: () => {
    const { uid, intent, steps } = get()
    save(uid, { seen: true, intent, steps })
    set({ seen: true, guideOpen: false })
  },

  resetGuide: () => {
    const { uid, intent } = get()
    const steps = { ...EMPTY_STEPS }
    save(uid, { seen: true, intent, steps })
    set({ steps, guideOpen: true })
  },
}))

/**
 * 5단계 자동 체크 — 편집기·영속 스토어의 **실제 변화**만 근거로 삼는다.
 * 반환값은 해제 함수. 호출부(GuidePanel)는 언마운트 시 반드시 호출한다.
 *
 * 근거로 삼는 사실:
 *   · edit   … 공정 개수·id 구성은 그대로인데 어떤 공정의 이름/시작/기간이 바뀜(= 진짜 수정)
 *   · link   … 연결(links) 개수가 늘어남
 *   · save   … 파일 백업 시각이 찍힘(.json 실제 기록) 또는 서버 영속 확정이 새로 도착함
 *   · export … 실제로 .pdf 다운로드 앵커가 문서에 삽입됨(exporter.ts triggerDownload)
 *   · sample … 여기서는 감지하지 않는다. 템플릿 적용 지점(TemplateDialog)에서 직접 표시한다.
 */
export function installGuideWatchers(): () => void {
  const mark = (s: GuideStep) => useOnboarding.getState().markStep(s)

  const unEditor = useEditor.subscribe((s, prev) => {
    if (s.project === prev.project) return
    const a = prev.project.tasks
    const b = s.project.tasks
    if (a !== b && a.length === b.length && a.length > 0) {
      // 같은 공정 집합에서 값만 달라졌을 때만 '수정'으로 본다. 문서 교체(하이드레이션·템플릿
      // 적용)는 id 구성이 달라지므로 여기 걸리지 않는다.
      let sameIds = true
      let changed = false
      for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id) {
          sameIds = false
          break
        }
        if (a[i].name !== b[i].name || a[i].start !== b[i].start || a[i].duration !== b[i].duration)
          changed = true
      }
      if (sameIds && changed) mark('edit')
    }
    if (s.project.links.length > prev.project.links.length) mark('link')
  })

  const unPersist = usePersistence.subscribe((s, prev) => {
    // 파일(.json) 백업은 backupProjectToFile 이 '실제로 파일이 써졌을 때만' 찍는다.
    if (s.fileBackupAt !== prev.fileBackupAt && s.fileBackupAt != null) mark('save')
    // 협업 방: 서버가 문서를 기록했다고 확정한 순간(미전송 변경 0). 내 편집이 있었을 때만.
    if (
      s.serverConfirmedAt !== prev.serverConfirmedAt &&
      s.serverConfirmedAt != null &&
      s.lastLocalChangeAt != null &&
      !s.pending
    )
      mark('save')
  })

  // PDF 출력은 ExportDialog 가 아니라 '실제로 파일이 내려갔다'는 사실로 판정한다 —
  // export/exporter.ts 의 triggerDownload 가 document.body 에 <a download="…pdf"> 를 붙인다.
  let observer: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of Array.from(rec.addedNodes)) {
          const el = node as Partial<HTMLAnchorElement> & { tagName?: string }
          if (el?.tagName === 'A' && /\.pdf$/i.test(String(el.download ?? ''))) {
            mark('export')
            return
          }
        }
      }
    })
    observer.observe(document.body, { childList: true })
  }

  return () => {
    unEditor()
    unPersist()
    observer?.disconnect()
  }
}
