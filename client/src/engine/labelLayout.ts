export interface LabelCandidate {
  id: string
  text: string
  anchorX: number
}

/** Approximate SVG text width before the browser has produced a measurable bbox. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56
  return Math.max(fontSize, units * fontSize)
}

/**
 * Spread labels on one task row while keeping their order and staying close to
 * their bars. When their combined width fits the chart, returned intervals never
 * overlap. The renderer uses the same routine for screen and export font sizes.
 */
export function arrangeLabelCenters(
  candidates: LabelCandidate[],
  fontSize: number,
  left: number,
  right: number,
): Map<string, number> {
  const result = new Map<string, number>()
  if (!candidates.length) return result
  const safeLeft = Math.min(left, right)
  const safeRight = Math.max(left, right)
  const gap = Math.max(4, fontSize * 0.35)
  const items = candidates
    .map((candidate) => ({
      ...candidate,
      width: estimateLabelWidth(candidate.text, fontSize),
    }))
    .sort((a, b) => a.anchorX - b.anchorX || a.id.localeCompare(b.id))

  let previousRight = safeLeft
  const centers: number[] = []
  for (const item of items) {
    const half = item.width / 2
    const center = Math.max(item.anchorX, previousRight + (centers.length ? gap : 0) + half)
    centers.push(center)
    previousRight = center + half
  }

  const overflow = previousRight - safeRight
  if (overflow > 0) {
    for (let i = 0; i < centers.length; i++) centers[i] -= overflow
  }

  // If shifting the row left crossed the chart edge and all labels can fit,
  // repack once from that edge. This preserves order and the requested gap.
  const firstLeft = centers[0] - items[0].width / 2
  const totalWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1)
  if (firstLeft < safeLeft && totalWidth <= safeRight - safeLeft) {
    let cursor = safeLeft
    for (let i = 0; i < items.length; i++) {
      centers[i] = cursor + items[i].width / 2
      cursor += items[i].width + gap
    }
  }

  for (let i = 0; i < items.length; i++) result.set(items[i].id, centers[i])
  return result
}
