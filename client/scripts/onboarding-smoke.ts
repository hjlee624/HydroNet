// F06/F08 클라이언트 스모크 — 실행: npx tsx scripts/onboarding-smoke.ts
//
// 여기서 못박는 세 가지:
//  1) F08 완료 기준 "검색과 필터에 권한 범위가 동일하게 적용됨" — filterProjects 의 출력은
//     **언제나 입력 배열의 부분집합**이다. 즐겨찾기·최근에 남아 있는 옛 id 로도, 어떤 검색어로도
//     필터되지 않은 목록이 감추던 프로젝트가 드러나지 않는다.
//  2) F06 의 5단계 라벨/스텝 정의가 하나로 유지되는지(안내 문구와 상태 키의 동기).
//  3) F06 의 단계 체크가 **실제 편집**에서만 일어나는지 — 진짜 편집기 스토어를 돌려
//     공정 수정·연결 추가로만 체크가 켜지고, 아무 일도 안 하면 켜지지 않음을 확인한다.

import { JSDOM } from 'jsdom'

// 편집기 스토어(store.ts)는 브라우저 전역을 쓴다 — import 보다 먼저 세운다(mount-test 와 같은 결).
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5273/',
})
const w = dom.window as unknown as Window & typeof globalThis
const g = globalThis as Record<string, unknown>
g.window = w
g.document = w.document
g.localStorage = w.localStorage
g.sessionStorage = w.sessionStorage
g.HTMLElement = w.HTMLElement
g.Element = w.Element
g.Node = w.Node
g.MutationObserver = w.MutationObserver

import { GUIDE_STEPS, type GuideStep } from '../src/state/onboardingStore'
import {
  type FilterableProject,
  filterProjects,
  matchProjectName,
  PROJECT_TABS,
} from '../src/state/projectPrefsStore'

let fail = 0
const ok = (cond: boolean, label: string) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label)
  if (!cond) fail++
}

// ── 100개 프로젝트 시나리오(F08 완료 기준: 지정 프로젝트를 15초 안에 찾는다) ──
// 서버가 이미 권한으로 걸러 내려준 목록을 흉내낸다: 배정 70 · 미배정(canEdit=false) 25 · 체험존 5.
// 체험존은 같은 본부면 누구나 편집 가능(canEdit=true)이므로, '내 프로젝트'에서 빠지는 근거는
// canEdit 이 아니라 sample 플래그다 — 두 조건이 각각 살아 있는지 확인하려는 배치다.
type P = FilterableProject & { canEnter?: boolean }
const projects: P[] = Array.from({ length: 100 }, (_, i) => ({
  id: `p_${i}`,
  name: i % 3 === 0 ? `${i}공구 도로 확장공사` : `${i}지구 하수관로 정비`,
  canEdit: i < 70 || i >= 95,
  canEnter: i < 70 || i >= 95,
  sample: i >= 95,
}))
/** 이 사용자에게 서버가 애초에 내려주지 않은 프로젝트(다른 본부·비활성). 목록에 절대 없어야 한다. */
const hidden: P[] = [
  { id: 'p_secret', name: '타 본부 비밀 프로젝트', canEdit: true },
  { id: 'p_inactive', name: '비활성 도로 확장공사', canEdit: true },
]

console.log('[F08 목록 필터 · 권한 범위]')

const mine = filterProjects(projects, 'mine', '', [], [])
ok(mine.length === 70, `'내 프로젝트' 탭이 배정된 70개만 남긴다 (실제 ${mine.length})`)
ok(
  mine.every((p) => p.canEdit !== false && !p.sample),
  "'내 프로젝트'에 미배정·체험존이 섞이지 않는다",
)

const searched = filterProjects(projects, 'all', '도로 확장', [], [])
ok(
  searched.length > 0 && searched.every((p) => p.name.includes('도로 확장')),
  `이름 부분일치 검색 (${searched.length}건)`,
)
ok(
  filterProjects(projects, 'all', '  도로 확장  ', [], []).length === searched.length,
  '검색어 앞뒤 공백 무시',
)
ok(matchProjectName({ id: 'x', name: 'ABC 교량' }, 'abc'), '검색은 대소문자를 무시한다')

// ★ 핵심 회귀 방어선 — 권한 범위를 넘는 결과가 절대 나오지 않는다.
const allowedIds = new Set(projects.map((p) => p.id))
const staleFavourites = [...hidden.map((p) => p.id), 'p_3']
const staleRecent = ['p_secret', 'p_inactive', 'p_7', 'p_없는id']
let leak: string | null = null
for (const t of PROJECT_TABS) {
  for (const q of ['', '도로', '비밀', '비활성', 'p_secret', '공사', '없는id']) {
    for (const out of filterProjects(projects, t.id, q, staleRecent, staleFavourites)) {
      if (!allowedIds.has(out.id)) leak = `${t.id}/"${q}" → ${out.id}`
    }
  }
}
ok(
  leak === null,
  `모든 탭×검색어 조합에서 권한 범위 밖 프로젝트가 나오지 않는다${leak ? ` — 유출: ${leak}` : ''}`,
)
ok(
  filterProjects(projects, 'fav', '', staleRecent, staleFavourites).length === 1,
  '즐겨찾기에 남은 옛 id 는 결과를 만들어 내지 않는다(살아있는 1건만)',
)
ok(
  filterProjects(projects, 'recent', '', staleRecent, staleFavourites)
    .map((p) => p.id)
    .join(',') === 'p_7',
  '최근 목록도 현재 권한 목록에 있는 것만 남긴다',
)
ok(
  filterProjects(projects, 'recent', '', ['p_7', 'p_3'], [])
    .map((p) => p.id)
    .join(',') === 'p_7,p_3',
  '최근은 최신순 순서를 보존한다',
)
ok(
  filterProjects(projects, 'all', '없는이름123', [], []).length === 0,
  '일치하는 이름이 없으면 빈 결과',
)

console.log('\n[F06 안내 5단계]')
const ids = GUIDE_STEPS.map((s) => s.id)
const expected: GuideStep[] = ['sample', 'edit', 'link', 'save', 'export']
ok(
  ids.length === 5 && expected.every((e, i) => ids[i] === e),
  `5단계가 샘플→수정→연결→저장→출력 순서다 (${ids.join(' → ')})`,
)
ok(
  GUIDE_STEPS.every((s) => s.label.trim().length > 0 && s.hint.trim().length > 0),
  '모든 단계에 한국어 라벨·설명이 있다',
)

// ── F06 단계 자동 체크는 '진짜 편집'에서만 켜진다 ─────────────────────────────
// 안내에 '다음' 버튼이 없다는 말을 코드로 못박는다: 감시자를 붙여 두고 아무 일도 하지 않으면
// 아무 단계도 켜지지 않아야 하고, 실제 공정 수정·연결 추가에서만 켜져야 한다.
async function guideWatcherChecks() {
  console.log('\n[F06 단계 자동 체크 — 실제 상태 변화만]')
  const { installGuideWatchers, useOnboarding } = await import('../src/state/onboardingStore')
  const { useEditor } = await import('../src/state/store')

  const dispose = installGuideWatchers()
  const steps = () => useOnboarding.getState().steps

  await new Promise((r) => setTimeout(r, 50))
  ok(
    !steps().edit && !steps().link,
    '감시자를 붙이기만 하고 아무 것도 하지 않으면 어떤 단계도 켜지지 않는다',
  )

  const a = useEditor.getState()
  const task = a.project.tasks[0]
  ok(!!task, `기본 도면에 공정이 있다 (${a.project.tasks.length}개)`)
  if (task) {
    a.updateTask(task.id, { duration: (task.duration ?? 1) + 3 })
    await new Promise((r) => setTimeout(r, 50))
    ok(steps().edit, "공정 기간을 실제로 바꾸면 '공정 하나 수정'이 켜진다")
  }

  const linksBefore = useEditor.getState().project.links.length
  const [t1, t2] = useEditor.getState().project.tasks
  if (t1 && t2) {
    useEditor.getState().addLink(t1.id, t2.id)
    await new Promise((r) => setTimeout(r, 50))
    ok(
      useEditor.getState().project.links.length > linksBefore && steps().link,
      "연결을 실제로 추가하면 '공정 연결'이 켜진다",
    )
  }
  ok(!steps().export, 'PDF 출력은 실제 다운로드 전까지 켜지지 않는다')

  dispose()
  const linksAfterDispose = useEditor.getState().project.links.length
  useOnboarding.getState().resetGuide()
  const [t3, t4] = useEditor.getState().project.tasks
  if (t3 && t4) useEditor.getState().addLink(t4.id, t3.id)
  await new Promise((r) => setTimeout(r, 50))
  ok(
    useEditor.getState().project.links.length > linksAfterDispose && !steps().link,
    '해제(dispose) 후에는 구독이 남지 않는다',
  )
}

await guideWatcherChecks()

console.log(fail === 0 ? '\n✅ ONBOARDING SMOKE PASS' : `\n❌ ${fail} FAIL`)
process.exit(fail ? 1 : 0)
