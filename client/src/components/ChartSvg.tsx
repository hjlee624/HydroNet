// Pure SVG renderer for the milestone chart. Draws the full content (header +
// lanes + bars + milestones + dependency arrows + 우기 bands) at 1:1 into an
// <svg id="hydronet-chart"> which both the screen and the exporter consume.

import { memo } from 'react'
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import type { Project } from '../types/model'
import type { LayoutModel } from '../engine/layout'
import type { RoutedLink } from '../engine/routing'
import { colors, fonts } from '../styles/theme'
import { dayToDate, toISO } from '../engine/dates'

export interface LinkingGhost { x1: number; y1: number; x2: number; y2: number }

interface Props {
  model: LayoutModel
  routed: RoutedLink[]
  project: Project
  selectedTaskId: string | null
  selectedLinkId: string | null
  showCriticalPath: boolean
  showGrid: boolean
  linkingGhost: LinkingGhost | null
  onTaskPointerDown: (e: RPointerEvent, id: string) => void
  onAnchorPointerDown: (e: RPointerEvent, id: string) => void
  onTaskClick: (e: RMouseEvent, id: string) => void
  onLinkClick: (e: RMouseEvent, id: string) => void
  onBackgroundClick: () => void
}

function diamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

function ChartSvgBase({
  model, routed, project, selectedTaskId, selectedLinkId,
  showCriticalPath, showGrid, linkingGhost,
  onTaskPointerDown, onAnchorPointerDown, onTaskClick, onLinkClick, onBackgroundClick,
}: Props) {
  const { labelWidth, headerHeight, contentWidth, contentHeight, chartTop, chartHeight, headerTop, titleHeight, title } = model
  const yearRowH = headerHeight * 0.46
  const chartBottom = chartTop + chartHeight
  const milestoneR = Math.min(model.rowHeight * 0.3, 11)

  return (
    <svg
      id="hydronet-chart"
      width={contentWidth}
      height={contentHeight}
      viewBox={`0 0 ${contentWidth} ${contentHeight}`}
      style={{ fontFamily: fonts.chart }}
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

      {/* background */}
      <rect x={0} y={0} width={contentWidth} height={contentHeight} fill={colors.canvas} />

      {/* 우기 bands */}
      {project.rainySeasons.length > 0 && model.rainyRects.map((r, i) => (
        <g key={`rainy-${i}`}>
          <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={colors.rainyBand} />
          <rect x={r.x} y={chartTop} width={r.width} height={16} fill={colors.rainyBandStroke} />
          <text x={r.x + r.width / 2} y={chartTop + 11.5} textAnchor="middle" fontSize={10.5} fill="#46566e" fontWeight={600}>
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
          <text x={contentWidth / 2} y={titleHeight * 0.66} textAnchor="middle" fontSize={20} fontWeight={800} fill={colors.ink} style={{ fontFamily: fonts.display }}>
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
            <text x={y.x + y.width / 2} y={yearRowH * 0.66} textAnchor="middle" fontSize={13} fontWeight={700} fill={colors.ink}>
              {y.year}
            </text>
          </g>
        ))}
        {model.months.map((m, i) => (
          <g key={`mo-${i}`}>
            <line x1={m.x} y1={yearRowH} x2={m.x} y2={headerHeight} stroke={colors.beigeDeep} strokeWidth={0.75} />
            <text x={m.x + m.width / 2} y={yearRowH + (headerHeight - yearRowH) * 0.62} textAnchor="middle" fontSize={10} fill={colors.slate}>
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
        <text x={12} y={headerTop + headerHeight * 0.4} fontSize={11} fontWeight={700} fill={colors.charcoal}>공종 / 마일스톤</text>
        <text x={12} y={headerTop + headerHeight * 0.78} fontSize={9.5} fill={colors.steel}>
          착수 {toISO(dayToDate(project.startDate, 0)).slice(0, 7)}
        </text>
        {model.categories.map((c) => (
          <g key={`lbl-${c.id}`}>
            <rect x={6} y={c.y + c.height / 2 - 7} width={4} height={14} rx={2} fill={c.color} />
            <text x={18} y={c.y + c.height / 2 + 4} fontSize={12} fontWeight={600} fill={colors.charcoal}>
              {c.name}
            </text>
          </g>
        ))}
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
            return (
              <g key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick(e, t.id) }} style={{ cursor: 'pointer' }}>
                <text x={lt.cx} y={lt.cy - milestoneR - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={colors.ink}>
                  {t.name.replace(/^◆\s*/, '')}
                </text>
                <polygon
                  data-task-id={t.id}
                  points={diamond(lt.cx, lt.cy, milestoneR)}
                  fill={crit ? colors.critical : colors.milestone}
                  stroke={selected ? colors.primary : colors.canvas}
                  strokeWidth={selected ? 2.5 : 1.5}
                  onPointerDown={(e) => onTaskPointerDown(e, t.id)}
                />
                <text x={lt.cx} y={lt.cy + milestoneR + 12} textAnchor="middle" fontSize={9} fill={colors.steel}>
                  {toISO(dayToDate(project.startDate, t.start)).slice(2)}
                </text>
              </g>
            )
          }
          return (
            <g key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick(e, t.id) }}>
              <text x={lt.x} y={lt.y - 3.5} fontSize={10.5} fill={colors.charcoal} fontWeight={500}>
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
              <text x={lt.x} y={lt.y + lt.h + 10.5} fontSize={9} fill={colors.steel}>
                {t.duration}일
              </text>
              {/* link anchor on the finish edge */}
              {selected && (
                <circle
                  className="chart-anchor"
                  cx={lt.endX} cy={lt.cy} r={5.5}
                  fill={colors.canvas} stroke={colors.primary} strokeWidth={2}
                  onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(e, t.id) }}
                />
              )}
            </g>
          )
        })}
      </g>

      {/* footer: CI / logos (bottom-right) */}
      {model.logos.length > 0 && (
        <g>
          <line x1={0} y1={chartBottom} x2={contentWidth} y2={chartBottom} stroke={colors.hairlineStrong} strokeWidth={1} />
          {model.logos.map((lg, i) => (
            <image
              key={`logo-${i}`}
              href={lg.src}
              x={lg.x}
              y={lg.y}
              width={lg.w}
              height={lg.h}
              preserveAspectRatio="xMidYMid meet"
            />
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
