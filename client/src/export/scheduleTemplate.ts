// 사내 표준 일정표(엑셀) 양식 내려받기 + 현재 공정표 내보내기 — F12 왕복(round-trip)의 한 쪽.
//
// 여기서 만든 표를 state/scheduleImport.ts 가 그대로 다시 읽어야 **ID·날짜·기간·연결 의미**가
// 보존된다. 그래서 표 만들기(buildScheduleAoa)는 xlsx·DOM 에 의존하지 않는 **순수 함수**로 두고,
// 스모크(scripts/schedule-import-smoke.ts)가 이 함수의 출력만으로 왕복을 검증한다.
//
// 날짜 규약: 종료일 = **마지막 작업일**(포함), 기간 = 종료 − 시작 + 1.
// 마일스톤(기간 0)은 종료일을 비우고 기간 0 으로 적는다 — 다시 읽어도 기간 0 이 살아남는다.

import { dayToDate, toISO } from '../engine/dates'
import type { Link, Project, Task } from '../types/model'

/** 사내 표준 일정표 머리글(열 순서 고정). 취입은 이름으로 검출하므로 순서가 바뀌어도 읽힌다. */
export const SCHEDULE_TEMPLATE_HEADER = [
  '번호',
  '공종',
  '공정명',
  '담당자',
  '시작일',
  '종료일',
  '기간(일)',
  '선행',
] as const

/** 빈 양식(머리글 + 예시 2행). '양식 내려받기' 버튼이 그대로 파일로 만든다. */
export function buildScheduleTemplateAoa(): string[][] {
  return [
    [...SCHEDULE_TEMPLATE_HEADER],
    ['1', '토공', '터파기', '김공정', '2026-03-02', '2026-04-30', '60', ''],
    ['2', '토공', '되메우기', '김공정', '2026-05-01', '2026-05-20', '20', '1FS+0'],
    ['3', '구조물', '기초 콘크리트', '박구조', '2026-05-21', '2026-06-19', '30', '2FS+3'],
  ]
}

/** 선행 표기 — `${번호}${유형}${지연}` (예: `2FS+3`, `5SS-1`). 유형은 항상 적어 왕복을 명확히 한다. */
function formatPredecessor(fromKey: string, type: Link['type'], lag: number): string {
  const lagPart = lag > 0 ? `+${lag}` : lag < 0 ? String(lag) : ''
  return `${fromKey}${type}${lagPart}`
}

/**
 * 현재 사업의 공정표를 사내 표준 일정표 AoA 로 만든다(순수).
 * 번호 = `task.extId ?? task.id` — 취입 쪽이 이 값으로 같은 공정을 다시 찾아 **갱신**한다.
 * 시작일은 계산된 최조기 시작(es)이 아니라 **저장된 계획값 start** 를 쓴다 — es 는 파생값이라
 * 내보냈다 다시 읽으면 사용자가 잡아둔 여유(수동 배치)가 조용히 사라진다.
 */
export function buildScheduleAoa(project: Project): string[][] {
  const catName = new Map(project.categories.map((c) => [c.id, c.name]))
  const keyOf = (t: Task): string => t.extId ?? t.id
  const keyById = new Map(project.tasks.map((t) => [t.id, keyOf(t)]))
  const incoming = new Map<string, string[]>()
  for (const l of project.links) {
    const fromKey = keyById.get(l.from)
    if (!fromKey || !keyById.has(l.to)) continue
    const lag = Number.isFinite(l.lag) ? l.lag : 0
    const list = incoming.get(l.to)
    const text = formatPredecessor(fromKey, l.type, lag)
    if (list) list.push(text)
    else incoming.set(l.to, [text])
  }
  const rows: string[][] = [[...SCHEDULE_TEMPLATE_HEADER]]
  for (const t of project.tasks) {
    const isPoint = t.isMilestone || t.duration === 0
    rows.push([
      keyOf(t),
      catName.get(t.categoryId) ?? '',
      t.name,
      t.owner ?? '',
      toISO(dayToDate(project.startDate, t.start)),
      // 마일스톤은 종료일을 비워 기간 0 이 그대로 읽히게 한다(종료−시작+1 규칙을 타지 않는다).
      isPoint ? '' : toISO(dayToDate(project.startDate, t.start + t.duration - 1)),
      String(t.duration),
      (incoming.get(t.id) ?? []).join(', '),
    ])
  }
  return rows
}

/** AoA → .xlsx 다운로드(xlsx 는 이미 의존성 — 동적 import 로 초기 번들에서 뺀다). */
async function downloadAoaAsXlsx(aoa: string[][], fileName: string): Promise<void> {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 9 },
    { wch: 18 },
  ]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '일정표')
  XLSX.writeFile(book, fileName)
}

/** 빈 양식 내려받기 — 사용자가 채워서 그대로 다시 취입한다. */
export async function downloadScheduleTemplate(): Promise<void> {
  await downloadAoaAsXlsx(buildScheduleTemplateAoa(), 'Sequence_일정표_양식.xlsx')
}

/** 현재 공정표를 같은 양식으로 내보내기 — 취입 → 내보내기 왕복의 검증 경로. */
export async function exportScheduleXlsx(project: Project): Promise<void> {
  const safe = (project.name || '공정표').replace(/[\\/:*?"<>|]/g, '_')
  await downloadAoaAsXlsx(buildScheduleAoa(project), `${safe}_일정표.xlsx`)
}
