// Headless smoke test of the pure pipeline (no DOM): sample → CPM → layout →
// routing. Verifies there are no exceptions, no NaN geometry, and that the
// critical spine and milestones come out as expected. Run: npx tsx scripts/smoke.ts
import { createSampleProject } from '../src/data/sampleProject'
import { computeSchedule, applyCascade } from '../src/engine/scheduling'
import { computeLayout } from '../src/engine/layout'
import { routeLinks } from '../src/engine/routing'
import { paperPx } from '../src/engine/paper'

let failures = 0
function check(cond: boolean, label: string) {
  if (!cond) { failures++; console.error('  ✗ ' + label) }
  else console.log('  ✓ ' + label)
}

const project = createSampleProject()
console.log(`Project: ${project.name}  (tasks=${project.tasks.length}, links=${project.links.length})`)

// 1. Scheduling
const sched = computeSchedule(project.tasks, project.links)
console.log(`\n[CPM] end day=${sched.projectEndDay}, critical=${sched.criticalCount}, warnings=${sched.warnings.length}`)
check(sched.warnings.length === 0, '의존성 그래프에 순환이 없다')
check(sched.criticalCount >= 5, `주공정이 충분히 식별됨 (${sched.criticalCount} ≥ 5)`)
check(sched.tasks.every((t) => Number.isFinite(t.es!) && Number.isFinite(t.ef!)), '모든 ES/EF가 유한값')
const done = sched.tasks.find((t) => t.id === 't-ms-done')!
check(!!done.critical, '준공 마일스톤이 주공정에 포함')

// 2. Cascade should not move a well-formed schedule
const cascaded = applyCascade(project.tasks, project.links)
const moved = cascaded.tasks.filter((t, i) => t.start !== project.tasks[i].start).length
console.log(`\n[Cascade] moved ${moved} tasks`)
check(moved <= 2, '잘 정렬된 일정은 거의 이동하지 않음')

// 3. Layout geometry
const scheduledProject = { ...project, tasks: sched.tasks }
const model = computeLayout(scheduledProject)
console.log(`\n[Layout] content=${Math.round(model.contentWidth)}×${Math.round(model.contentHeight)}, lanes=${model.categories.length}, bars=${model.tasks.length}, months=${model.months.length}, rainy=${model.rainyRects.length}`)
check(model.tasks.every((lt) => Number.isFinite(lt.x) && Number.isFinite(lt.w) && lt.w >= 0), '모든 바 좌표가 유한 & 음수 폭 없음')
check(model.categories.length === 12, '일반 댐 모드에서 12개 공종 표시 (시운전 제외)')
check(model.rainyRects.length >= 2, '우기 밴드가 연도별로 생성됨')
check(model.months.length >= 24, '월 눈금이 2년 이상')

// 4. Routing
const routed = routeLinks(model, project.links)
console.log(`\n[Routing] ${routed.length} arrows, critical=${routed.filter((r) => r.critical).length}`)
check(routed.length === project.links.filter((l) => model.tasks.some((t) => t.task.id === l.from) && model.tasks.some((t) => t.task.id === l.to)).length, '표시 가능한 모든 연결이 라우팅됨')
check(routed.every((r) => r.d.length > 0 && !r.d.includes('NaN')), '모든 경로 문자열이 유효 (NaN 없음)')

// 5. Commissioning toggle reveals the 시운전 lane
const withComm = computeLayout({ ...scheduledProject, commissioningEnabled: true })
check(withComm.categories.length === 13, '시운전 활성화 시 13개 공종')

// 6. Paper export sizing (A1@150 and A0@300 clamp)
const a1 = paperPx({ size: 'A1', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true })
const a0 = paperPx({ size: 'A0', orientation: 'landscape', marginMm: 10, dpi: 300, fitToPage: true })
console.log(`\n[Paper] A1@150=${a1.wPx}×${a1.hPx}  A0@300=${a0.wPx}×${a0.hPx} (clamped=${a0.clamped})`)
check(a1.wPx > 3000 && !a1.clamped, 'A1@150dpi 정상')
check(a0.wPx > 0 && a0.hPx > 0, 'A0@300dpi 픽셀 산정 (클램프 포함)')

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
