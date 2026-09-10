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
//   • 분할 장수 — 최소 글자 크기를 확보하려면 용지 몇 장이 필요한가(engine/paper.ts tilePages)
// ─────────────────────────────────────────────────────────────────────────────

import { computeLayout, type LayoutFilter } from '../engine/layout'
import { paperPx, tilePagesWithFrozen } from '../engine/paper'
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
  taskName: '공정 이름',
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
  /** 실제 출력 장수 — PDF는 최소 글자 크기를 지키기 위해 자동 분할할 수 있다. */
  pages: number
  /** 최소 글자 크기를 확보하려면 필요한 분할 장수(1이면 나눌 필요 없음). */
  legiblePages: number
  legibleCols: number
  legibleRows: number
  /** PDF 자동 분할에서 SVG 좌표를 출력 픽셀로 바꾸는 배율. */
  legibleScale: number
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
  const minFontPt = (minFontPx * drawScale * 72) / px.effectiveDpi

  // 읽을 수 있는 크기(MIN_FONT_PT)로 키우면 도면이 용지를 넘친다 → 몇 장 분할이 필요한가.
  const legibleScale = minFontPt > 0 ? drawScale * Math.max(1, MIN_FONT_PT / minFontPt) : drawScale
  const tiles = tilePagesWithFrozen(
    shown.contentWidth * legibleScale,
    shown.contentHeight * legibleScale,
    px.wPx,
    px.hPx,
    shown.labelWidth * legibleScale,
    shown.chartTop * legibleScale,
  )

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
        format === 'pdf' && tiles.pages > 1
          ? `한 장에 넣으면 가장 작은 글자(${ROLE_LABELS[minFontRoleId]})가 약 ${minFontPt.toFixed(1)}pt라 읽기 어려워 ${paper.size} ${tiles.cols}×${tiles.rows} = ${tiles.pages}장으로 자동 분할합니다.`
          : `용지에서 가장 작은 글자(${ROLE_LABELS[minFontRoleId]})가 약 ${minFontPt.toFixed(1)}pt로 인쇄됩니다 — 글자 크기를 키우거나 더 큰 용지를 고르세요.`,
      )
    if (marginPct > 5)
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
    pages: format === 'pdf' ? tiles.pages : 1,
    legiblePages: tiles.pages,
    legibleCols: tiles.cols,
    legibleRows: tiles.rows,
    legibleScale,
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
