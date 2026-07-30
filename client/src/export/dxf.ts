// ─────────────────────────────────────────────────────────────────────────────
// DXF (AutoCAD Drawing Exchange Format) exporter — turns the milestone chart
// into real CAD entities so it can be opened/edited in AutoCAD etc.
//
// Targets R12 (AC1009): the most widely-openable form (no handles / objects /
// blocks needed — only HEADER + TABLES + ENTITIES). Because R12 predates HATCH
// and LWPOLYLINE, fills use the SOLID entity and outlines use POLYLINE.
//   • 공사기간 막대 → SOLID(filled) + POLYLINE outline
//   • 마일스톤(◆)   → closed POLYLINE diamond (+ SOLID fill when critical)
//   • 의존성 화살표 → POLYLINE elbow + SOLID arrowhead
//   • 격자/축       → LINE
//   • 텍스트        → TEXT (UTF-8; renders Korean if the CAD has a Unicode font)
//   • 우기 밴드     → SOLID (light grey)
// DXF is Y-up, so every Y is flipped (dxfY = contentHeight - svgY).
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from '../types/model'
import { computeLayout, type LayoutModel, type LaidTask } from '../engine/layout'
import { routeLinks } from '../engine/routing'
import { resolveTextStyle } from '../styles/theme'
import { dayToDate, toISO } from '../engine/dates'

// ── ACI (AutoCAD Color Index) candidates for nearest-colour matching ──
// Includes muted mid-tones per hue family so the (desaturated) lane colours map
// to DISTINCT, hue-appropriate indices instead of all collapsing to grey. Index
// numbers sit in the right hue band; AutoCAD shows that index's actual colour.
const ACI: Array<[number, number, number, number]> = [
  [1, 255, 0, 0],
  [2, 255, 255, 0],
  [3, 0, 255, 0],
  [4, 0, 255, 255],
  [5, 0, 0, 255],
  [6, 255, 0, 255],
  [7, 0, 0, 0],
  // bright saturated hue ramp
  [30, 255, 128, 0],
  [40, 255, 191, 0],
  [70, 128, 255, 0],
  [110, 0, 255, 128],
  [150, 0, 128, 255],
  [190, 128, 0, 255],
  [230, 255, 0, 128],
  // muted mid-tones (route desaturated colours to the right hue family)
  [12, 178, 100, 100],
  [32, 190, 130, 80],
  [42, 168, 140, 92],
  [92, 110, 150, 100],
  [132, 92, 150, 150],
  [152, 96, 120, 165],
  [172, 104, 116, 160],
  [202, 140, 108, 162],
  [232, 168, 96, 130],
  // greys
  [8, 65, 65, 65],
  [9, 128, 128, 128],
  [250, 84, 84, 84],
  [252, 140, 140, 140],
  [254, 200, 200, 200],
]

/** Encode a label for DXF group 1: non-ASCII (e.g. Korean) becomes \U+XXXX so it
 *  renders regardless of the file's code page / DXF version (AutoCAD converts it). */
function dxfText(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    out += cp < 128 ? ch : '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Nearest AutoCAD Color Index for an arbitrary hex colour. */
function aci(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  let best = 7
  let bestD = Infinity
  for (const [idx, ar, ag, ab] of ACI) {
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2
    if (d < bestD) {
      bestD = d
      best = idx
    }
  }
  return best
}

// Colours are chosen to be visible on BOTH AutoCAD's default black model space
// and a white background (7 = white-on-dark / black-on-light; 9 = mid grey).
const LAYERS: Array<[string, number]> = [
  ['0', 7],
  ['HN_RAINY', 9],
  ['HN_GRID', 9],
  ['HN_AXIS', 7],
  ['HN_HEADER', 7],
  ['HN_CATEGORY', 7],
  ['HN_SUBCAT', 7],
  ['HN_BAR', 5],
  ['HN_BAR_CRIT', 1],
  ['HN_TASKNAME', 7],
  ['HN_DURATION', 7],
  ['HN_MILESTONE', 7],
  ['HN_MS_CRIT', 1],
  ['HN_MS_DATE', 7],
  ['HN_ARROW', 9],
  ['HN_ARROW_CRIT', 1],
  ['HN_TITLE', 7],
]

export function projectToDxf(project: Project): string {
  const model: LayoutModel = computeLayout(project)
  const routed = routeLinks(model, project.links)
  const H = model.contentHeight
  const fy = (y: number) => H - y // flip to Y-up
  const ts = (role: Parameters<typeof resolveTextStyle>[0]) =>
    resolveTextStyle(role, project.view.textStyles, project.view.fontScale ?? 1)

  const b: (string | number)[] = []
  const g = (code: number, val: string | number) => {
    b.push(code, val)
  }
  const num = (x: number) => (Number.isFinite(x) ? x : 0).toFixed(3)

  // ── primitives ──
  function line(layer: string, x1: number, y1: number, x2: number, y2: number, color?: number) {
    if (x1 === x2 && y1 === y2) return
    g(0, 'LINE')
    g(8, layer)
    if (color != null) g(62, color)
    g(10, num(x1))
    g(20, num(fy(y1)))
    g(30, '0.0')
    g(11, num(x2))
    g(21, num(fy(y2)))
    g(31, '0.0')
  }
  /** Filled quad — vertices in DXF Z-order (3rd & 4th swapped vs a perimeter walk). */
  function solidQuad(layer: string, pts: Array<[number, number]>, color?: number) {
    const [p0, p1, p2, p3] = pts
    g(0, 'SOLID')
    g(8, layer)
    if (color != null) g(62, color)
    g(10, num(p0[0]))
    g(20, num(fy(p0[1])))
    g(30, '0.0')
    g(11, num(p1[0]))
    g(21, num(fy(p1[1])))
    g(31, '0.0')
    g(12, num(p3[0]))
    g(22, num(fy(p3[1])))
    g(32, '0.0') // 3rd code = 4th point
    g(13, num(p2[0]))
    g(23, num(fy(p2[1])))
    g(33, '0.0') // 4th code = 3rd point
  }
  function solidRect(layer: string, x: number, y: number, w: number, h: number, color?: number) {
    // pts: BL, BR, TR, TL (perimeter); solidQuad re-orders to Z-order internally
    solidQuad(
      layer,
      [
        [x, y + h],
        [x + w, y + h],
        [x + w, y],
        [x, y],
      ],
      color,
    )
  }
  /** Closed/open old-style POLYLINE (R12-safe). Drops consecutive duplicate
   *  vertices (and a redundant closing one) to avoid zero-length segments. */
  function polyline(layer: string, pts: Array<[number, number]>, closed: boolean, color?: number) {
    const v: Array<[number, number]> = []
    for (const p of pts) {
      const last = v[v.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) v.push(p)
    }
    if (closed && v.length > 1) {
      const f = v[0],
        l = v[v.length - 1]
      if (f[0] === l[0] && f[1] === l[1]) v.pop()
    }
    if (v.length < 2) return
    g(0, 'POLYLINE')
    g(8, layer)
    if (color != null) g(62, color)
    g(66, 1)
    g(70, closed ? 1 : 0)
    g(10, '0.0')
    g(20, '0.0')
    g(30, '0.0')
    for (const [px, py] of v) {
      g(0, 'VERTEX')
      g(8, layer)
      g(10, num(px))
      g(20, num(fy(py)))
      g(30, '0.0')
    }
    g(0, 'SEQEND')
    g(8, layer)
  }
  /** TEXT — emits LEFT-anchored (group 10/20, 72=0) for BOTH modes. For 'center'
   *  the left edge is computed from an estimated string width, because many CAD
   *  readers don't honour the 72/11-21 indirect-anchor rule (centred text then
   *  piles up at the origin). Left-anchored 10/20 placement is universal. */
  function text(
    layer: string,
    x: number,
    y: number,
    str: string,
    heightPx: number,
    anchor: 'left' | 'center',
    color?: number,
  ) {
    const s = (str ?? '').replace(/[\r\n]+/g, ' ').trim()
    if (!s) return
    if (anchor !== 'center') {
      textLeft(layer, x, y, s, heightPx, color)
      return
    }
    const h = heightPx * 0.72
    let w = 0
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0
      w += ch === ' ' ? h * 0.4 : cp > 0x2e80 ? h : h * 0.55 // CJK ≈ 1em, Latin ≈ 0.55em
    }
    textLeft(layer, x - w / 2, y, s, heightPx, color)
  }
  // Left/baseline text — insertion point in 10/20 (universally honoured).
  function textLeft(
    layer: string,
    x: number,
    y: number,
    str: string,
    heightPx: number,
    color?: number,
  ) {
    const s = (str ?? '').replace(/[\r\n]+/g, ' ').trim()
    if (!s) return
    const h = Math.max(1, heightPx * 0.72)
    g(0, 'TEXT')
    g(8, layer)
    if (color != null) g(62, color)
    g(10, num(x))
    g(20, num(fy(y)))
    g(30, '0.0')
    g(40, num(h))
    g(1, dxfText(s))
    g(50, '0.0')
    g(72, 0)
  }

  // ── 우기 bands (drawn first, behind everything) ──
  for (const r of model.rainyRects) {
    solidRect('HN_RAINY', r.x, r.y, r.width, r.height, 254)
  }

  // ── grid: month verticals, year verticals, lane separators ──
  const chartBottom = model.chartTop + model.chartHeight
  for (const m of model.months) line('HN_GRID', m.x, model.chartTop, m.x, chartBottom, 9)
  // 연도 구분선은 월 격자(ACI 9, 연회색)보다 진한 회색(ACI 8)으로 — 화면과 동일하게 연 구획 강조.
  // R12는 선 두께가 없어 화면의 두께 조절은 미반영, 표시 ON/OFF만 반영한다.
  if (project.view.showYearLine !== false)
    for (const y of model.years) line('HN_GRID', y.x, model.headerTop, y.x, chartBottom, 8)
  for (const c of model.categories) {
    line('HN_GRID', model.labelWidth, c.y + c.height, model.contentWidth, c.y + c.height, 9)
  }
  // label column right border + header/title dividers + header month-row ticks +
  // outer drawing frame — all mirrored from the on-screen separators.
  line('HN_AXIS', model.labelWidth, model.titleHeight, model.labelWidth, model.contentHeight, 7)
  const yearRowDxf = model.headerHeight * 0.46
  if (model.titleHeight > 0)
    line('HN_AXIS', 0, model.titleHeight, model.contentWidth, model.titleHeight, 7) // 제목↔헤더
  line(
    'HN_AXIS',
    model.labelWidth,
    model.headerTop + yearRowDxf,
    model.contentWidth,
    model.headerTop + yearRowDxf,
    7,
  ) // 연도↔월
  line('HN_AXIS', model.labelWidth, model.chartTop, model.contentWidth, model.chartTop, 7) // 헤더↔차트
  for (const m of model.months)
    line('HN_GRID', m.x, model.headerTop + yearRowDxf, m.x, model.chartTop, 9) // 월 눈금
  polyline(
    'HN_AXIS',
    [
      [0, 0],
      [model.contentWidth, 0],
      [model.contentWidth, model.contentHeight],
      [0, model.contentHeight],
    ],
    true,
    7,
  ) // 테두리

  // ── timeline axis text (years / months) ──
  {
    const yr = ts('axisYear'),
      mo = ts('axisMonth')
    const headerH = model.headerHeight,
      top = model.headerTop
    const yearRowH = headerH * 0.46
    for (const y of model.years) {
      text(
        'HN_AXIS',
        y.x + y.width / 2,
        top + yearRowH * 0.66,
        String(y.year),
        yr.fontSize,
        'center',
        7,
      )
    }
    for (const m of model.months) {
      text(
        'HN_AXIS',
        m.x + m.width / 2,
        top + yearRowH + (headerH - yearRowH) * 0.62,
        m.label,
        mo.fontSize,
        'center',
        7,
      )
    }
  }

  // ── left header labels ──
  {
    const ht = ts('headerTitle'),
      hs = ts('headerSub')
    const top = model.headerTop,
      headerH = model.headerHeight
    textLeft('HN_HEADER', 12, top + headerH * 0.4, '공종 / 마일스톤', ht.fontSize, 7)
    textLeft(
      'HN_HEADER',
      12,
      top + headerH * 0.82,
      `착수 ${toISO(dayToDate(project.startDate, 0)).slice(0, 7)}`,
      hs.fontSize,
      7,
    )
  }

  // ── category + sub-category labels ──
  {
    const cat = ts('categoryLabel'),
      sub = ts('subCategoryLabel')
    for (const c of model.categories) {
      const hasSubs = c.subGroups.length > 0
      const nameY = hasSubs ? c.y + 15 : c.y + c.height / 2 + 4
      textLeft('HN_CATEGORY', 18, nameY, c.name, cat.fontSize, 7)
      if (hasSubs) {
        for (const sg of c.subGroups) {
          textLeft('HN_SUBCAT', 26, sg.y + sg.height / 2 + 4, sg.name, sub.fontSize, 7)
        }
      }
    }
  }

  // ── dependency arrows (under bars) ──
  {
    const show = project.view.showCriticalPath
    for (const r of routed) {
      const crit = show && r.critical
      const layer = crit ? 'HN_ARROW_CRIT' : 'HN_ARROW'
      const col = crit ? 1 : 9
      polyline(layer, r.points, false, col)
      // arrowhead — small filled triangle at the head, along arrowAngle
      const len = 9,
        half = 3.2
      const ax = r.arrowX,
        ay = r.arrowY,
        a = r.arrowAngle
      const bx = ax - len * Math.cos(a),
        by = ay - len * Math.sin(a)
      const nx = -Math.sin(a),
        ny = Math.cos(a)
      // SOLID triangle: 3 distinct points with the 4th duplicating the 3rd.
      solidQuad(
        layer,
        [
          [ax, ay],
          [bx + half * nx, by + half * ny],
          [bx - half * nx, by - half * ny],
          [bx - half * nx, by - half * ny],
        ],
        col,
      )
    }
  }

  // ── task bars + milestones ──
  {
    const show = project.view.showCriticalPath
    const tn = ts('taskName'),
      du = ts('taskDuration'),
      mn = ts('milestoneName'),
      md = ts('milestoneDate')
    const milestoneR = Math.min(model.rowHeight * 0.3, 11)
    const laneColor = (lt: LaidTask) =>
      lt.task.color ?? model.categories.find((c) => c.id === lt.categoryId)?.color ?? '#7c93a8'

    for (const lt of model.tasks) {
      const t = lt.task
      const crit = show && lt.critical
      if (lt.isMilestone) {
        const r = crit ? milestoneR * 1.45 : milestoneR
        const dia: Array<[number, number]> = [
          [lt.cx, lt.cy - r],
          [lt.cx + r, lt.cy],
          [lt.cx, lt.cy + r],
          [lt.cx - r, lt.cy],
        ]
        if (crit) solidQuad('HN_MS_CRIT', dia, 1)
        polyline(crit ? 'HN_MS_CRIT' : 'HN_MILESTONE', dia, true, crit ? 1 : 7)
        text(
          crit ? 'HN_MS_CRIT' : 'HN_MILESTONE',
          lt.cx,
          lt.cy - r - 4,
          t.name.replace(/^◆\s*/, ''),
          mn.fontSize,
          'center',
          crit ? 1 : 7,
        )
        text(
          'HN_MS_DATE',
          lt.cx,
          lt.cy + r + 12,
          toISO(dayToDate(project.startDate, t.start)).slice(2),
          md.fontSize,
          'center',
          7,
        )
      } else {
        const fill = crit ? '#E12D1B' : laneColor(lt)
        const layer = crit ? 'HN_BAR_CRIT' : 'HN_BAR'
        solidRect(layer, lt.x, lt.y, lt.w, lt.h, aci(fill))
        polyline(
          layer,
          [
            [lt.x, lt.y],
            [lt.x + lt.w, lt.y],
            [lt.x + lt.w, lt.y + lt.h],
            [lt.x, lt.y + lt.h],
          ],
          true,
          7,
        )
        textLeft('HN_TASKNAME', lt.x, lt.y - 3.5, t.name, tn.fontSize, crit ? 1 : 7)
        textLeft(
          'HN_DURATION',
          lt.x,
          lt.y + lt.h + du.fontSize * 0.85 + 3,
          `${t.duration}일`,
          du.fontSize,
          7,
        )
      }
    }
  }

  // ── drawing title ──
  if (model.titleHeight > 0 && model.title) {
    const ti = ts('title')
    text(
      'HN_TITLE',
      model.contentWidth / 2,
      model.titleHeight * 0.66,
      model.title,
      ti.fontSize,
      'center',
      7,
    )
  }

  // ── assemble: HEADER + TABLES(LAYER) + ENTITIES ──
  const head: (string | number)[] = []
  const hg = (code: number, val: string | number) => {
    head.push(code, val)
  }
  hg(0, 'SECTION')
  hg(2, 'HEADER')
  hg(9, '$ACADVER')
  hg(1, 'AC1009')
  hg(9, '$INSUNITS')
  hg(70, 0)
  hg(9, '$EXTMIN')
  hg(10, '0.0')
  hg(20, '0.0')
  hg(30, '0.0')
  hg(9, '$EXTMAX')
  hg(10, num(model.contentWidth))
  hg(20, num(model.contentHeight))
  hg(30, '0.0')
  hg(0, 'ENDSEC')

  hg(0, 'SECTION')
  hg(2, 'TABLES')
  // STYLE table — text will NOT render without a defined text style. STANDARD
  // uses a Korean-capable TrueType font so 한글 labels display (CAD substitutes
  // if absent). Non-ASCII is also \U+XXXX-escaped in the text strings.
  hg(0, 'TABLE')
  hg(2, 'STYLE')
  hg(70, 1)
  hg(0, 'STYLE')
  hg(2, 'STANDARD')
  hg(70, 0)
  hg(40, '0.0')
  hg(41, '1.0')
  hg(50, '0.0')
  hg(71, 0)
  hg(42, '2.5')
  hg(3, 'malgun.ttf')
  hg(4, '')
  hg(0, 'ENDTAB')
  hg(0, 'TABLE')
  hg(2, 'LAYER')
  hg(70, LAYERS.length)
  for (const [name, color] of LAYERS) {
    hg(0, 'LAYER')
    hg(2, name)
    hg(70, 0)
    hg(62, color)
    hg(6, 'CONTINUOUS')
  }
  hg(0, 'ENDTAB')
  hg(0, 'ENDSEC')

  hg(0, 'SECTION')
  hg(2, 'ENTITIES')

  const tail = [0, 'ENDSEC', 0, 'EOF']

  return [...head, ...b, ...tail].join('\n') + '\n'
}
