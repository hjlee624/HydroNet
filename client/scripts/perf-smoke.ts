// 공정표 계산 성능 실측 하네스(F17) — `tsx scripts/perf-smoke.ts` (npm run smoke:perf).
//
// 왜 이게 필요한가: 검토서는 '번들을 쪼개기 전에 먼저 재라'고 요구하는데, 저장소에는
// 성능을 재는 스크립트가 하나도 없었다. 여기서 재는 것은 **막대를 끌 때 프레임마다
// 도는 계산 1사이클** — 일정(CPM) → 레이아웃 → 화살표 라우팅 — 을 100/500/1000 공정에서
// 반복한 p50/p95(ms) 이다. 렌더(브라우저 페인트)는 포함하지 않는다.
//
// 실기기(사내 PC·태블릿·휴대전화) 수치는 사람이 재서
// docs/Sequence_지원체계_및_도입효과_측정.md 의 표에 적는다. 이 스크립트는 그 표를 채우는
// 기준선이자, 계산이 느려지는 회귀를 잡는 게이트다.

import { makeProject } from '../src/data/templates'
import { computeLayout } from '../src/engine/layout'
import { routeLinks } from '../src/engine/routing'
import { computeSchedule } from '../src/engine/scheduling'
import type { Link, Project, Task } from '../src/types/model'

/** 1000공정 1사이클 p95 예산(ms). 드래그 프레임(60fps≈16.7ms) 은 아니고, 눈에 띄는
 *  버벅임이 시작되는 선을 보수적으로 잡았다. 넘으면 종료코드 1(회귀 게이트). */
const P95_BUDGET_MS = 120
/** 각 케이스 반복 횟수(워밍업 별도). */
const RUNS = 30
const WARMUP = 5
const CASES = [100, 500, 1000]

/** 템플릿 프로젝트를 복제·증식해 정확히 n개의 공정을 갖는 프로젝트를 만든다.
 *  공종은 원본 것을 재사용하고, 공정은 선행 체인(FS)으로 이어 CPM이 실제로 일을 하게 한다. */
function makeCase(n: number): Project {
  const base = makeProject('construction', 'road-new')
  const cats = base.categories
  const tasks: Task[] = []
  const links: Link[] = []
  for (let i = 0; i < n; i++) {
    const src = base.tasks[i % base.tasks.length]
    const id = `pt${i}`
    tasks.push({
      ...src,
      id,
      categoryId: cats[i % cats.length].id,
      name: `${src.name} ${i + 1}`,
      start: (i % 40) * 5,
      duration: src.isMilestone ? 0 : 5 + (i % 20),
      parentId: undefined,
    })
    // 앞 공정과 FS 로 잇는다(체인). 20개마다 끊어 여러 갈래를 만든다.
    if (i > 0 && i % 20 !== 0)
      links.push({ id: `pl${i}`, from: `pt${i - 1}`, to: id, type: 'FS', lag: 0 })
  }
  return { ...base, tasks, links }
}

/** 계산 1사이클 — 드래그 한 프레임에서 실제로 도는 것과 같은 순서. */
function cycle(project: Project): number {
  const t0 = performance.now()
  computeSchedule(project.tasks, project.links)
  const model = computeLayout(project)
  routeLinks(model, project.links)
  return performance.now() - t0
}

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

const f1 = (v: number) => v.toFixed(1).padStart(7)

console.log('Sequence 계산 성능 실측 (일정 → 레이아웃 → 라우팅 1사이클)')
console.log(`  node ${process.version} · 반복 ${RUNS}회(워밍업 ${WARMUP}회 제외)`)
console.log('  공정수   연결수    p50(ms)   p95(ms)    max(ms)')

let worstP95 = 0
for (const n of CASES) {
  const project = makeCase(n)
  for (let i = 0; i < WARMUP; i++) cycle(project)
  const samples: number[] = []
  for (let i = 0; i < RUNS; i++) samples.push(cycle(project))
  samples.sort((a, b) => a - b)
  const p50 = pct(samples, 50)
  const p95 = pct(samples, 95)
  const max = samples[samples.length - 1]
  if (n === 1000) worstP95 = p95
  console.log(
    `  ${String(project.tasks.length).padStart(6)}  ${String(project.links.length).padStart(6)}  ${f1(p50)}   ${f1(p95)}   ${f1(max)}`,
  )
}

console.log('')
if (worstP95 > P95_BUDGET_MS) {
  console.log(
    `❌ 1000공정 p95 ${worstP95.toFixed(1)}ms > 예산 ${P95_BUDGET_MS}ms — 드래그가 눈에 띄게 버벅인다.`,
  )
  console.log('   먼저 engine/layout·routing 의 O(n²) 구간을 확인하고, 그 다음에 번들을 논하라.')
  process.exit(1)
}
console.log(`✅ PERF OK — 1000공정 p95 ${worstP95.toFixed(1)}ms ≤ 예산 ${P95_BUDGET_MS}ms`)
