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

/**
 * 저배율 화면 보정(글자를 minPx/zoom 으로 키움)의 역할별 상한 — "그 글자가 놓인 칸에 들어가는
 * 만큼만" 키운다. 상한이 없으면 칸(월 폭·헤더 높이·왼쪽 열 폭)은 그대로인데 글자만 커져서
 * 월 숫자·연도가 서로 겹치고 왼쪽 공종명이 열 경계에서 잘린다.
 * `base(role)` 는 도면 기준 글자 크기. 반환값이 base 보다 작아도 렌더는 base 아래로 내리지 않는다.
 */
export function screenTextCaps(
  m: {
    contentWidth: number
    labelWidth: number
    headerHeight: number
    titleHeight: number
    title: string
    pxPerDay: number
    months: { x: number; label: string }[]
    categories: { name: string; subGroups: { name: string }[] }[]
    tasks: { isMilestone: boolean; task: { name: string; parentId?: string; subName?: string } }[]
  },
  base: (role: 'categoryLabel' | 'subCategoryLabel' | 'taskLabel') => number,
  taskCol: boolean,
): {
  title: number
  axisYear: number
  axisMonth: number
  headerTitle: number
  headerSub: number
  categoryLabel: number
  subCategoryLabel: number
  taskLabel: number
} {
  const unit = (text: string) => estimateLabelWidth(text, 1) // 글자 크기 1 당 폭
  const yearRowH = m.headerHeight * 0.46
  const labeled = m.months.filter((mo) => mo.label)
  let monthGap = Number.POSITIVE_INFINITY
  for (let i = 1; i < labeled.length; i++) monthGap = Math.min(monthGap, labeled[i].x - labeled[i - 1].x)

  // 왼쪽 열: 모든 라벨이 열 안에 들어가는 공통 확대율(가장 긴 라벨이 정한다).
  const room = (x: number) => m.labelWidth - 4 - x
  let ratio = Number.POSITIVE_INFINITY
  const fit = (text: string, x: number, size: number) => {
    const w = estimateLabelWidth(text, size)
    if (w > 0) ratio = Math.min(ratio, room(x) / w)
  }
  const cat = base('categoryLabel')
  const sub = base('subCategoryLabel')
  const task = base('taskLabel')
  for (const c of m.categories) {
    fit(c.name, 18, cat)
    for (const sg of c.subGroups) fit(sg.name, 26, sub)
  }
  if (taskCol)
    for (const lt of m.tasks)
      if (!lt.isMilestone && !lt.task.parentId)
        fit(lt.task.name.replace(/^◆\s*/, ''), (lt.task.subName ?? '').trim() ? 40 : 30, task)
  if (!Number.isFinite(ratio)) ratio = 1
  ratio = Math.max(1, ratio)

  return {
    title: Math.min(m.titleHeight / 1.5, (m.contentWidth - 24) / (unit(m.title || ' ') * 1.05)),
    axisYear: Math.min(yearRowH / 1.5, (365 * m.pxPerDay * 0.9) / unit('2030')),
    axisMonth: Math.min((m.headerHeight - yearRowH) / 1.5, (monthGap - 4) / unit('12')),
    headerTitle: room(12) / unit('공종 / 마일스톤'),
    headerSub: room(12) / unit('착수 0000-00'),
    // 공종명은 레인 상단 인셋(layout.ts: max(20, 1.4×글자)) 안에 들어가야 한다.
    categoryLabel: Math.min(cat * ratio, Math.max(20, cat * 1.4) / 1.4),
    subCategoryLabel: sub * ratio,
    taskLabel: task * ratio,
  }
}
