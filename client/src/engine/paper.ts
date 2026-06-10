// Paper (ISO 216 A-series) dimensions and pixel helpers for the export engine.

import type { Orientation, PaperSettings, PaperSize } from '../types/model'

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
const MAX_DIMENSION = 16000  // widely-safe single-axis canvas limit

export interface PaperPx {
  wPx: number
  hPx: number
  wMm: number
  hMm: number
  effectiveDpi: number
  clamped: boolean
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
