// Interaction layer over ChartSvg: drag-to-move bars, drag-to-link from the
// finish anchor, click selection, and zoom-aware layout. Pointer math maps
// client coordinates into chart-content space (the paper is rendered 1:1).
//
// Photoshop-style navigation tools (store.navMode): in 'zoom' the mouse wheel
// zooms centred on the cursor; in 'pan' a drag scrolls the view. Editing
// gestures (move/resize/link/select) only run in 'edit'. Esc returns to edit.

import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { standardDurationIndex } from '../data/facilities'
import { type AdequacyResult, assessTasks } from '../engine/adequacy'
import { dateToDay, daysInMonth, dayToDate, toISO } from '../engine/dates'
import {
  AUTO_FIT_LIMITS,
  computeLayout,
  type LayoutFilter,
  type LayoutModel,
  pxPerDayFromMonthWidth,
} from '../engine/layout'
import { augmentForMirror } from '../engine/mirror'
import { routeLinks } from '../engine/routing'
import { type EditImpact, editImpactUndoable, previewEdit } from '../engine/scheduling'
import { publishPresenceCursor, usePresence } from '../state/collaboration'
import { getCurrentCrdtRuntime } from '../state/crdt'
import { filterActive, useEditor } from '../state/store'
import type { Link, LinkType, Project, Task } from '../types/model'
import { ChartSvg, type LinkingGhost } from './ChartSvg'
import { EditImpactCard } from './EditImpactCard'
import { Modal } from './Modal'

/**
 * 현재 되돌리기 스택 깊이 — 영향 카드가 '스택 맨 위'를 계속 설명하는지 판정하는 근거.
 * CRDT 런타임이 아직 없으면(초기 부팅·테스트) 0.
 * 컴포넌트 밖에 두는 이유: 렌더마다 새 함수를 만들면 useEffect 의존성으로 끌려 들어간다.
 */
const undoDepth = (): number => getCurrentCrdtRuntime()?.undoManager.undoStack.length ?? 0

type Drag =
  | { kind: 'move'; taskId: string; grabOffsetDays: number; started: boolean }
  | {
      kind: 'moveGroup'
      base: Array<{ id: string; start: number }>
      grabDay: number
      started: boolean
    }
  | {
      kind: 'resize'
      taskId: string
      edge: 'start' | 'end'
      startDay: number
      endDay: number
      started: boolean
    }
  | { kind: 'logo'; index: number; rightEdge: number; ratio: number; started: boolean }
  | { kind: 'link'; fromId: string; fromEdge: 'start' | 'end' }
  | { kind: 'rainy'; seasonId: string; edge: 'start' | 'end'; started: boolean }
  | null

const MIN_ZOOM = 0.02

/** 현재 시트 전체가 캔버스 안에 들어오는 배율. 가로·세로 중 더 작은 비율을 사용한다. */
export function fitChartZoom(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
): number {
  const availableWidth = Math.max(1, viewportWidth - padding)
  const availableHeight = Math.max(1, viewportHeight - padding)
  const widthZoom = availableWidth / Math.max(1, contentWidth)
  const heightZoom = availableHeight / Math.max(1, contentHeight)
  return Math.min(6, Math.max(MIN_ZOOM, Math.min(widthZoom, heightZoom)))
}

/**
 * 전체 맞춤에서 비정상적으로 큰 자동 배치 값을 먼저 정상화하고, 짧은 축의 밀도를
 * 제한된 범위에서 늘려 캔버스 종횡비에 가깝게 만든다. 수동 설정은 유지되지만 사용자가
 * 전체 맞춤을 요청한 순간에는 한눈에 읽을 수 있는 편집 밀도가 우선한다.
 */
export function fitOverviewDensity(
  project: Project,
  viewportWidth: number,
  viewportHeight: number,
  filter?: LayoutFilter,
  padding = 48,
): { pxPerDay?: number; rowHeight?: number; fontScale?: number } {
  const availableWidth = Math.max(1, viewportWidth - padding)
  const availableHeight = Math.max(1, viewportHeight - padding)
  const targetAspect = availableWidth / availableHeight
  const minPxPerDay = pxPerDayFromMonthWidth(AUTO_FIT_LIMITS.minMonthWidth)
  const maxPxPerDay = pxPerDayFromMonthWidth(AUTO_FIT_LIMITS.maxMonthWidth)
  const normalize = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) && value >= min && value <= max ? value : fallback
  const normalizedView = {
    ...project.view,
    pxPerDay: normalize(
      project.view.pxPerDay,
      minPxPerDay,
      maxPxPerDay,
      pxPerDayFromMonthWidth(AUTO_FIT_LIMITS.defaultMonthWidth),
    ),
    rowHeight: normalize(
      project.view.rowHeight,
      AUTO_FIT_LIMITS.minRowHeight,
      AUTO_FIT_LIMITS.maxRowHeight,
      AUTO_FIT_LIMITS.defaultRowHeight,
    ),
    fontScale: normalize(
      project.view.fontScale ?? 1,
      AUTO_FIT_LIMITS.minFontScale,
      AUTO_FIT_LIMITS.maxFontScale,
      AUTO_FIT_LIMITS.defaultFontScale,
    ),
  }
  const model = computeLayout({ ...project, view: normalizedView }, filter)
  const currentAspect = model.contentWidth / Math.max(1, model.contentHeight)
  if (!Number.isFinite(currentAspect) || !Number.isFinite(targetAspect)) return {}

  const patch: { pxPerDay?: number; rowHeight?: number; fontScale?: number } = {}
  if (Math.abs(normalizedView.pxPerDay - project.view.pxPerDay) > 1e-3)
    patch.pxPerDay = Number(normalizedView.pxPerDay.toFixed(4))
  if (Math.abs(normalizedView.rowHeight - project.view.rowHeight) > 0.5)
    patch.rowHeight = Math.round(normalizedView.rowHeight)
  if (Math.abs(normalizedView.fontScale - (project.view.fontScale ?? 1)) > 1e-3)
    patch.fontScale = Number(normalizedView.fontScale.toFixed(3))

  if (currentAspect > targetAspect * 1.02) {
    const totalRows = Math.max(1, model.categories.reduce((sum, c) => sum + c.subRows, 0))
    const fixedHeight = model.contentHeight - totalRows * model.rowHeight
    const needed = (model.contentWidth / targetAspect - fixedHeight) / totalRows
    const rowHeight = Math.min(
      AUTO_FIT_LIMITS.maxRowHeight,
      Math.max(model.rowHeight, needed),
    )
    if (rowHeight > normalizedView.rowHeight + 0.5) patch.rowHeight = Math.ceil(rowHeight)
    return patch
  }

  if (currentAspect < targetAspect / 1.02) {
    const domainDays = Math.max(1, model.domainEndDay - model.domainStartDay)
    const needed = (targetAspect * model.contentHeight - model.labelWidth) / domainDays
    const pxPerDay = Math.min(maxPxPerDay, Math.max(model.pxPerDay, needed))
    if (pxPerDay > normalizedView.pxPerDay + 0.001)
      patch.pxPerDay = Number(pxPerDay.toFixed(4))
    return patch
  }

  return patch
}

export function ChartCanvas({
  fitRequest = 0,
  fitViewRequest = 0,
}: {
  fitRequest?: number
  fitViewRequest?: number
}) {
  const project = useEditor((s) => s.project)
  const zoom = useEditor((s) => s.zoom)
  const navMode = useEditor((s) => s.navMode)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedTaskIds = useEditor((s) => s.selectedTaskIds)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)
  const selectedTextRole = useEditor((s) => s.selectedTextRole)
  const linking = useEditor((s) => s.linking)
  const filter = useEditor((s) => s.filter)
  const colorMode = useEditor((s) => s.colorMode)
  // 편집 의미론 + 연쇄 자동 — 드래그 중 '변경 영향' 미리보기를 실제 커밋과 같은 조건으로 계산한다.
  const editMode = useEditor((s) => s.editMode)
  const autoCascade = useEditor((s) => s.autoCascade)
  const lastEditImpact = useEditor((s) => s.lastEditImpact)
  const focusTaskId = useEditor((s) => s.focusTaskId)
  const remotePresences = usePresence((s) => s.remote)

  const wrapRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const handledFitRequest = useRef(0)
  const handledFitViewRequest = useRef(0)
  const dragRef = useRef<Drag>(null)
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const zoomAnchor = useRef<{
    cX: number
    cY: number
    clientX: number
    clientY: number
    z: number
  } | null>(null)
  const renameDone = useRef(false)
  const durDone = useRef(false)
  // Edge auto-scroll while dragging a bar/link past the visible area, plus the last
  // pointer position (so the gesture re-applies as the view scrolls) and a guard so
  // the click that ends a drag doesn't collapse a multi-selection.
  const lastClient = useRef<{ x: number; y: number } | null>(null)
  const autoScrollRef = useRef<number | null>(null)
  const movedRef = useRef(false)
  const [ghost, setGhost] = useState<LinkingGhost | null>(null)
  const [panning, setPanning] = useState(false)
  // 표시 기간 설정 팝업(마일스톤 상단 연/월 클릭 — 요구사항 1).
  const [periodOpen, setPeriodOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  // 막대 아래 공기(기간) 텍스트 인라인 편집(이름 편집과 별개 입력).
  const [editingDur, setEditingDur] = useState<{ id: string; text: string } | null>(null)
  // Live "drop here" hint while dragging a bar vertically: a line for a new row
  // (above/below) or a highlighted band for merging onto an existing row.
  const [reorderHint, setReorderHint] = useState<{ lineY: number; merge: boolean } | null>(null)
  // Rubber-band (marquee) rectangle in content coords while drag-selecting bars.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  )
  const marqueeRef = useRef<{ x0: number; y0: number } | null>(null)
  // ── 변경 영향 미리보기(F09) ─────────────────────────────────────────────────
  // 드래그가 시작될 때의 원본(제스처 이전 상태)을 한 번만 스냅샷해 두고, 포인터가 '하루'를
  // 넘어갈 때만 previewEdit 를 돌린다(픽셀마다 CPM 을 돌리지 않기 위한 스로틀).
  const baseRef = useRef<{ tasks: Task[]; links: Link[] } | null>(null)
  const previewDayRef = useRef<number | null>(null)
  const [impact, setImpact] = useState<EditImpact | null>(null)
  // pointerup 핸들러는 pointerdown 시점의 클로저라 state 를 못 읽는다 — ref 로 같이 들고 간다.
  const impactRef = useRef<EditImpact | null>(null)

  useEffect(() => () => publishPresenceCursor(null), [])

  // Layout is computed at base scale; zoom is applied as a uniform CSS
  // transform on the paper so the WHOLE milestone (bars, text, arrows, header)
  // scales together — not just the horizontal axis.
  // 예정공정표↔마일스톤 연동(요구사항 4): 미러가 켜져 있으면 예정 시트의 공종/공정을 병합한
  // 새 project로 레이아웃·라우팅한다(표시 전용). 새 객체는 이 컴포넌트 본문에서만 만든다
  // (zustand 셀렉터로 반환하면 스냅샷 불안정 → 빈 화면).
  const augmented = useMemo(() => augmentForMirror(project), [project])
  const model = useMemo(() => computeLayout(augmented, filter), [augmented, filter])

  const routed = useMemo(() => routeLinks(model, augmented.links), [model, augmented.links])

  // 공정별 공기 적정성(검토서 B4) — 막대 호버 툴팁·부적정 경보의 데이터원. CPM 결과 기반(주공정 한정).
  // 허용 편차는 사용자가 산정 전제(periodInputs.tolerancePct)에 넣은 값을 그대로 쓴다.
  // 넘기지 않으면 엔진 기본값 15%로 판정해, 같은 공정이 화면에선 '적정' 검토요청서에선
  // '과다' 로 갈리는 모순이 생긴다.
  const adequacy = useMemo(
    () =>
      assessTasks(project.tasks, project.links, {
        standardDurationByName: standardDurationIndex(project.facility),
        tolerancePct: project.periodInputs?.tolerancePct,
      }),
    [project.tasks, project.links, project.facility, project.periodInputs?.tolerancePct],
  )
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const onTaskHover = useCallback((id: string | null, x: number, y: number) => {
    if (id == null) return setHover(null)
    if (dragRef.current) return // 드래그 중엔 툴팁 숨김(오조작 방지)
    setHover({ id, x, y })
  }, [])

  // "오늘" line position (content coords), or null when today is off-domain.
  const todayX = useMemo(() => {
    const x = model.xOf(dateToDay(project.startDate, new Date()))
    return x >= model.labelWidth && x <= model.contentWidth ? x : null
  }, [project.startDate, model])

  const editLt = editing ? model.tasks.find((t) => t.task.id === editing.id) : null
  const editDurLt = editingDur ? model.tasks.find((t) => t.task.id === editingDur.id) : null

  function toContent(clientX: number, clientY: number) {
    const rect = paperRef.current!.getBoundingClientRect()
    // rect reflects the scaled box; divide by zoom to get unscaled model coords.
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  // Map a content-Y (while dragging task `taskId`) to a row drop target. 일반 공정은
  // 공종 안에서 이동하고, 세부공정은 같은 parentId 블록의 행만 대상으로 삼는다.
  // `anchorId` references a concrete task so the target survives the include/exclude shift.
  function computeRowTarget(taskId: string, contentY: number) {
    const cats = model.categories
    if (!cats.length) return null
    const moving = model.tasks.find((lt) => lt.task.id === taskId)
    const parentId = moving?.task.parentId
    const parent = parentId ? model.tasks.find((lt) => lt.task.id === parentId) : undefined
    let cat = parent
      ? cats.find((c) => c.id === parent.categoryId)
      : cats.find((c) => contentY >= c.y && contentY < c.y + c.height)
    if (!cat) cat = contentY < cats[0].y ? cats[0] : cats[cats.length - 1]
    const rh = model.rowHeight
    // Existing rows in this lane EXCLUDING the dragged task, each with a representative
    // (anchor) task and the row centre Y.
    const byRow = new Map<number, { anchorId: string; cy: number }>()
    for (const lt of model.tasks) {
      if (lt.categoryId !== cat.id || lt.task.id === taskId) continue
      if (parentId && lt.task.id !== parentId && lt.task.parentId !== parentId) continue
      if (!byRow.has(lt.subRow)) byRow.set(lt.subRow, { anchorId: lt.task.id, cy: lt.cy })
    }
    const rows = [...byRow.values()].sort((a, b) => a.cy - b.cy)
    if (!rows.length)
      return {
        catId: cat.id,
        anchorId: null as string | null,
        mode: 'below' as const,
        lineY: cat.y + cat.height / 2,
        merge: false,
      }
    for (const r of rows) {
      const top = r.cy - rh / 2
      const frac = (contentY - top) / rh
      if (frac < 0 || frac >= 1) continue
      if (frac < 0.28)
        return {
          catId: cat.id,
          anchorId: r.anchorId,
          mode: 'above' as const,
          lineY: top,
          merge: false,
        }
      if (frac > 0.72)
        return {
          catId: cat.id,
          anchorId: r.anchorId,
          mode: 'below' as const,
          lineY: top + rh,
          merge: false,
        }
      return {
        catId: cat.id,
        anchorId: r.anchorId,
        mode: 'merge' as const,
        lineY: r.cy,
        merge: true,
      }
    }
    if (contentY < rows[0].cy)
      return {
        catId: cat.id,
        anchorId: rows[0].anchorId,
        mode: 'above' as const,
        lineY: rows[0].cy - rh / 2,
        merge: false,
      }
    const last = rows[rows.length - 1]
    return {
      catId: cat.id,
      anchorId: last.anchorId,
      mode: 'below' as const,
      lineY: last.cy + rh / 2,
      merge: false,
    }
  }

  // ── Zoom-to-cursor: after a wheel-driven zoom commits, shift scroll so the
  //    content point that was under the cursor stays under the cursor. ──
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    if (!a) return
    zoomAnchor.current = null
    const wrap = wrapRef.current,
      paper = paperRef.current
    if (!wrap || !paper) return
    const r = paper.getBoundingClientRect()
    wrap.scrollLeft += r.left + a.cX * a.z - a.clientX
    wrap.scrollTop += r.top + a.cY * a.z - a.clientY
  }, [zoom])

  // 예정공정표와 마일스톤은 같은 캔버스를 사용한다. 요청 시 현재 활성 시트의 실제
  // 콘텐츠 크기와 보이는 캔버스 크기를 모두 재서 가로·세로 전체가 한 번에 보이게 한다.
  useLayoutEffect(() => {
    if (fitRequest === 0 || handledFitRequest.current === fitRequest) return
    const wrap = wrapRef.current
    if (!wrap) return
    handledFitRequest.current = fitRequest
    const densityPatch = fitOverviewDensity(
      augmented,
      wrap.clientWidth,
      wrap.clientHeight,
      filter,
    )
    const fittedProject = Object.keys(densityPatch).length
      ? { ...augmented, view: { ...augmented.view, ...densityPatch } }
      : augmented
    const fittedModel = Object.keys(densityPatch).length
      ? computeLayout(fittedProject, filter)
      : model
    if (Object.keys(densityPatch).length) useEditor.getState().setView(densityPatch)
    const next = fitChartZoom(
      fittedModel.contentWidth,
      fittedModel.contentHeight,
      wrap.clientWidth,
      wrap.clientHeight,
    )
    useEditor.getState().setZoom(next)
    wrap.scrollLeft = 0
    wrap.scrollTop = 0
  }, [augmented, filter, fitRequest, model])

  // 용지 비율 맞춤 뒤에는 배치 값을 다시 바꾸지 않고, 완성된 시트만 현재 캔버스에
  // 꽉 보이게 축소한다. 출력 종횡비와 화면 전체 표시가 서로 덮어쓰지 않게 한다.
  useLayoutEffect(() => {
    if (fitViewRequest === 0 || handledFitViewRequest.current === fitViewRequest) return
    const wrap = wrapRef.current
    if (!wrap) return
    handledFitViewRequest.current = fitViewRequest
    useEditor.getState().setZoom(
      fitChartZoom(model.contentWidth, model.contentHeight, wrap.clientWidth, wrap.clientHeight),
    )
    wrap.scrollLeft = 0
    wrap.scrollTop = 0
  }, [fitViewRequest, model])

  // Native (non-passive) wheel listener so we can preventDefault while zooming.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    function onWheel(e: WheelEvent) {
      const st = useEditor.getState()
      // Ctrl(⌘)+휠 = 차트만 커서 기준 확대/축소. preventDefault로 Chrome 등의 페이지
      // 전체 줌(Ctrl+휠)을 막아 이 페이지에선 마일스톤 차트만 확대/축소된다. 트랙패드
      // 핀치도 ctrlKey로 들어와 동일하게 동작. 일반 휠은 평소대로 스크롤.
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const paper = paperRef.current
      if (!paper) return
      const z1 = st.zoom
      const r = paper.getBoundingClientRect()
      const cX = (e.clientX - r.left) / z1
      const cY = (e.clientY - r.top) / z1
      const z2 = Math.min(6, Math.max(MIN_ZOOM, z1 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      if (Math.abs(z2 - z1) < 1e-4) return
      zoomAnchor.current = { cX, cY, clientX: e.clientX, clientY: e.clientY, z: z2 }
      st.setZoom(z2)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // Cancel any running edge auto-scroll loop if we unmount mid-drag (stopAutoScroll
  // reads the stable ref, so identity across renders doesn't matter).
  useEffect(() => () => stopAutoScroll(), [])

  // ── Hand-tool panning (navMode === 'pan') ──
  function onWrapPointerDown(e: RPointerEvent) {
    if (useEditor.getState().navMode !== 'pan') return
    const wrap = wrapRef.current
    if (!wrap) return
    e.preventDefault()
    panRef.current = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }
    setPanning(true)
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)
  }
  function onPanMove(e: PointerEvent) {
    const p = panRef.current,
      wrap = wrapRef.current
    if (!p || !wrap) return
    wrap.scrollLeft = p.sl - (e.clientX - p.x)
    wrap.scrollTop = p.st - (e.clientY - p.y)
  }
  function onPanUp() {
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanUp)
    panRef.current = null
    setPanning(false)
  }

  // ── Rubber-band marquee select (edit mode): drag on empty canvas to draw a
  //    rectangle; every bar/milestone it touches becomes the multi-selection,
  //    which can then be dragged horizontally as a group. Bars stop their own
  //    pointerdown, so reaching here means an empty spot. ──
  function onPaperPointerDown(e: RPointerEvent) {
    if (useEditor.getState().navMode !== 'edit') return // pan mode handled by the wrap
    if (e.button !== 0) return
    e.preventDefault() // suppress native text/drag-select while rubber-banding
    const { x, y } = toContent(e.clientX, e.clientY)
    marqueeRef.current = { x0: x, y0: y }
    movedRef.current = false
    window.addEventListener('pointermove', onMarqueeMove)
    window.addEventListener('pointerup', onMarqueeUp)
  }
  function marqueeRect(s: { x0: number; y0: number }, clientX: number, clientY: number) {
    const { x, y } = toContent(clientX, clientY)
    return {
      x: Math.min(s.x0, x),
      y: Math.min(s.y0, y),
      w: Math.abs(x - s.x0),
      h: Math.abs(y - s.y0),
    }
  }
  function onMarqueeMove(e: PointerEvent) {
    const s = marqueeRef.current
    if (!s) return
    const r = marqueeRect(s, e.clientX, e.clientY)
    if (r.w > 3 || r.h > 3) movedRef.current = true
    setMarquee(r)
  }
  function onMarqueeUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMarqueeMove)
    window.removeEventListener('pointerup', onMarqueeUp)
    const started = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!started || !movedRef.current) return // a plain click → background click clears
    const r = marqueeRect(started, e.clientX, e.clientY)
    const hit = (lt: (typeof model.tasks)[number]) => {
      const bx = lt.isMilestone ? lt.cx - 8 : lt.x
      const bw = lt.isMilestone ? 16 : lt.w
      const by = lt.isMilestone ? lt.cy - 8 : lt.y
      const bh = lt.isMilestone ? 16 : lt.h
      return r.x < bx + bw && bx < r.x + r.w && r.y < by + bh && by < r.y + r.h
    }
    // 미러(예정 연동) 공정은 표시 전용이라 선택 대상에서 제외.
    const ids = model.tasks.filter((lt) => !lt.task.__mirror && hit(lt)).map((lt) => lt.task.id)
    if (ids.length) useEditor.getState().selectTasks(ids)
    else useEditor.getState().selectTask(null)
  }

  function onTaskPointerDown(e: RPointerEvent, id: string) {
    if (useEditor.getState().navMode !== 'edit') return // let zoom/pan take over
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    const task = project.tasks.find((t) => t.id === id)
    if (!task) return
    movedRef.current = false
    // Ctrl/⌘+클릭 = 다중 선택 토글(드래그 시작 안 함).
    if (e.ctrlKey || e.metaKey) {
      store.toggleTaskSelection(id)
      return
    }
    const sel = store.selectedTaskIds
    const { x } = toContent(e.clientX, e.clientY)
    if (sel.length > 1 && sel.includes(id)) {
      // 다중 선택된 막대 중 하나를 잡고 드래그 → 선택 전체를 수평으로 함께 이동.
      const base = project.tasks
        .filter((t) => sel.includes(t.id))
        .map((t) => ({ id: t.id, start: t.start }))
      dragRef.current = { kind: 'moveGroup', base, grabDay: model.dayOf(x), started: false }
    } else {
      store.selectTask(id)
      // History is captured lazily on the first real move, so a plain click that
      // merely selects a bar does not push an empty undo step.
      dragRef.current = {
        kind: 'move',
        taskId: id,
        grabOffsetDays: model.dayOf(x) - task.start,
        started: false,
      }
    }
    lastClient.current = { x: e.clientX, y: e.clientY }
    startAutoScroll()
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onBarResizePointerDown(e: RPointerEvent, id: string, edge: 'start' | 'end') {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    const task = project.tasks.find((t) => t.id === id)
    if (!task) return
    store.selectTask(id)
    dragRef.current = {
      kind: 'resize',
      taskId: id,
      edge,
      startDay: task.start,
      endDay: task.start + task.duration,
      started: false,
    }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onLogoResizePointerDown(e: RPointerEvent, index: number) {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const lg = model.logos.find((l) => l.index === index)
    if (!lg) return
    // Right edge stays anchored; dragging the bottom-left grip scales the box.
    dragRef.current = {
      kind: 'logo',
      index,
      rightEdge: lg.x + lg.w,
      ratio: lg.h / lg.w,
      started: false,
    }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onRainyResizePointerDown(e: RPointerEvent, seasonId: string, edge: 'start' | 'end') {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { kind: 'rainy', seasonId, edge, started: false }
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function onAnchorPointerDown(e: RPointerEvent, id: string, edge: 'start' | 'end') {
    if (useEditor.getState().navMode !== 'edit') return
    e.stopPropagation()
    e.preventDefault()
    const store = useEditor.getState()
    store.startLinking(id)
    dragRef.current = { kind: 'link', fromId: id, fromEdge: edge }
    const { x, y } = toContent(e.clientX, e.clientY)
    setGhostFrom(id, edge, x, y)
    lastClient.current = { x: e.clientX, y: e.clientY }
    startAutoScroll() // 화면 밖 아래/위 공종으로도 끌어갈 수 있도록 가장자리 자동 스크롤
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  function setGhostFrom(fromId: string, edge: 'start' | 'end', x: number, y: number) {
    const src = model.tasks.find((t) => t.task.id === fromId)
    if (src) setGhost({ x1: edge === 'start' ? src.startX : src.endX, y1: src.cy, x2: x, y2: y })
  }

  /** 제스처 시작 시점의 원본(공정·연결)을 한 번 복사해 둔다 — 미리보기의 '변경 전' 기준. */
  function snapshotBase() {
    const p = useEditor.getState().project
    baseRef.current = {
      tasks: p.tasks.map((t) => ({ ...t })),
      links: p.links.map((l) => ({ ...l })),
    }
    previewDayRef.current = null
  }

  /** 미리보기 카드 상태를 state 와 ref 에 함께 반영(ref 는 pointerup 클로저용). */
  function putImpact(next: EditImpact | null) {
    impactRef.current = next
    setImpact(next)
  }

  /** 하루 단위로만 미리보기를 갱신(픽셀마다 CPM 재계산 방지). 커밋과 같은 함수·같은 옵션. */
  function previewDrag(id: string, edit: { start?: number; duration?: number }, key: number) {
    const base = baseRef.current
    if (!base) return
    const day = Math.round(key)
    if (previewDayRef.current === day) return
    previewDayRef.current = day
    putImpact(previewEdit(base.tasks, base.links, { id, ...edit }, editMode, autoCascade))
  }

  // Apply the active gesture at a given client pointer position. Shared by the
  // pointermove handler and the edge auto-scroll loop, so the bar/link/target keeps
  // tracking the cursor while the canvas scrolls under it.
  function applyAtPointer(clientX: number, clientY: number) {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = toContent(clientX, clientY)
    if (drag.kind === 'move') {
      if (!drag.started) {
        drag.started = true
        snapshotBase()
        useEditor.getState().beginGesture()
      }
      movedRef.current = true
      const newStart = model.dayOf(x) - drag.grabOffsetDays
      previewDrag(drag.taskId, { start: newStart }, newStart)
      useEditor.getState().setTaskStartLive(drag.taskId, newStart)
      // Vertical component → preview which row the bar would join / create. 세부공정은
      // computeRowTarget에서 같은 상위 공정 블록으로 제한된다.
      if (filterActive(useEditor.getState().filter)) setReorderHint(null)
      else {
        const t = computeRowTarget(drag.taskId, y)
        setReorderHint(t ? { lineY: t.lineY, merge: t.merge } : null)
      }
    } else if (drag.kind === 'moveGroup') {
      // 다중 선택 막대 수평 동시 이동 — 세로(줄 재배치)는 건드리지 않는다.
      if (!drag.started) {
        drag.started = true
        snapshotBase()
        useEditor.getState().beginGesture()
      }
      movedRef.current = true
      const delta = model.dayOf(x) - drag.grabDay
      // 다중 이동은 대표 막대(첫 선택) 하나만 미리보기한다 — 카드에도 그 사실을 적는다.
      const lead = drag.base[0]
      if (lead) previewDrag(lead.id, { start: lead.start + delta }, lead.start + delta)
      useEditor
        .getState()
        .setTasksStartLive(drag.base.map((b) => ({ id: b.id, start: b.start + delta })))
    } else if (drag.kind === 'resize') {
      if (!drag.started) {
        drag.started = true
        snapshotBase()
        useEditor.getState().beginGesture()
      }
      movedRef.current = true
      const day = model.dayOf(x)
      if (drag.edge === 'end') {
        previewDrag(drag.taskId, { start: drag.startDay, duration: day - drag.startDay }, day)
        useEditor.getState().setTaskSpanLive(drag.taskId, drag.startDay, day - drag.startDay)
      } else {
        const s = Math.min(drag.endDay - 1, Math.round(day)) // 시작 핸들: day 0 이전(음수)도 허용
        previewDrag(drag.taskId, { start: s, duration: drag.endDay - s }, s)
        useEditor.getState().setTaskSpanLive(drag.taskId, s, drag.endDay - s)
      }
    } else if (drag.kind === 'logo') {
      if (!drag.started) {
        drag.started = true
        useEditor.getState().beginGesture()
      }
      const newW = Math.max(40, Math.min(900, drag.rightEdge - x))
      useEditor.getState().setLogoSize(drag.index, newW, newW * drag.ratio)
    } else if (drag.kind === 'rainy') {
      if (!drag.started) {
        drag.started = true
        useEditor.getState().beginGesture()
      }
      const date = dayToDate(project.startDate, Math.round(model.dayOf(x)))
      const m = date.getMonth() + 1
      const d = Math.min(date.getDate(), daysInMonth(2001, m - 1)) // non-leap day model
      // setRainySeason keeps start ≤ end and reuses (month, day) for every year,
      // so dragging one edge of any year moves all years identically.
      if (drag.edge === 'start') useEditor.getState().setRainySeason({ startMonth: m, startDay: d })
      else useEditor.getState().setRainySeason({ endMonth: m, endDay: d })
    } else {
      setGhostFrom(drag.fromId, drag.fromEdge, x, y)
    }
  }

  function onWindowMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    // If the user switched to a zoom/pan tool mid-drag (keyboard), abort the
    // edit gesture cleanly instead of continuing to mutate the model.
    if (useEditor.getState().navMode !== 'edit') {
      stopAutoScroll()
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      dragRef.current = null
      setGhost(null)
      setReorderHint(null)
      putImpact(null)
      baseRef.current = null
      if (drag.kind === 'link') useEditor.getState().cancelLinking()
      else if ('started' in drag && drag.started) useEditor.getState().endGesture()
      return
    }
    lastClient.current = { x: e.clientX, y: e.clientY }
    applyAtPointer(e.clientX, e.clientY)
  }

  // ── Edge auto-scroll: while dragging a bar or pulling a link, scroll the canvas
  //    when the pointer nears (or passes) an edge so off-screen 공종 become reachable.
  function stopAutoScroll() {
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }
  function startAutoScroll() {
    if (autoScrollRef.current != null) return
    const EDGE = 52,
      MAX = 20
    const ramp = (over: number) => Math.max(0, Math.min(MAX, Math.ceil((over / EDGE) * MAX)))
    const tick = () => {
      const wrap = wrapRef.current,
        lp = lastClient.current
      if (!wrap || !lp || !dragRef.current) {
        autoScrollRef.current = null
        return
      }
      const r = wrap.getBoundingClientRect()
      let dx = 0,
        dy = 0
      if (lp.y < r.top + EDGE) dy = -ramp(r.top + EDGE - lp.y)
      else if (lp.y > r.bottom - EDGE) dy = ramp(lp.y - (r.bottom - EDGE))
      if (lp.x < r.left + EDGE) dx = -ramp(r.left + EDGE - lp.x)
      else if (lp.x > r.right - EDGE) dx = ramp(lp.x - (r.right - EDGE))
      if (dx || dy) {
        const sl = wrap.scrollLeft,
          st = wrap.scrollTop
        wrap.scrollLeft = sl + dx
        wrap.scrollTop = st + dy
        if (wrap.scrollLeft !== sl || wrap.scrollTop !== st) applyAtPointer(lp.x, lp.y)
      }
      autoScrollRef.current = requestAnimationFrame(tick)
    }
    autoScrollRef.current = requestAnimationFrame(tick)
  }

  function onWindowUp(e: PointerEvent) {
    const drag = dragRef.current
    stopAutoScroll()
    window.removeEventListener('pointermove', onWindowMove)
    window.removeEventListener('pointerup', onWindowUp)
    dragRef.current = null
    setGhost(null)
    setReorderHint(null)
    if (!drag) return
    if (drag.kind === 'move' && drag.started && !filterActive(useEditor.getState().filter)) {
      // The vertical part assigns the activity's row. 일반 공정은 공종 사이도 이동할 수 있지만,
      // 세부공정은 같은 상위 공정 블록 안에서만 합치거나 위/아래 새 행을 만든다.
      const { y } = toContent(e.clientX, e.clientY)
      const dragged = model.tasks.find((lt) => lt.task.id === drag.taskId)
      const target = computeRowTarget(drag.taskId, y)
      // 같은 줄(한 줄 패키지)에 다른 공정과 함께 있으면(merged), 그 공정을 자기 줄로 떼어내는(구분)
      // 세로 이동은 태생적으로 작다 — 특히 맨 아래 줄은 바로 아래에 여유 공간이 없어 "아래 밴드"가
      // 자기 막대 중심 0.5행 이내에 들어온다. 이 경우 tinyVertical 가드가 분리 제스처를 삼켜버려,
      // 다른 공종으로 옮겼다 되돌려야만 새 줄이 잡히는 버그가 있었다. → merged면 재배치를 허용한다.
      const sharesRow =
        !!dragged &&
        model.tasks.some(
          (lt) =>
            lt.categoryId === dragged.categoryId &&
            lt.task.id !== drag.taskId &&
            lt.subRow === dragged.subRow,
        )
      // 혼자인 줄에서의 near-horizontal 드래그는 순수 일정 이동 — 줄 재배치 안 함(중간 공정이 맨 아래로
      // 튀는 것 방지). merged면 위 이유로 이 가드를 풀어 작은 세로 이동으로도 분리되게 한다.
      const tinyVertical =
        !!dragged &&
        !sharesRow &&
        target?.catId === dragged.categoryId &&
        Math.abs(y - dragged.cy) < model.rowHeight * 0.5
      // 미러(예정 연동) 공종 레인으로는 옮길 수 없다 — 실제 공종(현재 시트)만 드롭 대상.
      if (target && !tinyVertical && project.categories.some((c) => c.id === target.catId)) {
        useEditor
          .getState()
          .moveTaskToRow(drag.taskId, target.catId, target.anchorId, target.mode, {
            history: false,
          })
      }
    }
    if (drag.kind !== 'link' && 'started' in drag && drag.started) {
      useEditor.getState().endGesture()
      // 제스처가 하나의 undo 엔트리로 봉인된 직후 — 방금 무슨 일이 일어났는지 카드로 남기고
      // 한 번의 클릭으로 통째로 되돌릴 수 있게 한다(store.undo = 이 제스처 전체 복원).
      // 봉인 시점의 스택 깊이를 함께 찍는다 — 이후 다른 편집이 쌓이면 카드의 ↩ 가 엉뚱한
      // 편집을 되돌리게 되므로(editImpactUndoable) 그 즉시 카드를 내리기 위한 근거다.
      if (impactRef.current)
        useEditor.getState().setLastEditImpact({ ...impactRef.current, historyDepth: undoDepth() })
    }
    putImpact(null)
    baseRef.current = null
    if (drag.kind === 'link') {
      const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      const target = el?.closest('[data-task-id]') as HTMLElement | null
      const toId = target?.getAttribute('data-task-id')
      const store = useEditor.getState()
      if (toId && toId !== drag.fromId) {
        // 도착 막대의 앞/뒤 중 드롭 위치에 가까운 끝을 도착점으로 삼고(시작=S·종료=F),
        // 출발 끝점(앞=S·뒤=F)과 조합해 FS/SS/FF/SF 연결 유형을 자동 결정한다.
        const targetLt = model.tasks.find((lt) => lt.task.id === toId)
        let toEdge: 'start' | 'end' = 'start'
        if (targetLt && !targetLt.isMilestone) {
          const { x } = toContent(e.clientX, e.clientY)
          toEdge = Math.abs(x - targetLt.startX) <= Math.abs(x - targetLt.endX) ? 'start' : 'end'
        }
        const type =
          `${drag.fromEdge === 'end' ? 'F' : 'S'}${toEdge === 'end' ? 'F' : 'S'}` as LinkType
        store.completeLinking(toId, type)
      } else store.cancelLinking()
    }
  }

  // ── Inline rename (double-click a bar/milestone) + create-on-double-click ──
  function commitRename() {
    if (!editing || renameDone.current) return
    renameDone.current = true
    const name = editing.name.trim()
    if (name) useEditor.getState().updateTask(editing.id, { name })
    setEditing(null)
  }
  function onTaskDoubleClick(_: RMouseEvent, id: string) {
    if (useEditor.getState().navMode !== 'edit') return
    const t = project.tasks.find((x) => x.id === id)
    if (!t) return
    useEditor.getState().selectTask(id)
    renameDone.current = false
    setEditing({ id, name: t.name })
  }
  function onPaperDoubleClick(e: RMouseEvent) {
    if (useEditor.getState().navMode !== 'edit') return // task dbl-clicks stop propagation
    // While a filter is active the lanes are a subset and a freshly-created
    // (non-matching) task would be filtered straight back out — no bar, no
    // rename box. Skip quick-add until the filter is cleared.
    if (filterActive(useEditor.getState().filter)) return
    const { x, y } = toContent(e.clientX, e.clientY)
    if (x < model.labelWidth) return
    const cat = model.categories.find((c) => y >= c.y && y < c.y + c.height)
    // 미러(예정 연동)로 추가된 공종 레인엔 빠른추가 금지 — 실제 공종(현재 시트)만 대상.
    if (!cat || !project.categories.some((c) => c.id === cat.id)) return
    const day = Math.round(model.dayOf(x)) // 빈 레인 더블클릭 추가 — day 0 이전(음수)도 허용
    const id = useEditor.getState().addTask(cat.id, { start: day, duration: 30 })
    const t = useEditor.getState().project.tasks.find((x2) => x2.id === id)
    renameDone.current = false
    setEditing({ id, name: t?.name ?? '새 공정' })
  }

  // ── 공기(기간) 텍스트 인라인 편집: 막대 아래 "30일"을 더블클릭 → 입력. 순수 숫자면
  //    duration 자체를 바꾸고(막대 길이 변경), 그 외 문자열은 표시 라벨로 저장한다. ──
  function onDurationDoubleClick(id: string) {
    if (useEditor.getState().navMode !== 'edit') return
    const t = project.tasks.find((x) => x.id === id)
    if (!t || t.isMilestone) return
    useEditor.getState().selectTask(id)
    durDone.current = false
    const seed = t.durationLabel && t.durationLabel.trim() ? t.durationLabel : String(t.duration)
    setEditingDur({ id, text: seed })
  }
  function commitDuration() {
    if (!editingDur || durDone.current) return
    durDone.current = true
    const v = editingDur.text.trim()
    const store = useEditor.getState()
    if (/^\d+$/.test(v))
      store.updateTask(editingDur.id, { duration: Math.max(1, Number(v)), durationLabel: '' })
    else store.updateTask(editingDur.id, { durationLabel: v }) // 빈 값이면 자동(${duration}일)로 복귀
    setEditingDur(null)
  }

  const navClass =
    navMode === 'zoom'
      ? ' nav-zoom'
      : navMode === 'pan'
        ? ` nav-pan${panning ? ' panning' : ''}`
        : ''

  // 문제 목록에서 '공정 칩'을 누르면 그 막대가 보이도록 스크롤한다(1회성 요청 → 즉시 소비).
  useEffect(() => {
    if (!focusTaskId) return
    const lt = model.tasks.find((t) => t.task.id === focusTaskId)
    const wrap = wrapRef.current
    if (lt && wrap) {
      wrap.scrollLeft = Math.max(0, lt.startX * zoom - wrap.clientWidth / 3)
      wrap.scrollTop = Math.max(0, lt.cy * zoom - wrap.clientHeight / 2)
    }
    useEditor.getState().clearFocusTask()
  }, [focusTaskId, model, zoom])

  // 커밋 직후 영향 카드는 잠깐만 남긴다(되돌리기 기회) — 8초 뒤 자동으로 사라진다.
  // 그 8초 안에 **다른** 편집이 히스토리에 쌓이면 카드는 더 이상 스택 맨 위를 설명하지 않는다
  // (↩ 를 누르면 설명과 무관한 최신 편집이 되돌아간다) → 그 즉시 카드를 내린다.
  useEffect(() => {
    if (!lastEditImpact) return
    const timer = setTimeout(() => useEditor.getState().setLastEditImpact(null), 8000)
    const undoManager = getCurrentCrdtRuntime()?.undoManager
    const dropIfStale = () => {
      if (!editImpactUndoable(lastEditImpact, undoDepth()))
        useEditor.getState().setLastEditImpact(null)
    }
    undoManager?.on('stack-item-added', dropIfStale)
    return () => {
      clearTimeout(timer)
      undoManager?.off('stack-item-added', dropIfStale)
    }
  }, [lastEditImpact])

  return (
    <div className="canvas-host">
      {impact && (
        <div className="edit-impact" data-export-hide="1">
          <EditImpactCard
            impact={impact}
            startDate={project.startDate}
            note={
              dragRef.current?.kind === 'moveGroup'
                ? '다중 선택 이동 — 잡은 막대 기준 미리보기입니다.'
                : undefined
            }
          />
        </div>
      )}
      {!impact && lastEditImpact && (
        <div className="edit-impact edit-impact--done" data-export-hide="1">
          <EditImpactCard
            impact={lastEditImpact}
            startDate={project.startDate}
            onUndo={() => {
              // 이중 방어: 스택 맨 위가 더 이상 이 카드의 편집이 아니면 되돌리지 않고 카드만
              // 내린다(설명하지 않은 편집을 조용히 되돌리는 것이 이 버그의 본체였다).
              if (!editImpactUndoable(lastEditImpact, undoDepth())) {
                useEditor.getState().setLastEditImpact(null)
                return
              }
              useEditor.getState().undo()
              useEditor.getState().setLastEditImpact(null)
            }}
          />
        </div>
      )}
      {navMode !== 'edit' && (
        <div className="nav-mode-badge" data-export-hide="1">
          <span>
            {navMode === 'zoom'
              ? '🔍 줌 모드 · 스크롤로 확대/축소'
              : '✋ 이동 모드 · 드래그로 화면 이동'}
          </span>
          <span className="nav-mode-esc">Esc 해제</span>
        </div>
      )}
      <div
        ref={wrapRef}
        className={`canvas-wrap${navClass}`}
        onPointerDown={onWrapPointerDown}
        onClick={() => {
          if (useEditor.getState().navMode !== 'edit') return
          if (movedRef.current) {
            movedRef.current = false
            return
          }
          useEditor.getState().selectTask(null)
        }}
      >
        <div
          className="paper-scale"
          style={{ width: model.contentWidth * zoom, height: model.contentHeight * zoom }}
        >
          <div
            ref={paperRef}
            className="paper"
            style={{
              width: model.contentWidth,
              height: model.contentHeight,
              transform: `scale(${zoom})`,
            }}
            onPointerDown={onPaperPointerDown}
            onPointerMove={(event) => {
              const { x, y } = toContent(event.clientX, event.clientY)
              publishPresenceCursor({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
            }}
            onPointerLeave={() => publishPresenceCursor(null)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={onPaperDoubleClick}
          >
            <ChartSvg
              model={model}
              routed={routed}
              project={project}
              selectedTaskId={selectedTaskId}
              selectedTaskIds={selectedTaskIds}
              selectedLinkId={selectedLinkId}
              selectedTextRole={selectedTextRole}
              showCriticalPath={project.view.showCriticalPath}
              showGrid={project.view.showGrid}
              colorMode={colorMode}
              todayX={todayX}
              linkingGhost={linking ? ghost : null}
              remotePresences={remotePresences}
              zoom={zoom}
              onTaskPointerDown={onTaskPointerDown}
              onAnchorPointerDown={onAnchorPointerDown}
              onBarResizePointerDown={onBarResizePointerDown}
              onLogoResizePointerDown={onLogoResizePointerDown}
              onTaskClick={(e, id) => {
                if (useEditor.getState().navMode !== 'edit') return
                if (e.ctrlKey || e.metaKey) return // pointerdown handled the multi-select toggle
                if (movedRef.current) {
                  movedRef.current = false
                  return
                } // a drag just ended → keep selection
                useEditor.getState().selectTask(id)
              }}
              onTaskDoubleClick={onTaskDoubleClick}
              onTaskContextMenu={(_, id) => {
                if (useEditor.getState().navMode === 'edit') useEditor.getState().toggleDummy(id)
              }}
              onDurationDoubleClick={onDurationDoubleClick}
              onLinkClick={(_, id) => {
                if (useEditor.getState().navMode === 'edit') useEditor.getState().selectLink(id)
              }}
              onTextClick={(role) => {
                if (useEditor.getState().navMode === 'edit')
                  useEditor.getState().selectTextRole(role)
              }}
              onTimelineClick={() => {
                if (useEditor.getState().navMode === 'edit') setPeriodOpen(true)
              }}
              onRainyResizePointerDown={onRainyResizePointerDown}
              onBackgroundClick={() => {
                if (useEditor.getState().navMode !== 'edit') return
                if (movedRef.current) {
                  movedRef.current = false
                  return
                } // marquee/drag just ran → keep selection
                useEditor.getState().selectTask(null)
              }}
              onTaskHover={onTaskHover}
              adequacyByTaskId={adequacy}
            />
            {editing && editLt && (
              <input
                className="inline-rename"
                autoFocus
                value={editing.name}
                style={{
                  left: editLt.x,
                  top: editLt.isMilestone ? editLt.cy - 24 : editLt.y - 19,
                }}
                onChange={(e) => setEditing({ id: editing.id, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    renameDone.current = true
                    setEditing(null)
                  }
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            )}
            {editingDur && editDurLt && !editDurLt.isMilestone && (
              <input
                className="inline-rename inline-dur"
                autoFocus
                value={editingDur.text}
                style={{ left: editDurLt.x, top: editDurLt.y + editDurLt.h + 2 }}
                onChange={(e) => setEditingDur({ id: editingDur.id, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDuration()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    durDone.current = true
                    setEditingDur(null)
                  }
                }}
                onBlur={commitDuration}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            )}
            {reorderHint &&
              (reorderHint.merge ? (
                <div
                  data-export-hide="1"
                  style={{
                    position: 'absolute',
                    top: reorderHint.lineY - model.rowHeight / 2,
                    height: model.rowHeight,
                    left: model.labelWidth,
                    width: Math.max(0, model.contentWidth - model.labelWidth),
                    background: 'rgba(250,81,17,0.12)',
                    border: '1.5px solid var(--primary)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                />
              ) : (
                <div
                  className="reorder-line"
                  data-export-hide="1"
                  style={{
                    top: reorderHint.lineY,
                    left: model.labelWidth,
                    width: Math.max(0, model.contentWidth - model.labelWidth),
                  }}
                />
              ))}
            {marquee && (marquee.w > 1 || marquee.h > 1) && (
              <div
                className="marquee"
                data-export-hide="1"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
          </div>
        </div>
      </div>
      {hover && adequacy.get(hover.id) && (
        <AdequacyTooltip
          x={hover.x}
          y={hover.y}
          adq={adequacy.get(hover.id) as AdequacyResult}
          name={project.tasks.find((t) => t.id === hover.id)?.name ?? ''}
        />
      )}
      {periodOpen && <DisplayPeriodDialog model={model} onClose={() => setPeriodOpen(false)} />}
    </div>
  )
}

/** 막대 호버 시 뜨는 공기 적정성 근거 툴팁 — 확대(zoom) 무관하게 화면 좌표(fixed)로 크게 표시.
 *  포인터를 통과(pointerEvents none)시키고, 내보내기 대상이 아니다(data-export-hide). */
function AdequacyTooltip({
  x,
  y,
  adq,
  name,
}: {
  x: number
  y: number
  adq: AdequacyResult
  name: string
}) {
  const color =
    adq.verdict === '과소'
      ? '#d64541'
      : adq.verdict === '과다'
        ? '#c98a1b'
        : adq.verdict === '적정'
          ? '#1f9d63'
          : '#5b6b7a'
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(x + 14, vw - 300))
  const top = Math.max(8, Math.min(y + 14, vh - 190))
  const dev = (p: number | null) => (p == null ? '' : `${p > 0 ? '+' : ''}${p}%`)
  return (
    <div
      data-export-hide="1"
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 60,
        pointerEvents: 'none',
        width: 280,
        background: '#fff',
        border: '1px solid #e2e8ee',
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(16,34,50,.16)',
        padding: '10px 12px',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: '#16222e',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <b style={{ fontSize: 13 }}>{name.replace(/^◆\s*/, '')}</b>
        <span style={{ color, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {adq.verdict}
          {adq.deviationPct != null ? ` ${dev(adq.deviationPct)}` : ''}
        </span>
      </div>
      <div style={{ color: '#5b6b7a' }}>
        현 공기 {adq.current}일
        {adq.theoretical != null ? ` · 이론 ${adq.theoretical}일(물량÷생산성)` : ''}
        {adq.standardDeviationPct != null ? ` · 표준대비 ${dev(adq.standardDeviationPct)}` : ''}
      </div>
      {adq.unitCheck.status === 'mismatch' && (
        <div style={{ color: '#c33b3b', fontWeight: 600 }}>
          ⚠ 단위 불일치(입력 «{adq.unitCheck.taskUnit}» vs 표준 «{adq.unitCheck.rateUnit}») —
          판정불가
        </div>
      )}
      {!adq.criticalApplicable && (
        <div style={{ color: '#8a94a0' }}>※ 주공정선이 아니므로 참고용 판정입니다.</div>
      )}
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
        {adq.basis.slice(0, 3).map((b, i) => (
          <li
            key={i}
            style={{ fontSize: 11.5, color: '#33465a', paddingLeft: 10, position: 'relative' }}
          >
            <span style={{ position: 'absolute', left: 0 }}>·</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 표시 기간 설정 팝업(요구사항 1) — 시작~종료 월을 지정하면 타임라인을 그 구간으로 고정한다.
 *  '자동으로 초기화'하면 데이터 범위(착수~준공)로 복귀. */
function DisplayPeriodDialog({ model, onClose }: { model: LayoutModel; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  const ym = (day: number) => toISO(dayToDate(project.startDate, day)).slice(0, 7) // YYYY-MM
  const curStart = project.view.displayStart?.slice(0, 7) ?? ym(model.domainStartDay)
  const curEnd =
    project.view.displayEnd?.slice(0, 7) ??
    ym(Math.max(model.domainStartDay, model.domainEndDay - 1))
  const [start, setStart] = useState(curStart)
  const [end, setEnd] = useState(curEnd)
  const active = !!(project.view.displayStart && project.view.displayEnd)

  function apply() {
    if (!start || !end) return
    if (end < start) {
      if (typeof window !== 'undefined') window.alert('종료 월이 시작 월보다 빠릅니다.')
      return
    }
    a().setView({ displayStart: `${start}-01`, displayEnd: `${end}-01` })
    onClose()
  }
  function reset() {
    a().setView({ displayStart: undefined, displayEnd: undefined })
    onClose()
  }

  return (
    <Modal
      title="표시 기간 설정"
      sub="마일스톤 타임라인에 표시할 기간(시작~종료 월)을 지정합니다."
      width={400}
      onClose={onClose}
      footer={(close) => (
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button
            className="btn btn--sm"
            style={{ flex: 1 }}
            onClick={reset}
            disabled={!active}
            title="데이터 범위(착수~준공)로 되돌리기"
          >
            자동으로 초기화
          </button>
          <button className="btn btn--sm" onClick={close}>
            취소
          </button>
          <button className="btn btn--primary btn--sm" onClick={apply}>
            적용
          </button>
        </div>
      )}
    >
      <div className="field-row">
        <div className="field">
          <label>시작 (연-월)</label>
          <input
            className="input"
            type="month"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label>종료 (연-월)</label>
          <input
            className="input"
            type="month"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <p className="note">
        지정한 구간만 표시됩니다 — 데이터가 더 길어도 그 구간만, 짧아도 빈 기간을 포함합니다.
        ‘자동으로 초기화’ 하면 데이터 범위로 돌아갑니다.
      </p>
    </Modal>
  )
}
