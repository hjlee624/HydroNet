// 일정표(엑셀·CSV) 취입 스모크 — `npm run smoke:schedule-import`.
// F12(취입·왕복·오류행·동일ID 갱신·단일 취소) + F13(이력 동시편집 병합) + F16(주간 집계) 회귀.
// 실패 시 throw → 비정상 종료.

import * as Y from 'yjs'
import { normWorkName } from '../src/engine/adequacy'
import { weeklyDigest } from '../src/engine/projectKpis'
import { buildScheduleAoa, SCHEDULE_TEMPLATE_HEADER } from '../src/export/scheduleTemplate'
import { parseCsv } from '../src/state/boqImport'
import {
  applyProjectToYDoc,
  canonicalProjectSnapshot,
  createProjectUndoManager,
  getCurrentCrdtRuntime,
  LOCAL_ORIGIN,
  projectFromYDoc,
} from '../src/state/crdt'
import {
  buildSchedulePlan,
  parseDateCell,
  parseDurationCell,
  parsePredecessors,
  parseScheduleAoa,
} from '../src/state/scheduleImport'
import { useEditor } from '../src/state/store'
import type { Project } from '../src/types/model'

let checks = 0
function ok(cond: boolean, msg: string): void {
  checks++
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
function eq(a: unknown, b: unknown, msg: string): void {
  ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

const clone = <T>(v: T): T => structuredClone(v)
const sync = (a: Y.Doc, b: Y.Doc): void => {
  const ua = Y.encodeStateAsUpdate(a)
  const ub = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(a, ub)
  Y.applyUpdate(b, ua)
}

// ── 최소 프로젝트(공정표 1시트, 다른 스모크와 독립) ───────────────────────────
function emptyProject(): Project {
  return {
    id: 'proj-sched-smoke',
    name: '일정표 취입 스모크',
    startDate: '2026-03-01',
    paper: { size: 'A3', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true },
    view: {
      pxPerDay: 1.5,
      rowHeight: 46,
      labelWidth: 150,
      headerHeight: 56,
      scale: 'month',
      showCriticalPath: true,
      showFloat: false,
      showGrid: true,
      showTitle: true,
    },
    categories: [{ id: 'cat-토공', name: '토공', color: '#7c93a8', collapsed: false, order: 0 }],
    tasks: [],
    links: [],
    rainySeasons: [],
    branding: { logos: [] },
    palette: [],
    commissioningEnabled: true,
    meta: {
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 4,
    },
  }
}

// ── ① 셀 파서 ────────────────────────────────────────────────────────────────
eq(parseDateCell('2026-03-02'), '2026-03-02', 'parseDateCell: ISO')
eq(parseDateCell('2026.3.2'), '2026-03-02', 'parseDateCell: 점 구분')
eq(parseDateCell('2026/03/02'), '2026-03-02', 'parseDateCell: 슬래시')
eq(parseDateCell('26.3.2'), '2026-03-02', 'parseDateCell: 2자리 연도')
// 엑셀 시리얼 46083 = 2026-03-02(1900 기준, 1900 윤년 버그 포함).
eq(parseDateCell('46083'), '2026-03-02', 'parseDateCell: 엑셀 시리얼')
eq(parseDateCell('2026-02-31'), null, 'parseDateCell: 존재하지 않는 날짜 → null')
eq(parseDateCell('미정'), null, 'parseDateCell: 비날짜 → null')
eq(parseDateCell(''), null, 'parseDateCell: 빈값 → null')
eq(parseDurationCell('120일'), 120, 'parseDurationCell: 단위 접미')
eq(parseDurationCell('1,200'), 1200, 'parseDurationCell: 천단위 구분')
eq(parseDurationCell(''), null, 'parseDurationCell: 빈값 → null')

{
  const { refs, unknown } = parsePredecessors('3FS+2, 5')
  eq(refs.length, 2, 'parsePredecessors: 2건')
  eq(refs[0].ref, '3', 'parsePredecessors: ref=3')
  eq(refs[0].type, 'FS', 'parsePredecessors: type=FS')
  eq(refs[0].lag, 2, 'parsePredecessors: lag=+2')
  eq(refs[1].ref, '5', 'parsePredecessors: 두번째 ref=5')
  eq(refs[1].type, 'FS', 'parsePredecessors: 유형 생략 → FS')
  eq(refs[1].lag, 0, 'parsePredecessors: 지연 생략 → 0')
  eq(unknown.length, 0, 'parsePredecessors: 미해석 토큰 없음')
}
{
  // 번호가 하이픈·숫자를 포함해도(우리 내보내기의 task id) 접미 파싱이 번호를 먹지 않는다.
  const known = new Set(['t-ab12cd34'])
  const one = parsePredecessors('t-ab12cd34SS-3', known).refs[0]
  eq(one.ref, 't-ab12cd34', 'parsePredecessors: 하이픈 포함 번호 보존')
  eq(one.type, 'SS', 'parsePredecessors: SS')
  eq(one.lag, -3, 'parsePredecessors: 음수 지연')
  const bare = parsePredecessors('t-ab12cd34', known).refs[0]
  eq(bare.ref, 't-ab12cd34', 'parsePredecessors: knownKeys 통째 일치 우선')
}

// ── ② 머리글 검출 + 100행 취입 ────────────────────────────────────────────────
const HEADER_LINE = SCHEDULE_TEMPLATE_HEADER.join(',')
const ROW_COUNT = 100
const csvLines = ['사내 표준 일정표,,,,,,,', HEADER_LINE]
for (let i = 1; i <= ROW_COUNT; i++) {
  const start = new Date(2026, 2, 1)
  start.setDate(start.getDate() + (i - 1) * 5)
  const finish = new Date(start)
  finish.setDate(finish.getDate() + 9) // 기간 10일 = 종료 − 시작 + 1
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  csvLines.push(
    [
      String(i),
      i % 2 === 0 ? '토공' : '구조물',
      `공정 ${i}`,
      `담당 ${i % 3}`,
      iso(start),
      iso(finish),
      '10',
      i > 1 ? `${i - 1}FS+0` : '',
    ].join(','),
  )
}
csvLines.push('합계,,,,,,,')
const parsed = parseScheduleAoa(parseCsv(`${csvLines.join('\n')}\n`))
eq(parsed.headerRowIndex, 1, '머리글 행 = 1')
eq(parsed.columns.key, 0, '번호 열 = 0')
eq(parsed.columns.category, 1, '공종 열 = 1')
eq(parsed.columns.name, 2, '공정명 열 = 2')
eq(parsed.columns.owner, 3, '담당자 열 = 3')
eq(parsed.columns.start, 4, '시작일 열 = 4')
eq(parsed.columns.finish, 5, '종료일 열 = 5')
eq(parsed.columns.duration, 6, '기간 열 = 6')
eq(parsed.columns.pred, 7, '선행 열 = 7')
eq(parsed.rows.length, ROW_COUNT, `데이터 ${ROW_COUNT}행(합계행 제외)`)

const plan = buildSchedulePlan(emptyProject(), parsed.rows)
eq(plan.items.length, ROW_COUNT, `계획 ${ROW_COUNT}행`)
eq(plan.items.filter((i) => i.mode === 'create').length, ROW_COUNT, '전부 신규')
eq(plan.items[0].startDay, 0, '1행 시작일 = day 0')
eq(plan.items[0].duration, 10, '1행 기간 = 종료−시작+1 = 10')
eq(plan.links.length, ROW_COUNT - 1, `선후행 ${ROW_COUNT - 1}건`)
ok(plan.newCategories.includes('구조물'), '없는 공종(구조물)은 신규 목록에')
ok(!plan.newCategories.includes('토공'), '이미 있는 공종(토공)은 신규 목록에서 제외')

// ── ③ 오류 행은 조용히 버리지 않고 계획에 남는다 ─────────────────────────────
{
  const badCsv = [
    HEADER_LINE,
    '1,토공,정상 공정,김,2026-03-02,2026-03-11,10,',
    '2,토공,시작일 없음,김,,,,',
    '3,토공,날짜 깨짐,김,2026-13-99,,,',
    '4,토공,종료가 앞섬,김,2026-03-20,2026-03-10,,',
    '1,토공,번호 중복,김,2026-04-01,2026-04-10,10,',
  ].join('\n')
  const p = parseScheduleAoa(parseCsv(`${badCsv}\n`))
  eq(p.rows.length, 5, '오류 행도 일단 전부 읽는다(조용히 드롭 금지)')
  const bad = buildSchedulePlan(emptyProject(), p.rows)
  eq(bad.items.length, 5, '계획에도 5행 모두 남는다')
  const errors = bad.items.filter((i) => i.mode === 'error')
  eq(errors.length, 4, '오류 4행(시작일 없음·날짜 깨짐·종료 역전·번호 중복)')
  ok(
    errors.every((e) => !!e.error && e.error.length > 0),
    '오류 행마다 사람이 읽는 사유가 붙는다',
  )
  ok(
    bad.warnings.some((w) => w.includes('읽지 못한 행 4건')),
    '경고에 오류 건수가 집계된다',
  )
  eq(bad.items.filter((i) => i.mode === 'create').length, 1, '정상 행 1건만 반영 대상')
}

// ── ④ store 반영: 100행 → 왕복 → 재취입(동일 ID 갱신) → 단일 undo ─────────────
const seed = emptyProject()
useEditor.getState().setProject(seed)
const before = clone(useEditor.getState().project)
const runtime = getCurrentCrdtRuntime()
if (!runtime) throw new Error('FAIL: store 가 활성 CRDT 런타임을 노출하지 않는다')
checks++
const undoBefore = runtime.undoManager.undoStack.length

const applyPlan = (planned: ReturnType<typeof buildSchedulePlan>) =>
  useEditor.getState().importScheduleRows({
    categories: planned.newCategories,
    tasks: planned.items
      .filter((i) => i.mode !== 'error')
      .map((i) => ({
        ...(i.taskId ? { taskId: i.taskId } : {}),
        ...(i.row.key ? { extId: i.row.key } : {}),
        categoryName: i.categoryName,
        name: i.row.name,
        start: i.startDay as number,
        duration: i.duration as number,
        ...(i.owner ? { owner: i.owner } : {}),
      })),
    links: planned.links,
    sourceName: '스모크.csv',
  })

const r1 = applyPlan(plan)
eq(r1.created, ROW_COUNT, `신규 ${ROW_COUNT}건 생성`)
eq(r1.updated, 0, '갱신 0건')
eq(r1.linked, ROW_COUNT - 1, `연결 ${ROW_COUNT - 1}건`)
const imported = useEditor.getState().project
eq(imported.tasks.length, ROW_COUNT, `공정 ${ROW_COUNT}개`)
eq(imported.links.length, ROW_COUNT - 1, `연결 ${ROW_COUNT - 1}개`)
eq(imported.tasks[0].owner, '담당 1', '담당자 반영')
eq(imported.tasks[0].extId, '1', '번호(extId) 반영')

// 단일 취소: 취입 전체가 undo 스택 **정확히 1엔트리** 여야 한다.
eq(
  runtime.undoManager.undoStack.length - undoBefore,
  1,
  '취입 전체가 undo 1엔트리(한 번에 취소 가능)',
)

// ── ⑤ 왕복(export → import): id·날짜·기간·연결 의미 보존 ─────────────────────
const aoa = buildScheduleAoa(imported)
eq(aoa.length, ROW_COUNT + 1, '내보낸 표 = 머리글 + 100행')
const reparsed = parseScheduleAoa(aoa)
eq(reparsed.rows.length, ROW_COUNT, '되읽은 데이터 100행')
const roundPlan = buildSchedulePlan(imported, reparsed.rows)
eq(roundPlan.items.filter((i) => i.mode === 'update').length, ROW_COUNT, '왕복 후 전부 update')
eq(roundPlan.items.filter((i) => i.mode === 'create').length, 0, '왕복이 공정을 새로 만들지 않는다')
eq(
  roundPlan.items.filter((i) => i.changed.length > 0).length,
  0,
  '왕복 후 달라진 필드 0 — 시작일·기간·담당자·공정명 보존',
)
eq(roundPlan.links.length, ROW_COUNT - 1, '왕복 후 선후행 건수 보존')
{
  const byId = new Map(imported.tasks.map((t) => [t.extId ?? t.id, t.id]))
  const origin = new Set(imported.links.map((l) => `${l.from} ${l.to} ${l.type} ${l.lag}`))
  const rebuilt = new Set(
    roundPlan.links.map((l) => `${byId.get(l.fromKey)} ${byId.get(l.toKey)} ${l.type} ${l.lag}`),
  )
  eq(rebuilt.size, origin.size, '왕복 연결 집합 크기 동일')
  for (const key of origin) ok(rebuilt.has(key), `왕복 연결 의미 보존: ${key}`)
}

// 재취입 → 동일 ID 갱신(중복 생성 없음).
const r2 = applyPlan(roundPlan)
eq(r2.created, 0, '재취입은 신규 0건')
eq(r2.updated, ROW_COUNT, `재취입은 전부 갱신 ${ROW_COUNT}건`)
eq(useEditor.getState().project.tasks.length, ROW_COUNT, '재취입 후에도 공정 수 그대로(중복 없음)')
eq(useEditor.getState().project.links.length, ROW_COUNT - 1, '재취입이 연결을 중복 추가하지 않는다')

// ── ⑥ 취입 전체 되돌리기 = 정확히 이전 상태 ───────────────────────────────────
useEditor.getState().undo() // 재취입 취소
useEditor.getState().undo() // 최초 취입 취소
const after = useEditor.getState().project
eq(after.tasks.length, before.tasks.length, 'undo 후 공정 수 복원')
eq(after.links.length, before.links.length, 'undo 후 연결 수 복원')
eq(after.categories.length, before.categories.length, 'undo 후 공종 수 복원(신규 공종도 제거)')
ok((after.changeLog?.length ?? 0) >= 2, '되돌려도 변경 이력(누가 언제 무엇을 취입했는가)은 남는다')

// ── ⑦ 변경 이력이 두 피어 CRDT 병합에서 살아남는다(서로 다른 공정 편집) ───────
{
  const histBase = emptyProject()
  histBase.tasks = [
    { id: 'T1', categoryId: 'cat-토공', name: 'A', start: 0, duration: 5, isMilestone: false },
    { id: 'T2', categoryId: 'cat-토공', name: 'B', start: 5, duration: 5, isMilestone: false },
  ]
  const left = new Y.Doc()
  applyProjectToYDoc(left, histBase)
  const right = new Y.Doc()
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left))

  const edit = (doc: Y.Doc, mutate: (p: Project) => void): void => {
    const p = projectFromYDoc(doc)
    mutate(p)
    applyProjectToYDoc(doc, p, LOCAL_ORIGIN)
  }
  const pick = (p: Project, id: string): Project['tasks'][number] => {
    const t = p.tasks.find((x) => x.id === id)
    if (!t) throw new Error(`FAIL: 공정 ${id} 없음`)
    return t
  }
  // 피어 A: T1 의 공기를 늘리고 사유를 남긴다. 피어 B: T2 담당자·실적일자 + 사유.
  edit(left, (p) => {
    const t = pick(p, 'T1')
    t.duration = 9
    p.changeLog = [
      ...(p.changeLog ?? []),
      {
        id: 'ch-left',
        at: '2026-04-01T01:00:00.000Z',
        actorName: '좌',
        kind: 'duration',
        taskIds: ['T1'],
        summary: 'A 5일 → 9일',
        reason: '암반 출현',
        state: 'review',
      },
    ]
  })
  edit(right, (p) => {
    const t = pick(p, 'T2')
    t.owner = '우담당'
    t.actualFinish = '2026-03-20'
    p.changeLog = [
      ...(p.changeLog ?? []),
      {
        id: 'ch-right',
        at: '2026-04-01T02:00:00.000Z',
        actorName: '우',
        kind: 'note',
        taskIds: ['T2'],
        summary: 'B 완료 보고',
        reason: '현장 확인',
        state: 'confirmed',
      },
    ]
  })
  sync(left, right)
  for (const doc of [left, right]) {
    const p = projectFromYDoc(doc)
    eq(p.changeLog?.length, 2, '두 피어의 이력이 모두 살아남는다(레코드 단위 병합)')
    eq(p.changeLog?.[0].id, 'ch-left', '이력은 기록 시각 순으로 정규화된다')
    eq(p.changeLog?.[1].reason, '현장 확인', '상대 이력의 사유가 보존된다')
    eq(p.tasks.find((t) => t.id === 'T1')?.duration, 9, '좌 피어의 공기 변경 보존')
    eq(p.tasks.find((t) => t.id === 'T2')?.owner, '우담당', '우 피어의 담당자 보존')
    eq(p.tasks.find((t) => t.id === 'T2')?.actualFinish, '2026-03-20', '우 피어의 실적일자 보존')
  }
  // 되돌리기는 감사기록을 지우지 않는다(changeLog 는 UndoManager 추적 대상이 아니다).
  const undoDoc = new Y.Doc()
  Y.applyUpdate(undoDoc, Y.encodeStateAsUpdate(left))
  const types = applyProjectToYDoc(undoDoc, projectFromYDoc(undoDoc), LOCAL_ORIGIN)
  const um = createProjectUndoManager(types)
  um.stopCapturing()
  edit(undoDoc, (p) => {
    pick(p, 'T1').name = 'A-편집'
  })
  um.stopCapturing()
  um.undo()
  const undone = projectFromYDoc(undoDoc)
  eq(undone.tasks.find((t) => t.id === 'T1')?.name, 'A', 'undo 는 공정 편집을 되돌린다')
  eq(undone.changeLog?.length, 2, 'undo 후에도 이력 건수 불변(감사기록 보존)')
  um.destroy()
}

// ── ⑧ 주간 공정회의 자동 집계(F16) ────────────────────────────────────────────
{
  const asOf = new Date(2026, 3, 15) // 2026-04-15
  const wp = emptyProject()
  wp.startDate = '2026-04-01'
  wp.tasks = [
    // 지난주(4/9~4/15) 착수 + 완료
    {
      id: 'W1',
      categoryId: 'cat-토공',
      name: '지난주 완료',
      start: 0,
      duration: 10,
      isMilestone: false,
      progress: 100,
      owner: '김',
      actualStart: '2026-04-02',
      actualFinish: '2026-04-13',
    },
    // 계획 착수 경과 + 미착수(실적 없음·진척 0)
    {
      id: 'W2',
      categoryId: 'cat-토공',
      name: '미착수',
      start: 0,
      duration: 20,
      isMilestone: false,
      progress: 0,
      owner: '이',
    },
    // 다음주(4/15~4/22) 착수 예정
    {
      id: 'W3',
      categoryId: 'cat-토공',
      name: '다음주 착수',
      start: 17,
      duration: 5,
      isMilestone: false,
      owner: '박',
    },
    // 계획 종료 경과 + 미완료
    {
      id: 'W4',
      categoryId: 'cat-토공',
      name: '완료 초과',
      start: 0,
      duration: 5,
      isMilestone: false,
      progress: 60,
      owner: '최',
    },
  ]
  const w = weeklyDigest(wp, asOf)
  eq(w.fromISO, '2026-04-08', '집계 시작 = 오늘 −7일')
  eq(w.toISO, '2026-04-15', '집계 끝 = 오늘')
  eq(w.finished.length, 1, '지난주 완료 1건')
  eq(w.finished[0].id, 'W1', '지난주 완료 = W1')
  eq(w.started.length, 0, 'W1 의 착수(4/02)는 지난 7일 밖이라 착수 목록엔 없다')
  eq(w.nextWeek.length, 1, '다음주 착수 예정 1건')
  eq(w.nextWeek[0].id, 'W3', '다음주 착수 = W3')
  ok(
    w.overdue.some((r) => r.id === 'W4'),
    '계획 종료 경과·미완료(W4)가 초과 목록에',
  )
  ok(
    w.behind.some((r) => r.id === 'W2'),
    '계획比 임계 이상 지연(W2)이 지연 목록에',
  )
  ok(
    w.finished[0].owner === '김' && w.nextWeek[0].owner === '박',
    '집계 행에 담당자가 실려 회의 자료가 그대로 만들어진다',
  )
}

// ── ⑨ 저장 파일(JSON) 왕복 — 신규 필드가 양방향 호환이어야 한다 ─────────────────
// fileIO.saveProjectToFile 은 canonicalProjectSnapshot → JSON.stringify 이고,
// parseProject 는 tasks/categories 배열 유무만 본다. 그 경로를 그대로 재현한다.
{
  const fp = emptyProject()
  fp.tasks = [
    {
      id: 'F1',
      categoryId: 'cat-토공',
      name: '저장 왕복',
      start: 0,
      duration: 7,
      isMilestone: false,
      extId: 'EXT-1',
      owner: '김',
      actualStart: '2026-03-02',
      actualFinish: '2026-03-08',
    },
  ]
  fp.changeLog = [
    {
      id: 'ch-file',
      at: '2026-03-09T00:00:00.000Z',
      actorName: '김',
      kind: 'note',
      taskIds: ['F1'],
      summary: '완료 보고',
      reason: '현장 확인',
      state: 'confirmed',
    },
  ]
  fp.baselineVersions = [
    {
      id: 'bv-file',
      name: '착공 기준선',
      authorName: '김',
      capturedAt: '2026-03-01T00:00:00.000Z',
      asOf: '2026-03-01',
      startDay: 0,
      endDay: 7,
      tasks: [{ id: 'F1', start: 0, duration: 7 }],
    },
  ]

  // (a) 새 파일 → 새 코드: 모든 신규 필드가 그대로 살아 돌아온다.
  const saved = JSON.parse(JSON.stringify(canonicalProjectSnapshot(fp))) as Project
  ok(Array.isArray(saved.tasks) && Array.isArray(saved.categories), 'parseProject 검증 조건 충족')
  eq(saved.tasks[0].owner, '김', 'JSON 왕복: owner 보존')
  eq(saved.tasks[0].extId, 'EXT-1', 'JSON 왕복: extId 보존')
  eq(saved.tasks[0].actualFinish, '2026-03-08', 'JSON 왕복: actualFinish 보존')
  eq(saved.changeLog?.length, 1, 'JSON 왕복: 변경 이력 보존')
  eq(saved.baselineVersions?.[0].name, '착공 기준선', 'JSON 왕복: 확정본 보존')

  // (b) 새 파일 → **구버전 형태 리더**: 모르는 키를 무시해도 남는 필드로 프로젝트가 성립한다.
  const legacyShaped = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>
  for (const key of ['changeLog', 'baselineVersions']) delete legacyShaped[key]
  const asLegacy = legacyShaped as unknown as Project
  ok(Array.isArray(asLegacy.tasks) && Array.isArray(asLegacy.categories), '구버전 리더도 파싱 가능')
  eq(asLegacy.tasks[0].duration, 7, '구버전 리더가 읽어도 일정은 그대로')

  // (c) 구버전 파일 → 새 코드: 신규 필드가 없어도 크래시 없이 로드되고 undefined 로 읽힌다.
  // id 를 달리 준다 — **다른 문서**를 여는 상황을 재현하기 위해서다. 같은 id 로 열면 그건
  // '같은 도면의 옛 백업을 다시 여는 것'이라 감사기록이 합쳐지는 게 맞다(⑩ 참조).
  const oldFile = JSON.parse(JSON.stringify(emptyProject())) as Project
  oldFile.id = 'proj-sched-smoke-legacy'
  useEditor.getState().setProject(oldFile)
  const loaded = useEditor.getState().project
  eq(loaded.changeLog, undefined, '구버전 파일: changeLog 없음')
  eq(loaded.baselineVersions, undefined, '구버전 파일: baselineVersions 없음')
  eq(loaded.tasks.length, 0, '구버전 파일: 공정 없음(크래시 없이 로드)')

  // (d) 신규 필드가 담긴 파일을 그대로 열면 CRDT 를 거쳐도 살아남는다.
  useEditor.getState().setProject(saved)
  const reopened = useEditor.getState().project
  eq(reopened.tasks[0].owner, '김', '재오픈: owner 보존(CRDT 경유)')
  eq(reopened.changeLog?.length, 1, '재오픈: 변경 이력 보존(CRDT 경유)')
  eq(reopened.baselineVersions?.[0].tasks.length, 1, '재오픈: 확정본 스냅샷 보존(CRDT 경유)')
}

// ── ⑩ 복구(RestoreDialog → importProjectContent)는 감사기록을 지울 수 없다 ────
// 서버 버전 스냅샷에 이력이 빠져 있어도(구 seed.js 가 만들던 형태, 혹은 앞으로 누가 또
// 빠뜨려도) 방의 변경 이력·확정본은 남아야 한다. changeLog 는 UndoManager 추적 대상이
// 아니어서 한 번 지워지면 되돌릴 수 없기 때문이다.
{
  const room = emptyProject()
  // 앞 블록과 다른 문서에서 시작한다 — 같은 id 로 열면 이전 블록의 감사기록이 (정상적으로)
  // 합쳐져 이 블록의 전제(이력 0건에서 시작)가 흐려진다.
  room.id = 'proj-restore-smoke'
  room.tasks = [
    {
      id: 'R1',
      categoryId: 'cat-토공',
      name: '터파기',
      start: 0,
      duration: 60,
      isMilestone: false,
    },
  ]
  useEditor.getState().setProject(room)
  useEditor.getState().appendChange({
    kind: 'duration',
    taskIds: ['R1'],
    summary: '터파기 60일 → 75일',
    reason: '암반 출현',
  })
  useEditor.getState().saveBaselineVersion('착공 기준선', '발주처 승인본')
  const live = useEditor.getState().project
  const liveLogCount = live.changeLog?.length ?? 0
  ok(liveLogCount >= 2, `방에 변경 이력이 쌓여 있다(${liveLogCount}건)`)
  eq(live.baselineVersions?.length, 1, '방에 확정본 1건')

  // 감사기록이 빠진 버전 = 되돌리기 전 서버가 내려주던 바로 그 모양.
  const versionWithoutAudit = JSON.parse(JSON.stringify(live)) as Project
  versionWithoutAudit.changeLog = undefined
  versionWithoutAudit.baselineVersions = undefined
  versionWithoutAudit.tasks = [
    {
      id: 'R1',
      categoryId: 'cat-토공',
      name: '터파기',
      start: 0,
      duration: 40,
      isMilestone: false,
    },
  ]
  useEditor.getState().importProjectContent(versionWithoutAudit)
  const restored = useEditor.getState().project
  eq(restored.tasks[0].duration, 40, '복구는 여전히 공정 내용을 되돌린다(기능 자체는 살아 있다)')
  eq(
    restored.changeLog?.length,
    liveLogCount,
    '이력이 빠진 버전으로 복구해도 방의 변경 이력은 한 건도 사라지지 않는다',
  )
  eq(
    restored.changeLog?.some((e) => e.reason === '암반 출현'),
    true,
    '복구 후에도 사유(왜 바꿨는가)가 그대로 남는다',
  )
  eq(restored.baselineVersions?.length, 1, '이력이 빠진 버전으로 복구해도 확정본이 사라지지 않는다')

  // 반대로 **버전에만 있는** 이력은 합쳐진다(합집합 — 어느 쪽도 잃지 않는다).
  const versionWithOlderAudit = JSON.parse(JSON.stringify(live)) as Project
  versionWithOlderAudit.changeLog = [
    {
      id: 'ch-only-in-version',
      at: '2026-01-01T00:00:00.000Z',
      actorName: '구버전',
      kind: 'note',
      taskIds: [],
      summary: '버전에만 있는 이력',
      reason: '합집합 검증',
      state: 'draft',
    },
  ]
  useEditor.getState().importProjectContent(versionWithOlderAudit)
  const merged = useEditor.getState().project
  eq(
    merged.changeLog?.length,
    liveLogCount + 1,
    '버전에만 있던 이력은 방의 이력에 더해진다(덮어쓰기가 아니라 합집합)',
  )
  eq(merged.changeLog?.[0].id, 'ch-only-in-version', '합쳐진 이력도 기록 시각 순으로 정렬된다')

  // 결재 상태는 되돌아가지 않는다 — 복구본의 오래된 사본이 '확정'을 '초안'으로 낮추면
  // 그것도 감사기록의 소실이다.
  const confirmedId = merged.changeLog?.find((e) => e.kind === 'baseline')?.id
  ok(!!confirmedId, '확정본 저장 이력이 존재')
  const staleCopy = JSON.parse(JSON.stringify(merged)) as Project
  for (const entry of staleCopy.changeLog ?? []) entry.state = 'draft'
  useEditor.getState().importProjectContent(staleCopy)
  eq(
    useEditor.getState().project.changeLog?.find((e) => e.id === confirmedId)?.state,
    'confirmed',
    '복구본의 오래된 사본이 결재 상태를 초안으로 되돌리지 못한다',
  )

  // ── 같은 보호가 **파일 열기(setProject)** 경로에도 걸려 있어야 한다 ──────────
  // setProject 는 파일이 가진 project.id 를 그대로 쓰므로 같은 IndexedDB 문서가 다시 붙는다.
  // 단독 실행본(standalone)·오프라인에서는 입장(entered) 개념이 없어 파일 열기가 **항상** 이
  // 경로를 탄다. 이력이 없던 시절의 백업 파일을 열었다고 방의 감사기록이 지워지면 안 된다.
  {
    const before = useEditor.getState().project
    const priorLog = before.changeLog?.length ?? 0
    const priorBase = before.baselineVersions?.length ?? 0
    ok(priorLog > 0 && priorBase > 0, `파일 열기 검증 전제: 이력 ${priorLog}건·확정본 ${priorBase}건`)

    const oldBackup = JSON.parse(JSON.stringify(before)) as Project
    oldBackup.changeLog = undefined
    oldBackup.baselineVersions = undefined
    oldBackup.tasks = [
      { id: 'R1', categoryId: 'cat-토공', name: '터파기', start: 0, duration: 33, isMilestone: false },
    ]
    useEditor.getState().setProject(oldBackup)
    const afterOpen = useEditor.getState().project
    eq(afterOpen.tasks[0].duration, 33, '파일 열기는 여전히 파일 내용을 반영한다')
    eq(
      afterOpen.changeLog?.length,
      priorLog,
      '이력 없는 백업 파일을 열어도(setProject) 같은 문서의 변경 이력이 사라지지 않는다',
    )
    eq(
      afterOpen.baselineVersions?.length,
      priorBase,
      '이력 없는 백업 파일을 열어도(setProject) 확정본이 사라지지 않는다',
    )

    // 대조군: **다른 문서**(새 도면·샘플)는 이력을 이월하지 않는다 — 남의 이력이 따라붙으면
    // 그게 더 큰 사고다.
    const otherDoc = emptyProject()
    otherDoc.id = 'proj-완전히-다른-문서'
    useEditor.getState().setProject(otherDoc)
    eq(
      useEditor.getState().project.changeLog?.length ?? 0,
      0,
      '대조군: 다른 문서를 열면 이전 문서의 이력이 따라오지 않는다',
    )
  }
}

// ── ⑪ 공종 대조는 계획과 반영이 **같은 규칙**(normWorkName)을 쓴다 ────────────
// 정규화하면 같지만 원문은 다른 이름('토공  공사'(공백 2칸) ↔ '토공 공사', '◆가설공사' ↔
// '가설공사')에서, 계획은 "이미 있는 공종"이라 생성을 건너뛰고 반영은 원문 조회에 실패해
// 공정이 통째로 첫 공종으로 들어가던 회귀를 막는다.
{
  const seeded = emptyProject()
  seeded.categories = [
    { id: 'c-first', name: '가설공사', color: '#7c93a8', collapsed: false, order: 0 },
    // 손으로 관리한 엑셀에서 흔한 형태 — 내부 공백 2칸.
    { id: 'c-earth', name: '토공  공사', color: '#7c93a8', collapsed: false, order: 1 },
  ]
  seeded.tasks = []
  const csv = [
    HEADER_LINE,
    // 공백 1칸('토공 공사') — 정규화하면 c-earth 와 같다.
    '1,토공 공사,터파기,김,2026-03-02,2026-03-11,10,',
    // 선행 ◆ — 정규화하면 c-first 와 같다.
    '2,◆가설공사,가시설 설치,김,2026-03-02,2026-03-11,10,',
    // 진짜 새 공종.
    '3,포장 공사,기층,김,2026-03-12,2026-03-21,10,',
    // 3번과 정규화만 같은 이름(공백 2칸) — 공종은 하나만 만들어져야 한다.
    '4,포장  공사,표층,김,2026-03-22,2026-03-31,10,',
  ].join('\n')
  const p = parseScheduleAoa(parseCsv(`${csv}\n`))
  const catPlan = buildSchedulePlan(seeded, p.rows)
  eq(catPlan.items.filter((i) => i.mode === 'error').length, 0, '네 행 모두 읽힌다')
  eq(catPlan.newCategories.length, 1, '신규 공종은 정규화 기준으로 1개(포장공사)만')
  eq(catPlan.newCategories[0], '포장 공사', '신규 공종 이름은 파일에 처음 나온 표기')

  useEditor.getState().setProject(seeded)
  const catResult = applyPlan(catPlan)
  eq(catResult.created, 4, '4개 공정이 모두 생성됨')
  eq(catResult.unresolved.length, 0, '공종을 못 찾아 미반영된 행 없음')
  const applied = useEditor.getState().project
  eq(applied.categories.length, 3, `공종은 3개(가설·토공·포장) — 실제 ${applied.categories.length}`)
  const catOf = (name: string) => applied.tasks.find((t) => t.name === name)?.categoryId
  eq(catOf('터파기'), 'c-earth', "'토공 공사' 행은 기존 '토공  공사'(c-earth)로 들어간다")
  eq(catOf('가시설 설치'), 'c-first', "'◆가설공사' 행은 기존 '가설공사'(c-first)로 들어간다")
  const paving = applied.categories.find((c) => normWorkName(c.name) === '포장 공사')
  ok(!!paving, '포장공사 공종이 새로 만들어졌다')
  eq(catOf('기층'), paving?.id, "'포장공사' 행이 새 공종으로")
  eq(catOf('표층'), paving?.id, "'포장  공사' 행도 **같은** 새 공종으로(중복 생성 없음)")
  ok(
    applied.tasks.every((t) => t.categoryId !== 'c-first' || t.name === '가시설 설치'),
    '어떤 공정도 조용히 첫 공종(c-first)으로 밀려나지 않았다',
  )

  // 조회 실패는 조용한 재배치가 아니라 **미반영 + 사유**로 드러나야 한다.
  const orphan = useEditor.getState().importScheduleRows({
    categories: [],
    tasks: [
      {
        categoryName: '존재하지 않는 공종',
        name: '고아 공정',
        start: 0,
        duration: 5,
      },
    ],
    links: [],
  })
  eq(orphan.created, 0, '공종을 못 찾은 행은 생성되지 않는다')
  eq(orphan.unresolved.length, 1, '미반영 사유가 1건 보고된다')
  ok(orphan.unresolved[0].includes('고아 공정'), '미반영 사유에 어떤 공정인지 적힌다')
  eq(
    useEditor.getState().project.tasks.find((t) => t.name === '고아 공정'),
    undefined,
    '못 찾은 공정이 첫 공종에 조용히 생기지 않는다',
  )
}

// Reimport must preserve identity while applying category and lag changes.
{
  const p = emptyProject()
  p.tasks = [
    { id: 'a', extId: 'A', categoryId: 'cat-토공', name: 'A', start: 0, duration: 2 },
    { id: 'b', extId: 'B', categoryId: 'cat-토공', name: 'B', start: 2, duration: 2 },
  ]
  p.links = [{ id: 'ab', from: 'a', to: 'b', type: 'FS', lag: 0 }]
  useEditor.getState().setProject(p)
  const parsed = parseScheduleAoa(parseCsv(`${HEADER_LINE}\nA,새공종,A,,2026-03-01,2026-03-02,2,\nB,토공,B,,2026-03-03,2026-03-04,2,AFS+7\n`))
  const plan = buildSchedulePlan(p, parsed.rows)
  ok(plan.newCategories.includes('새공종'), '기존 공정의 새 공종도 생성 계획에 포함')
  ok(plan.items[0].changed.includes('공종'), '공종 변경 미리보기')
  useEditor.getState().importScheduleRows({
    categories: plan.newCategories,
    tasks: plan.items.map((i) => ({ taskId: i.taskId, extId: i.row.key, categoryName: i.categoryName, name: i.row.name, start: i.startDay!, duration: i.duration! })),
    links: [{ fromKey: 'A', toKey: 'B', type: 'FS', lag: 7 }],
  })
  const result = useEditor.getState().project
  eq(result.tasks.find((t) => t.id === 'a')?.categoryId, result.categories.find((c) => c.name === '새공종')?.id, '기존 ID 유지하며 공종 이동')
  eq(result.links.length, 1, '재취입 시 연결 중복 없음')
  eq(result.links[0].lag, 7, '기존 연결 지연일 갱신')
  const invalid = parseScheduleAoa(parseCsv(`${HEADER_LINE}\nX,토공,X,,2026-03-02,2026-03-01,,\n`))
  eq(buildSchedulePlan(p, invalid.rows).items[0].mode, 'error', '종료일이 시작 전날이면 오류')
}

console.log(`✓ schedule-import-smoke: ${checks} checks passed`)
