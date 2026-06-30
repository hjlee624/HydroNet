// Pure SVG renderer for the milestone chart. Draws the full content (header +
// lanes + bars + milestones + dependency arrows + 우기 bands) at 1:1 into an
// <svg id="hydronet-chart"> which both the screen and the exporter consume.
//
// Every text resolves its size/family/colour through resolveTextStyle(role,…),
// so the user can click any label and restyle that whole role. font-family is
// applied via inline `style` (not a presentation attribute) so it beats the
// exporter's injected `text{font-family:…}` rule.

import { memo } from 'react'
import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import type { Project, TextRole } from '../types/model'
import type { LayoutModel, LaidTask } from '../engine/layout'
import type { RoutedLink } from '../engine/routing'
import { colors, fonts, resolveTextStyle } from '../styles/theme'
import { dayToDate, toISO } from '../engine/dates'

export interface LinkingGhost { x1: number; y1: number; x2: number; y2: number }

interface Props {
  model: LayoutModel
  routed: RoutedLink[]
  project: Project
  selectedTaskId: string | null
  /** All selected task ids (단일=[그 id], 다중선택 시 여러 개). Drives bar highlight. */
  selectedTaskIds: string[]
  selectedLinkId: string | null
  selectedTextRole: TextRole | null
  showCriticalPath: boolean
  showGrid: boolean
  /** 'critical' mutes non-critical bars so the 주공정 spine stands out. */
  colorMode?: 'category' | 'critical'
  /** X (content coords) of the "오늘" line; null/undefined = not drawn. */
  todayX?: number | null
  linkingGhost: LinkingGhost | null
  onTaskPointerDown: (e: RPointerEvent, id: string) => void
  /** 의존성 연결 드래그 시작 — `edge`는 막대의 앞(start)·뒤(end) 중 어느 끝에서 출발하는지. */
  onAnchorPointerDown: (e: RPointerEvent, id: string, edge: 'start' | 'end') => void
  onBarResizePointerDown: (e: RPointerEvent, id: string, edge: 'start' | 'end') => void
  onLogoResizePointerDown: (e: RPointerEvent, index: number) => void
  onTaskClick: (e: RMouseEvent, id: string) => void
  onTaskDoubleClick: (e: RMouseEvent, id: string) => void
  /** 우클릭 → DUMMY(가상/연결) 공정 토글. */
  onTaskContextMenu: (e: RMouseEvent, id: string) => void
  /** 막대 아래 공기(기간) 텍스트 더블클릭 → 인라인 편집. */
  onDurationDoubleClick: (id: string) => void
  onLinkClick: (e: RMouseEvent, id: string) => void
  onTextClick: (role: TextRole) => void
  /** 타임라인 헤더의 연/월 클릭 → 표시 기간 설정 팝업(요구사항 1). */
  onTimelineClick: () => void
  onRainyResizePointerDown: (e: RPointerEvent, seasonId: string, edge: 'start' | 'end') => void
  onBackgroundClick: () => void
}

function diamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

function ChartSvgBase({
  model, routed, project, selectedTaskId, selectedTaskIds, selectedLinkId, selectedTextRole,
  showCriticalPath, showGrid, colorMode = 'category', todayX, linkingGhost,
  onTaskPointerDown, onAnchorPointerDown, onBarResizePointerDown, onLogoResizePointerDown,
  onTaskClick, onTaskDoubleClick, onTaskContextMenu, onDurationDoubleClick, onLinkClick, onTextClick, onTimelineClick, onRainyResizePointerDown, onBackgroundClick,
}: Props) {
  const { labelWidth, headerHeight, contentWidth, contentHeight, chartTop, chartHeight, headerTop, titleHeight, title } = model
  const yearRowH = headerHeight * 0.46
  const chartBottom = chartTop + chartHeight
  const milestoneR = Math.min(model.rowHeight * 0.3, 11)
  const selSet = new Set(selectedTaskIds)
  const singleSel = selectedTaskIds.length <= 1
  // DUMMY opacity: "투명도 60%" → 60% transparent → 0.4 opaque.
  const DUMMY_OPACITY = 0.4

  // Auto DUMMY fill: the empty span between consecutive 공정 sharing one row (한 줄
  // 패키지의 공정 사이 빈 구간) is filled with the lane colour at low opacity so the
  // package reads as one continuous band. Only multi-task rows produce gaps.
  const gapRects: Array<{ x: number; y: number; w: number; h: number; color: string }> = []
  {
    const byRow = new Map<string, LaidTask[]>()
    for (const lt of model.tasks) {
      if (lt.isMilestone) continue
      const key = `${lt.categoryId}#${lt.subRow}`
      const arr = byRow.get(key); if (arr) arr.push(lt); else byRow.set(key, [lt])
    }
    for (const arr of byRow.values()) {
      if (arr.length < 2) continue
      arr.sort((a, b) => a.startX - b.startX)
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1], cur = arr[i]
        const gap = cur.startX - prev.endX
        if (gap > 1.5) gapRects.push({ x: prev.endX, y: prev.y, w: gap, h: prev.h, color: laneColor(model, prev.categoryId) })
      }
    }
  }

  // 왼쪽 라벨열에 공정명을 공종 하위로 나열할지(요구사항 4). 한 줄에 공정이 1개이고 세부공종이
  // 없는 비마일스톤만 왼쪽으로 옮기고(막대 위 플로팅 이름 생략) — 한 줄 패키지(여러 공정)·세부
  // 공종·마일스톤은 기존대로 막대/다이아몬드에 이름을 표기한다.
  const taskCol = project.view.taskColumn !== false
  const rowMeta = new Map<string, { count: number; hasSub: boolean }>()
  if (taskCol) for (const lt of model.tasks) {
    const key = `${lt.categoryId}#${lt.subRow}`
    const m = rowMeta.get(key) ?? { count: 0, hasSub: false }
    m.count++
    if ((lt.task.subName ?? '').trim()) m.hasSub = true
    rowMeta.set(key, m)
  }
  const nameOnLeft = (lt: LaidTask): boolean => {
    if (!taskCol || lt.isMilestone) return false
    const m = rowMeta.get(`${lt.categoryId}#${lt.subRow}`)
    return !!m && m.count === 1 && !m.hasSub
  }

  // Resolve a styleable text role into the props every <text> needs. font-family
  // goes through `style` so it survives rasterised export; click selects the role.
  function roleAttrs(role: TextRole) {
    const s = resolveTextStyle(role, project.view.textStyles, project.view.fontScale ?? 1)
    const style: CSSProperties = { fontFamily: s.fontFamily, cursor: 'pointer' }
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      fill: s.fill,
      style,
      'data-text-role': role,
      className: selectedTextRole === role ? 'tr-selected' : undefined,
      onClick: (e: RMouseEvent<SVGTextElement>) => { e.stopPropagation(); onTextClick(role) },
    }
  }

  return (
    <svg
      id="hydronet-chart"
      width={contentWidth}
      height={contentHeight}
      viewBox={`0 0 ${contentWidth} ${contentHeight}`}
      style={{ fontFamily: fonts.medium, fontWeight: 500 }}
      onClick={onBackgroundClick}
    >
      <defs>
        <marker id="hn-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1,1 L8,4.5 L1,8 Z" fill={colors.steel} />
        </marker>
        <marker id="hn-arrow-crit" markerWidth="10" markerHeight="10" refX="7.5" refY="5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1,1 L9,5 L1,9 Z" fill={colors.critical} />
        </marker>
      </defs>

      {/* background — screen-only; the exporter supplies its own (white, or none
          for transparent PNG), so this is flagged data-export-hide. */}
      <rect data-export-hide="1" x={0} y={0} width={contentWidth} height={contentHeight} fill={colors.canvas} />

      {/* 우기 bands */}
      {project.rainySeasons.length > 0 && model.rainyRects.map((r, i) => (
        <g key={`rainy-${i}`}>
          <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={colors.rainyBand} />
          <rect x={r.x} y={chartTop} width={r.width} height={Math.max(16, roleAttrs('rainyLabel').fontSize * 1.5)} fill={colors.rainyBandStroke} />
          <text x={r.x + r.width / 2} y={chartTop + Math.max(16, roleAttrs('rainyLabel').fontSize * 1.5) * 0.72} textAnchor="middle" {...roleAttrs('rainyLabel')}>
            {r.label}
          </text>
        </g>
      ))}

      {/* grid: month verticals + lane separators */}
      {showGrid && (
        <g>
          {model.months.map((m, i) => (
            <line key={`mv-${i}`} x1={m.x} y1={chartTop} x2={m.x} y2={chartBottom}
              stroke={colors.gridLine} strokeWidth={1} />
          ))}
          {model.years.map((y, i) => (
            <line key={`yv-${i}`} x1={y.x} y1={headerTop} x2={y.x} y2={chartBottom}
              stroke={colors.gridLineStrong} strokeWidth={1} />
          ))}
          {model.categories.map((c) => (
            <line key={`ls-${c.id}`} x1={labelWidth} y1={c.y + c.height} x2={contentWidth} y2={c.y + c.height}
              stroke={colors.gridLineStrong} strokeWidth={1} />
          ))}
        </g>
      )}

      {/* 오늘(today) reference line — screen-only editing aid (not exported) */}
      {todayX != null && todayX >= labelWidth && todayX <= contentWidth && (
        <g data-export-hide="1">
          <line x1={todayX} y1={chartTop} x2={todayX} y2={chartBottom} stroke={colors.primary} strokeWidth={1.25} strokeDasharray="4 3" />
          <rect x={todayX - 15} y={chartTop - 1} width={30} height={14} rx={3} fill={colors.primary} />
          <text x={todayX} y={chartTop + 9.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff">오늘</text>
        </g>
      )}

      {/* drawing title band (project / milestone name) — bold, top-centre */}
      {titleHeight > 0 && (
        <g>
          <rect x={0} y={0} width={contentWidth} height={titleHeight} fill={colors.cream} />
          <line x1={0} y1={titleHeight} x2={contentWidth} y2={titleHeight} stroke={colors.beigeDeep} strokeWidth={1} />
          <text x={contentWidth / 2} y={titleHeight * 0.66} textAnchor="middle" {...roleAttrs('title')}>
            {title}
          </text>
        </g>
      )}

      {/* timeline header (offset below the title band) */}
      <g transform={`translate(0, ${headerTop})`}>
        <rect x={labelWidth} y={0} width={contentWidth - labelWidth} height={headerHeight} fill={colors.cream} />
        <line x1={labelWidth} y1={yearRowH} x2={contentWidth} y2={yearRowH} stroke={colors.beigeDeep} strokeWidth={1} />
        {model.years.map((y, i) => (
          <g key={`yr-${i}`}>
            {i > 0 && <line x1={y.x} y1={0} x2={y.x} y2={headerHeight} stroke={colors.beigeDeep} strokeWidth={1} />}
            {/* 연/월 클릭 = 표시 기간 설정 팝업(요구사항 1). 축 텍스트 스타일은 속성 패널의
                텍스트 탭에서 역할을 골라 편집한다. */}
            <text x={y.x + y.width / 2} y={yearRowH * 0.66} textAnchor="middle" {...roleAttrs('axisYear')}
              onClick={(e) => { e.stopPropagation(); onTimelineClick() }}>
              {y.year}
            </text>
          </g>
        ))}
        {model.months.map((m, i) => (
          <g key={`mo-${i}`}>
            <line x1={m.x} y1={yearRowH} x2={m.x} y2={headerHeight} stroke={colors.beigeDeep} strokeWidth={0.75} />
            <text x={m.x + m.width / 2} y={yearRowH + (headerHeight - yearRowH) * 0.62} textAnchor="middle" {...roleAttrs('axisMonth')}
              onClick={(e) => { e.stopPropagation(); onTimelineClick() }}>
              {m.label}
            </text>
          </g>
        ))}
        <line x1={labelWidth} y1={headerHeight} x2={contentWidth} y2={headerHeight} stroke={colors.hairlineStrong} strokeWidth={1} />
      </g>

      {/* left label column */}
      <g>
        <rect x={0} y={titleHeight} width={labelWidth} height={contentHeight - titleHeight} fill={colors.creamSoft} />
        <line x1={labelWidth} y1={titleHeight} x2={labelWidth} y2={contentHeight} stroke={colors.hairlineStrong} strokeWidth={1} />
        <rect x={0} y={headerTop} width={labelWidth} height={headerHeight} fill={colors.cream} />
        <text x={12} y={headerTop + headerHeight * 0.4} {...roleAttrs('headerTitle')}>공종 / 마일스톤</text>
        <text x={12} y={headerTop + headerHeight * 0.82} {...roleAttrs('headerSub')}>
          착수 {toISO(dayToDate(project.startDate, 0)).slice(0, 7)}
        </text>
        {model.categories.map((c) => {
          const hasSubs = c.subGroups.length > 0
          // 공정명을 왼쪽에 나열하면 공종명은 레인 상단 헤더로 올린다(공정 줄과 겹치지 않게).
          const topAlign = hasSubs || taskCol
          const swatchY = topAlign ? c.y + 4 : c.y + c.height / 2 - 7
          const nameY = topAlign ? c.y + 15 : c.y + c.height / 2 + 4
          return (
            <g key={`lbl-${c.id}`}>
              <rect x={6} y={swatchY} width={4} height={14} rx={2} fill={c.color} />
              <text x={18} y={nameY} {...roleAttrs('categoryLabel')}>{c.name}</text>
              {hasSubs && c.subGroups.map((sg, i) => (
                <text key={`sg-${i}`} x={26} y={sg.y + sg.height / 2 + 4} {...roleAttrs('subCategoryLabel')}>
                  {sg.name}
                </text>
              ))}
            </g>
          )
        })}
        {/* 공정명을 공종(및 세부공종) 하위 행으로 왼쪽 라벨열에 나열 — 사이드바 '공종 구성'
            트리처럼. 막대와 같은 줄 높이(cy)에 맞춰 표시한다. */}
        {taskCol && model.tasks.map((lt) => (nameOnLeft(lt) ? (
          <text key={`tl-${lt.task.id}`} x={30} y={lt.cy + 3.5} {...roleAttrs('taskName')}
            {...(lt.task.__mirror ? { opacity: 0.6 } : {})}>
            {lt.task.name}
          </text>
        ) : null))}
      </g>

      {/* auto DUMMY fill — faded lane-colour band in the gaps between consecutive
          공정 on one row (한 줄 패키지가 끊김 없이 이어져 보이도록). Exported too. */}
      {gapRects.length > 0 && (
        <g>
          {gapRects.map((r, i) => (
            <rect key={`gap-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={2}
              fill={r.color} fillOpacity={DUMMY_OPACITY} pointerEvents="none" />
          ))}
        </g>
      )}

      {/* dependency arrows (under bars' selection ring, over grid) */}
      <g>
        {routed.map((r) => {
          const crit = showCriticalPath && r.critical
          const selected = r.id === selectedLinkId
          // User-chosen line style overrides the auto pattern (auto = critical solid,
          // others dashed) so arrows can be drawn 실선/파선/점선 individually.
          const dash = r.style === 'solid' ? undefined
            : r.style === 'dashed' ? '7 4'
              : r.style === 'dotted' ? '1.5 3.5'
                : (crit ? undefined : '5 3')
          return (
            <g key={r.id}>
              {/* Invisible fat hit area: pointer-events:'stroke' makes the WHOLE
                  route clickable — including the gaps between dashes/dots — so a
                  ~14px target replaces the 1.3px visible line that was nearly
                  impossible to hit (esp. arrows landing on milestone diamonds).
                  Hidden from export; the visible path below ignores pointers. */}
              <path
                d={r.d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                strokeLinecap="round"
                data-export-hide="1"
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onClick={(e) => { e.stopPropagation(); onLinkClick(e, r.id) }}
              />
              <path
                d={r.d}
                fill="none"
                stroke={selected ? colors.primary : crit ? colors.critical : colors.steel}
                strokeWidth={selected ? 2.4 : crit ? 2 : 1.3}
                strokeDasharray={dash}
                markerEnd={`url(#${crit ? 'hn-arrow-crit' : 'hn-arrow'})`}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          )
        })}
      </g>

      {/* tasks */}
      <g>
        {model.tasks.map((lt) => {
          const t = lt.task
          // 미러(예정공정표 연동) 공정은 표시 전용 — 포인터/CP 강조/선택/data-task-id 없이
          // 옅게(점선·반투명) 그려, 마일스톤 출력에는 포함되되 마일스톤에선 편집할 수 없다.
          const mirror = !!t.__mirror
          const crit = !mirror && showCriticalPath && lt.critical
          // In 주공정 강조 colour mode the emphasis follows the task's own critical
          // flag, independent of the 주공정 표시 overlay toggle — otherwise turning
          // that overlay off would mute every bar to grey and the colour mode would
          // do nothing. 'crit' still gates the CP-overlay flourishes (halo, enlarged
          // diamonds) that legitimately follow the overlay toggle. Mirror 공정은 강조 없음.
          const emphasizeCrit = mirror ? false : (colorMode === 'critical' ? lt.critical : crit)
          const selected = !mirror && selSet.has(t.id)
          const isDummy = !!t.isDummy && !lt.isMilestone
          const baseFill = emphasizeCrit ? colors.critical
            : colorMode === 'critical' ? '#CFC8B8' // muted so the critical spine pops
              : (t.color ?? laneColor(model, lt.categoryId))
          // DUMMY 공정은 항상 공종색을 60% 투명(0.4)으로 칠한다.
          const fill = isDummy ? laneColor(model, lt.categoryId) : baseFill
          if (lt.isMilestone) {
            // Critical milestones are enlarged with a red halo so the critical
            // path reads clearly even at the diamond markers.
            const r = crit ? milestoneR * 1.45 : milestoneR
            return (
              <g key={t.id}
                onClick={(e) => { if (mirror) return; e.stopPropagation(); onTaskClick(e, t.id) }}
                onDoubleClick={(e) => { if (mirror) return; e.stopPropagation(); onTaskDoubleClick(e, t.id) }}
                onContextMenu={(e) => { if (mirror) return; e.preventDefault(); e.stopPropagation(); onTaskContextMenu(e, t.id) }}
                style={{ cursor: mirror ? 'default' : 'pointer', opacity: mirror ? 0.6 : undefined }}>
                <text x={lt.cx} y={lt.cy - r - 4} textAnchor="middle"
                  {...roleAttrs('milestoneName')} {...(emphasizeCrit ? { fill: colors.critical, fontWeight: 700 } : {})}>
                  {t.name.replace(/^◆\s*/, '')}
                </text>
                {crit && <polygon points={diamond(lt.cx, lt.cy, r + 5)} fill={colors.critical} opacity={0.2} />}
                <polygon
                  data-task-id={mirror ? undefined : t.id}
                  points={diamond(lt.cx, lt.cy, r)}
                  fill={emphasizeCrit ? colors.critical : colors.milestone}
                  stroke={selected ? colors.primary : crit ? '#ffffff' : colors.canvas}
                  strokeWidth={selected ? 2.5 : crit ? 2 : 1.5}
                  strokeDasharray={mirror ? '2 2' : undefined}
                  style={mirror ? { pointerEvents: 'none' } : undefined}
                  onPointerDown={mirror ? undefined : (e) => onTaskPointerDown(e, t.id)}
                />
                <text x={lt.cx} y={lt.cy + r + 12} textAnchor="middle" {...roleAttrs('milestoneDate')}>
                  {toISO(dayToDate(project.startDate, t.start)).slice(2)}
                </text>
              </g>
            )
          }
          return (
            <g key={t.id}
              onClick={(e) => { if (mirror) return; e.stopPropagation(); onTaskClick(e, t.id) }}
              onDoubleClick={(e) => { if (mirror) return; e.stopPropagation(); onTaskDoubleClick(e, t.id) }}
              onContextMenu={(e) => { if (mirror) return; e.preventDefault(); e.stopPropagation(); onTaskContextMenu(e, t.id) }}
              style={mirror ? { opacity: 0.6 } : undefined}>
              {/* 공정명이 왼쪽 라벨열로 옮겨간 줄(한 줄·세부공종 없음)은 막대 위 이름을 생략. */}
              {!nameOnLeft(lt) && (
                <text x={lt.x} y={lt.y - 3.5} {...roleAttrs('taskName')} {...(emphasizeCrit ? { fill: colors.critical, fontWeight: 700 } : {})}>
                  {t.name}
                </text>
              )}
              <rect
                className="chart-bar"
                data-task-id={mirror ? undefined : t.id}
                x={lt.x} y={lt.y} width={lt.w} height={lt.h} rx={3}
                fill={fill}
                fillOpacity={isDummy ? DUMMY_OPACITY : mirror ? 0.5 : undefined}
                stroke={selected ? colors.primary : emphasizeCrit ? colors.critical : isDummy ? laneColor(model, lt.categoryId) : 'rgba(0,0,0,0.18)'}
                strokeWidth={selected ? 2.4 : 1}
                strokeDasharray={mirror ? '3 2' : (isDummy && !selected ? '4 3' : undefined)}
                style={mirror ? { pointerEvents: 'none' } : undefined}
                onPointerDown={mirror ? undefined : (e) => onTaskPointerDown(e, t.id)}
              />
              <text
                x={lt.x} y={lt.y + lt.h + roleAttrs('taskDuration').fontSize * 0.85 + 3}
                {...roleAttrs('taskDuration')}
                onDoubleClick={mirror ? undefined : (e) => { e.stopPropagation(); onDurationDoubleClick(t.id) }}
              >
                {t.durationLabel && t.durationLabel.trim() ? t.durationLabel : `${t.duration}일`}
              </text>
              {/* resize grips (drag to change duration) + link anchor (drag to connect) —
                  primary single selection only (다중선택 그룹 이동 중엔 숨김 · 미러 제외). */}
              {t.id === selectedTaskId && singleSel && !mirror && (
                <>
                  <rect
                    data-export-hide="1"
                    x={lt.startX - 3} y={lt.y - 1} width={6} height={lt.h + 2} rx={1.5}
                    fill={colors.primary} stroke={colors.canvas} strokeWidth={0.75}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onBarResizePointerDown(e, t.id, 'start')}
                  />
                  <rect
                    data-export-hide="1"
                    x={lt.endX - 3} y={lt.y - 1} width={6} height={lt.h + 2} rx={1.5}
                    fill={colors.primary} stroke={colors.canvas} strokeWidth={0.75}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onBarResizePointerDown(e, t.id, 'end')}
                  />
                  {/* 연결 앵커 2개 — 막대 앞(start)·뒤(end) 양쪽에서 화살표를 끌어 만들 수 있다.
                      출발 끝점 + 도착 끝점 조합으로 FS/SS/FF/SF가 자동 결정된다. */}
                  <circle
                    data-export-hide="1"
                    className="chart-anchor"
                    cx={lt.startX - 11} cy={lt.cy} r={5.5}
                    fill={colors.canvas} stroke={colors.primary} strokeWidth={2}
                    onPointerDown={(e) => onAnchorPointerDown(e, t.id, 'start')}
                  />
                  <circle
                    data-export-hide="1"
                    className="chart-anchor"
                    cx={lt.endX + 11} cy={lt.cy} r={5.5}
                    fill={colors.canvas} stroke={colors.primary} strokeWidth={2}
                    onPointerDown={(e) => onAnchorPointerDown(e, t.id, 'end')}
                  />
                </>
              )}
            </g>
          )
        })}
      </g>

      {/* 우기 band resize grips — drawn on top so they stay grabbable over bars.
          Near-invisible until hover; never exported (data-export-hide). Dragging
          any year's edge changes the shared (month, day), so all years move. */}
      {project.rainySeasons.length > 0 && model.rainyRects.map((r, i) => (
        <g key={`rainy-grip-${i}`}>
          {r.showStart && (
            <rect data-export-hide="1" className="rainy-grip" fill="transparent"
              x={r.startX - 3} y={chartTop} width={6} height={r.height}
              onPointerDown={(e) => onRainyResizePointerDown(e, r.seasonId, 'start')} />
          )}
          {r.showEnd && (
            <rect data-export-hide="1" className="rainy-grip" fill="transparent"
              x={r.endX - 3} y={chartTop} width={6} height={r.height}
              onPointerDown={(e) => onRainyResizePointerDown(e, r.seasonId, 'end')} />
          )}
        </g>
      ))}

      {/* footer: CI / logos (bottom-right). Dashed bounds + corner grip are
          flagged data-export-hide so they never appear in exported output. */}
      {model.logos.length > 0 && (
        <g>
          <line x1={0} y1={chartBottom} x2={contentWidth} y2={chartBottom} stroke={colors.hairlineStrong} strokeWidth={1} />
          {model.logos.map((lg) => (
            <g key={`logo-${lg.index}`}>
              <image
                href={lg.src}
                x={lg.x}
                y={lg.y}
                width={lg.w}
                height={lg.h}
                preserveAspectRatio="xMidYMid meet"
              />
              <rect
                data-export-hide="1"
                x={lg.x} y={lg.y} width={lg.w} height={lg.h}
                fill="none" stroke={colors.hairline} strokeWidth={1} strokeDasharray="3 3"
              />
              <rect
                data-export-hide="1"
                x={lg.x - 5} y={lg.y + lg.h - 5} width={11} height={11} rx={2}
                fill={colors.primary} stroke={colors.canvas} strokeWidth={1}
                style={{ cursor: 'nesw-resize' }}
                onPointerDown={(e) => onLogoResizePointerDown(e, lg.index)}
              />
            </g>
          ))}
        </g>
      )}

      {/* outer drawing frame (테두리) */}
      <rect x={0.5} y={0.5} width={contentWidth - 1} height={contentHeight - 1}
        fill="none" stroke={colors.hairlineStrong} strokeWidth={1} />

      {/* linking ghost */}
      {linkingGhost && (
        <line
          x1={linkingGhost.x1} y1={linkingGhost.y1} x2={linkingGhost.x2} y2={linkingGhost.y2}
          stroke={colors.primary} strokeWidth={2} strokeDasharray="4 3" markerEnd="url(#hn-arrow-crit)"
        />
      )}
    </svg>
  )
}

function laneColor(model: LayoutModel, categoryId: string): string {
  return model.categories.find((c) => c.id === categoryId)?.color ?? colors.bar
}

export const ChartSvg = memo(ChartSvgBase)
