// ─────────────────────────────────────────────────────────────────────────────
// 출력 사전 점검(preflight) — "지금 누르면 무엇이 어떻게 나오는가"를 출력 전에
// 결정적으로 계산한다. DOM 에 의존하지 않는 순수 모듈이라 헤드리스 스모크
// (scripts/export-smoke.ts)에서 그대로 실행·검증할 수 있다.
//
// 점검 항목
//   • 출력 범위 — 전체 도면 / 현재 표시 범위(필터 적용)에 따라 실제로 들어가는 공정 수
//   • 표시 OFF(숨김) — 범위와 무관하게 항상 빠지는 공종·공정 수(사용자가 모르고 넘어가지 않게)
//   • 표시 기간 제한 — view.displayStart/displayEnd 로 잘려나가는 구간
//   • 용지 위 최소 글자 크기(pt) — 너무 작으면 인쇄물에서 읽히지 않는다
//   • 레터박스 여백 비율 — 출력 엔진은 잘라내지 않고 축소·중앙배치하므로 '잘림'이 아니라 '여백'
//   • 분할 장수 — 기본은 한 장(전체 도면을 용지 안에 축소). 사용자가 2·4분할을 고른 PDF만 나눈다
// ─────────────────────────────────────────────────────────────────────────────

import { computeLayout, type LayoutFilter } from '../engine/layout'
import { paperPx } from '../engine/paper'
import { computeSchedule } from '../engine/scheduling'
import { resolveTextStyle } from '../styles/theme'
import type { PaperSettings, Project, TextRole } from '../types/model'
import type { ExportFormat } from './exporter'

/** 출력 범위 — 전체 도면 / 화면에 지금 보이는 범위(필터 적용). */
export type ExportScope = 'full' | 'view'

export const SCOPE_LABELS: Record<ExportScope, string> = {
  full: '전체 도면',
  view: '현재 표시 범위',
}

/** PDF 분할 장수 — 1 = 전체 도면을 한 장에(기본). 2·4 는 사용자가 고른 경우에만. */
export type PdfSplit = 1 | 2 | 4

/**
 * N장 분할 배치 — 매 장에 좌측 WBS 열과 상단 헤더를 반복하고, 본문을 cols×rows 로 나눈다.
 * 가능한 배치(2장: 2×1·1×2 / 4장: 4×1·2×2·1×4) 중 도면이 가장 크게 찍히는 것을 고른다.
 * scale = 도면 좌표 → 출력 픽셀 배율(그 배율에서 모든 조각이 용지 안에 들어간다).
 */
export function pdfSplitPlan(
  m: { contentWidth: number; contentHeight: number; labelWidth: number; chartTop: number },
  pageW: number,
  pageH: number,
  split: PdfSplit,
): { cols: number; rows: number; scale: number } {
  if (split === 1)
    return { cols: 1, rows: 1, scale: Math.min(pageW / m.contentWidth, pageH / m.contentHeight) }
  const bodyW = Math.max(1, m.contentWidth - m.labelWidth)
  const bodyH = Math.max(1, m.contentHeight - m.chartTop)
  let best = { cols: split as number, rows: 1, scale: 0 }
  for (let cols = 1; cols <= split; cols++) {
    if (split % cols) continue
    const rows = split / cols
    const scale = Math.min(pageW / (m.labelWidth + bodyW / cols), pageH / (m.chartTop + bodyH / rows))
    if (scale > best.scale) best = { cols, rows, scale }
  }
  return best
}

/** 인쇄물에서 읽을 수 있다고 보는 최소 글자 크기(pt). 이보다 작으면 경고. */
export const MIN_FONT_PT = 6

/** 도면에 실제로 그려지는 텍스트 역할 — 최소 글자 크기는 이 중에서 고른다. */
const DRAWN_ROLES: TextRole[] = [
  'title',
  'categoryLabel',
  'subCategoryLabel',
  'headerTitle',
  'headerSub',
  'taskName',
  'taskLabel',
  'taskDuration',
  'milestoneName',
  'milestoneDate',
  'axisYear',
  'axisMonth',
  'rainyLabel',
]

const ROLE_LABELS: Record<TextRole, string> = {
  title: '도면 제목',
  categoryLabel: '공종 이름',
  subCategoryLabel: '세부공종 이름',
  headerTitle: '좌측 헤더',
  headerSub: '좌측 헤더(착수)',
  taskName: '차트 공정 이름',
  taskLabel: '왼쪽 표 공정 이름',
  taskDuration: '공정 기간',
  milestoneName: '마일스톤 이름',
  milestoneDate: '마일스톤 날짜',
  axisYear: '연도 축',
  axisMonth: '월 축',
  rainyLabel: '우기 라벨',
}

export interface PreflightInput {
  project: Project
  filter: LayoutFilter
  scope: ExportScope
  paper: PaperSettings
  format: ExportFormat
  /** PDF 분할 장수(기본 1 = 한 장). PDF 가 아니면 무시. */
  split?: PdfSplit
}

export interface PreflightResult {
  /** '전체 도면' | '현재 표시 범위' */
  scopeLabel: string
  /** 출력되는 시트 이름(출력은 항상 활성 시트 1장). */
  sheetName: string
  /** 이번 출력에 실제로 들어가는 공정 수. */
  taskCount: number
  /** 필터 때문에 빠지는 공정 수(scope='full' 이면 0). */
  filteredOut: number
  /** 표시 OFF 로 빠지는 공종+공정 수(범위와 무관하게 항상 제외). */
  hiddenCount: number
  /** 표시 OFF 공종 수 / 공정 수 세부. */
  hiddenCategories: number
  hiddenTasks: number
  /** view.displayStart/displayEnd 로 기간이 고정되어 있는가. */
  rangeLimited: boolean
  /** '2026-03 ~ 2027-02' (제한이 있을 때만). */
  rangeLabel?: string
  /** 레터박스 여백 비율(%) — 용지 면적 중 도면이 덮지 않는 비율. */
  marginPct: number
  /** 용지 위에서 가장 작게 인쇄되는 글자 크기(pt). */
  minFontPt: number
  /** 그 글자가 어떤 역할인지(한국어). */
  minFontRole: string
  /** 실제 출력 장수 — 기본 1. PDF 에서 사용자가 2·4분할을 고른 경우에만 늘어난다. */
  pages: number
  /** 분할 배치(가로 조각 × 세로 조각). 한 장이면 1×1. */
  splitCols: number
  splitRows: number
  /** SVG 좌표를 출력 픽셀로 바꾸는 배율(한 장이면 용지에 맞춘 축소 배율). */
  splitScale: number
  /** PDF 각 장에 반복할 좌측 WBS·상단 축 영역(도면 좌표). */
  frozenLabelWidth: number
  frozenHeaderHeight: number
  frozenTitleHeight: number
  /** 출력 픽셀 크기(용량 보호로 DPI 가 낮춰졌으면 clamped=true). */
  outPx: { w: number; h: number; dpi: number; clamped: boolean }
  /** 미해결 일정 문제(순환 의존성 등) 건수 — 0 이 아니면 이 도면의 준공일·주공정은 잠정. */
  unresolvedProblems: number
  /** unresolvedProblems > 0 과 동치. 확정본으로 배포하면 안 되는 상태. */
  provisional: boolean
  /** 사람이 읽는 한국어 경고 문장(비어 있으면 이상 없음). */
  warnings: string[]
}

const filterOn = (f: LayoutFilter): boolean =>
  !!f && (f.critical || f.milestone || f.query.trim() !== '')

/** 출력 직전 점검 결과. 순수 함수 — 같은 입력이면 항상 같은 결과. */
export function exportPreflight(i: PreflightInput): PreflightResult {
  const { project, filter, scope, paper, format } = i
  const vector = format === 'svg' || format === 'dxf'

  // 전체 도면은 화면에서 임시로 늘려 둔 표시 기간을 버리고 실제 공정 데이터 범위만 쓴다.
  const fullProject: Project = {
    ...project,
    view: { ...project.view, displayStart: undefined, displayEnd: undefined },
  }
  const full = computeLayout(fullProject)
  const shown =
    scope === 'view'
      ? filterOn(filter)
        ? computeLayout(project, filter)
        : computeLayout(project)
      : full

  const hiddenCategories = project.categories.filter((c) => c.hidden).length
  const hiddenTasks = project.tasks.filter((t) => t.hidden).length

  const px = paperPx(paper)
  // 출력 엔진(export/exporter.ts rasterize)은 잘라내지 않고 비율 유지 축소 + 중앙배치.
  const drawScale = Math.min(px.wPx / shown.contentWidth, px.hPx / shown.contentHeight)
  const drawW = shown.contentWidth * drawScale
  const drawH = shown.contentHeight * drawScale
  const marginPct = Math.max(0, Math.round((1 - (drawW * drawH) / (px.wPx * px.hPx)) * 100))

  // 도면 좌표계의 글자 크기 → 용지 위 물리 크기(pt). px = 출력 픽셀, 1pt = 1/72 inch.
  const fontScale = project.view.fontScale ?? 1
  let minFontRoleId: TextRole = DRAWN_ROLES[0]
  let minFontPx = Number.POSITIVE_INFINITY
  for (const role of DRAWN_ROLES) {
    const size = resolveTextStyle(role, project.view.textStyles, fontScale).fontSize
    if (Number.isFinite(size) && size > 0 && size < minFontPx) {
      minFontPx = size
      minFontRoleId = role
    }
  }
  if (!Number.isFinite(minFontPx)) minFontPx = 0
  // 기본은 전체 도면을 한 장에 넣는다(작업한 그대로, 잘림 없음). 글자가 작아져도 자동으로
  // 나누지 않는다 — 나누는 것은 사용자가 2·4분할을 고른 PDF 뿐이다.
  const tiles = pdfSplitPlan(shown, px.wPx, px.hPx, format === 'pdf' ? (i.split ?? 1) : 1)
  const pages = tiles.cols * tiles.rows
  const minFontPt = (minFontPx * tiles.scale * 72) / px.effectiveDpi

  const ds = project.view.displayStart
  const de = project.view.displayEnd
  const rangeLimited = scope === 'view' && !!(ds && de)

  const warnings: string[] = []
  const sheetName = project.activeSheet?.name ?? project.name ?? '(이름 없음)'
  const filteredOut = Math.max(0, full.tasks.length - shown.tasks.length)

  // 미해결 일정 문제(순환 의존성)가 남아 있으면 이 도면의 준공일·주공정은 '잠정' 산정이다.
  // 출력물은 결재·배포로 이어지므로 **가장 먼저** 알린다(상태바 문제 목록에서 해결 가능).
  const unresolvedProblems = computeSchedule(project.tasks, project.links).problems.length
  if (unresolvedProblems > 0)
    warnings.push(
      `미해결 일정 문제 ${unresolvedProblems}건(순환 의존성)이 남아 있어 준공일·주공정이 ‘잠정’ 산정입니다 — 상태표시줄의 문제 목록에서 해결한 뒤 확정본을 출력하세요.`,
    )

  if (scope === 'view' && filteredOut > 0)
    warnings.push(
      `현재 필터로 ${filteredOut}개 공정이 빠진 상태로 출력됩니다 — 전체가 필요하면 ‘전체 도면’을 고르세요.`,
    )
  if (scope === 'full' && filterOn(filter))
    warnings.push('화면에는 필터가 걸려 있지만 ‘전체 도면’이 출력됩니다(필터는 출력에 반영 안 됨).')
  if (hiddenCategories + hiddenTasks > 0)
    warnings.push(
      `표시 OFF 항목(공종 ${hiddenCategories} · 공정 ${hiddenTasks})은 출력 범위와 무관하게 제외됩니다 — 왼쪽 목록의 표시 스위치로 되살립니다.`,
    )
  if (rangeLimited) warnings.push(`표시 기간(${ds} ~ ${de})으로 제한된 구간만 출력됩니다.`)
  if (!vector) {
    if (minFontPt > 0 && minFontPt < MIN_FONT_PT)
      warnings.push(
        format === 'pdf'
          ? `용지에서 가장 작은 글자(${ROLE_LABELS[minFontRoleId]})가 약 ${minFontPt.toFixed(1)}pt로 인쇄됩니다 — 글자 크기를 키우거나, 더 큰 용지 또는 더 많은 분할을 고르세요.`
          : `용지에서 가장 작은 글자(${ROLE_LABELS[minFontRoleId]})가 약 ${minFontPt.toFixed(1)}pt로 인쇄됩니다 — 글자 크기를 키우거나 더 큰 용지를 고르세요.`,
      )
    if (pages === 1 && marginPct > 5)
      warnings.push(
        `도면 비율이 용지와 달라 약 ${marginPct}%가 여백으로 남습니다 — 아래 [여백 없이 시트에 맞추기]로 채울 수 있습니다(출력은 잘리지 않고 축소됩니다).`,
      )
    if (px.clamped)
      warnings.push(
        `용량 보호를 위해 해상도가 ${px.effectiveDpi}dpi로 자동 조정됩니다 — 더 높은 DPI가 필요하면 용지를 줄이세요.`,
      )
  }
  if (shown.tasks.length === 0)
    warnings.push('이 범위에 출력할 공정이 하나도 없습니다 — 필터나 표시 스위치를 확인하세요.')

  return {
    scopeLabel: SCOPE_LABELS[scope],
    sheetName,
    taskCount: shown.tasks.length,
    filteredOut: scope === 'full' ? 0 : filteredOut,
    hiddenCount: hiddenCategories + hiddenTasks,
    hiddenCategories,
    hiddenTasks,
    rangeLimited,
    rangeLabel: rangeLimited ? `${ds} ~ ${de}` : undefined,
    marginPct,
    minFontPt,
    minFontRole: ROLE_LABELS[minFontRoleId],
    pages,
    splitCols: tiles.cols,
    splitRows: tiles.rows,
    splitScale: tiles.scale,
    frozenLabelWidth: shown.labelWidth,
    frozenHeaderHeight: shown.chartTop,
    frozenTitleHeight: shown.titleHeight,
    outPx: { w: px.wPx, h: px.hPx, dpi: px.effectiveDpi, clamped: px.clamped },
    unresolvedProblems,
    provisional: unresolvedProblems > 0,
    warnings,
  }
}

/** 실패했을 때 사용자가 그대로 복사해 전달할 수 있는 진단 텍스트(한국어 라벨). */
export function exportDiagnostics(i: PreflightInput, err?: unknown): string {
  const pre = exportPreflight(i)
  const e = err as { message?: string; stack?: string } | undefined
  const lines = [
    '── Sequence 도면 출력 진단 ──',
    `시각: ${new Date().toISOString()}`,
    `사업명: ${i.project.name}`,
    `시트: ${pre.sheetName}`,
    `형식: ${i.format}`,
    `출력 범위: ${pre.scopeLabel}`,
    `용지: ${i.paper.size} ${i.paper.orientation === 'landscape' ? '가로' : '세로'}`,
    `DPI(요청/실제): ${i.paper.dpi} / ${pre.outPx.dpi}${pre.outPx.clamped ? ' (자동 축소됨)' : ''}`,
    `출력 픽셀: ${pre.outPx.w} × ${pre.outPx.h}`,
    `공정 수: ${pre.taskCount} (필터 제외 ${pre.filteredOut} · 표시 OFF ${pre.hiddenCount})`,
    `미해결 일정 문제: ${pre.unresolvedProblems}건${pre.provisional ? ' (잠정 산정)' : ''}`,
    `최소 글자: ${pre.minFontPt.toFixed(2)}pt (${pre.minFontRole}) · 여백 ${pre.marginPct}%`,
    `표시 기간: ${pre.rangeLabel ?? '자동(데이터 범위)'}`,
    `브라우저: ${typeof navigator !== 'undefined' ? navigator.userAgent : '-'}`,
    `오류: ${e?.message ?? '(없음)'}`,
  ]
  if (e?.stack) lines.push(`스택: ${e.stack.split('\n').slice(0, 4).join(' | ')}`)
  return lines.join('\n')
}
