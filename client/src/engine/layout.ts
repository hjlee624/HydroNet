// ─────────────────────────────────────────────────────────────────────────────
// Layout engine — turns the data model into absolute pixel geometry.
//
// Produces everything the SVG renderer needs: lane bands, stacked task bars /
// milestone diamonds, the year + month timeline header, and the 우기 bands.
// Pure & deterministic so on-screen and exported output are identical.
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, Project, Task, TextRole } from '../types/model'
import { resolveTextStyle } from '../styles/theme'
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

/** Rough label width (CJK glyph ≈ 1em, Latin ≈ 0.56em). Used to widen the left
 *  label column so labels never overrun into the chart as fonts grow. */
function estimateTextWidth(text: string, fontPx: number): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1.0 : 0.56
  return units * fontPx
}

/** Resolve a user-pinned 표시 기간(view.displayStart/End, ISO `YYYY-MM`)을 달력 도메인으로.
 *  둘 다 유효할 때만 활성 — 타임라인을 시작 월 ~ 종료 월(종료 월 포함)로 정확히 고정한다.
 *  None when either edge is missing/invalid (→ 자동: 데이터 범위). */
function resolveDisplayWindow(ds?: string, de?: string): { startDate: Date; endDate: Date } | null {
  if (!ds || !de) return null
  const startDate = startOfMonth(parseISO(ds))
  const endDate = addMonths(startOfMonth(parseISO(de)), 1) // end month inclusive
  return endDate > startDate ? { startDate, endDate } : null
}

export function computeLayout(project: Project, filter?: LayoutFilter): LayoutModel {
  const { view } = project
  const pxPerDay = view.pxPerDay
  // Bands & rows grow with the resolved text sizes, so enlarging a font expands
  // its box instead of clipping the glyph (default sizes keep current geometry).
  const fontScale = view.fontScale ?? 1
  const fs = (role: TextRole) => resolveTextStyle(role, view.textStyles, fontScale).fontSize
  const rowHeight = Math.max(
    view.rowHeight,
    Math.ceil(2 * Math.max(11.5 + 0.8 * fs('taskName'), 11 + 0.8 * fs('milestoneName'), 12 + fs('taskDuration'))),
  )
  const barHeight = Math.min(rowHeight * 0.34, 16)
  const headerHeight = Math.max(
    view.headerHeight,
    Math.ceil((fs('axisYear') + fs('axisMonth')) * 1.6),
    Math.ceil((fs('headerTitle') + fs('headerSub')) * 1.4),
  )

  // Drawing title = 사업명, plus the active 시트명 when the 사업 has more than one
  // 공정표(예정공정표 + 마일스톤) so each sheet reads as its own titled drawing.
  const sheetName = project.activeSheet?.name
  const multiSheet = (project.sheets?.length ?? 0) >= 1
  // Append the sheet name only when it isn't already the tail of 사업명 (avoids
  // "…예정공정표 · 예정공정표" when a preset name ends with the sheet name).
  const showSheet = multiSheet && sheetName && !project.name.endsWith(sheetName)
  const title = view.showTitle !== false && project.name
    ? (showSheet ? `${project.name} · ${sheetName}` : project.name)
    : ''
  const titleHeight = title ? Math.max(TITLE_BAND, Math.ceil(fs('title') * 1.5 + 12)) : 0
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

  // Left label column widens to fit the longest 공종/세부공종/헤더 label at the
  // current font sizes, so big text never overruns into the chart (and the
  // top-left "공종/마일스톤"·착수일 never bleed into the timeline). Defaults fit 150.
  const catFs = fs('categoryLabel'), subFs = fs('subCategoryLabel')
  let labelWidth = Math.max(
    view.labelWidth,
    12 + estimateTextWidth('공종 / 마일스톤', fs('headerTitle')) + 10,
    12 + estimateTextWidth('착수 0000-00', fs('headerSub')) + 10,
  )
  for (const c of categories) labelWidth = Math.max(labelWidth, 18 + estimateTextWidth(c.name, catFs) + 10)
  for (const t of tasks) {
    const sn = (t.subName ?? '').trim()
    if (sn) labelWidth = Math.max(labelWidth, 26 + estimateTextWidth(sn, subFs) + 10)
  }
  labelWidth = Math.ceil(labelWidth)

  // ── Time domain: pad to whole months for a tidy axis. 표시 기간(연/월 클릭 팝업)이
  //    설정되면 데이터 범위 대신 그 구간으로 도메인을 고정한다. ──
  const win = resolveDisplayWindow(view.displayStart, view.displayEnd)
  let startDate: Date, endDate: Date
  if (win) {
    startDate = win.startDate
    endDate = win.endDate
  } else {
    const minTaskDay = tasks.reduce((m, t) => Math.min(m, t.start), 0)
    const maxTaskDay = tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 30)
    startDate = startOfMonth(dayToDate(project.startDate, minTaskDay))
    endDate = addMonths(startOfMonth(dayToDate(project.startDate, maxTaskDay)), 2)
  }
  const domainStartDay = dateToDay(project.startDate, startDate)
  const domainEndDay = dateToDay(project.startDate, endDate)

  const xOf = (day: number) => labelWidth + (day - domainStartDay) * pxPerDay
  const dayOf = (x: number) => (x - labelWidth) / pxPerDay + domainStartDay

  // When a 표시 기간 is pinned: drop activities entirely outside it, and clamp those
  // straddling an edge to the window so no bar bleeds past the axis/label column.
  const domainTasks = win
    ? tasks.filter((t) => (t.isMilestone
        ? t.start >= domainStartDay && t.start <= domainEndDay
        : t.start <= domainEndDay && t.start + t.duration >= domainStartDay))
    : tasks
  const clampX = win
    ? (x: number) => Math.max(labelWidth, Math.min(xOf(domainEndDay), x))
    : (x: number) => x

  // ── Lanes & sub-row stacking ──
  const laidCategories: LaidCategory[] = []
  const laidTasks: LaidTask[] = []
  const headerTop = titleHeight
  let cursorY = titleHeight + headerHeight
  for (const cat of categories) {
    const catTasks = domainTasks.filter((t) => t.categoryId === cat.id)
    // The sidebar tree's collapse toggle is sidebar-only; the chart always lays
    // a lane out in full (visibility is controlled by `hidden`, not `collapsed`).
    const laneY = cursorY

    // Group tasks into visual rows. An explicit Task.row places a task on that
    // shared line (so a 패키지 like 상부댐 can run 굴착→축조→페이스슬라브→충수 as
    // adjacent bars on ONE row); a task without a row falls back to a running
    // index, so an untouched lane stays one-task-per-row exactly as before.
    // Distinct row values are collapsed to dense visual indices (gaps removed).
    let auto = 0
    const rawRowOf = new Map<string, number>()
    for (const t of catTasks) rawRowOf.set(t.id, typeof t.row === 'number' ? t.row : auto++)
    const distinctRows = [...new Set(catTasks.map((t) => rawRowOf.get(t.id)!))].sort((a, b) => a - b)
    const denseOf = new Map<number, number>()
    distinctRows.forEach((r, i) => denseOf.set(r, i))
    const visualRowCount = Math.max(1, distinctRows.length)

    const hasNamed = catTasks.some((t) => (t.subName ?? '').trim() !== '')
    const headerInset = hasNamed ? Math.max(CATEGORY_HEADER_INSET, Math.ceil(fs('categoryLabel') * 1.4)) : 0

    for (const t of catTasks) {
      const vrow = denseOf.get(rawRowOf.get(t.id)!) ?? 0
      const rowMidY = laneY + headerInset + vrow * rowHeight + rowHeight / 2
      const startX = clampX(xOf(t.start))
      const endX = clampX(xOf(t.start + t.duration))
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
        subRow: vrow,
        isMilestone: t.isMilestone,
        critical: !!t.critical,
      })
    }

    // 세부공종 labels: name each visual row by its first sub-named task, then merge
    // consecutive rows sharing a name (one-task-per-row lanes behave as before).
    const rowBuckets: string[] = distinctRows.map(() => '')
    for (const t of catTasks) {
      const vi = denseOf.get(rawRowOf.get(t.id)!)!
      const sn = (t.subName ?? '').trim()
      if (sn && !rowBuckets[vi]) rowBuckets[vi] = sn
    }
    const subGroups: LaidSubGroup[] = []
    for (let i = 0; i < rowBuckets.length;) {
      const name = rowBuckets[i]
      let j = i + 1
      while (j < rowBuckets.length && rowBuckets[j] === name) j++
      if (name !== '') {
        subGroups.push({ name, y: laneY + headerInset + i * rowHeight, height: (j - i) * rowHeight, rows: j - i })
      }
      i = j
    }

    const laneHeight = headerInset + visualRowCount * rowHeight
    laidCategories.push({
      id: cat.id, name: cat.name, color: cat.color,
      y: laneY, height: laneHeight, subRows: visualRowCount, collapsed: false, subGroups,
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
): { pxPerDay?: number; rowHeight?: number; fontScale?: number } {
  const target = paperWmm / paperHmm
  if (!Number.isFinite(target) || target <= 0) return {}
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const REF_PX = 10.5    // taskName default — the reference annotation
  const TARGET_MM = 3.5  // legible printed height for that reference

  // The legibility fontScale changes labelWidth / rowHeight-floor / band heights,
  // which feed back into the very content size we solve against — so a single pass
  // leaves a residual margin on non-landscape sheets. Iterate to a fixed point
  // (the coupling is weak & contractive, so a few passes converge). Each pass
  // exactly hits the aspect for the CURRENT geometry, then re-derives fontScale.
  let view = project.view
  for (let i = 0; i < 4; i++) {
    const m = computeLayout({ ...project, view })
    const current = m.contentWidth / m.contentHeight
    let { pxPerDay, rowHeight } = view
    let contentWidthAfter = m.contentWidth
    if (Number.isFinite(current) && Math.abs(current - target) >= 1e-3) {
      if (current < target) {
        // Too narrow → widen the time axis so contentWidth = target × H.
        const domainDays = Math.max(1, m.domainEndDay - m.domainStartDay)
        pxPerDay = clamp((target * m.contentHeight - m.labelWidth) / domainDays, 0.05, 400)
        contentWidthAfter = m.labelWidth + domainDays * pxPerDay
      } else {
        // Too short → taller rows so contentHeight = contentWidth / target.
        const totalRows = Math.max(1, m.categories.reduce((s, c) => s + c.subRows, 0))
        const fixedV = m.contentHeight - totalRows * m.rowHeight // title+header+footer+insets
        rowHeight = clamp((m.contentWidth / target - fixedV) / totalRows, 16, 2000)
      }
    }
    // Text legibility: size REF_PX to TARGET_MM on the sheet; only ever ENLARGE.
    const fontScale = clamp((TARGET_MM * (contentWidthAfter / paperWmm)) / REF_PX, 1, 6)
    view = { ...view, pxPerDay, rowHeight, fontScale }
  }

  // Net change vs the original view (so fitToPaper's no-op guard fires correctly).
  const out: { pxPerDay?: number; rowHeight?: number; fontScale?: number } = {}
  if (Math.abs(view.pxPerDay - project.view.pxPerDay) > 1e-3) out.pxPerDay = Number(view.pxPerDay.toFixed(4))
  if (Math.abs(view.rowHeight - project.view.rowHeight) > 1e-3) out.rowHeight = Math.round(view.rowHeight)
  if (Math.abs((view.fontScale ?? 1) - (project.view.fontScale ?? 1)) > 1e-3) out.fontScale = Number((view.fontScale ?? 1).toFixed(3))
  return out
}
