// Headless smoke test of the pure pipeline (no DOM): sample → CPM → layout →
// routing. Verifies there are no exceptions, no NaN geometry, and that the
// critical spine and milestones come out as expected. Run: npx tsx scripts/smoke.ts
import { createSampleProject } from '../src/data/sampleProject'
import { computeSchedule, applyCascade } from '../src/engine/scheduling'
import { computeLayout, fitToPaperView } from '../src/engine/layout'
import { PROJECT_TYPES, makeProject } from '../src/data/templates'
import { FACILITY_TYPES, facilitySchedule } from '../src/data/facilities'
import { routeLinks } from '../src/engine/routing'
import { paperPx } from '../src/engine/paper'
import { projectKpis, toNum } from '../src/engine/kpis'
import { dayToDate } from '../src/engine/dates'

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

// 3b. Fit-to-paper: content aspect ratio should match the sheet (no export letterbox)
const fitPatch = fitToPaperView(scheduledProject, 841, 594) // A1 landscape
const fitted = computeLayout({ ...scheduledProject, view: { ...scheduledProject.view, ...fitPatch } })
const fittedAspect = fitted.contentWidth / fitted.contentHeight
const paperAspect = 841 / 594
console.log(`\n[Fit] A1↻ paper=${paperAspect.toFixed(3)}  fitted=${fittedAspect.toFixed(3)}  patch=${JSON.stringify(fitPatch)}`)
check(Math.abs(fittedAspect - paperAspect) / paperAspect < 0.02, `시트에 맞추면 종횡비 일치 (도면 ${fittedAspect.toFixed(3)} ≈ 용지 ${paperAspect.toFixed(3)})`)
check(Number.isFinite(fitted.contentWidth) && Number.isFinite(fitted.contentHeight), '맞춤 후 좌표 유한')
check(fitPatch.fontScale === undefined || (Number.isFinite(fitPatch.fontScale) && fitPatch.fontScale >= 1), '맞춤 글자 배율은 유한하며 축소하지 않음(≥1)')

// 3b-ii. Fit converges on a PORTRAIT sheet too (labelWidth↔fontScale feedback)
const portraitPatch = fitToPaperView(scheduledProject, 210, 297) // A4 portrait
const portraitFit = computeLayout({ ...scheduledProject, view: { ...scheduledProject.view, ...portraitPatch } })
const portraitAspect = portraitFit.contentWidth / portraitFit.contentHeight
const portraitTarget = 210 / 297
console.log(`[Fit A4↕] paper=${portraitTarget.toFixed(3)} fitted=${portraitAspect.toFixed(3)} patch=${JSON.stringify(portraitPatch)}`)
check(Math.abs(portraitAspect - portraitTarget) / portraitTarget < 0.03, `세로 용지도 맞춤이 수렴(여백≈0) (${portraitAspect.toFixed(3)} ≈ ${portraitTarget.toFixed(3)})`)

// 3c. Enlarging text grows its band/rows so glyphs aren't clipped
const bigText = computeLayout({ ...scheduledProject, view: { ...scheduledProject.view, fontScale: 3 } })
console.log(`\n[Responsive] fontScale 3 → 제목 ${model.titleHeight}→${bigText.titleHeight}, 헤더 ${model.headerHeight}→${bigText.headerHeight}, 행 ${model.rowHeight}→${bigText.rowHeight}`)
check(bigText.titleHeight > model.titleHeight, '글자 키우면 제목 칸이 커짐(잘림 방지)')
check(bigText.rowHeight > model.rowHeight, '글자 키우면 행 높이가 커짐')
check(bigText.headerHeight > model.headerHeight, '글자 키우면 헤더 칸이 커짐')

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

// 7. 사업 유형(단계) 프리셋 — 활성 시트 + (설계는) 마일스톤 시트가 모두 유효
console.log('')
for (const t of PROJECT_TYPES) {
  const p = t.make()
  const m = computeLayout(p)
  const finite = m.tasks.every((lt) => Number.isFinite(lt.x) && Number.isFinite(lt.cy) && lt.w >= 0)
  const nSheets = 1 + (p.sheets?.length ?? 0)
  check(finite && m.categories.length > 0, `유형 프리셋 유효: ${t.label} (공종 ${m.categories.length}·바 ${m.tasks.length}·시트 ${nSheets})`)
  // 시공=마일스톤만(시트 1), 설계=예정공정표+마일스톤(시트 2)
  const ms = (p.sheets ?? []).find((s) => s.role === 'milestone')
  if (t.kind === 'construction') check(nSheets === 1 && p.activeSheet?.role === 'milestone', `${t.label}: 마일스톤 시트만`)
  else {
    check(!!ms && p.activeSheet?.role === 'plan', `${t.label}: 예정공정표(활성) + 마일스톤 시트`)
    if (ms) {
      const mm = computeLayout({ ...p, categories: ms.categories, tasks: ms.tasks, links: ms.links, rainySeasons: ms.rainySeasons })
      check(mm.tasks.length > 0 && mm.tasks.every((lt) => Number.isFinite(lt.cy)), `${t.label}: 마일스톤 시트 유효(${mm.tasks.length})`)
    }
  }
}

// 7b. 시설물 유형 프리셋 — 모든 유형이 유효한 시공 공정표(공종·바·화살표)를 생성
console.log('')
for (const f of FACILITY_TYPES) {
  const data = facilitySchedule(f.key)
  const fp = makeProject('construction', f.key)
  const fm = computeLayout(fp)
  const finite = fm.tasks.every((lt) => Number.isFinite(lt.x) && Number.isFinite(lt.cy) && lt.w >= 0)
  const fr = routeLinks(fm, fp.links)
  const routesOk = fr.every((r) => r.d.length > 0 && !r.d.includes('NaN'))
  check(finite && fm.categories.length > 0 && routesOk && data.tasks.length > 0,
    `시설물 프리셋 유효: ${f.label} (공종 ${fm.categories.length}·바 ${fm.tasks.length})`)
  // 마일스톤 위생(적대적 리뷰 수정): 같은 이름 마일스톤 중복 없음, 준공/상업운전은 작업
  // 종료 이후, 착공/착수는 첫 공정 이전·동시.
  const msNames = data.tasks.filter((t) => t.isMilestone).map((t) => t.name)
  const dup = msNames.filter((n, i) => msNames.indexOf(n) !== i)
  check(dup.length === 0, `${f.label}: 마일스톤 이름 중복 없음${dup.length ? ' — ' + dup.join(',') : ''}`)
  const workEnd = Math.max(...data.tasks.filter((t) => !t.isMilestone).map((t) => t.start + t.duration))
  const workStart = Math.min(...data.tasks.map((t) => t.start))
  const endMs = data.tasks.filter((t) => t.isMilestone && /준공|상업운전/.test(t.name)).sort((a, b) => a.start - b.start)
  const lastEnd = endMs[endMs.length - 1]
  check(!!lastEnd && lastEnd.start >= workEnd - 1, `${f.label}: 준공/상업운전이 작업 종료 이후(${Math.round((lastEnd?.start ?? 0) / 30)}≥${Math.round(workEnd / 30)}mo)`)
  const startMs = data.tasks.find((t) => t.isMilestone && /착공|착수/.test(t.name))
  check(!!startMs && startMs.start <= workStart + 1, `${f.label}: 착공/착수가 첫 공정 이전·동시`)
}

// 7c. 한 줄(row) 패키지 모델 — 양수발전 상부댐: 굴착→축조→페이스슬라브→충수가 한 행에
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = pp.categories.find((c) => c.name === '댐공사')!
  const upper = pm.tasks.filter((lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'))
  const cys = new Set(upper.map((lt) => Math.round(lt.cy)))
  check(upper.length >= 4 && cys.size === 1, `상부댐 4공정이 한 줄(같은 행)에 배치 (${upper.length}공정·행수 ${cys.size})`)
  const ordered = [...upper].sort((a, b) => a.task.start - b.task.start).map((lt) => lt.task.name)
  check(ordered.length > 0 && ordered[0].includes('굴착') && ordered[ordered.length - 1].includes('충수'),
    `상부댐 순서: ${ordered.join(' → ')}`)
  // 댐공사 레인은 상·하부댐 2줄 → 한 패키지를 여러 줄로도 표현
  const damRows = new Set(pm.tasks.filter((lt) => lt.categoryId === damCat.id).map((lt) => lt.subRow))
  check(damRows.size === 2, `댐공사 레인 = 상·하부댐 2줄 (행수 ${damRows.size})`)
  // 링크 선 스타일(실선/점선)이 라우팅 결과에 전달됨
  const styled = pp.links.length ? [{ ...pp.links[0], style: 'dotted' as const }, ...pp.links.slice(1)] : []
  const sr = routeLinks(pm, styled)
  check(styled.length === 0 || sr.some((r) => r.style === 'dotted'), '링크 선 스타일이 라우팅 결과에 전달됨')
}

// 7d. 한 줄 패키지의 순차 막대 사이 화살표는 수평(옆으로) — same-row forward route
{
  const pp = makeProject('construction', 'pumped')
  const pm = computeLayout(pp)
  const damCat = pp.categories.find((c) => c.name === '댐공사')!
  const upper = pm.tasks.filter((lt) => lt.categoryId === damCat.id && (lt.task.subName ?? '').includes('상부댐'))
    .sort((a, b) => a.task.start - b.task.start)
  const a0 = upper[0].task.id, a1 = upper[1].task.id
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
    !t.isMilestone ? { ...t, progress: i % 3 === 0 ? 100 : i % 3 === 1 ? 50 : 0 } : t)
  const kp = {
    ...project, tasks: tasksWithProgress,
    modules: {
      cost: [
        { id: 'c1', values: { group: '공사비', budget: '50000', spent: '30000' } },
        { id: 'c2', values: { group: '설계비', budget: '100000', spent: '40000' } },
      ],
      boq: [
        { id: 'b1', values: { qty: '10', price: '50000' } },
        { id: 'b2', values: { qty: '5', price: '20000' } },
      ],
      risk: [{ id: 'r1', values: { status: '열림' } }, { id: 'r2', values: { status: '종료' } }],
    },
  }
  const k = projectKpis(kp, asOf)
  check(k.cost.budget === 150000 && k.cost.spent === 70000, `cost 합계(천원) budget=150000 spent=70000 (got ${k.cost.budget}/${k.cost.spent})`)
  check(k.cost.burnPct === Math.round((70000 / 150000) * 100), `소진율=${k.cost.burnPct}%`)
  check(k.boq.total === 600000, `boq 공사비 합계(원)=600000 (got ${k.boq.total})`)
  check(k.evm.costAvailable && k.evm.ac === 70000 && k.evm.bac === 150000, 'EVM costAvailable·BAC·AC 일치')
  const evOk = Math.abs(k.evm.ev - (k.evm.bac * k.progress.actualPct) / 100) < 1e-6
  const spiOk = k.progress.plannedPct > 0 ? Math.abs(k.evm.spi - k.progress.actualPct / k.progress.plannedPct) < 1e-6 : k.evm.spi === 0
  check(evOk && spiOk, 'EVM EV=BAC×실적%, SPI=실적/계획 일관')
  check(Math.abs(k.evm.cpi - k.evm.ev / k.evm.ac) < 1e-6 && Number.isFinite(k.evm.eac), `CPI=EV/AC, EAC 유한 (cpi=${k.evm.cpi.toFixed(2)})`)
  check([k.progress.actualPct, k.progress.plannedPct, k.evm.pv, k.evm.cv, k.cost.balance].every(Number.isFinite), 'KPI 핵심값 모두 유한(NaN 없음)')
  check(k.alerts.some((a) => a.module === 'risk' && a.count === 1), '리스크 경보(열림 1건) 집계')
  check(k.baseline === null, '기준선 없으면 baseline=null')
  check(toNum('1,000') === 1000 && toNum('') === 0 && toNum('abc') === 0, "toNum: 천단위/빈칸/비숫자 처리")

  // 결측: 빈 프로젝트는 NaN/Infinity 없이 0으로 수렴
  const empty = { ...project, tasks: [], links: [], modules: {} }
  const ke = projectKpis(empty, asOf)
  check(!ke.cost.hasCost && !ke.evm.costAvailable && ke.evm.spi === 0 && ke.evm.cpi === 0, '빈 프로젝트: cost/EVM 비활성·0(분모0 가드)')
  check([ke.schedule.elapsedPct, ke.progress.actualPct, ke.evm.eac].every(Number.isFinite), '빈 프로젝트: 모든 수치 유한')

  // 베이스라인 드리프트: 일부 공정을 뒤로 밀면 slipped 집계
  const base = { capturedAt: asOf.toISOString(), asOf: asOf.toISOString().slice(0, 10), startDay: 0, endDay: sched.projectEndDay, tasks: sched.tasks.map((t) => ({ id: t.id, start: t.es ?? t.start, duration: t.duration })) }
  const shifted = sched.tasks.map((t, i) => (i < 3 && !t.isMilestone ? { ...t, es: (t.es ?? t.start) + 20, start: t.start + 20 } : t))
  const kb = projectKpis({ ...project, tasks: shifted, baseline: base }, asOf)
  check(kb.baseline !== null && kb.baseline.slippedCount >= 1, `기준선 대비 표류 집계(slipped=${kb.baseline?.slippedCount})`)

  // 시트 인지: 다른 공정표에서 박제한 기준선은 표류 비교를 가린다(설계 사업 시트 전환).
  const active = { id: 'sh-plan', role: 'plan' as const, name: '예정공정표' }
  const kMismatch = projectKpis({ ...project, tasks: shifted, activeSheet: active, baseline: { ...base, sheetId: 'sh-ms' } }, asOf)
  check(kMismatch.baseline === null, '다른 공정표에서 박제한 기준선은 표류 비교 안 함(null)')
  const kMatch = projectKpis({ ...project, tasks: shifted, activeSheet: active, baseline: { ...base, sheetId: 'sh-plan' } }, asOf)
  check(kMatch.baseline !== null && kMatch.baseline.slippedCount >= 1, '같은 공정표 기준선은 표류 계산')
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
