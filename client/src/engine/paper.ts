// Paper (ISO 216 A-series) dimensions and pixel helpers for the export engine.

import type { Orientation, PaperSettings, PaperSize, Project } from '../types/model'
import { computeLayout, fitToPaperView, type LayoutFilter } from './layout'

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
 * 현재 출력 엔진은 항상 1장(레터박스 축소)이므로, 이 함수는 "읽을 수 있는 크기로
 * 인쇄하려면 몇 장이 필요한가"를 사용자에게 알리는 용도로 쓴다.
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
