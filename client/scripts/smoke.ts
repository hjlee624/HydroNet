// Headless smoke test of the pure pipeline (no DOM): sample → CPM → layout →
// routing. Verifies there are no exceptions, no NaN geometry, and that the
// critical spine and milestones come out as expected. Run: npx tsx scripts/smoke.ts

import { FACILITY_TYPES, facilitySchedule } from '../src/data/facilities'
import { createSampleProject } from '../src/data/sampleProject'
import { makeProject, PROJECT_TYPES } from '../src/data/templates'
import { computeLayout, fitToPaperView } from '../src/engine/layout'
import { augmentForMirror, mirrorActive, planMirrorView } from '../src/engine/mirror'
import { fitToPaperScopedView, paperMm, paperPx } from '../src/engine/paper'
import { routeLinks } from '../src/engine/routing'
import {
  applyCascade,
  computeSchedule,
  type EditImpact,
  type EditMode,
  editImpactUndoable,
  linkConstrainedStart,
  linkLagFromPositions,
  previewEdit,
  reschedule,
} from '../src/engine/scheduling'
import { exportPreflight } from '../src/export/preflight'
import { buildReviewRequestMd } from '../src/export/reviewRequest'
import { moveTaskFractionally, useEditor } from '../src/state/store'
import type { Link, Project, Task } from '../src/types/model'

let failures = 0
/** 있어야 할 값이 없으면 즉시 실패시킨다(비단언 — 실패 원인이 라벨로 남는다). */
function must<V>(value: V | undefined | null, what: string): V {
  if (value == null) throw new Error(`smoke: ${what} 을(를) 찾지 못했습니다`)
  return value
}
function check(cond: boolean, label: string) {
  if (!cond) {
    failures++
    console.error(`  ✗ ${label}`)
  } else console.log(`  ✓ ${label}`)
}

const project = createSampleProject()
console.log(
  `Project: ${project.name}  (tasks=${project.tasks.length}, links=${project.links.length})`,
)

// 1. Scheduling
const sched = computeSchedule(project.tasks, project.links)
console.log(
  `\n[CPM] end day=${sched.projectEndDay}, critical=${sched.criticalCount}, warnings=${sched.warnings.length}`,
)
check(sched.warnings.length === 0, '의존성 그래프에 순환이 없다')
check(sched.problems.length === 0, '정상 도면에는 미해결 문제가 0건(확정 산정)')
check(sched.criticalCount >= 5, `주공정이 충분히 식별됨 (${sched.criticalCount} ≥ 5)`)
check(
  sched.tasks.every((t) => Number.isFinite(t.es) && Number.isFinite(t.ef)),
  '모든 ES/EF가 유한값',
)
const done = must(
  sched.tasks.find((t) => t.id === 't-ms-done'),
  '준공 마일스톤(t-ms-done)',
)
check(!!done.critical, '준공 마일스톤이 주공정에 포함')

// 2. Cascade should not move a well-formed schedule
const cascaded = applyCascade(project.tasks, project.links)
const moved = cascaded.tasks.filter((t, i) => t.start !== project.tasks[i].start).length
console.log(`\n[Cascade] moved ${moved} tasks`)
check(moved <= 2, '잘 정렬된 일정은 거의 이동하지 않음')

// 3. Layout geometry
const scheduledProject = { ...project, tasks: sched.tasks }
const model = computeLayout(scheduledProject)
console.log(
  `\n[Layout] content=${Math.round(model.contentWidth)}×${Math.round(model.contentHeight)}, lanes=${model.categories.length}, bars=${model.tasks.length}, months=${model.months.length}, rainy=${model.rainyRects.length}`,
)
check(
  model.tasks.every((lt) => Number.isFinite(lt.x) && Number.isFinite(lt.w) && lt.w >= 0),
  '모든 바 좌표가 유한 & 음수 폭 없음',
)
check(model.categories.length === 12, '일반 댐 모드에서 12개 공종 표시 (시운전 제외)')
check(model.rainyRects.length >= 2, '우기 밴드가 연도별로 생성됨')
check(model.months.length >= 24, '월 눈금이 2년 이상')

// 3b. Fit-to-paper: content aspect ratio should match the sheet (no export letterbox)
const fitPatch = fitToPaperView(scheduledProject, 841, 594) // A1 landscape
const fitted = computeLayout({
  ...scheduledProject,
  view: { ...scheduledProject.view, ...fitPatch },
})
const fittedAspect = fitted.contentWidth / fitted.contentHeight
const paperAspect = 841 / 594
console.log(
  `\n[Fit] A1↻ paper=${paperAspect.toFixed(3)}  fitted=${fittedAspect.toFixed(3)}  patch=${JSON.stringify(fitPatch)}`,
)
check(
  Math.abs(fittedAspect - paperAspect) / paperAspect < 0.02,
  `시트에 맞추면 종횡비 일치 (도면 ${fittedAspect.toFixed(3)} ≈ 용지 ${paperAspect.toFixed(3)})`,
)
check(
  Number.isFinite(fitted.contentWidth) && Number.isFinite(fitted.contentHeight),
  '맞춤 후 좌표 유한',
)
check(
  fitPatch.fontScale === undefined ||
    (Number.isFinite(fitPatch.fontScale) && fitPatch.fontScale >= 1),
  '맞춤 글자 배율은 유한하며 축소하지 않음(≥1)',
)

// 3b-ii. Fit converges on a PORTRAIT sheet too (labelWidth↔fontScale feedback)
const portraitPatch = fitToPaperView(scheduledProject, 210, 297) // A4 portrait
const portraitFit = computeLayout({
  ...scheduledProject,
  view: { ...scheduledProject.view, ...portraitPatch },
})
const portraitAspect = portraitFit.contentWidth / portraitFit.contentHeight
const portraitTarget = 210 / 297
console.log(
  `[Fit A4↕] paper=${portraitTarget.toFixed(3)} fitted=${portraitAspect.toFixed(3)} patch=${JSON.stringify(portraitPatch)}`,
)
check(
  Math.abs(portraitAspect - portraitTarget) / portraitTarget < 0.03,
  `세로 용지도 맞춤이 수렴(여백≈0) (${portraitAspect.toFixed(3)} ≈ ${portraitTarget.toFixed(3)})`,
)

// 3b-iii. [여백 없이 시트에 맞추기]가 **출력될 범위**에 맞는가(H2).
// 출력 범위가 '현재 표시 범위'면 필터가 남긴 도면이 출력된다. 그런데 맞춤 계산이 필터를
// 모르면 전체 도면 기준으로 배율을 풀어, 정작 출력될 도면의 여백은 그대로거나 더 나빠진다
// (실측: A3 가로 · 주공정 필터에서 전체 0% / 표시범위 65%). 아래는 그 조합을 그대로 재현한다.
const critFilter = { critical: true, milestone: false, query: '' }
const a3 = { ...scheduledProject.paper, size: 'A3' as const, orientation: 'landscape' as const }
const marginOf = (proj: typeof scheduledProject, scope: 'full' | 'view') =>
  exportPreflight({ project: proj, filter: critFilter, scope, paper: a3, format: 'png' }).marginPct
const withView = (patch: { pxPerDay?: number; rowHeight?: number; fontScale?: number }) => ({
  ...scheduledProject,
  view: { ...scheduledProject.view, ...patch },
})

const beforeViewMargin = marginOf(scheduledProject, 'view')
const { w: a3w, h: a3h } = paperMm(a3.size, a3.orientation)
// (가) 범위를 모르는 옛 계산 — 전체 도면에만 맞는다.
const blindFit = withView(fitToPaperView(scheduledProject, a3w, a3h))
// (나) 범위를 아는 계산 — 필터가 남긴 도면에 맞춘다.
const scopedFit = withView(fitToPaperScopedView(scheduledProject, critFilter, a3w, a3h))
const blindViewMargin = marginOf(blindFit, 'view')
const scopedViewMargin = marginOf(scopedFit, 'view')
const scopedFullMargin = marginOf(scopedFit, 'full')
console.log(
  `\n[Fit scope] A3↻ 표시범위 여백: 맞춤전 ${beforeViewMargin}% · 범위무시 ${blindViewMargin}% · 범위반영 ${scopedViewMargin}% (전체 ${scopedFullMargin}%)`,
)
check(
  scopedViewMargin <= 1,
  `표시 범위로 맞추면 그 범위의 여백이 사라진다 (${scopedViewMargin}% ≤ 1%)`,
)
check(
  blindViewMargin > 5,
  `대조군: 범위를 무시한 맞춤은 표시 범위의 여백을 남긴다 (${blindViewMargin}% > 5%)`,
)
const reFitPatch = fitToPaperScopedView(scopedFit, critFilter, a3w, a3h)
const reFit = { ...scopedFit, view: { ...scopedFit.view, ...reFitPatch } }
check(
  marginOf(reFit, 'view') <= 1,
  `한 번 맞춘 뒤 다시 눌러도 그 범위 기준으로 계속 맞아 있다 (${marginOf(reFit, 'view')}%)`,
)

// 3c. Enlarging text grows its band/rows so glyphs aren't clipped
const bigText = computeLayout({
  ...scheduledProject,
  view: { ...scheduledProject.view, fontScale: 3 },
})
console.log(
  `\n[Responsive] fontScale 3 → 제목 ${model.titleHeight}→${bigText.titleHeight}, 헤더 ${model.headerHeight}→${bigText.headerHeight}, 행 ${model.rowHeight}→${bigText.rowHeight}`,
)
check(bigText.titleHeight > model.titleHeight, '글자 키우면 제목 칸이 커짐(잘림 방지)')
check(bigText.rowHeight > model.rowHeight, '글자 키우면 행 높이가 커짐')
check(bigText.headerHeight > model.headerHeight, '글자 키우면 헤더 칸이 커짐')

// 4. Routing
const routed = routeLinks(model, project.links)
console.log(
  `\n[Routing] ${routed.length} arrows, critical=${routed.filter((r) => r.critical).length}`,
)
check(
  routed.length ===
    project.links.filter(
      (l) =>
        model.tasks.some((t) => t.task.id === l.from) &&
        model.tasks.some((t) => t.task.id === l.to),
    ).length,
  '표시 가능한 모든 연결이 라우팅됨',
)
check(
  routed.every((r) => r.d.length > 0 && !r.d.includes('NaN')),
  '모든 경로 문자열이 유효 (NaN 없음)',
)

// 5. Commissioning toggle reveals the 시운전 lane
const withComm = computeLayout({ ...scheduledProject, commissioningEnabled: true })
check(withComm.categories.length === 13, '시운전 활성화 시 13개 공종')

// 6. Paper export sizing (A1@150 and A0@300 clamp)
const a1 = paperPx({
  size: 'A1',
  orientation: 'landscape',
  marginMm: 10,
  dpi: 150,
  fitToPage: true,
})
const a0 = paperPx({
  size: 'A0',
  orientation: 'landscape',
  marginMm: 10,
  dpi: 300,
  fitToPage: true,
})
console.log(
  `\n[Paper] A1@150=${a1.wPx}×${a1.hPx}  A0@300=${a0.wPx}×${a0.hPx} (clamped=${a0.clamped})`,
)
check(a1.wPx > 3000 && !a1.clamped, 'A1@150dpi 정상')
check(a0.wPx > 0 && a0.hPx > 0, 'A0@300dpi 픽셀 산정 (클램프 포함)')

// 7. 사업 유형(단계) 프리셋 — 활성 시트 + (설계는) 마일스톤 시트가 모두 유효
console.log('')
for (const t of PROJECT_TYPES) {
  const p = t.make()
  const m = computeLayout(p)
  const finite = m.tasks.every((lt) => Number.isFinite(lt.x) && Number.isFinite(lt.cy) && lt.w >= 0)
  const nSheets = 1 + (p.sheets?.length ?? 0)
  check(
    finite && m.categories.length > 0,
    `유형 프리셋 유효: ${t.label} (공종 ${m.categories.length}·바 ${m.tasks.length}·시트 ${nSheets})`,
  )
  // 시공=마일스톤만(시트 1), 설계=예정공정표+마일스톤(시트 2)
  const ms = (p.sheets ?? []).find((s) => s.role === 'milestone')
  if (t.kind === 'construction')
    check(nSheets === 1 && p.activeSheet?.role === 'milestone', `${t.label}: 마일스톤 시트만`)
  else {
    check(!!ms && p.activeSheet?.role === 'plan', `${t.label}: 예정공정표(활성) + 마일스톤 시트`)
    if (ms) {
      const mm = computeLayout({
        ...p,
        categories: ms.categories,
        tasks: ms.tasks,
        links: ms.links,
        rainySeasons: ms.rainySeasons,
      })
      check(
        mm.tasks.length > 0 && mm.tasks.every((lt) => Number.isFinite(lt.cy)),
        `${t.label}: 마일스톤 시트 유효(${mm.tasks.length})`,
      )
    }
  }
}

// 7b. 시설물 유형 프리셋 — 모든 유형이 유효한 시공 공정표(공종·바·화살표)를 생성
console.log('')
for (const f of FACILITY_TYPES) {
  const data = facilitySchedule(f.key)
  const fp = makeProject('construction', f.key)
  const fm = computeLayout(fp)
  const finite = fm.tasks.every(
    (lt) => Number.isFinite(lt.x) && Number.isFinite(lt.cy) && lt.w >= 0,
  )
  const fr = routeLinks(fm, fp.links)
  const routesOk = fr.every((r) => r.d.length > 0 && !r.d.includes('NaN'))
  check(
    finite && fm.categories.length > 0 && routesOk && data.tasks.length > 0,
    `시설물 프리셋 유효: ${f.label} (공종 ${fm.categories.length}·바 ${fm.tasks.length})`,
  )
  // 마일스톤 위생(적대적 리뷰 수정): 같은 이름 마일스톤 중복 없음, 준공/상업운전은 작업
  // 종료 이후, 착공/착수는 첫 공정 이전·동시.
  const msNames = data.tasks.filter((t) => t.isMilestone).map((t) => t.name)
  const dup = msNames.filter((n, i) => msNames.indexOf(n) !== i)
  check(
    dup.length === 0,
    `${f.label}: 마일스톤 이름 중복 없음${dup.length ? ` — ${dup.join(',')}` : ''}`,
  )
  const workEnd = Math.max(
    ...data.tasks.filter((t) => !t.isMilestone).map((t) => t.start + t.duration),
  )
  const workStart = Math.min(...data.tasks.map((t) => t.start))
  const endMs = data.tasks
    .filter((t) => t.isMilestone && /준공|상업운전/.test(t.name))
    .sort((a, b) => a.start - b.start)
  const lastEnd = endMs[endMs.length - 1]
  check(
    // 엄격 판정(±1일 슬랙 제거): 준공은 마지막 작업 종료일 **이상**이어야 한다. 예전의
    // '>= workEnd - 1' 은 하루짜리 실제 위반(준공 전에 작업이 끝나지 않는 프리셋)을
    // 그대로 통과시켰다 — 슬랙을 없애 프리셋 오류가 숨지 못하게 한다.
    !!lastEnd && lastEnd.start >= workEnd,
    // 라벨은 개월 반올림이 아니라 **일 단위**로 찍는다 — 반올림하면 12일짜리 위반이
    // '12≥12mo' 로 보여 판정이 틀린 것처럼 오해된다(판정식 자체는 일 단위로 정상).
    `${f.label}: 준공/상업운전이 작업 종료 이후(${lastEnd?.start ?? 0}일 ≥ ${workEnd}일)`,
  )
  const startMs = data.tasks.find((t) => t.isMilestone && /착공|착수/.test(t.name))
  check(
    // 엄격 판정(±1일 슬랙 제거): 착공은 첫 공정 시작일 **이하**여야 한다.
    !!startMs && startMs.start <= workStart,
    `${f.label}: 착공/착수가 첫 공정 이전·동시(${startMs?.start ?? -1}일 ≤ ${workStart}일)`,
  )
}

// 7b-2. 옹벽·보강토 — 준공검사가 선행 공정보다 먼저 시작되면 안 된다.
// 준공 마일스톤을 맞추려고 '부대·준공' 행을 앞당긴 적이 있어(11.6→11.2개월), 준공검사·
// 인수인계가 '성토·비탈면 정리 및 식생공' 종료 전에 시작되는 역순 공정이 만들어졌다.
// 마일스톤 위생 검사(7b)로는 안 잡히는 종류의 오류라 이 프리셋만 따로 못 박는다.
{
  const rt = facilitySchedule('retaining').tasks
  const insp = rt.find((t) => !t.isMilestone && /준공검사/.test(t.name))
  const veg = rt.find((t) => !t.isMilestone && /식생공/.test(t.name))
  check(
    !!insp && !!veg && insp.start >= veg.start + veg.duration,
    `옹벽·보강토: 준공검사·인수인계(${insp?.start ?? -1}일 착수)가 식생공 종료(${
      veg ? veg.start + veg.duration : -1
    }일) 이후`,
  )
}

// 7c. 세부공종 블록(연속 줄) 패키지 모델 — 양수발전 상부댐: 굴착→축조→페이스슬라브→충수가
//     연속 4줄 한 블록으로. 55236f3 이후 공정·마일스톤은 이름이 겹치지 않도록 **한 줄에
//     하나씩** 내려 배치하며(layout.ts), 묶음은 subName 세부공종 블록이 표현한다.
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = must(
    pp.categories.find((c) => c.name === '댐공사'),
    '댐공사 공종',
  )
  const upper = pm.tasks.filter(
    (lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'),
  )
  const cys = new Set(upper.map((lt) => Math.round(lt.cy)))
  check(
    upper.length >= 4 && cys.size === upper.length,
    `상부댐 4공정이 한 줄에 하나씩 배치(이름 겹침 방지) (${upper.length}공정·행수 ${cys.size})`,
  )
  const damLane = must(
    pm.categories.find((c) => c.id === damCat.id),
    '댐공사 레인',
  )
  const upperGroup = damLane.subGroups.find((g) => g.name.includes('상부댐'))
  check(
    !!upperGroup && upperGroup.rows === upper.length,
    `상부댐 4공정이 하나의 세부공종 블록(연속 ${upperGroup?.rows ?? 0}줄)으로 묶임`,
  )
  const ordered = [...upper].sort((a, b) => a.task.start - b.task.start).map((lt) => lt.task.name)
  check(
    ordered.length > 0 &&
      ordered[0].includes('굴착') &&
      ordered[ordered.length - 1].includes('충수'),
    `상부댐 순서: ${ordered.join(' → ')}`,
  )
  // 댐공사 레인은 공정당 1줄로 펼쳐지고(겹침 방지), 상·하부댐 2개 세부공종 블록으로 묶인다.
  const damRows = new Set(
    pm.tasks.filter((lt) => lt.categoryId === damCat.id).map((lt) => lt.subRow),
  )
  check(damRows.size === 8, `댐공사 레인 = 공정당 1줄 (행수 ${damRows.size})`)
  check(
    damLane.subGroups.length === 2,
    `댐공사 레인 = 상·하부댐 2개 세부공종 블록 (${damLane.subGroups.map((g) => g.name).join('·')})`,
  )
  // 링크 선 스타일(실선/점선)이 라우팅 결과에 전달됨
  const styled = pp.links.length
    ? [{ ...pp.links[0], style: 'dotted' as const }, ...pp.links.slice(1)]
    : []
  const sr = routeLinks(pm, styled)
  check(
    styled.length === 0 || sr.some((r) => r.style === 'dotted'),
    '링크 선 스타일이 라우팅 결과에 전달됨',
  )
}

// 7d. 연속 줄 패키지의 순차 막대 사이 화살표는 **후행 막대 중심으로 수평 도착** — 줄이
//     달라져도 마지막 구간은 옆으로 붙어야 화살표가 막대를 정면으로 가리킨다.
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = must(
    pp.categories.find((c) => c.name === '댐공사'),
    '댐공사 공종',
  )
  const upper = pm.tasks
    .filter((lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'))
    .sort((a, b) => a.task.start - b.task.start)
  const a0 = upper[0].task.id,
    a1 = upper[1].task.id
  const link = pp.links.find((l) => l.from === a0 && l.to === a1)
  if (link) {
    const r = routeLinks(pm, [link])[0]
    // 도착 높이는 **후행(축조) 막대 중심**이어야 하고, 도착 각도는 0(수평)이어야 한다.
    const flat = Math.abs(r.arrowY - upper[1].cy) < 0.5 && Math.abs(r.arrowAngle) < 1e-6
    check(flat, '순차 공정 화살표가 후행 막대 중심으로 수평(옆으로) 도착')
  } else check(false, '상부댐 굴착→축조 연결 존재')
}

// 7d-ii. 세부공정(parentId)은 상위 공정 한 줄에 이어 붙는다 — 같은 줄 순차 공정의
//        화살표는 중간 채널 없이 수평 직선(2점)으로 이어진다(routing.ts forwardSameRow).
{
  const base: any = makeProject('construction', 'concrete-gravity')
  const cat = base.categories[0].id
  base.tasks = [
    { id: 'P', categoryId: cat, name: '상위', start: 0, duration: 60, isMilestone: false },
    {
      id: 'A',
      categoryId: cat,
      name: 'A',
      start: 0,
      duration: 30,
      isMilestone: false,
      parentId: 'P',
    },
    {
      id: 'B',
      categoryId: cat,
      name: 'B',
      start: 30,
      duration: 30,
      isMilestone: false,
      parentId: 'P',
    },
  ]
  base.links = [{ id: 'l', from: 'A', to: 'B', type: 'FS', lag: 0 }]
  const m = computeLayout(base)
  const la = must(
    m.tasks.find((t) => t.task.id === 'A'),
    '배치된 공정 A',
  )
  const lb = must(
    m.tasks.find((t) => t.task.id === 'B'),
    '배치된 공정 B',
  )
  check(Math.abs(la.cy - lb.cy) < 0.5, '세부공정 2개가 상위 공정 한 줄에 나란히 배치')
  const r = routeLinks(m, base.links)[0]
  check(
    r.points.length === 2 && Math.abs(r.arrowY - la.cy) < 0.5,
    '같은 줄 순차 공정 화살표는 수평 직선(2점)',
  )
}

// 12. 지연일수(lag) 정확 반영 — linkConstrainedStart가 FS/SS/FF/SF + lag를 정확히 산출
{
  const mk = (id: string, start: number, duration: number): any => ({
    id,
    categoryId: 'c',
    name: id,
    start,
    duration,
    isMilestone: false,
  })
  const pred = mk('p', 10, 20) // EF = 30
  const succ = mk('s', 100, 5)
  const tasks = [pred, succ]
  const L = 4
  const at = (type: string) =>
    linkConstrainedStart(tasks, [{ id: 'l', from: 'p', to: 's', type: type as any, lag: L }], 's')
  console.log('\n[Lag] FS/SS/FF/SF + lag 정확 산출(양방향 스냅)')
  check(at('FS') === 30 + L, `FS+${L}: 후행 시작 = 선행 종료+lag (${at('FS')}=${30 + L})`)
  check(at('SS') === 10 + L, `SS+${L}: 후행 시작 = 선행 시작+lag (${at('SS')}=${10 + L})`)
  check(at('FF') === 30 + L - 5, `FF+${L}: 후행 종료 = 선행 종료+lag (start=${at('FF')})`)
  check(at('SF') === 10 + L - 5, `SF+${L}: 후행 종료 = 선행 시작+lag (start=${at('SF')})`)
  check(
    linkConstrainedStart(tasks, [{ id: 'l', from: 'p', to: 's', type: 'FS', lag: 0 }], 's') === 30,
    'lag 0이면 후행이 선행 종료(30)로 당겨짐(양방향)',
  )
  const p2 = mk('p2', 50, 10) // EF=60
  const multi = linkConstrainedStart(
    [pred, p2, succ],
    [
      { id: 'l1', from: 'p', to: 's', type: 'FS', lag: 0 },
      { id: 'l2', from: 'p2', to: 's', type: 'FS', lag: 0 },
    ],
    's',
  )
  check(multi === 60, `다중 선행은 가장 늦은 제약으로 결정 (${multi}=60)`)
  check(linkConstrainedStart(tasks, [], 's') === null, '선행 없으면 null(스냅 안 함)')
}

// 13. 화살표 수렴 — 한 막대로 들어오는 여러 화살표는 분산(fan-out) 없이 같은 지점으로 수렴
{
  const base: any = makeProject('construction', 'concrete-gravity')
  const cat = base.categories[0].id
  base.tasks = [
    { id: 'x1', categoryId: cat, name: 'A', start: 0, duration: 20, isMilestone: false, row: 0 },
    { id: 'x2', categoryId: cat, name: 'B', start: 0, duration: 20, isMilestone: false, row: 1 },
    { id: 'x3', categoryId: cat, name: 'C', start: 60, duration: 20, isMilestone: false, row: 2 },
  ]
  base.links = [
    { id: 'la', from: 'x1', to: 'x3', type: 'FS', lag: 0 },
    { id: 'lb', from: 'x2', to: 'x3', type: 'FS', lag: 0 },
  ]
  const m = computeLayout(base)
  const rr = routeLinks(m, base.links)
  const toC = rr.filter((l) => l.to === 'x3')
  console.log('\n[Arrows] 한 막대로 들어오는 화살표 수렴(분산 없음)')
  check(
    toC.length === 2 && Math.abs(toC[0].arrowY - toC[1].arrowY) < 0.01,
    `여러 화살표가 같은 Y(막대 중심)로 수렴 (${toC.map((l) => l.arrowY.toFixed(1)).join(' / ')})`,
  )
}

// 14. 표시 기간(view.displayStart/End) — 지정 구간만 정확히 표시(요구사항 1)
console.log('')
{
  const base: any = makeProject('construction', 'concrete-gravity') // 착수일 2026-01-01
  const full = computeLayout(base)
  const win = computeLayout({
    ...base,
    view: { ...base.view, displayStart: '2026-01-01', displayEnd: '2026-06-01' },
  })
  console.log(
    `\n[표시기간] 전체 months=${full.months.length} → 6개월창 months=${win.months.length}, bars ${full.tasks.length}→${win.tasks.length}`,
  )
  check(win.months.length === 6, `지정 구간 = 6개월만 표시 (got ${win.months.length})`)
  check(win.months.length < full.months.length, '지정 구간이 전체 데이터 범위보다 짧게 잘림')
  check(
    win.tasks.every(
      (lt: any) =>
        lt.startX >= win.labelWidth - 0.5 &&
        lt.endX <= win.contentWidth + 0.5 &&
        lt.x >= win.labelWidth - 0.5,
    ),
    '구간에 걸친 막대는 경계로 클램프(라벨열/우측 넘침 없음)',
  )
  check(!win.tasks.some((lt: any) => /준공/.test(lt.task.name)), '구간 밖 마일스톤(준공)은 제외')
  const onlyStart = computeLayout({ ...base, view: { ...base.view, displayStart: '2026-01-01' } })
  check(onlyStart.months.length === full.months.length, '한쪽만 지정하면 자동(전체) 범위 유지')
  const inverted = computeLayout({
    ...base,
    view: { ...base.view, displayStart: '2026-06-01', displayEnd: '2026-01-01' },
  })
  check(inverted.months.length === full.months.length, '역전 구간은 무시하고 자동 범위')
}

// 15. 예정공정표↔마일스톤 연동(augmentForMirror) — 병합·숨김·게이팅(요구사항 4)
console.log('')
{
  const baseP: any = createSampleProject()
  const synth: any = {
    ...baseP,
    categories: [{ id: 'm1', name: '공통', color: '#445566', collapsed: false, order: 0 }],
    tasks: [
      { id: 'mt1', categoryId: 'm1', name: '시공A', start: 0, duration: 10, isMilestone: false },
    ],
    links: [],
    rainySeasons: [],
    activeSheet: { id: 'sh-ms', role: 'milestone', name: '시공 마일스톤' },
    sheets: [
      {
        id: 'sh-plan',
        role: 'plan',
        name: '예정공정표',
        categories: [
          { id: 'pc1', name: '공통', color: '#777', collapsed: false, order: 0 },
          { id: 'pc2', name: '설계', color: '#999', collapsed: false, order: 1 },
        ],
        tasks: [
          {
            id: 'pt1',
            categoryId: 'pc1',
            name: '예정A',
            start: 5,
            duration: 10,
            isMilestone: false,
          },
          {
            id: 'pt2',
            categoryId: 'pc2',
            name: '예정B',
            start: 20,
            duration: 10,
            isMilestone: false,
          },
        ],
        links: [{ id: 'pl', from: 'pt1', to: 'pt2', type: 'FS', lag: 0 }],
        rainySeasons: [],
      },
    ],
    view: { ...baseP.view, mirrorPlan: true, mirrorHidden: [] },
  }
  check(mirrorActive(synth), '미러 활성(마일스톤 시트 + plan 시트 + 토글 ON)')
  const aug = augmentForMirror(synth)
  const mir = aug.tasks.filter((t: any) => t.__mirror)
  console.log(
    `\n[미러] cats ${synth.categories.length}→${aug.categories.length}, tasks ${synth.tasks.length}→${aug.tasks.length}(미러 ${mir.length})`,
  )
  check(
    aug.categories.length === 2,
    `공종 병합: 같은 이름(공통)은 흡수·설계는 추가 (got ${aug.categories.length})`,
  )
  check(aug.tasks.length === 3 && mir.length === 2, '예정 공정 2개가 미러로 함께 표시')
  const pt1 = aug.tasks.find((t: any) => t.id === 'pt1')
  const pt2 = aug.tasks.find((t: any) => t.id === 'pt2')
  check(pt1?.categoryId === 'm1', '같은 이름 공종으로 remap(공통→m1)')
  check(
    typeof pt2?.categoryId === 'string' && pt2.categoryId.startsWith('mir-cat-'),
    '예정 전용 공종은 새 레인으로 추가',
  )
  check(
    aug.links.some((l: any) => l.from === 'pt1' && l.to === 'pt2'),
    '미러 공정 간 연결도 함께 표시',
  )
  const hiddenAug = augmentForMirror({ ...synth, view: { ...synth.view, mirrorHidden: ['pt1'] } })
  check(
    hiddenAug.tasks.filter((t: any) => t.__mirror).length === 1,
    '마일스톤에서 숨긴 예정 공정은 차트에서 제외',
  )
  check(!hiddenAug.links.some((l: any) => l.from === 'pt1'), '숨긴 공정으로 가는/오는 연결도 제외')
  check(synth.sheets[0].tasks.length === 2, '예정공정표 원본은 불변(숨겨도 2개 유지)')
  const off = { ...synth, view: { ...synth.view, mirrorPlan: false } }
  check(augmentForMirror(off) === off, '토글 OFF면 augment 없이 원본 그대로 반환(===)')
  check(
    !mirrorActive({ ...synth, activeSheet: { id: 'sh-plan', role: 'plan', name: '예정공정표' } }),
    '예정 시트가 활성이면 미러 비활성',
  )
  const am = computeLayout(aug)
  check(
    am.tasks.every((lt: any) => Number.isFinite(lt.x) && Number.isFinite(lt.cy)),
    '미러 병합 레이아웃 좌표 유한',
  )
  const mvw = planMirrorView(synth)
  check(
    !!mvw && (mvw.tasksByCat.get('m1') ?? []).some((r: any) => r.id === 'pt1'),
    '사이드바 뷰: 공통 공종 아래 예정A 표시',
  )
}

// 16. 좌측 WBS 라벨열(view.taskColumn) — 공종명을 레인 상단 헤더로 올려 도면이 높아지고,
//     공종 > 세부공종 > 공정 트리를 좌측에 나열하므로 긴 공정명·세부공종명은 라벨열을 넓힌다.
console.log('')
{
  const dd: any = makeProject('detailed-design', 'rockfill-cfrd') // 예정공정표(세부공종 없음)
  const on = computeLayout(dd) // taskColumn 기본 ON
  const off = computeLayout({ ...dd, view: { ...dd.view, taskColumn: false } })
  console.log(
    `\n[WBS라벨] height ${Math.round(off.contentHeight)}→${Math.round(on.contentHeight)} (label ${off.labelWidth}/${on.labelWidth})`,
  )
  check(
    on.contentHeight > off.contentHeight,
    '공종명을 상단 헤더로 올려 도면이 높아짐(공종 헤더 인셋)',
  )
  check(
    on.tasks.every((lt: any) => Number.isFinite(lt.cy) && Number.isFinite(lt.x)),
    'WBS 라벨 ON 레이아웃 좌표 유한',
  )
  // 긴 공정명을 넣어도 라벨열은 넓어지지 않는다(공정명은 좌측에 나열하지 않고 막대 위에 표기).
  const longName = '아주 긴 공정 이름 테스트용으로 충분히 길게 만든 라벨 문자열입니다'
  const inject = (field: 'name' | 'subName') => {
    let done = false
    return computeLayout({
      ...dd,
      tasks: dd.tasks.map((t: any) => {
        if (!done && !t.isMilestone) {
          done = true
          return { ...t, [field]: longName }
        }
        return t
      }),
    })
  }
  // 공정·세부공종 모두 좌측 WBS 트리에 표기 → 길어지면 라벨열을 넓힌다.
  check(
    inject('name').labelWidth > on.labelWidth,
    '긴 공정명이 라벨열을 넓힌다(공정은 좌측 WBS에 표기)',
  )
  check(
    inject('subName').labelWidth > on.labelWidth,
    '긴 세부공종명이 라벨열을 넓힌다(WBS는 좌측 표기)',
  )

  const cat = dd.categories[0].id
  const grouped: Project = {
    ...dd,
    categories: dd.categories.slice(0, 2),
    tasks: [
      { id: 'parent', categoryId: cat, name: '상위 공정', start: 0, duration: 120, isMilestone: false },
      { id: 'child-a', categoryId: cat, parentId: 'parent', name: '세부 A', start: 0, duration: 30, isMilestone: false, row: 0 },
      { id: 'child-b', categoryId: cat, parentId: 'parent', name: '세부 B', start: 40, duration: 30, isMilestone: false, row: 0 },
    ],
    links: [],
  }
  const together = computeLayout(grouped)
  const splitProject: Project = {
    ...grouped,
    tasks: grouped.tasks.map((t) => (t.id === 'child-b' ? { ...t, row: 1 } : { ...t })),
  }
  const split = computeLayout(splitProject)
  const togetherA = must(together.tasks.find((lt) => lt.task.id === 'child-a'), '같은 줄 세부 A')
  const togetherB = must(together.tasks.find((lt) => lt.task.id === 'child-b'), '같은 줄 세부 B')
  const splitA = must(split.tasks.find((lt) => lt.task.id === 'child-a'), '분리 줄 세부 A')
  const splitB = must(split.tasks.find((lt) => lt.task.id === 'child-b'), '분리 줄 세부 B')
  check(togetherA.cy === togetherB.cy, '같은 row의 세부공정은 상위 공정 블록 한 줄에 배치된다')
  check(
    splitB.cy - splitA.cy === split.rowHeight,
    '세부공정 row를 바꾸면 같은 상위 공정 블록 안에서 위·아래 줄로 이동한다',
  )
  check(
    split.categories[0].height === together.categories[0].height + split.rowHeight,
    '세부공정이 새 줄을 쓰면 상위 공정 블록만 한 행만큼 확장된다',
  )
  const moved = structuredClone(grouped)
  const otherCategory = dd.categories[1].id
  moveTaskFractionally(moved, 'child-b', otherCategory, null, 'below')
  const movedChild = must(moved.tasks.find((t) => t.id === 'child-b'), '이동한 세부 B')
  check(
    movedChild.parentId === 'parent' && movedChild.categoryId === cat && movedChild.row === 1,
    '세부공정 세로 이동은 다른 공종에 놓아도 상위 공정 소속을 유지하고 그룹 안 새 줄을 만든다',
  )
}

// 17. 연결 유형별 라우팅 끝점 — 막대 앞/뒤 양쪽에서 연결(FS/SS/FF/SF) 시 출발·도착 끝점이
//     정확한 막대 끝(시작=S·종료=F)으로 라우팅되는지(드래그 생성이 의존하는 계약)
console.log('')
{
  const base: any = makeProject('construction', 'concrete-gravity')
  const cat = base.categories[0].id
  base.tasks = [
    { id: 'A', categoryId: cat, name: 'A', start: 0, duration: 30, isMilestone: false, row: 0 },
    { id: 'B', categoryId: cat, name: 'B', start: 60, duration: 30, isMilestone: false, row: 1 },
  ]
  base.links = []
  const m = computeLayout(base)
  const la = must(
    m.tasks.find((t) => t.task.id === 'A'),
    '배치된 공정 A',
  )
  const lb = must(
    m.tasks.find((t) => t.task.id === 'B'),
    '배치된 공정 B',
  )
  const near = (x: number, y: number) => Math.abs(x - y) < 0.6
  console.log('\n[연결끝점] 앞/뒤 양쪽 연결 — FS/SS/FF/SF 출발·도착 끝점')
  for (const [type, srcX, dstX] of [
    ['FS', la.endX, lb.startX],
    ['SS', la.startX, lb.startX],
    ['FF', la.endX, lb.endX],
    ['SF', la.startX, lb.endX],
  ] as const) {
    const r = routeLinks(m, [{ id: 'l', from: 'A', to: 'B', type, lag: 0 }] as any)[0]
    const p0 = r.points[0]
    const head = r.points[r.points.length - 1]
    check(
      near(p0[0], srcX) && near(head[0], dstX),
      `${type}: 출발=${type[0] === 'F' ? '종료' : '시작'} · 도착=${type[1] === 'F' ? '종료' : '시작'} 끝점으로 라우팅`,
    )
  }
}

// 18. 막대 이동 시 지연(lag) 자동 갱신 — 위치→지연 역산(snapSuccessor의 역방향, 위치↔지연 상호작용)
console.log('')
{
  const mk = (id: string, start: number, duration: number): any => ({
    id,
    categoryId: 'c',
    name: id,
    start,
    duration,
    isMilestone: false,
  })
  const pred = mk('p', 10, 20) // start 10, finish 30
  const succ = mk('s', 47, 8) // start 47, finish 55
  console.log('\n[위치→지연] 막대 위치에서 lag 역산 후 그 lag로 위치가 그대로 재현되는지')
  for (const type of ['FS', 'SS', 'FF', 'SF'] as const) {
    const lag = linkLagFromPositions(pred, succ, type)
    const back = linkConstrainedStart(
      [pred, succ],
      [{ id: 'l', from: 'p', to: 's', type, lag }],
      's',
    )
    check(back === succ.start, `${type}: 위치→지연(${lag})→위치 재현 (${back}=${succ.start})`)
  }
  // 후행을 뒤로 밀면 FS 지연이 그만큼 커지고(양수), 선행 종료보다 당기면 음수(선행/리드).
  check(linkLagFromPositions(pred, mk('s', 50, 8), 'FS') === 20, 'FS: 뒤로 밀면 지연 +20')
  check(
    linkLagFromPositions(pred, mk('s', 25, 8), 'FS') === -5,
    'FS: 선행 종료보다 앞서면 음수 지연 -5',
  )
}

// 19. 편집 의미론(F09) — '위치 자유 편집'(위치→지연 역산) vs '선후행 제약 유지'(지연 불변).
//     완료 기준: ① FS/SS/FF/SF + 다중 선행에서 이동·기간 변경의 영향이 **사전 표시와 일치**
//     ② 제약 유지 모드에서는 lag 가 임의로 변경되지 않는다.
console.log('')
{
  type T = Task
  const mk = (id: string, start: number, duration: number): T => ({
    id,
    categoryId: 'c',
    name: id,
    start,
    duration,
    isMilestone: false,
  })
  /** p(선행1)·q(선행2)·s(대상)·d(후행) 4공정 체인. 모든 lag 는 현재 위치와 정합. */
  const chain = (type: 'FS' | 'SS' | 'FF' | 'SF', type2: 'FS' | 'SS' | 'FF' | 'SF' = type) => {
    const p = mk('p', 10, 20) // 10 ~ 30
    const q = mk('q', 0, 12) //  0 ~ 12
    const s = mk('s', 47, 8) // 47 ~ 55
    const d = mk('d', 80, 10) // 80 ~ 90
    const tasks: T[] = [p, q, s, d]
    const links: Link[] = [
      { id: 'lp', from: 'p', to: 's', type, lag: linkLagFromPositions(p, s, type) },
      { id: 'lq', from: 'q', to: 's', type: type2, lag: linkLagFromPositions(q, s, type2) },
      { id: 'ld', from: 's', to: 'd', type: 'FS', lag: linkLagFromPositions(s, d, 'FS') },
    ]
    return { tasks, links }
  }
  /**
   * 스토어의 커밋 경로를 **독립적으로** 재현한 참조 구현(previewEdit 을 쓰지 않는다):
   * start/duration 대입 → 편집 의미론(자유=지연 역산 / 제약유지=위치 clamp) → 연쇄 정렬.
   * previewEdit 의 사전 표시가 이 실제 결과와 같아야 한다.
   */
  const applyLikeStore = (
    tasks: T[],
    links: Link[],
    edit: { id: string; start?: number; duration?: number },
    mode: EditMode,
  ) => {
    const nt: T[] = tasks.map((t) => ({ ...t }))
    const nl: Link[] = links.map((l) => ({ ...l }))
    const t = must(
      nt.find((x) => x.id === edit.id),
      edit.id,
    )
    if (edit.start !== undefined) t.start = Math.round(edit.start)
    if (edit.duration !== undefined) t.duration = Math.max(1, Math.round(edit.duration))
    if (mode === 'keepLinks') {
      const min = linkConstrainedStart(nt, nl, edit.id)
      if (min != null && t.start < min) t.start = min
    } else {
      for (const l of nl) {
        if (l.to !== edit.id || l.from === edit.id) continue
        const from = nt.find((x) => x.id === l.from)
        if (from) l.lag = linkLagFromPositions(from, t, l.type)
      }
    }
    const out = applyCascade(nt, nl).tasks
    return { tasks: out, links: nl, end: computeSchedule(out, nl).projectEndDay }
  }
  const lagsOf = (links: Link[]) => JSON.stringify(links.map((l) => [l.id, l.lag]))

  console.log('\n[편집의미론] 위치 자유 편집(지연 역산) vs 선후행 제약 유지(지연 불변)')
  for (const type of ['FS', 'SS', 'FF', 'SF'] as const) {
    // ── (가) 자유 편집: 뒤로 10일 이동 → 들어오는 링크 지연이 새 위치에서 역산된다 ──
    {
      const { tasks, links } = chain(type)
      const imp = must(previewEdit(tasks, links, { id: 's', start: 57 }, 'free', true), '미리보기')
      const real = applyLikeStore(tasks, links, { id: 's', start: 57 }, 'free')
      const movedS = {
        ...must(
          tasks.find((t) => t.id === 's'),
          's',
        ),
        start: 57,
      }
      const expected = links
        .filter((l) => l.to === 's')
        .map((l) =>
          linkLagFromPositions(
            must(
              tasks.find((t) => t.id === l.from),
              l.from,
            ),
            movedS,
            l.type,
          ),
        )
      const got = links
        .filter((l) => l.to === 's')
        .map((l) => imp.lagChanges.find((c) => c.linkId === l.id)?.after)
      check(
        JSON.stringify(got) === JSON.stringify(expected),
        `${type} 자유편집: 사전 표시된 지연 = 위치 역산값 ${JSON.stringify(expected)}`,
      )
      check(
        imp.target.startAfter ===
          must(
            real.tasks.find((t) => t.id === 's'),
            's',
          ).start && imp.endAfter === real.end,
        `${type} 자유편집: 사전 표시(시작 ${imp.target.startAfter} · 준공 ${imp.endAfter}) = 실제 커밋 결과`,
      )
      const realMoves = real.tasks
        .filter(
          (t) =>
            t.id !== 's' &&
            t.start !==
              must(
                tasks.find((x) => x.id === t.id),
                t.id,
              ).start,
        )
        .map((t) => `${t.id}:${t.start}`)
      check(
        JSON.stringify(imp.successorMoves.map((m) => `${m.id}:${m.after}`)) ===
          JSON.stringify(realMoves),
        `${type} 자유편집: 사전 표시된 후행 이동 = 실제 이동 ${JSON.stringify(realMoves)}`,
      )
    }
    // ── (나) 제약 유지: 같은 이동 + 선행보다 앞으로 당기기 → lag 는 단 1건도 안 바뀐다 ──
    for (const [label, start] of [
      ['뒤로', 57],
      ['앞으로', 37],
    ] as const) {
      const { tasks, links } = chain(type)
      const beforeLags = lagsOf(links)
      const imp = must(previewEdit(tasks, links, { id: 's', start }, 'keepLinks', true), '미리보기')
      const real = applyLikeStore(tasks, links, { id: 's', start }, 'keepLinks')
      check(imp.lagChanges.length === 0, `${type} 제약유지(${label}): 지연 변경 0건`)
      check(
        lagsOf(real.links) === beforeLags,
        `${type} 제약유지(${label}): 실제 커밋 후 lag 배열이 바이트 동일`,
      )
      check(
        imp.target.startAfter ===
          must(
            real.tasks.find((t) => t.id === 's'),
            's',
          ).start,
        `${type} 제약유지(${label}): 사전 표시 시작(${imp.target.startAfter}) = 실제 결과`,
      )
      if (start === 37) {
        const min = must(linkConstrainedStart(tasks, links, 's'), '선행 제약')
        check(
          imp.clamped && imp.target.startAfter === min && imp.clampedTo === min,
          `${type} 제약유지: 선행 제약(${min}일)에 막혀 되밀림 — 임의로 lag 를 고치지 않음`,
        )
      }
    }
    // ── (다) 기간 변경: FF/SF 는 자유 편집에서 지연이 바뀌지만, 제약 유지에서는 불변 ──
    {
      const { tasks, links } = chain(type)
      const beforeLags = lagsOf(links)
      const free = must(
        previewEdit(tasks, links, { id: 's', duration: 20 }, 'free', true),
        '미리보기',
      )
      const keep = must(
        previewEdit(tasks, links, { id: 's', duration: 20 }, 'keepLinks', true),
        '미리보기',
      )
      const realFree = applyLikeStore(tasks, links, { id: 's', duration: 20 }, 'free')
      const realKeep = applyLikeStore(tasks, links, { id: 's', duration: 20 }, 'keepLinks')
      check(
        free.lagChanges.length === (type === 'FF' || type === 'SF' ? 2 : 0),
        `${type} 기간변경 자유편집: 지연 변경 ${free.lagChanges.length}건(FF/SF만 2건)`,
      )
      check(
        JSON.stringify(realFree.links.filter((l: Link) => l.to === 's').map((l: Link) => l.lag)) ===
          JSON.stringify(
            links
              .filter((l: Link) => l.to === 's')
              .map((l: Link) => free.lagChanges.find((c) => c.linkId === l.id)?.after ?? l.lag),
          ),
        `${type} 기간변경 자유편집: 사전 표시된 지연 = 실제 커밋된 지연`,
      )
      check(keep.lagChanges.length === 0, `${type} 기간변경 제약유지: 지연 변경 0건`)
      check(
        lagsOf(realKeep.links) === beforeLags,
        `${type} 기간변경 제약유지: 실제 커밋 후 lag 배열이 바이트 동일`,
      )
      check(
        free.endAfter === realFree.end && keep.endAfter === realKeep.end,
        `${type} 기간변경: 사전 표시 준공 = 실제 준공(자유 ${free.endAfter} · 제약 ${keep.endAfter})`,
      )
    }
  }
  // ── (라) 다중 선행 혼합(FS + SS) — 두 선행 모두 사전 표시대로 갱신/보존되는가 ──
  {
    const { tasks, links } = chain('FS', 'SS')
    const beforeLags = lagsOf(links)
    const free = must(previewEdit(tasks, links, { id: 's', start: 61 }, 'free', true), '미리보기')
    check(free.lagChanges.length === 2, '다중 선행(FS+SS) 자유편집: 두 선행 지연 모두 갱신')
    const realFree = applyLikeStore(tasks, links, { id: 's', start: 61 }, 'free')
    check(
      JSON.stringify(realFree.links.filter((l: Link) => l.to === 's').map((l: Link) => l.lag)) ===
        JSON.stringify(free.lagChanges.map((c) => c.after)),
      '다중 선행: 사전 표시된 지연값 = 실제 커밋된 지연값',
    )
    const keep = must(
      previewEdit(tasks, links, { id: 's', start: 61 }, 'keepLinks', true),
      '미리보기',
    )
    const realKeep = applyLikeStore(tasks, links, { id: 's', start: 61 }, 'keepLinks')
    check(
      keep.lagChanges.length === 0 && lagsOf(realKeep.links) === beforeLags,
      '다중 선행: 제약 유지에서는 두 선행 지연 모두 불변',
    )
  }
  // ── (마) 없는 공정이면 null(호출부가 안전하게 무시) ──
  {
    const { tasks, links } = chain('FS')
    check(
      previewEdit(tasks, links, { id: 'none' }, 'free', true) === null,
      '대상 공정이 없으면 null',
    )
  }
}

// 20. 복수 순환 문제 목록(F10) — 순환마다 항목 1건, 순환 밖(하류) 공정은 지목하지 않는다.
//     완료 기준: 모든 문제를 탐색·해결할 수 있고 해결 후 경고가 사라진다.
console.log('')
{
  type T = Task
  const mk = (id: string, start: number): T => ({
    id,
    categoryId: 'c',
    name: id,
    start,
    duration: 10,
    isMilestone: false,
  })
  const tasks: T[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id, i) => mk(id, i * 10))
  const L = (id: string, from: string, to: string): Link => ({
    id,
    from,
    to,
    type: 'FS',
    lag: 0,
  })
  const links: Link[] = [
    L('l-ab', 'A', 'B'),
    L('l-ba', 'B', 'A'), // 순환 ①
    L('l-cd', 'C', 'D'),
    L('l-dc', 'D', 'C'), // 순환 ②
    L('l-ef', 'E', 'F'), // 정상 체인
    L('l-bg', 'B', 'G'), // 순환 ① 하류(범인 아님)
  ]
  const r = computeSchedule(tasks, links)
  console.log(`\n[문제목록] problems=${r.problems.length} warnings=${r.warnings.length}`)
  check(r.problems.length === 2, '독립 순환 2개를 각각 별도 항목으로 보고(마지막 1건만 아님)')
  check(r.warnings.length === 2, '경고 문자열도 순환 수만큼(상태바 호환 유지)')
  const sorted = r.problems.map((p) => [...p.taskIds].sort().join(','))
  check(sorted.includes('A,B') && sorted.includes('C,D'), '각 항목의 공정은 자기 순환 구성원뿐')
  check(
    !r.problems.some((p) => p.taskIds.includes('G')),
    '순환 하류 공정(G)은 범인으로 지목되지 않는다',
  )
  check(
    r.problems.every((p) => p.linkIds.length === 2),
    '각 항목이 고리를 이루는 연결 2개를 지목(클릭해 삭제 가능)',
  )
  check(
    r.problems.every((p) => p.kind === 'cycle' && p.severity === 'error' && p.message.length > 0),
    '항목마다 종류·심각도·한국어 설명을 갖춘다',
  )
  check(
    r.tasks.every((t) => Number.isFinite(t.es) && Number.isFinite(t.ef)),
    '순환이 있어도 모든 공정의 ES/EF 는 유한(계산은 계속된다)',
  )
  const again = computeSchedule(tasks, links)
  check(
    JSON.stringify(r.problems.map((p) => p.id)) === JSON.stringify(again.problems.map((p) => p.id)),
    '문제 id 가 호출마다 동일(목록 key 안정)',
  )
  check(
    applyCascade(tasks, links).problems.length === 2 &&
      reschedule(tasks, links).problems.length === 2,
    '연쇄 정렬·재계산 경로도 같은 문제 목록을 노출',
  )
  // 해결 과정 — 연결을 하나씩 지우면 문제가 하나씩 사라지고, 마지막엔 경고가 완전히 사라진다.
  const half = links.filter((l) => l.id !== 'l-dc')
  check(computeSchedule(tasks, half).problems.length === 1, '순환 ②의 연결을 지우면 1건만 남음')
  const solved = half.filter((l) => l.id !== 'l-ba')
  const solvedR = computeSchedule(tasks, solved)
  check(
    solvedR.problems.length === 0 && solvedR.warnings.length === 0,
    '두 순환을 모두 풀면 문제·경고가 모두 사라진다(잠정 → 확정)',
  )

  // ── 20b. 자기연결(from === to)도 문제로 보고되는가 (R5-6) ────────────────────
  // 예전에는 buildGraph 가 자기연결을 조용히 버렸다. 자기연결은 순환을 만들지 않으므로
  // 위상정렬 부족분에도 잡히지 않았고, 화살표만 그려진 채 problems=0 · provisional=false ·
  // preflight/reviewRequest 는 'final' 이라고 답했다 — JSON 불러오기나 AI 검토 왕복이
  // {from:'t1',to:'t1'} 를 실어 오면 그대로 통과한 것이다.
  const selfLinks: Link[] = [L('l-ee', 'E', 'E'), L('l-ef2', 'E', 'F')]
  const selfR = computeSchedule(tasks, selfLinks)
  console.log(`[자기연결] problems=${selfR.problems.length} warnings=${selfR.warnings.length}`)
  check(selfR.problems.length === 1, '자기연결 1개 = 미해결 문제 1건(예전에는 0건이었다)')
  check(selfR.warnings.length === 1, '자기연결도 경고 문자열을 남긴다(상태바 호환)')
  const selfP = must(selfR.problems[0], '자기연결 문제')
  check(selfP.kind === 'selfLink' && selfP.severity === 'error', "종류는 'selfLink' · 오류 등급")
  check(
    selfP.linkIds.length === 1 && selfP.linkIds[0] === 'l-ee',
    '문제 목록에서 지울 수 있도록 그 연결 id 를 지목한다',
  )
  check(
    selfP.taskIds.length === 1 && selfP.taskIds[0] === 'E',
    '자기 자신을 문 공정 하나만 지목(무관한 공정은 범인이 아니다)',
  )
  check(selfP.message.includes('E'), '설명에 그 공정 이름이 들어간다')
  check(
    selfR.tasks.every((t) => Number.isFinite(t.es) && Number.isFinite(t.ef)),
    '자기연결이 있어도 계산은 계속된다(무시하되 침묵하지 않는다)',
  )
  check(
    computeSchedule(tasks, selfLinks).problems[0]?.id === selfP.id,
    '자기연결 문제 id 도 호출마다 동일(목록 key 안정)',
  )
  check(
    applyCascade(tasks, selfLinks).problems.length === 1 &&
      reschedule(tasks, selfLinks).problems.length === 1,
    '연쇄 정렬·재계산 경로도 자기연결을 같은 문제로 노출',
  )
  check(
    computeSchedule(tasks, [L('l-ef3', 'E', 'F')]).problems.length === 0,
    '대조군: 정상 연결만 있으면 문제 0건(과잉 보고 아님)',
  )
  // 자기연결 + 순환이 함께 있어도 서로를 삼키지 않는다.
  const mixed = computeSchedule(tasks, [...links, L('l-gg', 'G', 'G')])
  check(
    mixed.problems.length === 3 && mixed.problems.filter((p) => p.kind === 'cycle').length === 2,
    `자기연결이 순환 보고를 삼키지 않는다 (문제 ${mixed.problems.length}건)`,
  )
}

// 21. 출력 사전 점검이 '미해결 경고'를 명시하는가(F10) — 확정본으로 오해하고 배포하는 사고 방지.
console.log('')
{
  const paper = { ...project.paper, size: 'A1' as const, orientation: 'landscape' as const }
  const FILTER_OFF = { critical: false, milestone: false, query: '' }
  const clean = exportPreflight({
    project,
    filter: FILTER_OFF,
    scope: 'full',
    paper,
    format: 'png',
  })
  check(
    clean.unresolvedProblems === 0 && clean.provisional === false,
    '정상 도면 출력 점검: 미해결 0건 · 확정 산정',
  )
  check(
    !clean.warnings.some((w) => w.includes('미해결 일정 문제')),
    '정상 도면에는 잠정 경고가 뜨지 않는다',
  )
  // 실제 도면에 순환을 하나 심는다(두 공정을 서로 물리게).
  const t0 = project.tasks[0],
    t1 = project.tasks[1]
  const cyclic = {
    ...project,
    links: [
      ...project.links,
      { id: 'x1', from: t0.id, to: t1.id, type: 'FS' as const, lag: 0 },
      { id: 'x2', from: t1.id, to: t0.id, type: 'FS' as const, lag: 0 },
    ],
  }
  const pre = exportPreflight({
    project: cyclic,
    filter: FILTER_OFF,
    scope: 'full',
    paper,
    format: 'png',
  })
  check(pre.unresolvedProblems >= 1 && pre.provisional, '순환이 있으면 출력 점검이 잠정으로 판정')
  check(
    pre.warnings.some((w) => w.includes('미해결 일정 문제') && w.includes('잠정')),
    '출력 경고 목록에 미해결 문제·잠정 산정이 명시된다',
  )
  // 자기연결도 같은 경로로 흘러야 한다 — 예전에는 preflight 가 '확정'을,
  // reviewRequest 가 'scheduleStatus: final' 을 답해 그대로 배포·외부 검토로 나갔다.
  const selfLinked = {
    ...project,
    links: [...project.links, { id: 'self1', from: t0.id, to: t0.id, type: 'FS' as const, lag: 0 }],
  }
  const selfPre = exportPreflight({
    project: selfLinked,
    filter: FILTER_OFF,
    scope: 'full',
    paper,
    format: 'png',
  })
  check(
    selfPre.unresolvedProblems >= 1 && selfPre.provisional,
    '자기연결이 있으면 출력 점검도 잠정으로 판정(예전: 확정)',
  )
  check(
    buildReviewRequestMd(selfLinked).includes('scheduleStatus: provisional'),
    'AI 검토 요청서도 자기연결을 잠정으로 표기한다(예전: final)',
  )
  check(
    buildReviewRequestMd(project).includes('scheduleStatus: final'),
    '대조군: 정상 도면은 여전히 final 로 나간다',
  )
}

// 22. **실제 스토어** 커밋 경로로 본 편집 의미론(F09) + 문제 목록 상태(F10).
//     19번이 순수 엔진(previewEdit)을 검증한다면, 여기서는 store 의 드래그 커밋 경로
//     (beginGesture → setTaskStartLive → endGesture)와 undo 를 그대로 태워
//     "사전 표시 = 실제 커밋 결과", "제약 유지에서 lag 불변", "되돌리기 1회 복원"을 확인한다.
console.log('')
{
  const st = () => useEditor.getState()
  const base = makeProject('construction', 'concrete-gravity')
  const cat = base.categories[0].id
  const mkProj = (): Project => {
    const p: Project = JSON.parse(JSON.stringify(base))
    p.tasks = [
      { id: 'p', categoryId: cat, name: 'p', start: 10, duration: 20, isMilestone: false },
      { id: 'q', categoryId: cat, name: 'q', start: 0, duration: 12, isMilestone: false },
      { id: 's', categoryId: cat, name: 's', start: 47, duration: 8, isMilestone: false },
      { id: 'd', categoryId: cat, name: 'd', start: 80, duration: 10, isMilestone: false },
    ]
    p.links = [
      { id: 'lp', from: 'p', to: 's', type: 'FS', lag: 17 }, // 47 − 30
      { id: 'lq', from: 'q', to: 's', type: 'SS', lag: 47 }, // 47 − 0
      { id: 'ld', from: 's', to: 'd', type: 'FS', lag: 25 }, // 80 − 55
    ]
    return p
  }
  const lagsNow = () => JSON.stringify(st().project.links.map((l) => [l.id, l.lag]))
  const taskNow = (id: string): Task =>
    must(
      st().project.tasks.find((t) => t.id === id),
      id,
    )

  console.log('\n[스토어] 드래그 커밋 · 편집 의미론 · 되돌리기')
  // ── (가) 위치 자유 편집: 사전 표시(previewEdit) 그대로 커밋되는가 ──
  st().setProject(mkProj())
  st().setEditMode('free')
  const impFree = must(
    previewEdit(
      st().project.tasks,
      st().project.links,
      { id: 's', start: 57 },
      'free',
      st().autoCascade,
    ),
    '미리보기',
  )
  st().beginGesture()
  st().setTaskStartLive('s', 57)
  st().endGesture()
  check(
    taskNow('s').start === impFree.target.startAfter,
    `자유편집 커밋: 시작일 ${taskNow('s').start} = 사전 표시 ${impFree.target.startAfter}`,
  )
  check(
    st()
      .project.links.filter((l) => l.to === 's')
      .every((l) => {
        const c = impFree.lagChanges.find((x) => x.linkId === l.id)
        return c ? l.lag === c.after : true
      }) && impFree.lagChanges.length === 2,
    '자유편집 커밋: 두 선행 지연이 사전 표시된 값으로 갱신됨',
  )
  check(
    taskNow('d').start === impFree.successorMoves.find((m) => m.id === 'd')?.after,
    `자유편집 커밋: 후행 d 가 사전 표시대로 이동(${taskNow('d').start})`,
  )
  // 되돌리기 — 한 번의 undo 로 시작일과 지연이 **함께** 원복(제스처 = undo 1엔트리)
  check(st().canUndo, '드래그 제스처가 undo 스택에 1엔트리로 쌓임')
  st().undo()
  check(
    taskNow('s').start === 47 &&
      lagsNow() ===
        JSON.stringify([
          ['lp', 17],
          ['lq', 47],
          ['ld', 25],
        ]),
    '되돌리기 1회로 시작일과 지연이 함께 원복(카드의 [되돌리기]가 정직하다)',
  )
  check(st().lastEditImpact === null, '되돌리면 영향 카드도 함께 내려간다')

  // ── (나) 선후행 제약 유지: lag 는 단 1건도 바뀌지 않는다 ──
  st().setProject(mkProj())
  st().setEditMode('keepLinks')
  const lagsBefore = lagsNow()
  st().beginGesture()
  st().setTaskStartLive('s', 37) // 제약(47)보다 10일 앞으로 — 막혀야 한다
  st().endGesture()
  check(lagsNow() === lagsBefore, '제약유지 드래그: 커밋 후 lag 배열이 바이트 동일')
  check(
    taskNow('s').start === 47,
    `제약유지 드래그: 선행 제약(47)에 막힘 (현재 ${taskNow('s').start})`,
  )
  st().beginGesture()
  st().setTaskSpanLive('s', 47, 20) // 기간 변경(FF/SF 였다면 자유편집은 lag 를 고쳤을 자리)
  st().endGesture()
  check(lagsNow() === lagsBefore, '제약유지 기간변경: 커밋 후에도 lag 불변')
  st().updateTask('s', { start: 20 }) // 인스펙터 직접 입력 경로도 같은 규칙
  check(
    lagsNow() === lagsBefore && taskNow('s').start === 47,
    '제약유지 인스펙터 입력: lag 불변 + 위치 clamp',
  )
  // 같은 편집을 자유 편집으로 하면 lag 가 실제로 바뀐다(위 불변이 공허하지 않음을 증명)
  st().setProject(mkProj())
  st().setEditMode('free')
  st().updateTask('s', { start: 37 })
  check(lagsNow() !== lagsBefore, '대조군: 자유 편집에서는 같은 편집이 lag 를 바꾼다')
  st().setEditMode('free')

  // ── (다) 문제 목록/잠정 상태가 스토어에 반영되는가 ──
  const cyc = mkProj()
  // 체인(p·q·s·d)과 무관한 **서로 독립인** 두 순환을 심는다(A↔B, C↔D).
  for (const id of ['A', 'B', 'C', 'D'])
    cyc.tasks.push({ id, categoryId: cat, name: id, start: 0, duration: 5, isMilestone: false })
  cyc.links.push({ id: 'x-ab', from: 'A', to: 'B', type: 'FS', lag: 0 })
  cyc.links.push({ id: 'x-ba', from: 'B', to: 'A', type: 'FS', lag: 0 })
  cyc.links.push({ id: 'x-cd', from: 'C', to: 'D', type: 'FS', lag: 0 })
  cyc.links.push({ id: 'x-dc', from: 'D', to: 'C', type: 'FS', lag: 0 })
  st().setProject(cyc)
  check(st().problems.length === 2 && st().provisional, '스토어: 순환 2건 → 문제 2건 · 잠정 true')
  check(
    st().problems.every((p) => p.taskIds.length >= 2 && p.linkIds.length >= 1),
    '스토어 문제 항목마다 이동할 공정·연결이 들어 있다',
  )
  st().deleteLink('x-ba')
  check(st().problems.length === 1 && st().provisional, '연결 하나를 지우면 1건만 남고 여전히 잠정')
  st().deleteLink('x-dc')
  check(
    st().problems.length === 0 && !st().provisional && st().warnings.length === 0,
    '모두 해결하면 문제·경고 0건 · 잠정 해제(확정 산정)',
  )

  // ── (라) 영향 카드의 ↩ 되돌리기 자격 판정(R5-3) ──
  // 카드는 봉인 시점의 되돌리기 스택 깊이를 들고 있다. 그 뒤 다른 편집이 쌓이면 카드가
  // 설명하는 편집은 더 이상 스택 맨 위가 아니므로 ↩ 는 **엉뚱한 편집**을 되돌리게 된다.
  const cardImpact = must(
    previewEdit(mkProj().tasks, mkProj().links, { id: 's', start: 40 }, 'free', true),
    '영향 카드용 previewEdit',
  )
  check(
    editImpactUndoable({ ...cardImpact, historyDepth: 3 }, 3),
    '봉인 깊이와 현재 깊이가 같으면 되돌릴 수 있다',
  )
  check(
    !editImpactUndoable({ ...cardImpact, historyDepth: 3 }, 4),
    '그 뒤 다른 편집이 쌓이면(깊이 증가) 되돌릴 수 없다',
  )
  check(
    !editImpactUndoable({ ...cardImpact, historyDepth: 3 }, 2),
    '되돌리기로 깊이가 줄어든 뒤에도 되돌릴 수 없다',
  )
  check(
    !editImpactUndoable(cardImpact as EditImpact, 0),
    '봉인 깊이가 없는 카드(미기록)는 안전한 쪽 — 되돌리기 금지',
  )
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
