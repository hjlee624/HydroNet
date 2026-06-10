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
  monthInRange,
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

const LABEL_FONT_PX = 10.5

/** Rough text width estimate (CJK glyphs ~1.85× Latin). Avoids DOM measuring. */
function estimateTextWidth(text: string, fontPx = LABEL_FONT_PX): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1.0 : 0.56
  return units * fontPx
}

/** Greedy interval partition: assign each task the lowest non-overlapping row. */
function stackTasks(tasks: Task[], pxPerDay: number): Map<string, number> {
  const sorted = [...tasks].sort((a, b) => a.start - b.start || b.duration - a.duration)
  const rowEnds: number[] = [] // last occupied x (px) per sub-row
  const assignment = new Map<string, number>()
  const gap = 8
  for (const t of sorted) {
    const startPx = t.start * pxPerDay
    const barW = t.isMilestone ? 14 : Math.max(3, t.duration * pxPerDay)
    const labelW = estimateTextWidth(t.name)
    const endPx = startPx + Math.max(barW, labelW) + gap
    let placed = -1
    for (let r = 0; r < rowEnds.length; r++) {
      if (startPx >= rowEnds[r]) {
        placed = r
        break
      }
    }
    if (placed === -1) {
      placed = rowEnds.length
      rowEnds.push(endPx)
    } else {
      rowEnds[placed] = endPx
    }
    assignment.set(t.id, placed)
  }
  return assignment
}

export function computeLayout(project: Project): LayoutModel {
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

  const categories = project.categories
    .filter((c) => project.commissioningEnabled || !c.isCommissioning)
    .sort((a, b) => a.order - b.order)
  const visibleCatIds = new Set(categories.map((c) => c.id))
  const tasks = project.tasks.filter((t) => visibleCatIds.has(t.categoryId))

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
    if (cat.collapsed) {
      laidCategories.push({
        id: cat.id, name: cat.name, color: cat.color,
        y: cursorY, height: rowHeight, subRows: 0, collapsed: true, subGroups: [],
      })
      cursorY += rowHeight
      continue
    }
    const laneY = cursorY

    // Partition the lane's tasks into 세부공종 groups (tasks without a subName
    // share the unnamed '' group, rendered directly under the category). Named
    // groups are ordered by their earliest task so the timeline reads top-down.
    const groupMap = new Map<string, Task[]>()
    for (const t of catTasks) {
      const key = (t.subName ?? '').trim()
      const arr = groupMap.get(key)
      if (arr) arr.push(t)
      else groupMap.set(key, [t])
    }
    const orderedGroups = [...groupMap.entries()].sort((a, b) => {
      if (a[0] === '' && b[0] !== '') return -1
      if (b[0] === '' && a[0] !== '') return 1
      const aMin = Math.min(...a[1].map((t) => t.start))
      const bMin = Math.min(...b[1].map((t) => t.start))
      return aMin - bMin
    })

    // Reserve a header band for the 공종 name only when named sub-groups exist,
    // so the category name never overlaps the first 세부공종 label.
    const hasNamed = orderedGroups.some(([name]) => name !== '')
    const headerInset = hasNamed ? CATEGORY_HEADER_INSET : 0

    const subGroups: LaidSubGroup[] = []
    let rowCursor = 0 // rows consumed within this lane so far
    for (const [name, gtasks] of orderedGroups) {
      const assignment = stackTasks(gtasks, pxPerDay)
      const gRows = Math.max(1, Math.max(...gtasks.map((t) => assignment.get(t.id) ?? 0)) + 1)
      const groupRowStart = rowCursor
      for (const t of gtasks) {
        const sub = assignment.get(t.id) ?? 0
        const rowMidY = laneY + headerInset + (groupRowStart + sub) * rowHeight + rowHeight / 2
        const startX = xOf(t.start)
        const endX = xOf(t.start + t.duration)
        laidTasks.push({
          task: t,
          categoryId: cat.id,
          x: startX,
          y: rowMidY - barHeight / 2,
          w: Math.max(3, endX - startX),
          h: barHeight,
          cx: t.isMilestone ? startX : startX,
          cy: rowMidY,
          startX,
          endX: t.isMilestone ? startX : endX,
          subRow: groupRowStart + sub,
          isMilestone: t.isMilestone,
          critical: !!t.critical,
        })
      }
      if (name !== '') {
        subGroups.push({
          name,
          y: laneY + headerInset + groupRowStart * rowHeight,
          height: gRows * rowHeight,
          rows: gRows,
        })
      }
      rowCursor += gRows
    }

    const subRows = Math.max(1, rowCursor)
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

  // ── 우기 (rainy-season) bands, repeated per year ──
  const rainyRects: RainyRect[] = []
  for (const band of project.rainySeasons) {
    let m = startOfMonth(startDate)
    while (m < endDate) {
      if (monthInRange(m.getMonth(), band.startMonth, band.endMonth)) {
        const mStartDay = dateToDay(project.startDate, m)
        const mEndDay = dateToDay(project.startDate, addMonths(m, 1))
        const x = xOf(mStartDay)
        const width = (mEndDay - mStartDay) * pxPerDay
        // merge with previous contiguous month
        const prev = rainyRects[rainyRects.length - 1]
        if (prev && Math.abs(prev.x + prev.width - x) < 0.5 && prev.label === band.label) {
          prev.width += width
        } else {
          rainyRects.push({ x, width, label: band.label, y: chartTop, height: chartHeight })
        }
      }
      m = addMonths(m, 1)
    }
  }
  // refresh band heights to final chart height
  for (const r of rainyRects) { r.y = chartTop; r.height = chartHeight }

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
