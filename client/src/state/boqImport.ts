// 내역서·수량산출서(BoQ) 취입 — 파싱·매핑 순수 함수(store 비의존). 검토서 B3.
//
// 설계 원칙(오류·데이터오염 금지):
//  · 파싱은 전부 이 순수 함수에서 하고, 실제 반영(store.importBoqQuantities)은 사용자가
//    매핑 표에서 **확인한 항목만** 건드린다 — 자동 추측이 곧바로 공정 데이터를 바꾸지 않는다.
//  · 포맷 로더(xlsx/hwpx/pdf)는 여기의 AoA(행×열 문자열)로 정규화해 같은 경로로 흐른다.
//  · 헤더·열을 못 찾으면 rows=[] + 경고를 돌려주고, UI가 사용자 수동 열지정으로 degrade 한다.
//
// 표준 열: 항목(품명/공종) · 규격(선택) · 단위 · 수량. (BoQ 표준 구조 참조.)

import { findStandardRate, STANDARD_RATES } from '../data/standardRates'
import { nameMatchScore, normWorkName, tokenizeWorkName } from '../engine/adequacy'
import { compareUnits, normalizeUnit, type UnitCheck } from '../engine/units'
import type { Task } from '../types/model'

export interface BoqRow {
  /** 항목명(품명/공종). */
  name: string
  /** 규격/사양(선택). */
  spec?: string
  /** 단위(㎥·㎡·m·ton…). */
  unit?: string
  /** 수량(물량). 0 이하/비수치는 제외. */
  quantity: number
}

export interface BoqColumns {
  /** 항목명 열 인덱스(-1=미지정). */
  name: number
  /** 규격 열(-1=없음). */
  spec: number
  /** 단위 열(-1=없음). */
  unit: number
  /** 수량 열(-1=미지정). */
  qty: number
}

export interface BoqParseResult {
  /** 정규화된 표(행×열, 셀은 문자열). UI 수동 열지정에 사용. */
  aoa: string[][]
  /** 헤더 행 인덱스(-1=미검출). */
  headerRowIndex: number
  columns: BoqColumns
  rows: BoqRow[]
  warnings: string[]
}

const NAME_KEYS = /품\s*명|명\s*칭|공\s*종|항\s*목|작업|내역|공종명|품목/
const QTY_KEYS = /수\s*량|물\s*량|q'?ty|quantity/i
const UNIT_KEYS = /단\s*위|unit/i
const SPEC_KEYS = /규\s*격|사\s*양|spec|치수/i
/** 합계/소계 행 판별 — 일정표 취입(state/scheduleImport.ts)도 같은 규칙을 쓴다. */
export const TOTAL_ROW = /^\s*(합\s*계|소\s*계|총\s*계|계|합계금액)\s*$/

const cell = (v: unknown): string => (v == null ? '' : String(v).trim())

/** "1,234.5 ㎥" → 1234.5 · 비수치 → null. 통화·단위 접미는 무시. */
export function parseQuantity(v: unknown): number | null {
  const s = cell(v).replace(/,/g, '').replace(/\s/g, '')
  if (!s) return null
  const m = s.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** RFC4180 스타일 CSV → 행×열. 따옴표·이스케이프·CRLF·개행 내포 처리. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '') // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // handled by \n
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 헤더 행을 찾아 표준 열(항목·규격·단위·수량)을 매핑. 상위 25행 내에서 탐색. */
function detectColumns(aoa: string[][]): { headerRowIndex: number; columns: BoqColumns } {
  const empty: BoqColumns = { name: -1, spec: -1, unit: -1, qty: -1 }
  const limit = Math.min(aoa.length, 25)
  for (let r = 0; r < limit; r++) {
    const rowCells = aoa[r].map(cell)
    let name = -1
    let spec = -1
    let unit = -1
    let qty = -1
    for (let c = 0; c < rowCells.length; c++) {
      const v = rowCells[c]
      if (!v) continue
      if (qty < 0 && QTY_KEYS.test(v)) qty = c
      else if (unit < 0 && UNIT_KEYS.test(v)) unit = c
      else if (spec < 0 && SPEC_KEYS.test(v)) spec = c
      else if (name < 0 && NAME_KEYS.test(v)) name = c
    }
    // 항목명+수량이 모두 있어야 유효한 헤더로 인정.
    if (name >= 0 && qty >= 0) return { headerRowIndex: r, columns: { name, spec, unit, qty } }
  }
  return { headerRowIndex: -1, columns: empty }
}

/** 검출/사용자 지정 열로 데이터 행을 추출. name 필수·qty>0 만 채택, 합계행 제외. */
export function extractRows(
  aoa: string[][],
  headerRowIndex: number,
  columns: BoqColumns,
): BoqRow[] {
  if (columns.name < 0 || columns.qty < 0 || headerRowIndex < 0) return []
  const out: BoqRow[] = []
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const rowCells = aoa[r]
    const name = cell(rowCells[columns.name])
    if (!name || TOTAL_ROW.test(name)) continue
    const qty = parseQuantity(rowCells[columns.qty])
    if (qty == null || qty <= 0) continue
    const unit = columns.unit >= 0 ? cell(rowCells[columns.unit]) : ''
    const spec = columns.spec >= 0 ? cell(rowCells[columns.spec]) : ''
    out.push({ name, quantity: qty, ...(unit ? { unit } : {}), ...(spec ? { spec } : {}) })
  }
  return out
}

/** AoA(행×열) → BoQ 파싱 결과(헤더·열·행·경고). 포맷 로더 공통 진입점. */
export function parseBoqAoa(aoaIn: unknown[][]): BoqParseResult {
  const aoa = aoaIn.map((row) => (Array.isArray(row) ? row.map(cell) : []))
  const warnings: string[] = []
  const { headerRowIndex, columns } = detectColumns(aoa)
  if (headerRowIndex < 0) {
    warnings.push('표준 헤더(항목·수량)를 찾지 못했습니다 — 아래에서 열을 직접 지정하세요.')
    return { aoa, headerRowIndex, columns, rows: [], warnings }
  }
  if (columns.unit < 0)
    warnings.push('단위 열을 찾지 못했습니다 — 단위는 표준 일작업량에서 보완합니다.')
  const rows = extractRows(aoa, headerRowIndex, columns)
  if (rows.length === 0) warnings.push('데이터 행을 읽지 못했습니다 — 열 지정을 확인하세요.')
  return { aoa, headerRowIndex, columns, rows, warnings }
}

// ── 공종코드 추천(표준 일작업량 DB 매칭) ────────────────────────────────────────
// 토큰화·이름 점수는 engine/adequacy 와 **같은 규칙**을 쓴다(검토요청서의 표준공기 유사
// 매칭과 동일한 결정론 기준 — 규칙이 갈라지면 화면과 AI 요청서가 서로 다른 매칭을 한다).
const tokenize = tokenizeWorkName

/**
 * BoQ 항목명/규격/단위로 표준 일작업량 DB의 workCode 를 추천(결정론 점수).
 * 토큰 겹침 + 부분일치 + 단위 일치 보너스. 임계 미만이면 undefined(추측 강요 안 함).
 */
export function suggestWorkCode(name: string, spec?: string, unit?: string): string | undefined {
  const q = tokenize(`${name} ${spec ?? ''}`)
  if (q.length === 0) return undefined
  let best: { code: string; score: number } | null = null
  for (const rate of STANDARD_RATES) {
    const hay = `${rate.work} ${rate.subwork}`
    const rt = tokenize(hay)
    let score = 0
    for (const w of q) {
      if (rt.includes(w)) score += 2
      else if (w.length >= 2 && hay.includes(w)) score += 1
    }
    // 단위 보너스는 정규화 후 비교 — 'm3'·'루베'도 '㎥' 와 같은 단위로 인정한다(engine/units).
    if (unit && rate.unit && normalizeUnit(unit) === normalizeUnit(rate.unit)) score += 2
    if (!best || score > best.score) best = { code: rate.code, score }
  }
  return best && best.score >= 3 ? best.code : undefined
}

// ── BoQ 행 ↔ 공정 매핑 ─────────────────────────────────────────────────────────
export interface BoqTaskMapping {
  taskId: string
  taskName: string
  categoryId: string
  /** 매칭된 BoQ 행(없으면 미매칭 — 사용자가 수동 연결). */
  row: BoqRow | null
  /** 반영 예정 물량(사용자 수정 가능). */
  quantity?: number
  unit?: string
  workCode?: string
  /** 단위 검사(BoQ 단위 vs 표준 일작업량 단위). 값은 고치지 않고 판정만 덧붙인다. */
  unitCheck?: UnitCheck
}

const nameScore = nameMatchScore

/**
 * BoQ 행들을 공정(비마일스톤)에 자동 매핑 — 이름 유사도 최고 행을 붙이고, 단위/공종코드는
 * 행/표준DB에서 추천한다. 결과는 UI 매핑 표에 채워지며, **사용자 확인 후에만** 반영된다.
 */
export function matchRowsToTasks(
  rows: BoqRow[],
  tasks: Task[],
): { mappings: BoqTaskMapping[]; unmatchedRows: BoqRow[] } {
  const usedRow = new Set<number>()
  const mappings: BoqTaskMapping[] = []
  for (const t of tasks) {
    if (t.isMilestone) continue
    let best: { idx: number; score: number } | null = null
    for (let i = 0; i < rows.length; i++) {
      if (usedRow.has(i)) continue
      const score = nameScore(t.name, rows[i].name)
      if (score > 0 && (!best || score > best.score)) best = { idx: i, score }
    }
    if (best && best.score >= 4) {
      usedRow.add(best.idx)
      const row = rows[best.idx]
      const workCode = t.workCode ?? suggestWorkCode(row.name, row.spec, row.unit)
      const unit = row.unit ?? t.unit ?? findStandardRate(workCode)?.unit
      // 단위 검사 — 표준 일작업량과 단위가 다르면 물량÷생산성이 성립하지 않는다. 값은
      // 자동 수정하지 않고(원칙 유지) 판정만 실어 UI 가 ⚠ 로 알리고 자동선택에서 뺀다.
      const unitCheck = compareUnits(unit, findStandardRate(workCode)?.unit)
      mappings.push({
        taskId: t.id,
        taskName: normWorkName(t.name),
        categoryId: t.categoryId,
        row,
        quantity: row.quantity,
        ...(unit ? { unit } : {}),
        ...(workCode ? { workCode } : {}),
        unitCheck,
      })
    } else {
      mappings.push({
        taskId: t.id,
        taskName: normWorkName(t.name),
        categoryId: t.categoryId,
        row: null,
      })
    }
  }
  const unmatchedRows = rows.filter((_, i) => !usedRow.has(i))
  return { mappings, unmatchedRows }
}
