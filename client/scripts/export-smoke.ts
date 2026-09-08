// ─────────────────────────────────────────────────────────────────────────────
// 헤드리스 출력 검증 (F14 출력 범위·사전 점검 + F11 단축키 범위).
// DOM 없이 순수 모듈만 돌린다: export/preflight.ts, export/dxf.ts,
// engine/paper.ts, state/keymap.ts.  실행: npm run smoke:export
// ─────────────────────────────────────────────────────────────────────────────

import { createSampleProject } from '../src/data/sampleProject'
import { computeLayout, type LayoutFilter } from '../src/engine/layout'
import { paperPx, tilePages } from '../src/engine/paper'
import { computeSchedule } from '../src/engine/scheduling'
import { projectToDxf } from '../src/export/dxf'
import { exportDiagnostics, exportPreflight, MIN_FONT_PT } from '../src/export/preflight'
import { ALL_SHORTCUTS, KEYMAP, resolveAction } from '../src/state/keymap'
import type { PaperSettings, Project } from '../src/types/model'

let failures = 0
function check(cond: boolean, label: string) {
  if (!cond) {
    failures++
    console.error(`  ✗ ${label}`)
  } else console.log(`  ✓ ${label}`)
}

const base = createSampleProject()
const sched = computeSchedule(base.tasks, base.links)
const project: Project = { ...base, tasks: sched.tasks }

const FILTER_OFF: LayoutFilter = { critical: false, milestone: false, query: '' }
const FILTER_CRIT: LayoutFilter = { critical: true, milestone: false, query: '' }
const A4: PaperSettings = { size: 'A4', orientation: 'landscape', dpi: 150 }
const A1: PaperSettings = { size: 'A1', orientation: 'landscape', dpi: 150 }

// ── 1. 출력 범위가 선택과 일치하는가 ───────────────────────────────────────────
console.log('\n[출력 범위]')
const full = exportPreflight({
  project,
  filter: FILTER_CRIT,
  scope: 'full',
  paper: A4,
  format: 'png',
})
const view = exportPreflight({
  project,
  filter: FILTER_CRIT,
  scope: 'view',
  paper: A4,
  format: 'png',
})
const allTasks = computeLayout(project).tasks.length
console.log(
  `  전체=${full.taskCount}개 · 표시범위(주공정만)=${view.taskCount}개 · 레이아웃 전체=${allTasks}개`,
)
check(full.taskCount === allTasks, `'전체 도면'은 필터를 무시하고 전부 포함 (${full.taskCount})`)
check(full.filteredOut === 0, "'전체 도면'에서는 필터로 빠지는 공정이 0")
check(
  view.taskCount < full.taskCount,
  `'현재 표시 범위'는 필터로 실제로 줄어든다 (${view.taskCount} < ${full.taskCount})`,
)
check(
  view.filteredOut === full.taskCount - view.taskCount,
  `빠진 공정 수가 정확히 보고됨 (${view.filteredOut})`,
)
check(
  view.warnings.some((w) => w.includes(`${view.filteredOut}개 공정이 빠진`)),
  '표시 범위 출력 시 몇 개가 빠지는지 경고 문장으로 알려준다',
)
check(
  full.warnings.some((w) => w.includes('필터는 출력에 반영 안 됨')),
  '화면엔 필터가 걸렸지만 전체를 내보낸다는 사실을 경고한다',
)

// 필터가 없으면 두 범위는 같아야 한다(정책 회귀 가드).
const noFilterView = exportPreflight({
  project,
  filter: FILTER_OFF,
  scope: 'view',
  paper: A4,
  format: 'png',
})
check(noFilterView.taskCount === full.taskCount, '필터가 없으면 표시 범위 = 전체 도면')

// ── 2. 표시 OFF(숨김) 항목은 범위와 무관하게 빠지고, 그 사실이 보고된다 ────────
console.log('\n[숨김 항목]')
const hiddenLaneId = project.categories[1].id
const withHidden: Project = {
  ...project,
  categories: project.categories.map((c) => (c.id === hiddenLaneId ? { ...c, hidden: true } : c)),
}
const hiddenLaneTasks = project.tasks.filter((t) => t.categoryId === hiddenLaneId).length
const hFull = exportPreflight({
  project: withHidden,
  filter: FILTER_OFF,
  scope: 'full',
  paper: A4,
  format: 'png',
})
const hView = exportPreflight({
  project: withHidden,
  filter: FILTER_OFF,
  scope: 'view',
  paper: A4,
  format: 'png',
})
console.log(
  `  숨긴 공종 '${project.categories[1].name}' (공정 ${hiddenLaneTasks}개) → 전체=${hFull.taskCount}, 표시범위=${hView.taskCount}`,
)
check(hFull.hiddenCategories === 1, '숨긴 공종 1개가 집계된다')
check(hFull.taskCount === full.taskCount - hiddenLaneTasks, '숨긴 공종의 공정이 실제로 빠진다')
check(hView.taskCount === hFull.taskCount, '숨김은 두 범위 모두에서 동일하게 빠진다')
check(
  hFull.warnings.some((w) => w.includes('표시 OFF 항목')),
  '숨김 때문에 빠지는 항목이 있음을 경고한다',
)
const noHidden = exportPreflight({
  project,
  filter: FILTER_OFF,
  scope: 'full',
  paper: A4,
  format: 'png',
})
check(
  !noHidden.warnings.some((w) => w.includes('표시 OFF 항목')),
  '숨긴 항목이 없으면 그 경고는 나오지 않는다',
)

// ── 3. 최소 글자 크기(pt) — A4/150dpi 에서는 너무 작다고 경고해야 한다 ─────────
console.log('\n[최소 글자 크기]')
const a4 = exportPreflight({ project, filter: FILTER_OFF, scope: 'full', paper: A4, format: 'png' })
const a1 = exportPreflight({ project, filter: FILTER_OFF, scope: 'full', paper: A1, format: 'png' })
console.log(
  `  A4 150dpi → ${a4.minFontPt.toFixed(2)}pt (${a4.minFontRole}) · A1 150dpi → ${a1.minFontPt.toFixed(2)}pt · 기준 ${MIN_FONT_PT}pt`,
)
check(Number.isFinite(a4.minFontPt) && a4.minFontPt > 0, '최소 글자 크기가 유한·양수')
check(a4.minFontPt < MIN_FONT_PT, `A4 150dpi 에서 최소 글자가 ${MIN_FONT_PT}pt 미만으로 판정됨`)
check(
  a4.warnings.some((w) => w.includes('가장 작은 글자')),
  'A4 150dpi 에서 글자가 너무 작다는 경고가 실제로 생성된다',
)
check(
  a1.minFontPt > a4.minFontPt,
  `용지를 키우면 물리 글자 크기가 커진다 (A1 ${a1.minFontPt.toFixed(2)} > A4 ${a4.minFontPt.toFixed(2)})`,
)
check(!a1.warnings.some((w) => w.includes('가장 작은 글자')), 'A1 에서는 글자 크기 경고가 사라진다')

// 글자를 크게 키우면 경고가 사라지는지(사용자가 실제로 취할 수 있는 조치인지) 확인.
const bigFont: Project = { ...project, view: { ...project.view, fontScale: 6 } }
const bf = exportPreflight({
  project: bigFont,
  filter: FILTER_OFF,
  scope: 'full',
  paper: A4,
  format: 'png',
})
console.log(`  fontScale=6 → ${bf.minFontPt.toFixed(2)}pt`)
check(bf.minFontPt > a4.minFontPt, '글자 크기를 키우면 인쇄 pt 도 커진다(안내가 실제 해법)')

// ── 4. 분할 장수(타일) 가 engine/paper.ts 와 일치 ─────────────────────────────
console.log('\n[분할 장수]')
const px4 = paperPx(A4)
const m = computeLayout(project)
const drawScale = Math.min(px4.wPx / m.contentWidth, px4.hPx / m.contentHeight)
const legibleScale = drawScale * Math.max(1, MIN_FONT_PT / a4.minFontPt)
const expect = tilePages(
  m.contentWidth * legibleScale,
  m.contentHeight * legibleScale,
  px4.wPx,
  px4.hPx,
)
console.log(
  `  preflight ${a4.legibleCols}×${a4.legibleRows}=${a4.legiblePages}장 · tilePages ${expect.cols}×${expect.rows}=${expect.pages}장`,
)
check(a4.pages === 1, '현재 출력 엔진은 항상 1장(축소·레터박스)')
check(
  a4.legiblePages === expect.pages &&
    a4.legibleCols === expect.cols &&
    a4.legibleRows === expect.rows,
  '읽을 수 있는 크기의 분할 장수가 engine/paper.ts tilePages 와 일치',
)
check(tilePages(100, 100, 100, 100).pages === 1, 'tilePages: 딱 맞으면 1장')
check(tilePages(201, 100, 100, 100).pages === 3, 'tilePages: 가로 2.01배면 3장(3×1)')
check(tilePages(0, 0, 100, 100).pages === 1, 'tilePages: 0 입력에도 최소 1장(NaN 방지)')

// ── 5. 표시 기간 제한 ────────────────────────────────────────────────────────
console.log('\n[표시 기간]')
const ranged: Project = {
  ...project,
  view: { ...project.view, displayStart: '2026-03', displayEnd: '2027-02' },
}
const rp = exportPreflight({
  project: ranged,
  filter: FILTER_OFF,
  scope: 'full',
  paper: A4,
  format: 'png',
})
check(
  rp.rangeLimited && rp.rangeLabel === '2026-03 ~ 2027-02',
  `표시 기간 제한을 감지 (${rp.rangeLabel})`,
)
check(
  rp.warnings.some((w) => w.includes('표시 기간')),
  '표시 기간으로 잘린다는 사실을 경고한다',
)
check(!a4.rangeLimited, '표시 기간 미설정이면 제한 없음으로 본다')

// ── 6. DXF 도 같은 범위 규칙을 따른다 ────────────────────────────────────────
console.log('\n[DXF 범위]')
const dxfFull = projectToDxf(project)
const dxfView = projectToDxf(project, FILTER_CRIT)
console.log(`  전체 ${dxfFull.length} chars · 주공정만 ${dxfView.length} chars`)
check(dxfView.length < dxfFull.length, 'DXF도 표시 범위를 주면 실제로 작아진다')
check(
  dxfFull.includes('AC1009') && dxfFull.trimEnd().endsWith('EOF'),
  '전체 DXF 구조 정상(R12 · EOF)',
)
check(
  dxfView.includes('AC1009') && dxfView.trimEnd().endsWith('EOF'),
  '범위 DXF 구조 정상(R12 · EOF)',
)

// ── 7. 진단 텍스트 ───────────────────────────────────────────────────────────
console.log('\n[진단 정보]')
const diag = exportDiagnostics(
  { project, filter: FILTER_OFF, scope: 'full', paper: A4, format: 'png' },
  new Error('테스트 실패'),
)
check(diag.includes('용지: A4 가로'), '진단에 용지·방향이 들어간다')
check(diag.includes('테스트 실패'), '진단에 오류 메시지가 들어간다')
check(
  diag.includes('공정 수:') && diag.includes('최소 글자:'),
  '진단에 공정 수·최소 글자 크기가 들어간다',
)

// ── 8. 단축키 범위(F11) — {입력 중} × {대화상자} 전 조합 행동 검증 ────────────
// 예전 검사는 "도움말 표가 ALL_SHORTCUTS 를 전부 렌더한다"였는데, 그 표를 만드는 배열이
// 바로 ALL_SHORTCUTS 라 절대 실패할 수 없었다. 여기서는 **손으로 적은 기대표**(도움말
// 산문이 사용자에게 약속하는 내용)와 resolveAction 의 실제 결과를 맞춘다.
console.log('\n[단축키 범위]')

/** 문서에 적힌 키 표기(keys)로 실제 KeyboardEvent 형태를 만든다 — 표기↔매칭 드리프트도 잡힌다. */
function eventFor(b: (typeof KEYMAP)[number]) {
  const lower = b.keys.map((s) => s.toLowerCase())
  const last = b.keys[b.keys.length - 1]
  return {
    key: last === 'Esc' ? 'Escape' : last,
    ctrlKey: lower.includes('ctrl'),
    shiftKey: lower.includes('shift'),
  }
}

/**
 * 도움말 산문이 약속하는 계약 — 구현을 베끼지 않고 손으로 적는다.
 *   typing … 입력 칸(INPUT/TEXTAREA…)에 커서가 있을 때도 동작하는가
 *   modal  … 대화상자가 떠 있을 때도 동작하는가
 */
const EXPECT: Record<string, { typing: boolean; modal: boolean }> = {
  save: { typing: true, modal: true }, // 대화상자 위에서 살아남는 유일한 키
  escape: { typing: true, modal: false }, // 입력 칸에서도 연결 드래그는 취소된다
  undo: { typing: false, modal: false },
  redo: { typing: false, modal: false },
  copyCategories: { typing: false, modal: false },
  pasteCategories: { typing: false, modal: false },
  deleteSelection: { typing: false, modal: false },
  panMode: { typing: false, modal: false },
  editMode: { typing: false, modal: false },
}
check(
  KEYMAP.every((b) => EXPECT[b.id] !== undefined),
  `기대표가 KEYMAP 전체를 덮는다 (${KEYMAP.length}건)`,
)
for (const b of KEYMAP) {
  const e = eventFor(b)
  const want = EXPECT[b.id]
  if (!want) continue
  check(
    resolveAction(e, { typing: false, modal: false }) === b.id,
    `${b.keys.join('+')} → ${b.id} (도면에서 문서대로 동작)`,
  )
  check(
    resolveAction(e, { typing: true, modal: false }) === (want.typing ? b.id : null),
    `${b.keys.join('+')} · 입력 중 → ${want.typing ? b.id : '무시'}`,
  )
  check(
    resolveAction(e, { typing: false, modal: true }) === (want.modal ? b.id : null),
    `${b.keys.join('+')} · 대화상자 열림 → ${want.modal ? b.id : '무시'}`,
  )
  check(
    resolveAction(e, { typing: true, modal: true }) === (want.typing && want.modal ? b.id : null),
    `${b.keys.join('+')} · 대화상자 안 입력 칸 → ${want.typing && want.modal ? b.id : '무시'}`,
  )
}
// 도움말 산문의 핵심 주장 두 가지를 그대로 검증한다.
const modalAlive = KEYMAP.filter(
  (b) => resolveAction(eventFor(b), { typing: false, modal: true }) !== null,
).map((b) => b.id)
check(
  modalAlive.length === 1 && modalAlive[0] === 'save',
  `'대화상자 위에서는 Ctrl+S(저장) 하나만 동작' — 실제 생존: [${modalAlive.join(', ')}]`,
)
const typingAlive = KEYMAP.filter(
  (b) => resolveAction(eventFor(b), { typing: true, modal: false }) !== null,
).map((b) => b.id)
check(
  typingAlive.length === 2 && typingAlive.includes('save') && typingAlive.includes('escape'),
  `'입력 칸에서는 저장·Esc 만 동작' — 실제 생존: [${typingAlive.join(', ')}]`,
)
// Ctrl+Shift+Z(다시 실행)는 altKeys 표기라 eventFor 가 만들지 않는다 — 따로 본다.
check(
  resolveAction({ key: 'z', ctrlKey: true, shiftKey: true }, { typing: false, modal: false }) ===
    'redo',
  'Ctrl+Shift+Z 는 다시 실행',
)
check(
  ALL_SHORTCUTS.every(
    (d) => d.keys.length > 0 && d.keys.every((k) => k.trim() !== '') && d.label.trim() !== '',
  ),
  '모든 단축키 문서 항목이 키·설명을 갖는다(도움말 빈칸 방지)',
)

// ── 9. 서버 시드 왕복 — 공기 산정 전제(periodInputs)가 스냅샷에서 살아남는가 ──
// server/src/collab/seed.js 는 자기만의 project↔Y.Doc 매핑을 갖고 있어, 클라이언트
// crdt.ts 에 필드를 추가해도 자동으로 따라오지 않는다. 여기서 encode→decode 를 실제로
// 돌려 다섯 필드가 모두 살아 돌아오는지 확인한다(빠지면 판정이 기본값으로 되돌아감).
console.log('\n[서버 시드 왕복 · 공기 산정 전제]')
const seed = (await import('../../server/src/collab/seed.js')) as {
  encodeLegacyProject: (project: unknown, documentName: string) => Uint8Array
  decodeProjectFromState: (state: Uint8Array, documentName: string) => Record<string, unknown>
}
const PI = { prepDays: 45, cleanupDays: 20, holidayDays: 60, weatherDays: 33, tolerancePct: 5 }
const seedSrc = {
  id: 'smokeDoc',
  name: '공기 전제 왕복',
  startDate: '2026-01-01',
  commissioningEnabled: false,
  meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '', schemaVersion: 1 },
  paper: project.paper,
  view: project.view,
  branding: { logos: [] },
  palette: project.palette,
  categories: project.categories,
  tasks: project.tasks,
  links: project.links,
  rainySeasons: project.rainySeasons ?? [],
  activeSheet: { id: 'sheet-main', role: 'plan', name: 'Main' },
  sheets: [],
  periodInputs: PI,
}
const roundTrip = seed.decodeProjectFromState(
  seed.encodeLegacyProject(seedSrc, 'smokeDoc'),
  'smokeDoc',
) as { periodInputs?: Record<string, number> }
console.log(`  왕복 결과: ${JSON.stringify(roundTrip.periodInputs ?? null)}`)
for (const [field, value] of Object.entries(PI)) {
  check(
    roundTrip.periodInputs?.[field] === value,
    `periodInputs.${field} 가 서버 왕복에서 보존됨 (${value})`,
  )
}
// 값이 없으면 키 자체를 만들지 않는다(옛 프로젝트 JSON 왕복 형태 유지 — 하위 호환).
const bare = seed.decodeProjectFromState(
  seed.encodeLegacyProject({ ...seedSrc, periodInputs: undefined }, 'smokeDoc'),
  'smokeDoc',
) as { periodInputs?: unknown }
check(bare.periodInputs === undefined, '전제를 입력하지 않은 프로젝트는 periodInputs 키가 없다')
// (구버전 문서의 중첩 meta.periodInputs 폴백은 seed.js readProjectFromDoc 안에 남아 있다 —
//  그 형태의 문서는 옛 클라이언트만 만들 수 있어 여기서는 재현하지 않는다.)

// ── 10. 서버 시드 왕복 — 감사기록(변경 이력·확정본)이 스냅샷에서 살아남는가 ────
// 여기가 비면 versions.js 가 남기는 **모든 보관 버전**이 이력 없는 프로젝트가 되고,
// 그 버전으로 복구하는 순간 방의 감사기록이 사라진다(undo 추적 대상이 아니라 복구 불가).
console.log('\n[서버 시드 왕복 · 변경 이력·확정본]')
const AUDIT_SRC = {
  ...seedSrc,
  changeLog: [
    {
      id: 'ch-seed-1',
      at: '2026-03-09T00:00:00.000Z',
      actorName: '김검토',
      kind: 'duration',
      taskIds: ['T1', 'T2'],
      summary: '터파기 60일 → 75일',
      reason: '암반 출현',
      state: 'confirmed',
      decidedBy: '박소장',
      decidedAt: '2026-03-10T00:00:00.000Z',
    },
    {
      id: 'ch-seed-0',
      at: '2026-03-01T00:00:00.000Z',
      actorName: '이현장',
      kind: 'note',
      taskIds: [],
      summary: '착공 메모',
      reason: '착공계 제출',
      state: 'draft',
    },
  ],
  baselineVersions: [
    {
      id: 'bv-seed-1',
      name: '착공 기준선',
      authorName: '박소장',
      capturedAt: '2026-03-01T00:00:00.000Z',
      asOf: '2026-03-01',
      startDay: 0,
      endDay: 120,
      note: '발주처 승인본',
      tasks: [{ id: 'T1', start: 0, duration: 60 }],
    },
  ],
}
const auditTrip = seed.decodeProjectFromState(
  seed.encodeLegacyProject(AUDIT_SRC, 'smokeDoc'),
  'smokeDoc',
) as {
  changeLog?: Array<Record<string, unknown>>
  baselineVersions?: Array<Record<string, unknown>>
}
console.log(
  `  왕복 결과: 이력 ${auditTrip.changeLog?.length ?? 0}건 · 확정본 ${auditTrip.baselineVersions?.length ?? 0}건`,
)
check(auditTrip.changeLog?.length === 2, '변경 이력 2건이 서버 왕복에서 보존됨')
check(
  auditTrip.changeLog?.[0]?.id === 'ch-seed-0' && auditTrip.changeLog?.[1]?.id === 'ch-seed-1',
  '변경 이력이 기록 시각(at) 순으로 정규화된다 — 클라이언트 crdt.ts 와 같은 순서',
)
check(
  auditTrip.changeLog?.[1]?.reason === '암반 출현' &&
    auditTrip.changeLog?.[1]?.decidedBy === '박소장',
  '사유·결재자까지 그대로 보존(감사기록의 핵심 필드)',
)
check(
  Array.isArray(auditTrip.changeLog?.[1]?.taskIds) &&
    (auditTrip.changeLog?.[1]?.taskIds as string[]).length === 2,
  '이력의 대상 공정 목록(taskIds)이 배열로 보존',
)
check(auditTrip.baselineVersions?.length === 1, '확정본 1건이 서버 왕복에서 보존됨')
check(
  auditTrip.baselineVersions?.[0]?.name === '착공 기준선' &&
    (auditTrip.baselineVersions?.[0]?.tasks as unknown[])?.length === 1,
  '확정본의 이름·박제 공정 스냅샷이 보존',
)
// 이력이 없는 프로젝트는 키 자체를 만들지 않는다(옛 JSON 왕복 형태 유지).
const noAudit = seed.decodeProjectFromState(
  seed.encodeLegacyProject(seedSrc, 'smokeDoc'),
  'smokeDoc',
) as { changeLog?: unknown; baselineVersions?: unknown }
check(
  noAudit.changeLog === undefined && noAudit.baselineVersions === undefined,
  '이력이 없는 프로젝트는 changeLog·baselineVersions 키가 없다(하위 호환)',
)

console.log(`\n${failures === 0 ? '✅ EXPORT SMOKE OK' : `❌ ${failures} FAIL`}`)
process.exit(failures === 0 ? 0 : 1)
