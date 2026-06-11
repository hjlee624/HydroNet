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
import type { LayoutModel } from '../engine/layout'
import type { RoutedLink } from '../engine/routing'
import { colors, fonts, resolveTextStyle } from '../styles/theme'
import { dayToDate, toISO } from '../engine/dates'

export interface LinkingGhost { x1: number; y1: number; x2: number; y2: number }

interface Props {
  model: LayoutModel
  routed: RoutedLink[]
  project: Project
  selectedTaskId: string | null
  selectedLinkId: string | null
  selectedTextRole: TextRole | null
  showCriticalPath: boolean
  showGrid: boolean
  linkingGhost: LinkingGhost | null
  onTaskPointerDown: (e: RPointerEvent, id: string) => void
  onAnchorPointerDown: (e: RPointerEvent, id: string) => void
  onBarResizePointerDown: (e: RPointerEvent, id: string, edge: 'start' | 'end') => void
  onLogoResizePointerDown: (e: RPointerEvent, index: number) => void
  onTaskClick: (e: RMouseEvent, id: string) => void
  onLinkClick: (e: RMouseEvent, id: string) => void
  onTextClick: (role: TextRole) => void
  onRainyResizePointerDown: (e: RPointerEvent, seasonId: string, edge: 'start' | 'end') => void
  onBackgroundClick: () => void
}

function diamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

function ChartSvgBase({
  model, routed, project, selectedTaskId, selectedLinkId, selectedTextRole,
  showCriticalPath, showGrid, linkingGhost,
  onTaskPointerDown, onAnchorPointerDown, onBarResizePointerDown, onLogoResizePointerDown,
  onTaskClick, onLinkClick, onTextClick, onRainyResizePointerDown, onBackgroundClick,
}: Props) {
  const { labelWidth, headerHeight, contentWidth, contentHeight, chartTop, chartHeight, headerTop, titleHeight, title } = model
  const yearRowH = headerHeight * 0.46
  const chartBottom = chartTop + chartHeight
  const milestoneR = Math.min(model.rowHeight * 0.3, 11)

  // Resolve a styleable text role into the props every <text> needs. font-family
  // goes through `style` so it survives rasterised export; click selects the role.
  function roleAttrs(role: TextRole) {
    const s = resolveTextStyle(role, project.view.textStyles)
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
          <rect x={r.x} y={chartTop} width={r.width} height={16} fill={colors.rainyBandStroke} />
          <text x={r.x + r.width / 2} y={chartTop + 11.5} textAnchor="middle" {...roleAttrs('rainyLabel')}>
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
            <text x={y.x + y.width / 2} y={yearRowH * 0.66} textAnchor="middle" {...roleAttrs('axisYear')}>
              {y.year}
            </text>
          </g>
        ))}
        {model.months.map((m, i) => (
          <g key={`mo-${i}`}>
            <line x1={m.x} y1={yearRowH} x2={m.x} y2={headerHeight} stroke={colors.beigeDeep} strokeWidth={0.75} />
            <text x={m.x + m.width / 2} y={yearRowH + (headerHeight - yearRowH) * 0.62} textAnchor="middle" {...roleAttrs('axisMonth')}>
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
          const swatchY = hasSubs ? c.y + 4 : c.y + c.height / 2 - 7
          const nameY = hasSubs ? c.y + 15 : c.y + c.height / 2 + 4
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
      </g>

      {/* dependency arrows (under bars' selection ring, over grid) */}
      <g>
        {routed.map((r) => {
          const crit = showCriticalPath && r.critical
          const selected = r.id === selectedLinkId
          return (
            <path
              key={r.id}
              d={r.d}
              fill="none"
              stroke={selected ? colors.primary : crit ? colors.critical : colors.steel}
              strokeWidth={selected ? 2.4 : crit ? 2 : 1.3}
              strokeDasharray={crit ? undefined : '5 3'}
              markerEnd={`url(#${crit ? 'hn-arrow-crit' : 'hn-arrow'})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onLinkClick(e, r.id) }}
            />
          )
        })}
      </g>

      {/* tasks */}
      <g>
        {model.tasks.map((lt) => {
          const t = lt.task
          const crit = showCriticalPath && lt.critical
          const selected = t.id === selectedTaskId
          const fill = crit ? colors.critical : (t.color ?? laneColor(model, lt.categoryId))
          if (lt.isMilestone) {
            // Critical milestones are enlarged with a red halo so the critical
            // path reads clearly even at the diamond markers.
            const r = crit ? milestoneR * 1.45 : milestoneR
            return (
              <g key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick(e, t.id) }} style={{ cursor: 'pointer' }}>
                <text x={lt.cx} y={lt.cy - r - 4} textAnchor="middle"
                  {...roleAttrs('milestoneName')} {...(crit ? { fill: colors.critical, fontWeight: 700 } : {})}>
                  {t.name.replace(/^◆\s*/, '')}
                </text>
                {crit && <polygon points={diamond(lt.cx, lt.cy, r + 5)} fill={colors.critical} opacity={0.2} />}
                <polygon
                  data-task-id={t.id}
                  points={diamond(lt.cx, lt.cy, r)}
                  fill={crit ? colors.critical : colors.milestone}
                  stroke={selected ? colors.primary : crit ? '#ffffff' : colors.canvas}
                  strokeWidth={selected ? 2.5 : crit ? 2 : 1.5}
                  onPointerDown={(e) => onTaskPointerDown(e, t.id)}
                />
                <text x={lt.cx} y={lt.cy + r + 12} textAnchor="middle" {...roleAttrs('milestoneDate')}>
                  {toISO(dayToDate(project.startDate, t.start)).slice(2)}
                </text>
              </g>
            )
          }
          return (
            <g key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick(e, t.id) }}>
              <text x={lt.x} y={lt.y - 3.5} {...roleAttrs('taskName')} {...(crit ? { fill: colors.critical, fontWeight: 700 } : {})}>
                {t.name}
              </text>
              <rect
                className="chart-bar"
                data-task-id={t.id}
                x={lt.x} y={lt.y} width={lt.w} height={lt.h} rx={3}
                fill={fill}
                stroke={selected ? colors.primary : crit ? colors.critical : 'rgba(0,0,0,0.18)'}
                strokeWidth={selected ? 2.4 : 1}
                onPointerDown={(e) => onTaskPointerDown(e, t.id)}
              />
              <text x={lt.x} y={lt.y + lt.h + 10.5} {...roleAttrs('taskDuration')}>
                {t.duration}일
              </text>
              {/* resize grips (drag to change duration) + link anchor (drag to connect) */}
              {selected && (
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
                  <circle
                    data-export-hide="1"
                    className="chart-anchor"
                    cx={lt.endX + 11} cy={lt.cy} r={5.5}
                    fill={colors.canvas} stroke={colors.primary} strokeWidth={2}
                    onPointerDown={(e) => onAnchorPointerDown(e, t.id)}
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
