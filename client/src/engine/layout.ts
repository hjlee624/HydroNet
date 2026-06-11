// ─────────────────────────────────────────────────────────────────────────────
// Layout engine — turns the data model into absolute pixel geometry.
//
// Produces everything the SVG renderer needs: lane bands, stacked task bars /
// milestone diamonds, the year + month timeline header, and the 우기 bands.
// Pure & deterministic so on-screen and exported output are identical.
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, Project, Task } from '../types/model'
import {
  MONTH_LABELS_KO,
  addMonths,
  dateToDay,
  dayToDate,
  daysInMonth,
  parseISO,
  startOfMonth,
  toISO,
} from './dates'

export interface LaidTask {
  task: Task
  categoryId: string
  x: number
  y: number
  w: number
  h: number
  cx: number // centre (milestone / link anchor)
  cy: number
  startX: number
  endX: number
  subRow: number
  isMilestone: boolean
  critical: boolean
}

/** A named 세부공종 (sub-work) block within a lane, used for the left labels. */
export interface LaidSubGroup {
  name: string
  y: number
  height: number
  rows: number
}

export interface LaidCategory {
  id: string
  name: string
  color: string
  y: number
  height: number
  subRows: number
  collapsed: boolean
  /** Labelled sub-work blocks (empty when no task carries a subName). */
  subGroups: LaidSubGroup[]
}

export interface MonthTick {
  x: number
  width: number
  label: string
  monthIndex0: number
  year: number
  isYearStart: boolean
}

export interface YearTick {
  x: number
  width: number
  year: number
}

export interface RainyRect {
  x: number
  width: number
  label: string
  y: number
  height: number
  seasonId: string
  /** Left/right edge x (= true band start/end clipped to the domain). */
  startX: number
  endX: number
  /** Whether each edge is the real (draggable) band start/end and in-domain. */
  showStart: boolean
  showEnd: boolean
}

export interface LogoRect {
  src: string
  index: number
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutModel {
  contentWidth: number
  contentHeight: number
  labelWidth: number
  headerHeight: number
  /** Y of the year/month header band (below the optional title band). */
  headerTop: number
  /** Height of the bold drawing-title band at the very top (0 when hidden). */
  titleHeight: number
  /** Drawing title text (project name); empty when hidden. */
  title: string
  /** Height of the bottom band hosting CI logos (0 when none). */
  footerHeight: number
  chartTop: number
  chartHeight: number
  pxPerDay: number
  rowHeight: number
  barHeight: number
  domainStartDay: number
  domainEndDay: number
  xOf: (day: number) => number
  dayOf: (x: number) => number
  tasks: LaidTask[]
  categories: LaidCategory[]
  months: MonthTick[]
  years: YearTick[]
  rainyRects: RainyRect[]
  logos: LogoRect[]
}

const TITLE_BAND = 44
const FOOTER_BAND = 92

/** Vertical band reserved at the top of a lane for the 공종 name when the lane
 *  also carries named 세부공종 sub-labels (keeps the two from overlapping). */
const CATEGORY_HEADER_INSET = 20

/** Transient subset filter applied on top of per-item visibility. */
export interface LayoutFilter {
  critical: boolean
  milestone: boolean
  query: string
}

function matchesFilter(t: Task, f?: LayoutFilter): boolean {
  if (!f) return true
  if (f.critical && !t.critical) return false
  if (f.milestone && !t.isMilestone) return false
  const q = f.query.trim().toLowerCase()
  if (q && !t.name.toLowerCase().includes(q)) return false
  return true
}

export function computeLayout(project: Project, filter?: LayoutFilter): LayoutModel {
  const { view } = project
  const pxPerDay = view.pxPerDay
  const rowHeight = view.rowHeight
  const barHeight = Math.min(rowHeight * 0.34, 16)
  const labelWidth = view.labelWidth
  const headerHeight = view.headerHeight

  const title = view.showTitle !== false && project.name ? project.name : ''
  const titleHeight = title ? TITLE_BAND : 0
  const logoItems = project.branding?.logos ?? []
  const maxLogoH = logoItems.reduce((m, l) => Math.max(m, l.h), 0)
  const footerHeight = logoItems.length ? Math.max(FOOTER_BAND, maxLogoH + 28) : 0

  const filterOn = !!filter && (filter.critical || filter.milestone || filter.query.trim() !== '')
  const baseCats = project.categories
    .filter((c) => (project.commissioningEnabled || !c.isCommissioning) && !c.hidden)
    .sort((a, b) => a.order - b.order)
  const baseCatIds = new Set(baseCats.map((c) => c.id))
  const tasks = project.tasks.filter((t) => baseCatIds.has(t.categoryId) && !t.hidden && matchesFilter(t, filter))
  // When a filter is active, drop lanes that have no matching activities.
  const catsWithTasks = new Set(tasks.map((t) => t.categoryId))
  const categories = filterOn ? baseCats.filter((c) => catsWithTasks.has(c.id)) : baseCats

  // ── Time domain: pad to whole months for a tidy axis ──
  const minTaskDay = tasks.reduce((m, t) => Math.min(m, t.start), 0)
  const maxTaskDay = tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 30)
  const startDate = startOfMonth(dayToDate(project.startDate, minTaskDay))
  const endDate = addMonths(startOfMonth(dayToDate(project.startDate, maxTaskDay)), 2)
  const domainStartDay = dateToDay(project.startDate, startDate)
  const domainEndDay = dateToDay(project.startDate, endDate)

  const xOf = (day: number) => labelWidth + (day - domainStartDay) * pxPerDay
  const dayOf = (x: number) => (x - labelWidth) / pxPerDay + domainStartDay

  // ── Lanes & sub-row stacking ──
  const laidCategories: LaidCategory[] = []
  const laidTasks: LaidTask[] = []
  const headerTop = titleHeight
  let cursorY = titleHeight + headerHeight
  for (const cat of categories) {
    const catTasks = tasks.filter((t) => t.categoryId === cat.id)
    // The sidebar tree's collapse toggle is sidebar-only; the chart always lays
    // a lane out in full (visibility is controlled by `hidden`, not `collapsed`).
    const laneY = cursorY

    // One row per 공정 in the user's manual order (= array order within the
    // lane). The sidebar lists tasks in this same order, so the two views stay
    // in lock-step and the user can drag an activity to any exact row instead of
    // the engine auto-packing non-overlapping bars onto a shared row.
    const hasNamed = catTasks.some((t) => (t.subName ?? '').trim() !== '')
    const headerInset = hasNamed ? CATEGORY_HEADER_INSET : 0

    catTasks.forEach((t, row) => {
      const rowMidY = laneY + headerInset + row * rowHeight + rowHeight / 2
      const startX = xOf(t.start)
      const endX = xOf(t.start + t.duration)
      laidTasks.push({
        task: t,
        categoryId: cat.id,
        x: startX,
        y: rowMidY - barHeight / 2,
        w: Math.max(3, endX - startX),
        h: barHeight,
        cx: startX,
        cy: rowMidY,
        startX,
        endX: t.isMilestone ? startX : endX,
        subRow: row,
        isMilestone: t.isMilestone,
        critical: !!t.critical,
      })
    })

    // 세부공종 labels span each maximal run of consecutive same-subName rows
    // (manual ordering means a group is whatever the user keeps adjacent).
    const subGroups: LaidSubGroup[] = []
    for (let i = 0; i < catTasks.length;) {
      const name = (catTasks[i].subName ?? '').trim()
      let j = i + 1
      while (j < catTasks.length && (catTasks[j].subName ?? '').trim() === name) j++
      if (name !== '') {
        subGroups.push({ name, y: laneY + headerInset + i * rowHeight, height: (j - i) * rowHeight, rows: j - i })
      }
      i = j
    }

    const subRows = Math.max(1, catTasks.length)
    const laneHeight = headerInset + subRows * rowHeight
    laidCategories.push({
      id: cat.id, name: cat.name, color: cat.color,
      y: laneY, height: laneHeight, subRows, collapsed: false, subGroups,
    })
    cursorY += laneHeight
  }

  const chartTop = titleHeight + headerHeight
  const chartHeight = cursorY - chartTop
  const footerTop = cursorY
  const contentHeight = cursorY + footerHeight
  const contentWidth = xOf(domainEndDay)

  // ── CI logos in the bottom-right footer band (rightmost = index 0),
  //    stacked leftward by their individual widths ──
  let rightX = contentWidth - 18
  const logos: LogoRect[] = logoItems.map((lg, i) => {
    const x = rightX - lg.w
    const rect: LogoRect = { src: lg.src, index: i, x, y: footerTop + (footerHeight - lg.h) / 2, w: lg.w, h: lg.h }
    rightX = x - 14
    return rect
  })

  // ── Timeline header: months + years ──
  const months: MonthTick[] = []
  const years: YearTick[] = []
  let d = parseISO(toISO(startDate))
  let yearStartX = xOf(domainStartDay)
  let yearAcc = 0
  let curYear = d.getFullYear()
  while (d < endDate) {
    const next = addMonths(d, 1)
    const mStartDay = dateToDay(project.startDate, d)
    const mEndDay = dateToDay(project.startDate, next)
    const x = xOf(mStartDay)
    const width = (mEndDay - mStartDay) * pxPerDay
    const isYearStart = d.getMonth() === 0 || months.length === 0
    months.push({
      x, width,
      label: MONTH_LABELS_KO[d.getMonth()],
      monthIndex0: d.getMonth(),
      year: d.getFullYear(),
      isYearStart,
    })
    if (d.getFullYear() !== curYear) {
      years.push({ x: yearStartX, width: yearAcc, year: curYear })
      curYear = d.getFullYear()
      yearStartX = x
      yearAcc = width
    } else {
      yearAcc += width
    }
    d = next
  }
  years.push({ x: yearStartX, width: yearAcc, year: curYear })

  // ── 우기 (rainy-season) bands — day-precise window repeated per year ──
  // Non-wrapping window (startMonth, startDay)..(endMonth, endDay), INCLUSIVE.
  // The shared (month, day) is reused for every year so editing one edge moves
  // all years identically. The end day is inclusive (+1) so a one-day window
  // still shades a day and whole-month ranges match the original look.
  const rainyRects: RainyRect[] = []
  for (const band of project.rainySeasons) {
    const sM = band.startMonth, eM = band.endMonth
    const sD = Math.min(band.startDay ?? 1, daysInMonth(2001, sM - 1))
    const eD = Math.min(band.endDay ?? daysInMonth(2001, eM - 1), daysInMonth(2001, eM - 1))
    const firstYear = startDate.getFullYear() - 1
    const lastYear = endDate.getFullYear() + 1
    for (let yr = firstYear; yr <= lastYear; yr++) {
      const sDay = dateToDay(project.startDate, new Date(yr, sM - 1, sD))
      const eDay = dateToDay(project.startDate, new Date(yr, eM - 1, eD)) + 1 // inclusive end
      if (eDay <= sDay) continue // inverted/degenerate window → skip
      const a = Math.max(sDay, domainStartDay)
      const b = Math.min(eDay, domainEndDay)
      if (b <= a) continue
      rainyRects.push({
        x: xOf(a),
        width: (b - a) * pxPerDay,
        label: band.label,
        y: chartTop,
        height: chartHeight,
        seasonId: band.id,
        startX: xOf(a),
        endX: xOf(b),
        showStart: sDay >= domainStartDay,
        showEnd: eDay <= domainEndDay,
      })
    }
  }

  return {
    contentWidth,
    contentHeight,
    labelWidth,
    headerHeight,
    headerTop,
    titleHeight,
    title,
    footerHeight,
    chartTop,
    chartHeight,
    pxPerDay,
    rowHeight,
    barHeight,
    domainStartDay,
    domainEndDay,
    xOf,
    dayOf,
    tasks: laidTasks,
    categories: laidCategories,
    months,
    years,
    rainyRects,
    logos,
  }
}

/** Lookup helper for the renderer / link routing. */
export function laidTaskMap(model: LayoutModel): Map<string, LaidTask> {
  return new Map(model.tasks.map((lt) => [lt.task.id, lt]))
}

export function categoryOf(categories: Category[], id: string): Category | undefined {
  return categories.find((c) => c.id === id)
}

/**
 * Solve the view density so the chart's aspect ratio matches a paper sheet
 * (w×h in mm) — eliminating the export letterbox margin without distortion.
 *
 * The export rasterizer scales content into the page preserving aspect ratio, so
 * the margin is zero exactly when contentWidth/contentHeight === paperW/paperH.
 * The two axes are independent layout knobs (pxPerDay = time density, rowHeight =
 * row density), so we only ever STRETCH the deficient axis UP — never compress —
 * which keeps text and bars readable (the time axis carries no inherent aspect,
 * and rows just get taller). Both inversions are exact because content size is
 * affine in each knob. Returns the view param(s) to apply ({} when already fit).
 */
export function fitToPaperView(
  project: Project,
  paperWmm: number,
  paperHmm: number,
): { pxPerDay?: number; rowHeight?: number } {
  const m = computeLayout(project)
  const target = paperWmm / paperHmm
  const current = m.contentWidth / m.contentHeight
  if (!Number.isFinite(target) || !Number.isFinite(current) || Math.abs(current - target) < 1e-3) return {}
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  if (current < target) {
    // Too narrow for the sheet → widen the time axis: contentWidth = target × H.
    const domainDays = Math.max(1, m.domainEndDay - m.domainStartDay)
    const targetW = target * m.contentHeight
    return { pxPerDay: clamp((targetW - m.labelWidth) / domainDays, 0.1, 80) }
  }
  // Too short for the sheet → taller rows: contentHeight = contentWidth / target.
  const totalRows = Math.max(1, m.categories.reduce((s, c) => s + c.subRows, 0))
  const fixedV = m.contentHeight - totalRows * m.rowHeight // title+header+footer+insets
  const targetH = m.contentWidth / target
  return { rowHeight: clamp((targetH - fixedV) / totalRows, 16, 400) }
}
