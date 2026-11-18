// Paper (ISO 216 A-series) dimensions and pixel helpers for the export engine.

import type { Orientation, PaperSettings, PaperSize, Project } from '../types/model'
import {
  AUTO_FIT_LIMITS,
  computeLayout,
  fitToPaperView,
  type LayoutFilter,
  type LayoutModel,
} from './layout'

/** Portrait dimensions in millimetres. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
}

export const PAPER_SIZES: PaperSize[] = ['A4', 'A3', 'A2', 'A1', 'A0']

/** Selectable export DPIs. 400·600 enable high-fidelity prints on A4~A2. */
export const DPI_OPTIONS: number[] = [96, 150, 200, 300, 400, 600]

export function paperMm(size: PaperSize, orientation: Orientation): { w: number; h: number } {
  const base = PAPER_MM[size]
  return orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

const MM_PER_INCH = 25.4

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi)
}

/** Safety cap so giant rasters don't blow the canvas/memory limit. Raised so
 *  A4~A2 reach a true 600dpi; larger sheets still auto-clamp (with a notice). */
const MAX_PIXEL_AREA = 2.4e8 // ~240 MP (under Chrome's 2^28 canvas-area limit)
const MAX_DIMENSION = 16000 // widely-safe single-axis canvas limit

export interface PaperPx {
  wPx: number
  hPx: number
  wMm: number
  hMm: number
  effectiveDpi: number
  clamped: boolean
}

/** 분할 출력(타일링) 계획 — 도면을 용지 몇 장에 나눠 실어야 하는지. */
export interface TilePlan {
  cols: number
  rows: number
  pages: number
}

/**
 * 도면(contentW×contentH)을 한 장(pageW×pageH)씩 잘라 실을 때 필요한 장수.
 * 모든 값은 **같은 단위**(보통 출력 픽셀)여야 한다. 순수·결정적 함수라
 * 사전 점검(export/preflight.ts)과 스모크가 같은 결과를 공유한다.
 * PDF 출력 엔진과 사전 점검이 함께 사용해 최소 글자 크기를 지키는 자동 분할 장수를 정한다.
 */
export function tilePages(
  contentW: number,
  contentH: number,
  pageW: number,
  pageH: number,
): TilePlan {
  const safe = (v: number) => (Number.isFinite(v) && v > 0 ? v : 1)
  const cols = Math.max(1, Math.ceil(safe(contentW) / safe(pageW)))
  const rows = Math.max(1, Math.ceil(safe(contentH) / safe(pageH)))
  return { cols, rows, pages: cols * rows }
}

/** Repeat the left WBS column and top time header on every PDF tile. */
export function tilePagesWithFrozen(
  contentW: number,
  contentH: number,
  pageW: number,
  pageH: number,
  frozenW: number,
  frozenH: number,
): TilePlan {
  const safe = (v: number) => (Number.isFinite(v) && v > 0 ? v : 1)
  const bodyW = Math.max(0, safe(contentW) - Math.max(0, frozenW))
  const bodyH = Math.max(0, safe(contentH) - Math.max(0, frozenH))
  const usableW = Math.max(1, safe(pageW) - Math.max(0, frozenW))
  const usableH = Math.max(1, safe(pageH) - Math.max(0, frozenH))
  const cols = Math.max(1, Math.ceil(bodyW / usableW))
  const rows = Math.max(1, Math.ceil(bodyH / usableH))
  return { cols, rows, pages: cols * rows }
}

/**
 * 필터가 실제로 남기는 것만 담은 프로젝트 투영(projection).
 *
 * computeLayout(project, filter) 과 **같은 결과**를 필터 없이 얻기 위한 것이다. 필터 판정을
 * 여기서 다시 쓰지 않고 computeLayout 에게 직접 물어보므로(두 판정이 갈라질 여지 없음),
 * 필터 규칙이 바뀌어도 자동으로 따라간다.
 */
function scopedProject(project: Project, filter?: LayoutFilter): Project {
  const on = !!filter && (filter.critical || filter.milestone || filter.query.trim() !== '')
  if (!on) return project
  const shown = computeLayout(project, filter)
  const taskIds = new Set(shown.tasks.map((laid) => laid.task.id))
  const categoryIds = new Set(shown.categories.map((cat) => cat.id))
  return {
    ...project,
    categories: project.categories.filter((cat) => categoryIds.has(cat.id)),
    tasks: project.tasks.filter((task) => taskIds.has(task.id)),
  }
}

/**
 * 출력 범위를 반영한 용지 맞춤 — [여백 없이 시트에 맞추기]가 실제로 **출력될 그 도면**에
 * 맞추게 한다.
 *
 * fitToPaperView 는 필터를 모르는 순수 기하 함수라 늘 전체 도면 기준으로 배율을 풀었다.
 * '현재 표시 범위'(필터 적용)로 출력하는 중에 그걸 누르면 전체 도면 기준으로 맞춰지므로,
 * 정작 출력될 도면의 여백은 그대로거나 오히려 더 나빠졌다(전체 0% / 표시범위 65%).
 * filter 를 주면 그 필터가 남기는 도면을 기준으로 푼다.
 */
export function fitToPaperScopedView(
  project: Project,
  filter: LayoutFilter | undefined,
  paperWmm: number,
  paperHmm: number,
): { pxPerDay?: number; rowHeight?: number; fontScale?: number } {
  return fitToPaperView(scopedProject(project, filter), paperWmm, paperHmm)
}

/** 시트 맞춤에서 한 줄(행)이 용지 위에서 차지하는 높이(mm). */
export const SHEET_ROW_MM = 10

export interface SheetPages {
  /** 도면 좌표 1px 이 용지에서 차지하는 길이(mm) — 도면 폭을 용지 폭에 정확히 맞춘 배율. */
  mmPerPx: number
  /** 한 줄(행)의 용지 위 높이(mm). */
  rowMm: number
  /** 용지 한 장의 높이(도면 좌표 px). */
  pageHeight: number
  /** 쪽이 나뉘는 도면 y 좌표(오름차순). 비어 있으면 한 장. */
  breaks: number[]
}

/**
 * 도면 폭을 용지 폭에 **정확히** 맞췄을 때 세로로 몇 장이 되고 어디서 나뉘는지.
 *
 * 1쪽은 제목·연/월 헤더부터 시작하고, 2쪽부터는 맨 위에 연/월 헤더를 반복한 뒤 이어진다
 * (그래서 2쪽부터는 담을 수 있는 높이가 헤더만큼 줄어든다). 줄 중간에서는 자르지 않는다 —
 * 공종 시작선과 줄 경계에서만 나눈다. 화면의 쪽 나눔 점선·PDF·DXF 가 모두 이 결과를 쓴다.
 */
export function sheetPages(
  m: Pick<
    LayoutModel,
    'contentWidth' | 'contentHeight' | 'rowHeight' | 'headerHeight' | 'categories' | 'chartTop' | 'chartHeight'
  >,
  paperWmm: number,
  paperHmm: number,
): SheetPages {
  const mmPerPx = paperWmm / Math.max(1, m.contentWidth)
  const pageHeight = paperHmm / mmPerPx
  const out: SheetPages = { mmPerPx, rowMm: m.rowHeight * mmPerPx, pageHeight, breaks: [] }
  if (!(pageHeight - m.headerHeight > 1)) return out // 헤더만으로 한 장이 차는 비정상 배율
  const candidates: number[] = []
  for (const c of m.categories) {
    candidates.push(c.y)
    const inset = c.height - c.subRows * m.rowHeight
    for (let i = 1; i < c.subRows; i++) candidates.push(c.y + inset + i * m.rowHeight)
  }
  candidates.push(m.chartTop + m.chartHeight) // 하단 로고 띠 앞
  candidates.sort((a, b) => a - b)
  let start = 0
  let capacity = pageHeight
  while (m.contentHeight - start > capacity + 0.01) {
    let next = start + capacity // 한 줄이 용지보다 크면(비정상) 그 자리에서 자른다
    for (const y of candidates) {
      if (y > start + 0.01 && y <= start + capacity + 0.01) next = y
      else if (y > start + capacity) break
    }
    out.breaks.push(next)
    start = next
    capacity = pageHeight - m.headerHeight
  }
  return out
}

/**
 * [여백 없이 시트에 맞추기] — 도면 폭을 용지 폭에 맞췄을 때 한 줄이 정확히 SHEET_ROW_MM 가
 * 되도록 시간축(pxPerDay)을 푼다. 줄 높이는 글자·막대가 들어가는 최소 높이로 내려, 10mm 안에서
 * 글자가 가장 크게 찍히게 한다. 글자 크기는 건드리지 않는다. 세로는 맞추지 않는다 — 넘치면
 * sheetPages 가 다음 장으로 넘긴다.
 */
export function fitToSheetView(
  project: Project,
  filter: LayoutFilter | undefined,
  paperWmm: number,
  paperHmm: number,
): { pxPerDay?: number; rowHeight?: number; fontScale?: number } {
  if (!(paperWmm > 0) || !(paperHmm > 0)) return {}
  const scoped = scopedProject(project, filter)
  const rowHeight = AUTO_FIT_LIMITS.minRowHeight // 하한 아래 → computeLayout 이 최소 높이로 올린다
  // 글자 크기는 사용자가 정한 대로 둔다. 다만 슬라이더 범위(50~600%)를 벗어난 폭주 값은
  // 옛 자동 맞춤이 남긴 사고 흔적이므로 100% 로 되돌린다(88430% 글자 사례).
  const fs0 = project.view.fontScale ?? 1
  const fontScale = fs0 >= AUTO_FIT_LIMITS.minFontScale && fs0 <= 6 ? fs0 : 1
  const m = computeLayout({ ...scoped, view: { ...scoped.view, rowHeight, fontScale } })
  const days = Math.max(1, m.domainEndDay - m.domainStartDay)
  const targetWidth = (m.rowHeight * paperWmm) / SHEET_ROW_MM
  const pxPerDay = Math.max(0.02, (targetWidth - m.labelWidth) / days)
  const out: { pxPerDay?: number; rowHeight?: number; fontScale?: number } = {}
  if (fontScale !== fs0) out.fontScale = fontScale
  if (Math.abs(pxPerDay - project.view.pxPerDay) > 1e-4) out.pxPerDay = Number(pxPerDay.toFixed(5))
  if (rowHeight !== project.view.rowHeight) out.rowHeight = rowHeight
  return out
}

export function paperPx(paper: PaperSettings): PaperPx {
  const { w: wMm, h: hMm } = paperMm(paper.size, paper.orientation)
  let dpi = paper.dpi
  let wPx = mmToPx(wMm, dpi)
  let hPx = mmToPx(hMm, dpi)
  let clamped = false

  const area = wPx * hPx
  const maxDim = Math.max(wPx, hPx)
  let scale = 1
  if (area > MAX_PIXEL_AREA) scale = Math.min(scale, Math.sqrt(MAX_PIXEL_AREA / area))
  if (maxDim > MAX_DIMENSION) scale = Math.min(scale, MAX_DIMENSION / maxDim)
  if (scale < 1) {
    dpi = Math.floor(dpi * scale)
    wPx = mmToPx(wMm, dpi)
    hPx = mmToPx(hMm, dpi)
    clamped = true
  }
  return { wPx, hPx, wMm, hMm, effectiveDpi: dpi, clamped }
}
