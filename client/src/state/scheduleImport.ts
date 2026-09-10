// 사내 일정표(엑셀·CSV) 취입 — 파싱·매핑 순수 함수(store 비의존). F12.
//
// 대상 형식은 **1종**으로 한정한다: `export/scheduleTemplate.ts` 가 내려주는 사내 표준 일정표
//   번호 · 공종 · 공정명 · 담당자 · 시작일 · 종료일 · 기간(일) · 선행
// 열 순서는 자유(머리글 이름으로 검출)이고, 검출에 실패하면 UI 가 수동 열지정으로 degrade 한다.
// MS Project XML/MPP·자원·원가 열·작업일 캘린더는 이번 슬라이스 대상이 아니다.
//
// 설계 원칙(boqImport.ts 와 동일 — 오류·데이터오염 금지):
//  · 파싱은 전부 이 순수 함수에서, 반영은 사용자가 **미리보기에서 확인·체크한 행만**.
//  · 읽을 수 없는 행은 **조용히 버리지 않고** mode:'error' + 사유로 계획에 남겨 화면에 띄운다.
//  · 같은 번호(extId)/같은 공정 id 가 이미 있으면 새로 만들지 않고 갱신한다(무한 중복 방지).
//
// 날짜 규약(왕복 보존의 핵심):
//  · 시작일 = 공정의 첫 작업일, 종료일 = **마지막 작업일**(포함). 기간 = 종료 − 시작 + 1.
//  · 마일스톤(기간 0)은 종료일을 비우고 기간 0 으로 적는다 → 다시 읽어도 기간 0 이 보존된다.

import { normWorkName } from '../engine/adequacy'
import { dateToDay, parseISO, toISO } from '../engine/dates'
import type { ID, LinkType, Project } from '../types/model'
import { TOTAL_ROW } from './boqImport'

/** 검출/사용자 지정 열 인덱스. -1 = 미지정. */
export interface ScheduleColumns {
  /** 번호(외부 고유 ID) — 재취입 시 동일 ID 갱신 키. */
  key: number
  category: number
  name: number
  owner: number
  start: number
  finish: number
  duration: number
  pred: number
}

/** 한 데이터 행의 원문(문자열 단계). */
export interface ScheduleRow {
  /** 원본 시트의 0-based 행 인덱스(오류 표시에 그대로 쓴다). */
  rowIndex: number
  key?: string
  categoryName?: string
  name: string
  owner?: string
  startISO?: string
  finishISO?: string
  duration?: number
  predRaw?: string
}

export interface ScheduleParseResult {
  /** 정규화된 표(행×열, 셀은 문자열). UI 수동 열지정에 사용. */
  aoa: string[][]
  /** 머리글 행 인덱스(-1=미검출). */
  headerRowIndex: number
  columns: ScheduleColumns
  rows: ScheduleRow[]
  warnings: string[]
}

/** 선행 참조 하나 — ref 는 '번호' 열의 값(우리 내보내기는 task.extId ?? task.id). */
export interface SchedulePredRef {
  ref: string
  type: LinkType
  lag: number
}

/** 행 하나에 대한 반영 계획. mode==='error' 면 체크 불가·미반영이며 error 에 사유가 있다. */
export interface SchedulePlanItem {
  rowIndex: number
  row: ScheduleRow
  mode: 'create' | 'update' | 'error'
  /** 갱신 대상 공정 id(mode==='update'). */
  taskId?: ID
  categoryName: string
  startDay?: number
  duration?: number
  owner?: string
  /** 갱신 시 실제로 달라지는 필드들(사람이 읽는 이름). 비어 있으면 변경 없음. */
  changed: string[]
  error?: string
}

export interface ScheduleLinkPlan {
  fromKey: string
  toKey: string
  type: LinkType
  lag: number
}

export interface SchedulePlan {
  items: SchedulePlanItem[]
  /** 새로 만들어야 하는 공종 이름(중복 제거·등장 순서). */
  newCategories: string[]
  links: ScheduleLinkPlan[]
  warnings: string[]
}

const KEY_KEYS = /번\s*호|^no\.?$|^id$|코\s*드|순\s*번/i
const CAT_KEYS = /공\s*종|구\s*분|대분류|wbs/i
const NAME_KEYS = /공\s*정\s*명|공\s*정$|작\s*업|활\s*동|task|activity|명\s*칭/i
const OWNER_KEYS = /담\s*당|책\s*임|owner/i
const START_KEYS = /시\s*작|착\s*수|start/i
const FINISH_KEYS = /종\s*료|완\s*료|준\s*공|finish|end/i
const DUR_KEYS = /기\s*간|공\s*기|일\s*수|duration|days?/i
const PRED_KEYS = /선\s*행|선후행|predecessor|pred/i

const cell = (v: unknown): string => (v == null ? '' : String(v).trim())

export const EMPTY_SCHEDULE_COLUMNS: ScheduleColumns = {
  key: -1,
  category: -1,
  name: -1,
  owner: -1,
  start: -1,
  finish: -1,
  duration: -1,
  pred: -1,
}

/**
 * 날짜 셀 → ISO(YYYY-MM-DD). 지원: `2026-03-01` · `2026.3.1` · `2026/03/01` · `26.3.1` ·
 * 엑셀 시리얼 숫자(1900 기준). 읽을 수 없으면 null(호출부가 오류 행으로 모은다).
 */
export function parseDateCell(v: unknown): string | null {
  const s = cell(v)
  if (!s) return null
  // 엑셀 시리얼(raw:false 로 읽어도 서식 없는 셀은 숫자 문자열로 온다).
  if (/^\d{1,5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    // 1..2958465 = 1900-01-01 ~ 9999-12-31. 4자리 이하는 연도가 아니라 시리얼로 본다.
    if (serial >= 1 && serial <= 2_958_465) {
      const d = new Date(1899, 11, 30)
      d.setDate(d.getDate() + serial)
      return toISO(d)
    }
    return null
  }
  const m = s.match(/^(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/)
  if (!m) return null
  let year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  // 2026-02-31 같은 값은 Date 가 조용히 넘겨버리므로 되돌려 검증한다.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return toISO(d)
}

/** "120" · "120일" · "1,200" → 120 · 비수치 → null. */
export function parseDurationCell(v: unknown): number | null {
  const s = cell(v).replace(/,/g, '')
  if (!s) return null
  const m = s.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Math.round(Number(m[0]))
  return Number.isFinite(n) ? n : null
}

/**
 * 선행 토큰 하나 해석. `knownKeys` 에 통째로 들어 있으면 **그대로 번호**로 본다 —
 * 우리 내보내기의 번호가 `t-abc123`(하이픈·숫자 포함)이라 접미 파싱이 번호를 먹는 사고를 막는다.
 */
function parsePredToken(token: string, knownKeys?: Set<string>): SchedulePredRef | null {
  const s = token.trim()
  if (!s) return null
  if (knownKeys?.has(s)) return { ref: s, type: 'FS', lag: 0 }
  let rest = s
  let lag = 0
  const lagMatch = rest.match(/([+-]\s*\d+)\s*(?:일|d|days?)?$/i)
  if (lagMatch) {
    const head = rest.slice(0, rest.length - lagMatch[0].length)
    // '-3' 처럼 앞이 비면 지연이 아니라 번호 자체다.
    if (head.trim()) {
      lag = Number(lagMatch[1].replace(/\s/g, ''))
      rest = head
    }
  }
  let type: LinkType = 'FS'
  const trimmed = rest.trim()
  const typeMatch = trimmed.match(/(FS|SS|FF|SF)$/i)
  if (typeMatch) {
    const head = trimmed.slice(0, trimmed.length - 2)
    if (head.trim()) {
      type = typeMatch[1].toUpperCase() as LinkType
      rest = head
    }
  }
  const ref = rest.trim().replace(/[,;]$/, '')
  return ref ? { ref, type, lag } : null
}

/** "3FS+2, 5" → [{3,FS,2},{5,FS,0}]. 해석 불가 토큰은 unknown 에 모아 경고로 올린다. */
export function parsePredecessors(
  raw: string | undefined,
  knownKeys?: Set<string>,
): { refs: SchedulePredRef[]; unknown: string[] } {
  const refs: SchedulePredRef[] = []
  const unknown: string[] = []
  for (const token of cell(raw).split(/[,;\n]/)) {
    const t = token.trim()
    if (!t) continue
    const parsed = parsePredToken(t, knownKeys)
    if (parsed) refs.push(parsed)
    else unknown.push(t)
  }
  return { refs, unknown }
}

/** 머리글 행을 찾아 표준 열을 매핑. 상위 25행 내에서 탐색(boqImport.detectColumns 와 같은 구조). */
export function detectScheduleColumns(aoa: string[][]): {
  headerRowIndex: number
  columns: ScheduleColumns
} {
  const limit = Math.min(aoa.length, 25)
  for (let r = 0; r < limit; r++) {
    const cells = aoa[r].map(cell)
    const cols: ScheduleColumns = { ...EMPTY_SCHEDULE_COLUMNS }
    for (let c = 0; c < cells.length; c++) {
      const v = cells[c]
      if (!v) continue
      // 판정 순서가 곧 우선순위 — '공정명' 이 '공종' 보다, '기간(일)' 이 '시작일' 보다 먼저.
      if (cols.name < 0 && NAME_KEYS.test(v)) cols.name = c
      else if (cols.owner < 0 && OWNER_KEYS.test(v)) cols.owner = c
      else if (cols.start < 0 && START_KEYS.test(v)) cols.start = c
      else if (cols.finish < 0 && FINISH_KEYS.test(v)) cols.finish = c
      else if (cols.duration < 0 && DUR_KEYS.test(v)) cols.duration = c
      else if (cols.pred < 0 && PRED_KEYS.test(v)) cols.pred = c
      else if (cols.category < 0 && CAT_KEYS.test(v)) cols.category = c
      else if (cols.key < 0 && KEY_KEYS.test(v)) cols.key = c
    }
    // 공정명 + (시작일 | 기간) 이 모두 있어야 유효한 머리글로 인정한다.
    if (cols.name >= 0 && (cols.start >= 0 || cols.duration >= 0)) {
      return { headerRowIndex: r, columns: cols }
    }
  }
  return { headerRowIndex: -1, columns: { ...EMPTY_SCHEDULE_COLUMNS } }
}

/** 검출/사용자 지정 열로 데이터 행을 추출. 공정명 필수, 합계행 제외. 날짜 오류는 여기서 버리지 않는다. */
export function extractScheduleRows(
  aoa: string[][],
  headerRowIndex: number,
  columns: ScheduleColumns,
): ScheduleRow[] {
  if (columns.name < 0 || headerRowIndex < 0) return []
  const at = (row: string[], c: number): string => (c >= 0 ? cell(row[c]) : '')
  const out: ScheduleRow[] = []
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r]
    const name = at(row, columns.name)
    if (!name || TOTAL_ROW.test(name)) continue
    const key = at(row, columns.key)
    const categoryName = at(row, columns.category)
    const owner = at(row, columns.owner)
    const startISO = parseDateCell(at(row, columns.start))
    const finishISO = parseDateCell(at(row, columns.finish))
    const duration = parseDurationCell(at(row, columns.duration))
    const predRaw = at(row, columns.pred)
    out.push({
      rowIndex: r,
      name,
      ...(key ? { key } : {}),
      ...(categoryName ? { categoryName } : {}),
      ...(owner ? { owner } : {}),
      ...(startISO ? { startISO } : {}),
      ...(finishISO ? { finishISO } : {}),
      ...(duration != null ? { duration } : {}),
      ...(predRaw ? { predRaw } : {}),
    })
  }
  return out
}

/** AoA → 파싱 결과(머리글·열·행·경고). 포맷 로더(엑셀/CSV) 공통 진입점. */
export function parseScheduleAoa(aoaIn: unknown[][]): ScheduleParseResult {
  const aoa = aoaIn.map((row) => (Array.isArray(row) ? row.map(cell) : []))
  const warnings: string[] = []
  const { headerRowIndex, columns } = detectScheduleColumns(aoa)
  if (headerRowIndex < 0) {
    warnings.push('표준 머리글(공정명 + 시작일/기간)을 찾지 못했습니다 — 열을 직접 지정하세요.')
    return { aoa, headerRowIndex, columns, rows: [], warnings }
  }
  if (columns.key < 0)
    warnings.push('번호 열이 없어 재취입 시 같은 공정을 알아보지 못합니다(이름으로만 대조).')
  const rows = extractScheduleRows(aoa, headerRowIndex, columns)
  if (rows.length === 0) warnings.push('데이터 행을 읽지 못했습니다 — 열 지정을 확인하세요.')
  return { aoa, headerRowIndex, columns, rows, warnings }
}

const catKey = (categoryName: string, name: string): string =>
  `${normWorkName(categoryName)} ${normWorkName(name)}`

/**
 * 파싱된 행들을 현재 사업에 맞춰 **반영 계획**으로 만든다(아직 아무것도 바꾸지 않는다).
 * 매칭 우선순위: 같은 extId → 같은 공정 id(내보내기 왕복) → 같은 공종 안 같은 이름 → 신규.
 * 오류는 throw 하지 않고 mode:'error' 로 모은다(BoQ 의 '경고 후 degrade' 원칙과 동일).
 */
export function buildSchedulePlan(project: Project, rows: ScheduleRow[]): SchedulePlan {
  const warnings: string[] = []
  const byExtId = new Map<string, ID>()
  const byId = new Set<ID>()
  const byName = new Map<string, ID>()
  const catNameById = new Map<ID, string>(project.categories.map((c) => [c.id, c.name]))
  for (const t of project.tasks) {
    if (t.extId && !byExtId.has(t.extId)) byExtId.set(t.extId, t.id)
    byId.add(t.id)
    const key = catKey(catNameById.get(t.categoryId) ?? '', t.name)
    if (!byName.has(key)) byName.set(key, t.id)
  }
  // 공종 대조 규칙은 **normWorkName 하나**다(선행 ◆ 제거 + 내부 공백 축약). 계획과 반영이
  // 서로 다른 규칙을 쓰면(계획=정규화 / 반영=원문) '토공  공사'(공백 2칸)와 '토공 공사'처럼
  // 정규화만 같은 이름에서 계획은 공종 생성을 건너뛰고 반영은 조회에 실패해, 공정이 통째로
  // 엉뚱한 공종으로 들어간다. store.importScheduleRows 도 같은 함수로 대조한다.
  const existingCategoryNames = new Set(project.categories.map((c) => normWorkName(c.name)))

  const items: SchedulePlanItem[] = []
  const usedTaskIds = new Set<ID>()
  const seenKeys = new Set<string>()
  const newCategories: string[] = []
  // 신규 공종도 정규화 키로 중복 제거한다 — 파일 안에 '토공 공사'/'토공  공사'가 섞여 있어도
  // 공종은 하나만 만들어지고, 두 행 모두 그 하나로 들어간다.
  const seenNewCat = new Set<string>()

  for (const row of rows) {
    const categoryName = row.categoryName?.trim() || '취입 공정'
    const base = { rowIndex: row.rowIndex, row, categoryName, changed: [] as string[] }

    if (row.key && seenKeys.has(row.key)) {
      items.push({ ...base, mode: 'error', error: `번호 '${row.key}' 가 파일 안에서 중복됩니다.` })
      continue
    }
    if (row.key) seenKeys.add(row.key)

    const startDay = row.startISO ? dateToDay(project.startDate, parseISO(row.startISO)) : null
    const finishDay = row.finishISO ? dateToDay(project.startDate, parseISO(row.finishISO)) : null
    if (startDay == null) {
      items.push({ ...base, mode: 'error', error: '시작일을 읽지 못했습니다(YYYY-MM-DD).' })
      continue
    }
    let duration: number | null = null
    if (finishDay != null) duration = finishDay - startDay + 1
    if (duration == null && row.duration != null) duration = row.duration
    if (duration == null) {
      items.push({ ...base, mode: 'error', error: '종료일·기간(일)이 모두 없습니다.' })
      continue
    }
    if (duration < 0 || (finishDay != null && finishDay < startDay)) {
      items.push({ ...base, mode: 'error', error: '종료일이 시작일보다 앞섭니다.' })
      continue
    }

    // 매칭 — 이미 이 파일의 다른 행이 가져간 공정은 다시 쓰지 않는다(중복 갱신 방지).
    let taskId: ID | undefined
    if (row.key) {
      const hit = byExtId.get(row.key) ?? (byId.has(row.key) ? row.key : undefined)
      if (hit && !usedTaskIds.has(hit)) taskId = hit
    }
    if (!taskId) {
      const hit = byName.get(catKey(categoryName, row.name))
      if (hit && !usedTaskIds.has(hit)) taskId = hit
    }

    const catNorm = normWorkName(categoryName)
    if (!existingCategoryNames.has(catNorm) && !seenNewCat.has(catNorm)) {
      seenNewCat.add(catNorm)
      newCategories.push(categoryName)
    }
    if (taskId) {
      usedTaskIds.add(taskId)
      const current = project.tasks.find((t) => t.id === taskId)
      const changed: string[] = []
      if (current) {
        const currentCategory = project.categories.find((c) => c.id === current.categoryId)
        if (!currentCategory || normWorkName(currentCategory.name) !== catNorm) changed.push('공종')
        if (current.start !== startDay) changed.push('시작일')
        if (current.duration !== duration) changed.push('기간')
        if ((current.owner ?? '') !== (row.owner ?? '')) changed.push('담당자')
        if (current.name !== row.name) changed.push('공정명')
      }
      items.push({
        ...base,
        mode: 'update',
        taskId,
        startDay,
        duration,
        ...(row.owner ? { owner: row.owner } : {}),
        changed,
      })
    } else {
      items.push({
        ...base,
        mode: 'create',
        startDay,
        duration,
        ...(row.owner ? { owner: row.owner } : {}),
        changed: ['신규'],
      })
    }
  }

  // 선후행 — 번호가 있는 행끼리만 연결한다(번호 없이는 어느 행을 가리키는지 알 수 없다).
  const knownKeys = new Set(rows.map((r) => r.key).filter((k): k is string => !!k))
  const links: ScheduleLinkPlan[] = []
  const seenLink = new Set<string>()
  const unknownRefs = new Set<string>()
  let droppedNoKey = 0
  for (const row of rows) {
    if (!row.predRaw) continue
    if (!row.key) {
      droppedNoKey++
      continue
    }
    const { refs, unknown } = parsePredecessors(row.predRaw, knownKeys)
    for (const u of unknown) unknownRefs.add(u)
    for (const ref of refs) {
      if (!knownKeys.has(ref.ref)) {
        unknownRefs.add(ref.ref)
        continue
      }
      if (ref.ref === row.key) continue
      const dedupe = `${ref.ref} ${row.key} ${ref.type}`
      if (seenLink.has(dedupe)) continue
      seenLink.add(dedupe)
      links.push({ fromKey: ref.ref, toKey: row.key, type: ref.type, lag: ref.lag })
    }
  }
  if (droppedNoKey > 0)
    warnings.push(`번호가 없어 선후행을 연결하지 못한 행 ${droppedNoKey}건(번호 열을 채우세요).`)
  if (unknownRefs.size > 0)
    warnings.push(`이 파일에 없는 선행 번호 ${[...unknownRefs].slice(0, 8).join(', ')}`)
  const errorCount = items.filter((i) => i.mode === 'error').length
  if (errorCount > 0) warnings.push(`읽지 못한 행 ${errorCount}건 — 아래 표에서 사유를 확인하세요.`)

  return { items, newCategories, links, warnings }
}
