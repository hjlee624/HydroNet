// Dev-only: mount the FULL React app in jsdom to catch runtime render errors
// (e.g. unstable zustand selectors → infinite loop → blank screen) that the
// type-check / bundle build cannot detect. Run: npx tsx scripts/mount-test.ts
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5273/',
  pretendToBeVisual: true,
})
const w = dom.window as unknown as Window & typeof globalThis
const g = globalThis as Record<string, unknown>
g.window = w
g.document = w.document
g.localStorage = w.localStorage
g.sessionStorage = w.sessionStorage
// 기본 진입은 총괄 대시보드지만, 이 테스트는 편집기(차트/사이드바) 렌더도 검증하므로
// 편집기 뷰를 시드한다. 이후 총괄 대시보드 뷰는 아래에서 토글해 별도 검증.
w.localStorage.setItem('sequence:project-view', 'schedule')
// 마일스톤 편집기 단일 루트. AuthGate는 서버 미탐지 시 '로컬 모드'로 우회하므로,
// 아래 fetch 스텁이 /api/health 를 실패로 응답해 로그인 게이트 없이 편집기가 바로 렌더된다.
g.HTMLElement = w.HTMLElement
g.Element = w.Element
g.Node = w.Node
g.getComputedStyle = w.getComputedStyle
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)
g.fetch = async (url: unknown) =>
  (String(url).includes('/api/health')
    ? { ok: false, status: 0, json: async () => null }
    : { ok: true, status: 200, json: async () => [], text: async () => '' }) as unknown as Response

const errors: string[] = []
const origError = console.error
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '))
}

async function main() {
  const { createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await import('../src/App')

  const root = createRoot(document.getElementById('root')!)
  root.render(createElement(App))
  await new Promise((r) => setTimeout(r, 400))

  console.error = origError
  const html = document.getElementById('root')!.innerHTML
  const loopErr = errors.find((e) =>
    /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
  )

  let fail = 0
  const check = (cond: boolean, label: string) => {
    if (!cond) {
      fail++
      console.log('  ✗ ' + label)
    } else console.log('  ✓ ' + label)
  }

  console.log(`#root innerHTML length = ${html.length}`)
  check(html.length > 1000, '#root 가 비어있지 않게 렌더됨 (블랙화면 아님)')
  check(html.includes('Seq') && html.includes('도면 출력'), '브랜드/상단바 렌더 확인')
  check(html.includes('<svg'), '차트 SVG 렌더 확인')
  check(html.includes('공종'), '사이드바(공종) 렌더 확인')
  check(html.includes('공정관리') && html.includes('리스크·이슈'), '모듈 레일 렌더 확인')
  check(!loopErr, '무한 렌더 루프 경고 없음')

  // 총괄 대시보드 뷰 토글 후 렌더 검증(새 화면의 런타임 렌더 오류·무한루프 방지).
  const dashErrors: string[] = []
  console.error = (...a: unknown[]) => {
    dashErrors.push(a.map(String).join(' '))
  }
  const { useView } = await import('../src/state/viewStore')
  useView.getState().setView('dashboard')
  await new Promise((r) => setTimeout(r, 300))
  console.error = origError
  const dashHtml = document.getElementById('root')!.innerHTML
  const dashLoop = dashErrors.find((e) =>
    /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
  )
  check(dashHtml.includes('프로젝트 총괄'), '총괄 대시보드 렌더 확인')
  check(!dashLoop, '총괄 대시보드 무한 렌더 루프 없음')

  // 기록형 모듈(프로젝트 예산) 토글 렌더 검증.
  const recErrors: string[] = []
  console.error = (...a: unknown[]) => {
    recErrors.push(a.map(String).join(' '))
  }
  useView.getState().setView('cost')
  await new Promise((r) => setTimeout(r, 250))
  console.error = origError
  const recHtml = document.getElementById('root')!.innerHTML
  const recLoop = recErrors.find((e) =>
    /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
  )
  check(recHtml.includes('프로젝트 예산'), '기록 모듈(프로젝트 예산) 렌더 확인')
  check(!recLoop, '기록 모듈 무한 렌더 루프 없음')

  if (errors.length) {
    console.log(`\n(console.error ${errors.length}건):`)
    errors.slice(0, 6).forEach((e) => console.log('   • ' + e.slice(0, 160)))
  }
  console.log(`\n${fail === 0 ? '✅ MOUNT OK' : `❌ ${fail} FAIL`}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error = origError
  console.log('THREW:', e?.message || e)
  process.exit(1)
})
