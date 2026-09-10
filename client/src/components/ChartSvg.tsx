// Pure SVG renderer for the milestone chart. Draws the full content (header +
// lanes + bars + milestones + dependency arrows + 우기 bands) at 1:1 into an
// <svg id="sequence-chart"> which both the screen and the exporter consume.
//
// Every text resolves its size/family/colour through resolveTextStyle(role,…),
// so the user can click any label and restyle that whole role. font-family is
// applied via inline `style` (not a presentation attribute) so it beats the
// exporter's injected `text{font-family:…}` rule.

import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import { memo } from 'react'
import type { AdequacyResult } from '../engine/adequacy'
import { dayToDate, toISO } from '../engine/dates'
import type { LaidTask, LayoutModel } from '../engine/layout'
import type { RoutedLink } from '../engine/routing'
import type { RemotePresence } from '../state/collaboration'
import { colors, fonts, resolveTextStyle } from '../styles/theme'
import type { Project, TextRole } from '../types/model'

export interface LinkingGhost {
  x1: number
  y1: number
  x2: number
  y2: number
}

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
  remotePresences: RemotePresence[]
  /** 현재 배율(줌) — presence 마커를 화면상 일정 크기로 역-스케일해 항상 크게 보이도록. */
  zoom: number
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
  /** 막대 위 호버(진입/이탈) → 적정성 근거 툴팁(ChartCanvas 오버레이). id=null 이면 이탈. */
  onTaskHover?: (id: string | null, clientX: number, clientY: number) => void
  /** 공정별 공기 적정성 판정 — 과소/과다면 막대에 경보(색 스트라이프+⚠, 화면 전용) 표시. */
  adequacyByTaskId?: Map<string, AdequacyResult>
}

function diamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

function ChartSvgBase({
  model,
  routed,
  project,
  selectedTaskId,
  selectedTaskIds,
  selectedLinkId,
  selectedTextRole,
  showCriticalPath,
  showGrid,
  colorMode = 'category',
  todayX,
  linkingGhost,
  remotePresences,
  zoom,
  onTaskPointerDown,
  onAnchorPointerDown,
  onBarResizePointerDown,
  onLogoResizePointerDown,
  onTaskClick,
  onTaskDoubleClick,
  onTaskContextMenu,
  onLinkClick,
  onTextClick,
  onTimelineClick,
  onRainyResizePointerDown,
  onBackgroundClick,
  onTaskHover,
  adequacyByTaskId,
}: Props) {
  const {
    labelWidth,
    headerHeight,
    contentWidth,
    contentHeight,
    chartTop,
    chartHeight,
    headerTop,
    titleHeight,
    title,
  } = model
  const yearRowH = headerHeight * 0.46
  const chartBottom = chartTop + chartHeight
  // 공사기간 구분선(세로) — 연도·월 각각 표시/두께 사용자 조절. showGrid(가로 행 구분선)와 독립.
  const showYearLine = project.view.showYearLine !== false
  const yearLineW = project.view.yearLineWidth ?? 2.5
  const showMonthLine = project.view.showMonthLine !== false
  const monthLineW = project.view.monthLineWidth ?? 1
  const milestoneR = Math.min(model.rowHeight * 0.3, 11)
  const screenScale = Math.max(0.02, zoom)
  // presence 마커는 줌에 반비례로 역-스케일 → 확대/축소해도 항상 같은(큰) 화면 크기로 보임(관제 가독성).
  const presenceScale = 1 / Math.max(0.1, zoom)
  const selSet = new Set(selectedTaskIds)
  const singleSel = selectedTaskIds.length <= 1
  // DUMMY opacity: "투명도 60%" → 60% transparent → 0.4 opaque.
  const DUMMY_OPACITY = 0.4

  // 자식(세부공정)을 가진 상위 공정 id 집합. 이런 상위 공정은 막대를 그리지 않고(세부공정 막대만
  // 그 줄에 표시) 이름은 좌측 라벨로만 남긴다. parentId로 판정하므로 이름 충돌과 무관.
  const childParentIds = new Set(
    model.tasks.map((lt) => lt.task.parentId).filter((p): p is string => !!p),
  )
  // DUMMY 채움: 같은 줄의 두 막대 **사이를 사용자가 화살표(링크)로 연결한 경우에만** 그 빈 구간을
  // 공종색 옅게 채운다(요구). 링크 없이 그냥 인접하거나 세부공정을 추가한 것만으로는 더미를
  // 만들지 않는다. 링크된 쌍(순서 무관)만 대상.
  // 링크된 쌍(순서 무관) + 그 링크의 DUMMY 음영 표시 여부(link.showDummy). false면 그 구간은
  // 채우지 않는다(연결 속성의 '연결 음영' 토글). 기본(undefined/true)은 표시.
  const linkedPairs = new Set<string>()
  const dummyShownByPair = new Map<string, boolean>()
  for (const l of project.links) {
    const [a, b] = l.from < l.to ? [l.from, l.to] : [l.to, l.from]
    const key = `${a}|${b}`
    linkedPairs.add(key)
    // 한 쌍에 여러 링크가 있으면 하나라도 표시면 표시(OR).
    dummyShownByPair.set(key, (dummyShownByPair.get(key) ?? false) || l.showDummy !== false)
  }
  const gapRects: Array<{ x: number; y: number; w: number; h: number; color: string }> = []
  {
    const byRow = new Map<string, LaidTask[]>()
    for (const lt of model.tasks) {
      if (lt.isMilestone) continue
      // 숨겨진 상위 공정(세부공정 보유)은 막대가 없으니 더미 계산에서 제외한다.
      if (childParentIds.has(lt.task.id)) continue
      const key = `${lt.categoryId}#${lt.subRow}`
      const arr = byRow.get(key)
      if (arr) arr.push(lt)
      else byRow.set(key, [lt])
    }
    for (const arr of byRow.values()) {
      if (arr.length < 2) continue
      arr.sort((a, b) => a.startX - b.startX)
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1],
          cur = arr[i]
        const gap = cur.startX - prev.endX
        const [a, b] =
          prev.task.id < cur.task.id ? [prev.task.id, cur.task.id] : [cur.task.id, prev.task.id]
        if (
          gap > 1.5 &&
          linkedPairs.has(`${a}|${b}`) &&
          dummyShownByPair.get(`${a}|${b}`) !== false
        )
          gapRects.push({
            x: prev.endX,
            y: prev.y,
            w: gap,
            h: prev.h,
            color: laneColor(model, prev.categoryId),
          })
      }
    }
  }

  // 좌측 라벨열은 WBS(공종·세부공종)만 표기하고, 공정명은 **항상 막대 위**에 띄운다.
  // taskCol(기본 ON)은 공종명을 레인 상단 헤더로 올릴지(WBS 정렬)만 결정한다.
  const taskCol = project.view.taskColumn !== false

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
      onClick: (e: RMouseEvent<SVGTextElement>) => {
        e.stopPropagation()
        onTextClick(role)
      },
    }
  }

  return (
    <svg
      id="sequence-chart"
      width={contentWidth}
      height={contentHeight}
      viewBox={`0 0 ${contentWidth} ${contentHeight}`}
      style={{ fontFamily: fonts.medium, fontWeight: 500 }}
      onClick={onBackgroundClick}
    >
      <defs>
        <marker
          id="hn-arrow"
          markerWidth="9"
          markerHeight="9"
          refX="7"
          refY="4.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L8,4.5 L1,8 Z" fill={colors.steel} />
        </marker>
        <marker
          id="hn-arrow-crit"
          markerWidth="10"
          markerHeight="10"
          refX="7.5"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L9,5 L1,9 Z" fill={colors.critical} />
        </marker>
      </defs>

      {/* background — screen-only; the exporter supplies its own (white, or none
          for transparent PNG), so this is flagged data-export-hide. */}
      <rect
        data-export-hide="1"
        x={0}
        y={0}
        width={contentWidth}
        height={contentHeight}
        fill={colors.canvas}
      />

      {/* 우기 bands */}
      {project.rainySeasons.length > 0 &&
        model.rainyRects.map((r, i) => (
          <g key={`rainy-${i}`}>
            <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={colors.rainyBand} />
            <rect
              x={r.x}
              y={chartTop}
              width={r.width}
              height={Math.max(16, roleAttrs('rainyLabel').fontSize * 1.5)}
              fill={colors.rainyBandStroke}
            />
            <text
              x={r.x + r.width / 2}
              y={chartTop + Math.max(16, roleAttrs('rainyLabel').fontSize * 1.5) * 0.72}
              textAnchor="middle"
              {...roleAttrs('rainyLabel')}
            >
              {r.label}
            </text>
          </g>
        ))}

      {/* 월 구분선(세로) — 공사기간 구분선의 월 단위. showMonthLine·monthLineWidth로 표시/두께 조절. */}
      {showMonthLine && (
        <g>
          {model.months.map((m, i) => (
            <line
              key={`mv-${i}`}
              x1={m.x}
              y1={chartTop}
              x2={m.x}
              y2={chartBottom}
              stroke={colors.gridLine}
              strokeWidth={monthLineW}
            />
          ))}
        </g>
      )}

      {/* 가로 행 구분선(레인 경계) — showGrid('행 구분선 표시')로 제어. 세로 시간 구분선과 별개. */}
      {showGrid && (
        <g>
          {model.categories.map((c) => (
            <line
              key={`ls-${c.id}`}
              x1={labelWidth}
              y1={c.y + c.height}
              x2={contentWidth}
              y2={c.y + c.height}
              stroke={colors.gridLineStrong}
              strokeWidth={1}
            />
          ))}
        </g>
      )}

      {/* 연도 구분선(세로) — 공사기간 구분선의 연 단위. 월/행 격자와 독립(격자를 꺼도 연 구획 유지). */}
      {showYearLine && (
        <g>
          {model.years.map((y, i) => (
            <line
              key={`yv-${i}`}
              x1={y.x}
              y1={headerTop}
              x2={y.x}
              y2={chartBottom}
              stroke={colors.yearLine}
              strokeWidth={yearLineW}
            />
          ))}
        </g>
      )}

      {/* 오늘(today) reference line — screen-only editing aid (not exported) */}
      {todayX != null && todayX >= labelWidth && todayX <= contentWidth && (
        <g data-export-hide="1">
          <line
            x1={todayX}
            y1={chartTop}
            x2={todayX}
            y2={chartBottom}
            stroke={colors.primary}
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
          <rect
            x={todayX - 15}
            y={chartTop - 1}
            width={30}
            height={14}
            rx={3}
            fill={colors.primary}
          />
          <text
            x={todayX}
            y={chartTop + 9.5}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill="#ffffff"
          >
            오늘
          </text>
        </g>
      )}

      {/* drawing title band (project / milestone name) — bold, top-centre */}
      {titleHeight > 0 && (
        <g>
          <rect x={0} y={0} width={contentWidth} height={titleHeight} fill={colors.cream} />
          {/* 제목↔연도 가로 구분선 — 연도 구분선 설정을 함께 따른다(켜짐: 진한 yearLine·조절 두께,
              꺼짐: 기본 얇은 테두리 유지). */}
          <line
            x1={0}
            y1={titleHeight}
            x2={contentWidth}
            y2={titleHeight}
            stroke={showYearLine ? colors.yearLine : colors.beigeDeep}
            strokeWidth={showYearLine ? yearLineW : 1}
          />
          <text
            x={contentWidth / 2}
            y={titleHeight * 0.66}
            textAnchor="middle"
            {...roleAttrs('title')}
          >
            {title}
          </text>
        </g>
      )}

      {/* timeline header (offset below the title band) */}
      <g transform={`translate(0, ${headerTop})`}>
        <rect
          x={labelWidth}
          y={0}
          width={contentWidth - labelWidth}
          height={headerHeight}
          fill={colors.cream}
        />
        <line
          x1={labelWidth}
          y1={yearRowH}
          x2={contentWidth}
          y2={yearRowH}
          stroke={colors.beigeDeep}
          strokeWidth={1}
        />
        {model.years.map((y, i) => (
          <g key={`yr-${i}`}>
            {i > 0 && showYearLine && (
              <line
                x1={y.x}
                y1={0}
                x2={y.x}
                y2={headerHeight}
                stroke={colors.yearLine}
                strokeWidth={yearLineW}
              />
            )}
            {/* 연/월 클릭 = 표시 기간 설정 팝업(요구사항 1). 축 텍스트 스타일은 속성 패널의
                텍스트 탭에서 역할을 골라 편집한다. */}
            <text
              x={y.x + y.width / 2}
              y={yearRowH * 0.66}
              textAnchor="middle"
              {...roleAttrs('axisYear')}
              onClick={(e) => {
                e.stopPropagation()
                onTimelineClick()
              }}
            >
              {y.year}
            </text>
          </g>
        ))}
        {model.months.map((m, i) => (
          <g key={`mo-${i}`}>
            {/* 월 눈금선 — 월 구분선 설정을 따름(라벨은 항상 표시). */}
            {showMonthLine && (
              <line
                x1={m.x}
                y1={yearRowH}
                x2={m.x}
                y2={headerHeight}
                stroke={colors.beigeDeep}
                strokeWidth={monthLineW}
              />
            )}
            <text
              x={m.x + m.width / 2}
              y={yearRowH + (headerHeight - yearRowH) * 0.62}
              textAnchor="middle"
              {...roleAttrs('axisMonth')}
              onClick={(e) => {
                e.stopPropagation()
                onTimelineClick()
              }}
            >
              {m.label}
            </text>
          </g>
        ))}
        <line
          x1={labelWidth}
          y1={headerHeight}
          x2={contentWidth}
          y2={headerHeight}
          stroke={colors.hairlineStrong}
          strokeWidth={1}
        />
      </g>

      {/* left label column */}
      <g>
        <rect
          x={0}
          y={titleHeight}
          width={labelWidth}
          height={contentHeight - titleHeight}
          fill={colors.creamSoft}
        />
        <line
          x1={labelWidth}
          y1={titleHeight}
          x2={labelWidth}
          y2={contentHeight}
          stroke={colors.hairlineStrong}
          strokeWidth={1}
        />
        <rect x={0} y={headerTop} width={labelWidth} height={headerHeight} fill={colors.cream} />
        <text x={12} y={headerTop + headerHeight * 0.4} {...roleAttrs('headerTitle')}>
          공종 / 마일스톤
        </text>
        <text x={12} y={headerTop + headerHeight * 0.82} {...roleAttrs('headerSub')}>
          착수 {toISO(dayToDate(project.startDate, 0)).slice(0, 7)}
        </text>
        {model.categories.map((c) => {
          const hasSubs = c.subGroups.length > 0
          // 공정명을 왼쪽에 나열하면 공종명은 레인 상단 헤더로 올린다(공정 줄과 겹치지 않게).
          const topAlign = hasSubs || taskCol
          // 공종명 배치는 글자 크기(fontScale)에 연동해야 한다. 고정 오프셋이면 fit-to-paper로
          // 폰트가 커질 때(A3 등 작은 용지) 글자가 baseline 위로 넘쳐 위 레인/헤더 밴드와 겹친다.
          // 레인 상단 인셋(layout.ts headerInset = max(20, ceil(fs*1.4)) 안에 들어오도록 스케일.
          const catFs = roleAttrs('categoryLabel').fontSize
          const swH = Math.max(14, Math.round(catFs))
          const swatchY = topAlign ? c.y + 4 : c.y + c.height / 2 - swH / 2
          const nameY = topAlign ? c.y + Math.max(15, catFs + 4) : c.y + c.height / 2 + 4
          return (
            <g key={`lbl-${c.id}`}>
              <rect x={6} y={swatchY} width={4} height={swH} rx={2} fill={c.color} />
              <text x={18} y={nameY} {...roleAttrs('categoryLabel')}>
                {c.name}
              </text>
            </g>
          )
        })}
        {/* 좌측 라벨열 = 공종 > 공정. 각 막대(공정)는 layout에서 한 줄에 하나씩 배치되므로 공정명이
            줄마다 분리돼 세로로 겹치지 않는다. 세부공정(parentId 있음)은 좌측에 나열하지 않고 상위
            공정 줄에 막대로만 이어 붙는다(요구2). 상위 공정(세부공정 보유)은 막대는 숨겨도 여기 좌측
            이름은 남긴다 — 그 줄의 대표 이름이 된다. 마일스톤 제외. */}
        {taskCol &&
          model.tasks.map((lt) =>
            lt.isMilestone || lt.task.parentId ? null : (
              <text
                key={`tl-${lt.task.id}`}
                x={30}
                y={lt.cy + 3.5}
                {...roleAttrs('taskName')}
                {...(lt.task.__mirror ? { opacity: 0.6 } : {})}
              >
                {lt.task.name.replace(/^◆\s*/, '')}
              </text>
            ),
          )}
      </g>

      {/* DUMMY fill — 같은 줄에서 사용자가 화살표(링크)로 연결한 두 막대 사이의 빈 구간만
          공종색 옅게 채운다(그 외/세부공정 추가엔 더미 없음). Exported too. */}
      {gapRects.length > 0 && (
        <g>
          {gapRects.map((r, i) => (
            <rect
              key={`gap-${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={2}
              fill={r.color}
              fillOpacity={DUMMY_OPACITY}
              pointerEvents="none"
            />
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
          const dash =
            r.style === 'solid'
              ? undefined
              : r.style === 'dashed'
                ? '7 4'
                : r.style === 'dotted'
                  ? '1.5 3.5'
                  : crit
                    ? undefined
                    : '5 3'
          // 사용자 지정 선 두께(연결 속성) 우선, 없으면 자동(주공정 2·그 외 1.3).
          const baseW = r.width ?? (crit ? 2 : 1.3)
          const lineW = selected ? Math.max(2.4, baseW) : baseW
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
                strokeWidth={Math.max(14, lineW + 6)}
                strokeLinecap="round"
                data-export-hide="1"
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onClick={(e) => {
                  e.stopPropagation()
                  onLinkClick(e, r.id)
                }}
              />
              <path
                d={r.d}
                fill="none"
                stroke={selected ? colors.primary : crit ? colors.critical : colors.steel}
                strokeWidth={lineW}
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
          // 세부공정이 달린 상위 공정은 자기 막대를 그리지 않는다 — 세부공정 막대만 그 줄에 이어
          // 붙고, 상위 공정명은 좌측 라벨로만 표시된다(check.png). 마일스톤은 제외.
          if (!lt.isMilestone && childParentIds.has(t.id)) return null
          // 미러(예정공정표 연동) 공정은 표시 전용 — 포인터/CP 강조/선택/data-task-id 없이
          // 옅게(점선·반투명) 그려, 마일스톤 출력에는 포함되되 마일스톤에선 편집할 수 없다.
          const mirror = !!t.__mirror
          const crit = !mirror && showCriticalPath && lt.critical
          // In 주공정 강조 colour mode the emphasis follows the task's own critical
          // flag, independent of the 주공정 표시 overlay toggle — otherwise turning
          // that overlay off would mute every bar to grey and the colour mode would
          // do nothing. 'crit' still gates the CP-overlay flourishes (halo, enlarged
          // diamonds) that legitimately follow the overlay toggle. Mirror 공정은 강조 없음.
          const emphasizeCrit = mirror ? false : colorMode === 'critical' ? lt.critical : crit
          const selected = !mirror && selSet.has(t.id)
          const isDummy = !!t.isDummy && !lt.isMilestone
          // 사용자가 공정 색을 지정하면 주공정(빨강 채움)보다 그 색을 우선한다 — 색을 바꿔도 주공정이
          // '해제'되지 않게(빨강 테두리·이름·화살표의 주공정 표시는 그대로 유지). 단 '주공정 강조'
          // 색상 모드에서는 스포트라이트 유지를 위해 지정색을 무시한다.
          const userColor = mirror ? undefined : t.color
          const baseFill =
            colorMode === 'critical'
              ? emphasizeCrit
                ? colors.critical
                : '#CFC8B8' // muted so the critical spine pops
              : (userColor ?? (emphasizeCrit ? colors.critical : laneColor(model, lt.categoryId)))
          // DUMMY 공정은 항상 공종색을 60% 투명(0.4)으로 칠한다.
          const fill = isDummy ? laneColor(model, lt.categoryId) : baseFill
          // 공기 적정성 부적정 판정(과소/과다). 툴팁(<title>)은 **마우스를 실제로 받는 막대**에
          // 붙인다 — 아래 경보 그래픽 그룹은 pointer-events:none 이라 그 안의 <title>은 히트
          // 테스트에 절대 걸리지 않아 영원히 뜨지 않았다.
          const adqMark = mirror || isDummy ? undefined : adequacyByTaskId?.get(t.id)
          const adqWarn =
            adqMark && (adqMark.verdict === '과소' || adqMark.verdict === '과다')
              ? adqMark
              : undefined
          if (lt.isMilestone) {
            // Critical milestones are enlarged with a red halo so the critical
            // path reads clearly even at the diamond markers.
            const baseR = crit ? milestoneR * 1.45 : milestoneR
            const r = Math.min(model.rowHeight * 0.3, Math.max(baseR, 5 / screenScale))
            const hitR = Math.min(model.rowHeight * 0.42, Math.max(r, 10 / screenScale))
            return (
              <g
                key={t.id}
                onClick={(e) => {
                  if (mirror) return
                  e.stopPropagation()
                  onTaskClick(e, t.id)
                }}
                onDoubleClick={(e) => {
                  if (mirror) return
                  e.stopPropagation()
                  onTaskDoubleClick(e, t.id)
                }}
                onContextMenu={(e) => {
                  if (mirror) return
                  e.preventDefault()
                  e.stopPropagation()
                  onTaskContextMenu(e, t.id)
                }}
                style={{
                  cursor: mirror ? 'default' : 'pointer',
                  opacity: mirror ? 0.6 : undefined,
                }}
              >
                <text
                  x={lt.cx}
                  y={lt.cy - r - 4}
                  textAnchor="middle"
                  {...roleAttrs('milestoneName')}
                  {...(emphasizeCrit ? { fill: colors.critical, fontWeight: 700 } : {})}
                >
                  {t.name.replace(/^◆\s*/, '')}
                </text>
                {crit && (
                  <polygon
                    points={diamond(lt.cx, lt.cy, r + 5)}
                    fill={colors.critical}
                    opacity={0.2}
                  />
                )}
                {!mirror && (
                  <circle
                    data-task-id={t.id}
                    data-export-hide="1"
                    cx={lt.cx}
                    cy={lt.cy}
                    r={hitR}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onTaskPointerDown(e, t.id)}
                  />
                )}
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
                <text
                  x={lt.cx}
                  y={lt.cy + r + 12}
                  textAnchor="middle"
                  {...roleAttrs('milestoneDate')}
                >
                  {toISO(dayToDate(project.startDate, t.start)).slice(2)}
                </text>
              </g>
            )
          }
          const visibleHeight = Math.min(
            model.rowHeight * 0.8,
            Math.max(lt.h, 6 / screenScale),
          )
          const visibleY = lt.cy - visibleHeight / 2
          const hitHeight = Math.min(
            model.rowHeight * 0.9,
            Math.max(visibleHeight, 18 / screenScale),
          )
          const hitY = lt.cy - hitHeight / 2
          return (
            <g
              key={t.id}
              onClick={(e) => {
                if (mirror) return
                e.stopPropagation()
                onTaskClick(e, t.id)
              }}
              onDoubleClick={(e) => {
                if (mirror) return
                e.stopPropagation()
                onTaskDoubleClick(e, t.id)
              }}
              onContextMenu={(e) => {
                if (mirror) return
                e.preventDefault()
                e.stopPropagation()
                onTaskContextMenu(e, t.id)
              }}
              style={mirror ? { opacity: 0.6 } : undefined}
            >
              {/* 공정명은 항상 막대 위 **중앙**에 표기(요구). 막대 선택을 방해하지 않도록 클릭
                  통과(pointer-events none) — 칸이 좁아도 막대가 잘 잡힌다. 텍스트 편집은 인스펙터/사이드바. */}
              <text
                x={lt.x + lt.w / 2}
                y={lt.y - 3.5}
                textAnchor="middle"
                {...roleAttrs('taskName')}
                {...(emphasizeCrit ? { fill: colors.critical, fontWeight: 700 } : {})}
                style={{ ...roleAttrs('taskName').style, pointerEvents: 'none' }}
              >
                {t.name}
              </text>
              {!mirror && (
                <rect
                  data-task-id={t.id}
                  data-export-hide="1"
                  x={lt.x}
                  y={hitY}
                  width={lt.w}
                  height={hitHeight}
                  rx={3}
                  fill="transparent"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => onTaskPointerDown(e, t.id)}
                  onMouseEnter={
                    !onTaskHover ? undefined : (e) => onTaskHover(t.id, e.clientX, e.clientY)
                  }
                  onMouseLeave={!onTaskHover ? undefined : () => onTaskHover(null, 0, 0)}
                />
              )}
              <rect
                className="chart-bar"
                data-task-id={mirror ? undefined : t.id}
                x={lt.x}
                y={visibleY}
                width={lt.w}
                height={visibleHeight}
                rx={3}
                fill={fill}
                fillOpacity={isDummy ? DUMMY_OPACITY : mirror ? 0.5 : undefined}
                stroke={
                  selected
                    ? colors.primary
                    : emphasizeCrit
                      ? colors.critical
                      : isDummy
                        ? laneColor(model, lt.categoryId)
                        : 'rgba(0,0,0,0.18)'
                }
                strokeWidth={selected ? 2.4 : 1}
                strokeDasharray={mirror ? '3 2' : isDummy && !selected ? '4 3' : undefined}
                style={mirror ? { pointerEvents: 'none' } : undefined}
                onPointerDown={mirror ? undefined : (e) => onTaskPointerDown(e, t.id)}
                onMouseEnter={
                  mirror || !onTaskHover
                    ? undefined
                    : (e) => onTaskHover(t.id, e.clientX, e.clientY)
                }
                onMouseLeave={mirror || !onTaskHover ? undefined : () => onTaskHover(null, 0, 0)}
              >
                {/* 화면 전용 안내라 출력에서는 뺀다(data-export-hide). */}
                {adqWarn && (
                  <title data-export-hide="1">
                    {`${adqWarn.verdict}${adqWarn.criticalApplicable ? ' (주공정)' : ' (참고용 · 주공정선 아님)'}`}
                  </title>
                )}
              </rect>
              <text
                x={lt.x}
                y={visibleY + visibleHeight + roleAttrs('taskDuration').fontSize * 0.85 + 3}
                {...roleAttrs('taskDuration')}
                style={{ ...roleAttrs('taskDuration').style, pointerEvents: 'none' }}
              >
                {t.durationLabel && t.durationLabel.trim() ? t.durationLabel : `${t.duration}일`}
              </text>
              {/* 부적정(과소/과다) 경보 — 화면 전용(내보내기 제외). 결정론 엔진(adequacy) 판정 기반.
                  주공정선이 아닌 공정(criticalApplicable=false)은 법정 산정식의 직접 적용 대상이
                  아니므로 '참고용'임이 보이게 옅은 점선 + 작은 기호로 낮춰 표시한다. */}
              {(() => {
                if (!adqWarn) return null
                const warnColor = adqWarn.verdict === '과소' ? '#d64541' : '#e0972a'
                const ref = !adqWarn.criticalApplicable // 참고용(주공정 아님)
                return (
                  <g data-export-hide="1" pointerEvents="none" opacity={ref ? 0.45 : 1}>
                    {ref ? (
                      <line
                        x1={lt.x}
                        y1={visibleY + 0.75}
                        x2={lt.x + lt.w}
                        y2={visibleY + 0.75}
                        stroke={warnColor}
                        strokeWidth={1.5}
                        strokeDasharray="3 2.5"
                      />
                    ) : (
                      <rect
                        x={lt.x}
                        y={visibleY - 0.5}
                        width={lt.w}
                        height={2.5}
                        rx={1}
                        fill={warnColor}
                      />
                    )}
                    <text
                      x={lt.endX - 4}
                      y={lt.cy + 4}
                      textAnchor="end"
                      fontSize={ref ? 8.5 : 11}
                      fontWeight={ref ? 400 : 700}
                      fill={warnColor}
                    >
                      ⚠
                    </text>
                  </g>
                )
              })()}
              {/* resize grips (drag to change duration) + link anchor (drag to connect) —
                  primary single selection only (다중선택 그룹 이동 중엔 숨김 · 미러 제외). */}
              {t.id === selectedTaskId && singleSel && !mirror && (
                <>
                  {(() => {
                    const gripWidth = Math.max(6, 10 / screenScale)
                    return (
                      <>
                  <rect
                    data-export-hide="1"
                    x={lt.startX - gripWidth / 2}
                    y={hitY}
                    width={gripWidth}
                    height={hitHeight}
                    rx={1.5}
                    fill={colors.primary}
                    stroke={colors.canvas}
                    strokeWidth={0.75}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onBarResizePointerDown(e, t.id, 'start')}
                  />
                  <rect
                    data-export-hide="1"
                    x={lt.endX - gripWidth / 2}
                    y={hitY}
                    width={gripWidth}
                    height={hitHeight}
                    rx={1.5}
                    fill={colors.primary}
                    stroke={colors.canvas}
                    strokeWidth={0.75}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onBarResizePointerDown(e, t.id, 'end')}
                  />
                      </>
                    )
                  })()}
                  {/* 연결 앵커 2개 — 막대 앞(start)·뒤(end) 양쪽에서 화살표를 끌어 만들 수 있다.
                      출발 끝점 + 도착 끝점 조합으로 FS/SS/FF/SF가 자동 결정된다. */}
                  <circle
                    data-export-hide="1"
                    className="chart-anchor"
                    cx={lt.startX - 11}
                    cy={lt.cy}
                    r={Math.max(5.5, 8 / screenScale)}
                    fill={colors.canvas}
                    stroke={colors.primary}
                    strokeWidth={2}
                    onPointerDown={(e) => onAnchorPointerDown(e, t.id, 'start')}
                  />
                  <circle
                    data-export-hide="1"
                    className="chart-anchor"
                    cx={lt.endX + 11}
                    cy={lt.cy}
                    r={Math.max(5.5, 8 / screenScale)}
                    fill={colors.canvas}
                    stroke={colors.primary}
                    strokeWidth={2}
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
      {project.rainySeasons.length > 0 &&
        model.rainyRects.map((r, i) => (
          <g key={`rainy-grip-${i}`}>
            {r.showStart && (
              <rect
                data-export-hide="1"
                className="rainy-grip"
                fill="transparent"
                x={r.startX - 3}
                y={chartTop}
                width={6}
                height={r.height}
                onPointerDown={(e) => onRainyResizePointerDown(e, r.seasonId, 'start')}
              />
            )}
            {r.showEnd && (
              <rect
                data-export-hide="1"
                className="rainy-grip"
                fill="transparent"
                x={r.endX - 3}
                y={chartTop}
                width={6}
                height={r.height}
                onPointerDown={(e) => onRainyResizePointerDown(e, r.seasonId, 'end')}
              />
            )}
          </g>
        ))}

      {/* footer: CI / logos (bottom-right). Dashed bounds + corner grip are
          flagged data-export-hide so they never appear in exported output. */}
      {model.logos.length > 0 && (
        <g>
          <line
            x1={0}
            y1={chartBottom}
            x2={contentWidth}
            y2={chartBottom}
            stroke={colors.hairlineStrong}
            strokeWidth={1}
          />
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
                x={lg.x}
                y={lg.y}
                width={lg.w}
                height={lg.h}
                fill="none"
                stroke={colors.hairline}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <rect
                data-export-hide="1"
                x={lg.x - 5}
                y={lg.y + lg.h - 5}
                width={11}
                height={11}
                rx={2}
                fill={colors.primary}
                stroke={colors.canvas}
                strokeWidth={1}
                style={{ cursor: 'nesw-resize' }}
                onPointerDown={(e) => onLogoResizePointerDown(e, lg.index)}
              />
            </g>
          ))}
        </g>
      )}

      {/* outer drawing frame (테두리) */}
      <rect
        x={0.5}
        y={0.5}
        width={contentWidth - 1}
        height={contentHeight - 1}
        fill="none"
        stroke={colors.hairlineStrong}
        strokeWidth={1}
      />

      {/* linking ghost */}
      {linkingGhost && (
        <line
          x1={linkingGhost.x1}
          y1={linkingGhost.y1}
          x2={linkingGhost.x2}
          y2={linkingGhost.y2}
          stroke={colors.primary}
          strokeWidth={2}
          strokeDasharray="4 3"
          markerEnd="url(#hn-arrow-crit)"
        />
      )}

      {/* Awareness is transient, untrusted UI state. This entire overlay is excluded from export. */}
      <g data-export-hide="1" pointerEvents="none">
        {remotePresences.map((presence) => {
          const selectedTasks = new Set(presence.selection.selectedTaskIds)
          const selectedCategories = new Set(presence.selection.selectedCategoryIds)
          const selectedLink = presence.selection.selectedLinkId
          const firstTask = model.tasks.find((task) => selectedTasks.has(task.task.id))
          const firstCategory = model.categories.find((category) =>
            selectedCategories.has(category.id),
          )
          const labelX = presence.cursor?.x ?? firstTask?.x ?? (firstCategory ? labelWidth : 8)
          const labelY = presence.cursor?.y ?? firstTask?.y ?? firstCategory?.y ?? 8
          return (
            <g key={`presence-${presence.clientId}`}>
              {model.categories.map((category) =>
                selectedCategories.has(category.id) ? (
                  <rect
                    key={`presence-category-${presence.clientId}-${category.id}`}
                    x={1.5}
                    y={category.y + 1.5}
                    width={contentWidth - 3}
                    height={Math.max(0, category.height - 3)}
                    fill="none"
                    stroke={presence.user.color}
                    strokeWidth={3}
                    strokeDasharray="7 4"
                    opacity={0.75}
                  />
                ) : null,
              )}
              {routed.map((route) =>
                selectedLink === route.id ? (
                  <path
                    key={`presence-link-${presence.clientId}-${route.id}`}
                    d={route.d}
                    fill="none"
                    stroke={presence.user.color}
                    strokeWidth={5}
                    strokeLinecap="round"
                    opacity={0.72}
                  />
                ) : null,
              )}
              {model.tasks.map((task) => {
                if (!selectedTasks.has(task.task.id)) return null
                return task.isMilestone ? (
                  <polygon
                    key={`presence-task-${presence.clientId}-${task.task.id}`}
                    points={diamond(task.cx, task.cy, milestoneR + 5)}
                    fill="none"
                    stroke={presence.user.color}
                    strokeWidth={3}
                    opacity={0.82}
                  />
                ) : (
                  <rect
                    key={`presence-task-${presence.clientId}-${task.task.id}`}
                    x={task.x - 3}
                    y={task.y - 3}
                    width={task.w + 6}
                    height={task.h + 6}
                    rx={5}
                    fill="none"
                    stroke={presence.user.color}
                    strokeWidth={3}
                    opacity={0.82}
                  />
                )
              })}
              {presence.cursor && (
                <g
                  transform={`translate(${presence.cursor.x} ${presence.cursor.y}) scale(${presenceScale})`}
                >
                  <circle
                    cx={0}
                    cy={0}
                    r={5}
                    fill={presence.user.color}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={-9}
                    y1={0}
                    x2={9}
                    y2={0}
                    stroke={presence.user.color}
                    strokeWidth={1.5}
                  />
                  <line
                    x1={0}
                    y1={-9}
                    x2={0}
                    y2={9}
                    stroke={presence.user.color}
                    strokeWidth={1.5}
                  />
                </g>
              )}
              {/* 이름 + 역할(관리자/사용자) 배지 — 줌과 무관하게 항상 크게(관제 가독성).
                  역할 애셋(/presence/*.png)이 없거나 로드 실패해도 색 원 + 이름으로 표시(그레이스풀). */}
              {(() => {
                const isAdmin = presence.user.role === 'admin'
                const roleLabel = isAdmin ? '관리자' : '사용자'
                const asset = isAdmin ? '/presence/admin.png' : '/presence/user.png'
                const pillW = Math.max(104, 46 + presence.user.name.length * 9)
                return (
                  <g transform={`translate(${labelX + 12} ${labelY + 10}) scale(${presenceScale})`}>
                    <rect
                      x={0}
                      y={0}
                      width={pillW}
                      height={38}
                      rx={19}
                      fill="#fff"
                      stroke={presence.user.color}
                      strokeWidth={2.5}
                      opacity={0.98}
                    />
                    <circle
                      cx={19}
                      cy={19}
                      r={15.5}
                      fill={presence.user.color}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                    <image
                      href={asset}
                      x={5}
                      y={5}
                      width={28}
                      height={28}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    <text x={42} y={16} fill={colors.ink} fontSize={13.5} fontWeight={800}>
                      {presence.user.name}
                    </text>
                    <text x={42} y={30} fill={presence.user.color} fontSize={10} fontWeight={700}>
                      {roleLabel}
                    </text>
                  </g>
                )
              })()}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

function laneColor(model: LayoutModel, categoryId: string): string {
  return model.categories.find((c) => c.id === categoryId)?.color ?? colors.bar
}

export const ChartSvg = memo(ChartSvgBase)
