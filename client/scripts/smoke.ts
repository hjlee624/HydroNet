// Headless smoke test of the pure pipeline (no DOM): sample → CPM → layout →
// routing. Verifies there are no exceptions, no NaN geometry, and that the
// critical spine and milestones come out as expected. Run: npx tsx scripts/smoke.ts
import { createSampleProject } from '../src/data/sampleProject'
import {
  computeSchedule,
  applyCascade,
  linkConstrainedStart,
  linkLagFromPositions,
} from '../src/engine/scheduling'
import { computeLayout, fitToPaperView } from '../src/engine/layout'
import { PROJECT_TYPES, makeProject } from '../src/data/templates'
import { FACILITY_TYPES, facilitySchedule } from '../src/data/facilities'
import { routeLinks } from '../src/engine/routing'
import { paperPx } from '../src/engine/paper'
import { projectKpis, toNum } from '../src/engine/kpis'
import { dayToDate } from '../src/engine/dates'
import { augmentForMirror, mirrorActive, planMirrorView } from '../src/engine/mirror'

let failures = 0
function check(cond: boolean, label: string) {
  if (!cond) {
    failures++
    console.error('  ✗ ' + label)
  } else console.log('  ✓ ' + label)
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
check(sched.criticalCount >= 5, `주공정이 충분히 식별됨 (${sched.criticalCount} ≥ 5)`)
check(
  sched.tasks.every((t) => Number.isFinite(t.es!) && Number.isFinite(t.ef!)),
  '모든 ES/EF가 유한값',
)
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
    `${f.label}: 마일스톤 이름 중복 없음${dup.length ? ' — ' + dup.join(',') : ''}`,
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
    !!lastEnd && lastEnd.start >= workEnd - 1,
    `${f.label}: 준공/상업운전이 작업 종료 이후(${Math.round((lastEnd?.start ?? 0) / 30)}≥${Math.round(workEnd / 30)}mo)`,
  )
  const startMs = data.tasks.find((t) => t.isMilestone && /착공|착수/.test(t.name))
  check(!!startMs && startMs.start <= workStart + 1, `${f.label}: 착공/착수가 첫 공정 이전·동시`)
}

// 7c. 한 줄(row) 패키지 모델 — 양수발전 상부댐: 굴착→축조→페이스슬라브→충수가 한 행에
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = pp.categories.find((c) => c.name === '댐공사')!
  const upper = pm.tasks.filter(
    (lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'),
  )
  const cys = new Set(upper.map((lt) => Math.round(lt.cy)))
  check(
    upper.length >= 4 && cys.size === 1,
    `상부댐 4공정이 한 줄(같은 행)에 배치 (${upper.length}공정·행수 ${cys.size})`,
  )
  const ordered = [...upper].sort((a, b) => a.task.start - b.task.start).map((lt) => lt.task.name)
  check(
    ordered.length > 0 &&
      ordered[0].includes('굴착') &&
      ordered[ordered.length - 1].includes('충수'),
    `상부댐 순서: ${ordered.join(' → ')}`,
  )
  // 댐공사 레인은 상·하부댐 2줄 → 한 패키지를 여러 줄로도 표현
  const damRows = new Set(
    pm.tasks.filter((lt) => lt.categoryId === damCat.id).map((lt) => lt.subRow),
  )
  check(damRows.size === 2, `댐공사 레인 = 상·하부댐 2줄 (행수 ${damRows.size})`)
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

// 7d. 한 줄 패키지의 순차 막대 사이 화살표는 수평(옆으로) — same-row forward route
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = pp.categories.find((c) => c.name === '댐공사')!
  const upper = pm.tasks
    .filter((lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'))
    .sort((a, b) => a.task.start - b.task.start)
  const a0 = upper[0].task.id,
    a1 = upper[1].task.id
  const link = pp.links.find((l) => l.from === a0 && l.to === a1)
  if (link) {
    const r = routeLinks(pm, [link])[0]
    const flat = Math.abs(r.arrowY - upper[0].cy) < 2 // 화살표가 같은 행 높이로 도착(수평)
    check(flat, '같은 줄 순차 공정 화살표가 수평(옆으로) 도착')
  } else check(false, '상부댐 굴착→축조 연결 존재')
}

// 8. projectKpis — 단일 셀렉터(일정·진척·원가·EVM·경보·베이스라인) 무결성
console.log('')
{
  const midDay = Math.round(sched.projectEndDay * 0.6)
  const asOf = dayToDate(project.startDate, midDay)
  const tasksWithProgress = sched.tasks.map((t, i) =>
    !t.isMilestone ? { ...t, progress: i % 3 === 0 ? 100 : i % 3 === 1 ? 50 : 0 } : t,
  )
  const kp = {
    ...project,
    tasks: tasksWithProgress,
    modules: {
      cost: [
        { id: 'c1', values: { group: '공사비', budget: '50000', spent: '30000' } },
        { id: 'c2', values: { group: '설계비', budget: '100000', spent: '40000' } },
      ],
      boq: [
        { id: 'b1', values: { qty: '10', price: '50000' } },
        { id: 'b2', values: { qty: '5', price: '20000' } },
      ],
      risk: [
        { id: 'r1', values: { status: '열림' } },
        { id: 'r2', values: { status: '종료' } },
      ],
    },
  }
  const k = projectKpis(kp, asOf)
  check(
    k.cost.budget === 150000 && k.cost.spent === 70000,
    `cost 합계(천원) budget=150000 spent=70000 (got ${k.cost.budget}/${k.cost.spent})`,
  )
  check(k.cost.burnPct === Math.round((70000 / 150000) * 100), `소진율=${k.cost.burnPct}%`)
  check(k.boq.total === 600000, `boq 공사비 합계(원)=600000 (got ${k.boq.total})`)
  check(
    k.evm.costAvailable && k.evm.ac === 70000 && k.evm.bac === 150000,
    'EVM costAvailable·BAC·AC 일치',
  )
  const evOk = Math.abs(k.evm.ev - (k.evm.bac * k.progress.actualPct) / 100) < 1e-6
  const spiOk =
    k.progress.plannedPct > 0
      ? Math.abs(k.evm.spi - k.progress.actualPct / k.progress.plannedPct) < 1e-6
      : k.evm.spi === 0
  check(evOk && spiOk, 'EVM EV=BAC×실적%, SPI=실적/계획 일관')
  check(
    Math.abs(k.evm.cpi - k.evm.ev / k.evm.ac) < 1e-6 && Number.isFinite(k.evm.eac),
    `CPI=EV/AC, EAC 유한 (cpi=${k.evm.cpi.toFixed(2)})`,
  )
  check(
    [k.progress.actualPct, k.progress.plannedPct, k.evm.pv, k.evm.cv, k.cost.balance].every(
      Number.isFinite,
    ),
    'KPI 핵심값 모두 유한(NaN 없음)',
  )
  check(
    k.alerts.some((a) => a.module === 'risk' && a.count === 1),
    '리스크 경보(열림 1건) 집계',
  )
  check(k.baseline === null, '기준선 없으면 baseline=null')
  check(
    toNum('1,000') === 1000 && toNum('') === 0 && toNum('abc') === 0,
    'toNum: 천단위/빈칸/비숫자 처리',
  )

  // 결측: 빈 프로젝트는 NaN/Infinity 없이 0으로 수렴
  const empty = { ...project, tasks: [], links: [], modules: {} }
  const ke = projectKpis(empty, asOf)
  check(
    !ke.cost.hasCost && !ke.evm.costAvailable && ke.evm.spi === 0 && ke.evm.cpi === 0,
    '빈 프로젝트: cost/EVM 비활성·0(분모0 가드)',
  )
  check(
    [ke.schedule.elapsedPct, ke.progress.actualPct, ke.evm.eac].every(Number.isFinite),
    '빈 프로젝트: 모든 수치 유한',
  )

  // 베이스라인 드리프트: 일부 공정을 뒤로 밀면 slipped 집계
  const base = {
    capturedAt: asOf.toISOString(),
    asOf: asOf.toISOString().slice(0, 10),
    startDay: 0,
    endDay: sched.projectEndDay,
    tasks: sched.tasks.map((t) => ({ id: t.id, start: t.es ?? t.start, duration: t.duration })),
  }
  const shifted = sched.tasks.map((t, i) =>
    i < 3 && !t.isMilestone ? { ...t, es: (t.es ?? t.start) + 20, start: t.start + 20 } : t,
  )
  const kb = projectKpis({ ...project, tasks: shifted, baseline: base }, asOf)
  check(
    kb.baseline !== null && kb.baseline.slippedCount >= 1,
    `기준선 대비 표류 집계(slipped=${kb.baseline?.slippedCount})`,
  )

  // 시트 인지: 다른 공정표에서 박제한 기준선은 표류 비교를 가린다(설계 사업 시트 전환).
  const active = { id: 'sh-plan', role: 'plan' as const, name: '예정공정표' }
  const kMismatch = projectKpis(
    { ...project, tasks: shifted, activeSheet: active, baseline: { ...base, sheetId: 'sh-ms' } },
    asOf,
  )
  check(kMismatch.baseline === null, '다른 공정표에서 박제한 기준선은 표류 비교 안 함(null)')
  const kMatch = projectKpis(
    { ...project, tasks: shifted, activeSheet: active, baseline: { ...base, sheetId: 'sh-plan' } },
    asOf,
  )
  check(
    kMatch.baseline !== null && kMatch.baseline.slippedCount >= 1,
    '같은 공정표 기준선은 표류 계산',
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

// 16. 좌측 WBS 라벨열(view.taskColumn) — 공종명을 레인 상단 헤더로 올려 도면이 높아지되,
//     공정명은 항상 막대 위에 표기하므로 라벨열을 공정명 폭까지 넓히지 않는다(좌측=WBS 전용).
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
  check(inject('name').labelWidth === on.labelWidth, '긴 공정명이 라벨열 폭을 바꾸지 않음(공정명은 막대 위)')
  // 세부공종(WBS)은 좌측에 표기하므로 길어지면 라벨열을 넓힌다.
  check(inject('subName').labelWidth > on.labelWidth, '긴 세부공종명은 라벨열을 넓힌다(WBS는 좌측 표기)')
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
  const la = m.tasks.find((t: any) => t.task.id === 'A')!
  const lb = m.tasks.find((t: any) => t.task.id === 'B')!
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

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
