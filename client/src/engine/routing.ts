// ─────────────────────────────────────────────────────────────────────────────
// Link routing — orthogonal "elbow" connectors between task bars.
//
// Produces an SVG path plus an arrowhead pose for each dependency link. Routes
// cleanly to the right when the successor is downstream, and wraps around (over
// or under) when it is not, so arrows avoid crossing back through their source.
// A small per-endpoint fan-out keeps parallel links from overlapping.
// ─────────────────────────────────────────────────────────────────────────────

import type { Link } from '../types/model'
import type { LaidTask, LayoutModel } from './layout'
import { laidTaskMap } from './layout'

export interface RoutedLink {
  id: string
  from: string
  to: string
  d: string
  arrowX: number
  arrowY: number
  arrowAngle: number // radians, direction of travel at the head
  critical: boolean
  type: Link['type']
}

const STUB = 12
const CORNER = 5

interface Anchor { x: number; y: number; dir: 1 | -1 } // dir: +1 exits/enters to the right

function sourceAnchor(lt: LaidTask, type: Link['type']): Anchor {
  const fromStart = type === 'SS' || type === 'SF'
  return { x: fromStart ? lt.startX : lt.endX, y: lt.cy, dir: fromStart ? -1 : 1 }
}
function targetAnchor(lt: LaidTask, type: Link['type']): Anchor {
  const toFinish = type === 'FF' || type === 'SF'
  // entering anchor faces inward: arrive from the left for a start-anchor (dir +1)
  return { x: toFinish ? lt.endX : lt.startX, y: lt.cy, dir: toFinish ? 1 : -1 }
}

/** Build an orthogonal path string with lightly rounded corners. */
function orthoPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return ''
  let d = `M ${round(pts[0][0])} ${round(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const inDx = Math.sign(cx - px)
    const inDy = Math.sign(cy - py)
    const outDx = Math.sign(nx - cx)
    const outDy = Math.sign(ny - cy)
    const r = CORNER
    const beforeX = cx - inDx * r
    const beforeY = cy - inDy * r
    const afterX = cx + outDx * r
    const afterY = cy + outDy * r
    d += ` L ${round(beforeX)} ${round(beforeY)} Q ${round(cx)} ${round(cy)} ${round(afterX)} ${round(afterY)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${round(last[0])} ${round(last[1])}`
  return d
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export function routeLinks(model: LayoutModel, links: Link[]): RoutedLink[] {
  const map = laidTaskMap(model)
  const routed: RoutedLink[] = []

  // Fan-out offsets so multiple links sharing a target don't stack exactly.
  const targetGroups = new Map<string, Link[]>()
  for (const l of links) {
    if (!targetGroups.has(l.to)) targetGroups.set(l.to, [])
    targetGroups.get(l.to)!.push(l)
  }

  for (const link of links) {
    const a = map.get(link.from)
    const b = map.get(link.to)
    if (!a || !b) continue

    const src = sourceAnchor(a, link.type)
    const dst = targetAnchor(b, link.type)

    const group = targetGroups.get(link.to)!
    const idx = group.indexOf(link)
    const spread = group.length > 1 ? (idx - (group.length - 1) / 2) * 6 : 0
    const dstY = dst.y + spread

    const sx = src.x + src.dir * STUB
    const dx = dst.x + dst.dir * STUB

    const pts: Array<[number, number]> = [[src.x, src.y], [sx, src.y]]

    if (src.dir === 1 && dst.dir === -1 && dx > sx) {
      // Standard downstream FS: route through a vertical mid-line.
      const midX = (sx + dx) / 2
      pts.push([midX, src.y], [midX, dstY], [dx, dstY])
    } else {
      // Wrap-around: drop to a channel between the two rows then approach.
      const channelY =
        a.cy === b.cy ? src.y - model.rowHeight * 0.55 : (src.y + dstY) / 2
      pts.push([sx, channelY], [dx, channelY], [dx, dstY])
    }
    pts.push([dst.x, dstY])

    const d = orthoPath(pts)
    const head = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const arrowAngle = Math.atan2(head[1] - prev[1], head[0] - prev[0])

    routed.push({
      id: link.id,
      from: link.from,
      to: link.to,
      d,
      arrowX: head[0],
      arrowY: head[1],
      arrowAngle,
      critical: !!(a.critical && b.critical),
      type: link.type,
    })
  }
  return routed
}
