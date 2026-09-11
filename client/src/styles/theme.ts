// Design tokens distilled from Design.md (Mistral editorial system):
// warm cream/orange/sunset palette, sober editorial geometry, Inter for UI.
// These are the single source of truth for colours used by both the React
// chrome and the SVG chart renderer (so exports match the on-screen look).

import type { TextRole, TextStyle } from '../types/model'

export const colors = {
  // Brand & accent (sunset)
  primary: '#FA5111', // saturated brand orange — CTAs, active, critical path
  primaryDeep: '#D2410B',
  sunshine300: '#FFC56B',
  sunshine500: '#FF9D2E',
  sunshine700: '#FB6A18',
  yellow: '#FFD23F',

  // Cream / neutral-warm surfaces
  cream: '#FBF1DF',
  creamSoft: '#FEF8EE',
  creamDeeper: '#F4E3C4',
  beigeDeep: '#E7D3AC',

  // Surfaces
  canvas: '#FFFFFF',
  surface: '#FAF8F4',
  surfaceCode: '#1F1B16',
  hairline: '#ECE6DA',
  hairlineSoft: '#F1ECE2',
  hairlineStrong: '#D9CFBC',

  // Text
  ink: '#1B1712',
  charcoal: '#37322B',
  slate: '#5C5346',
  steel: '#857A68',
  stone: '#A89B85',
  muted: '#BCB19C',
  onPrimary: '#FFFFFF',
  onDark: '#FBF4E6',

  // Semantic
  link: '#FA5111',
  rainyBand: 'rgba(120, 140, 170, 0.16)', // 우기 shaded band
  rainyBandStroke: 'rgba(90, 110, 140, 0.28)',
  critical: '#E12D1B',
  gridLine: '#EFE9DD',
  gridLineStrong: '#E2D9C7',
  yearLine: '#A89B85', // 연도 구분선 — 월/레인 격자보다 진하게(연 단위 주 구획 강조)
  milestone: '#1B1712',
  bar: '#7C93A8',
  barBorder: '#5A6E82',
} as const

// KoPubWorld Dotum_Pro — explicit per-weight families so the chart SVG renders
// (and exports) with the correct face. `bold` for titles & 공종, `medium` for
// everything else. Both fall back to Malgun Gothic when the font is absent.
const KOPUB_MEDIUM = `'KoPubWorld Dotum_Pro Medium', 'KoPubWorldDotum_Pro Medium', 'Malgun Gothic', sans-serif`
const KOPUB_BOLD = `'KoPubWorld Dotum_Pro Bold', 'KoPubWorldDotum_Pro Bold', 'Malgun Gothic', sans-serif`

export const fonts = {
  bold: KOPUB_BOLD,
  medium: KOPUB_MEDIUM,
  display: KOPUB_BOLD,
  ui: `'KoPubWorld Dotum', 'Malgun Gothic', -apple-system, system-ui, sans-serif`,
  mono: `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`,
  chart: KOPUB_MEDIUM,
}

export const radius = {
  xs: 4,
  sm: 6,
  md: 8, // buttons, inputs
  lg: 12, // cards, panels
  xl: 16,
  full: 9999,
}

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
}

/** The signature sunset-stripe gradient (brand continuity element). */
export const sunsetStripe = `linear-gradient(90deg, ${colors.primary} 0%, ${colors.sunshine700} 28%, ${colors.sunshine500} 52%, ${colors.yellow} 76%, ${colors.cream} 100%)`

/** Shared palette for WBS accents and top-level process groups, cycled by index. */
export const lanePalette = [
  '#6E8CA8', // steel blue (토목)
  '#C9803B', // ochre (가물막이)
  '#7FA06A', // green (수로)
  '#9A6FA6', // violet (조절/도류)
  '#C36B6B', // dusty red (감세지)
  '#5E9CA0', // teal (취수)
  '#B08A4F', // bronze (부대공)
  '#8089A8', // slate-violet
]

/** Seed favourites for the 즐겨찾기 palette (exactly 10: 2 rows × 5). */
export const DEFAULT_PALETTE: string[] = [...lanePalette, '#E12D1B', '#2E7D6B']

// ── Per-role chart typography defaults ──────────────────────────────────────
// Every styleable text on the drawing resolves to one of these unless the user
// has overridden it via project.view.textStyles. Sizes are in chart units.

export const TEXT_ROLE_DEFAULTS: Record<TextRole, Required<TextStyle>> = {
  title: { fontSize: 20, fontFamily: KOPUB_BOLD, color: colors.ink },
  categoryLabel: { fontSize: 12, fontFamily: KOPUB_BOLD, color: colors.charcoal },
  subCategoryLabel: { fontSize: 11, fontFamily: KOPUB_MEDIUM, color: colors.slate },
  headerTitle: { fontSize: 14, fontFamily: KOPUB_BOLD, color: colors.charcoal },
  headerSub: { fontSize: 12, fontFamily: KOPUB_MEDIUM, color: colors.steel },
  taskName: { fontSize: 10.5, fontFamily: KOPUB_MEDIUM, color: colors.charcoal },
  taskDuration: { fontSize: 9, fontFamily: KOPUB_MEDIUM, color: colors.steel },
  milestoneName: { fontSize: 13, fontFamily: KOPUB_MEDIUM, color: colors.ink },
  milestoneDate: { fontSize: 9, fontFamily: KOPUB_MEDIUM, color: colors.steel },
  axisYear: { fontSize: 13, fontFamily: KOPUB_MEDIUM, color: colors.ink },
  axisMonth: { fontSize: 10, fontFamily: KOPUB_MEDIUM, color: colors.slate },
  rainyLabel: { fontSize: 10.5, fontFamily: KOPUB_MEDIUM, color: '#46566e' },
}

/** Human-friendly Korean labels for the text-style inspector. */
export const TEXT_ROLE_LABELS: Record<TextRole, string> = {
  title: '도면 제목',
  categoryLabel: '공종 이름',
  subCategoryLabel: '세부공종 이름',
  headerTitle: '좌측 헤더(공종/마일스톤)',
  headerSub: '좌측 헤더(착수)',
  taskName: '공정 이름',
  taskDuration: '공정 기간',
  milestoneName: '마일스톤 이름',
  milestoneDate: '마일스톤 날짜',
  axisYear: '연도 축',
  axisMonth: '월 축',
  rainyLabel: '우기 라벨',
}

/**
 * 화면 전체 맞춤처럼 도면이 크게 축소될 때도 판독해야 하는 최소 화면 글자 크기.
 * 도면/출력의 원래 글자 크기는 유지하고 ChartSvg의 화면 렌더링에만 적용한다.
 */
export const SCREEN_TEXT_MIN_PX: Record<TextRole, number> = {
  title: 11,
  categoryLabel: 9,
  subCategoryLabel: 8,
  headerTitle: 8.5,
  headerSub: 7.5,
  taskName: 8.5,
  taskDuration: 7.5,
  milestoneName: 8.5,
  milestoneDate: 7.5,
  axisYear: 8.5,
  axisMonth: 7.5,
  rainyLabel: 7.5,
}

/**
 * 저배율에서도 읽히도록 화면 글자 크기를 역보정한다(출력물은 data-export-font-size 로 원래
 * 크기를 복원하므로 영향 없음).
 *
 * `maxSize` 는 **행 높이가 허락하는 상한**이다. layout.ts 는 확대 *전* 글자 크기로 행 높이를
 * 잡기 때문에, 상한 없이 키우면 위 행의 공사일수(막대 아래)와 아래 행의 공정명(막대 위)이
 * 같은 띠를 차지해 서로 겹친다. 상한을 줘도 base 아래로는 내리지 않는다 — base 는 layout 이
 * 이미 자리를 확보해 둔 크기라 줄일 이유가 없다.
 */
export function readableScreenTextSize(
  role: TextRole,
  baseSize: number,
  zoom: number,
  maxSize?: number,
): number {
  const wanted = Math.max(baseSize, SCREEN_TEXT_MIN_PX[role] / Math.max(0.02, zoom))
  if (maxSize == null || !Number.isFinite(maxSize)) return wanted
  return Math.max(baseSize, Math.min(wanted, maxSize))
}

/** 글자 크기 대비 실제 <text> 상자 높이 배수(어센더·디센더 포함) — 실측 1.53~1.60. */
export const TEXT_BOX_RATIO = 1.6

/**
 * 한 행이 감당할 수 있는 공정명·공사일수 화면 글자 크기를 정한다.
 *
 * 공정명은 막대 **위**, 공사일수는 막대 **아래**에 놓이므로 이웃한 두 행 사이의 띠에는
 * "위 행의 공사일수 + 아래 행의 공정명"이 함께 들어간다. layout.ts 는 **확대 전** 크기로 행
 * 높이를 잡는데 저배율에서는 화면 글자를 minPx/zoom 으로 키우므로, 상한을 두지 않으면 둘이
 * 겹친다(실측: 48% 배율 TBM 터널 프리셋에서 9~12px 겹침).
 *
 * 둘 다 판독 크기로 들어가면 그대로 두고, 안 되면 **이름을 우선**해 띠 전체를 이름에 주고
 * 공사일수는 화면에서만 감춘다. 공사일수 몫을 남겨 두면 이름까지 판독 크기 아래로 내려가
 * (실측 5.3px) 둘 다 못 읽게 되기 때문이다. 감춘 라벨은 출력에서 되살린다.
 */
export function resolveRowLabelSizes(args: {
  rowHeight: number
  barHeight: number
  nameBase: number
  durationBase: number
  zoom: number
}): { nameSize: number; durationSize: number; showDuration: boolean } {
  const { rowHeight, barHeight, nameBase, durationBase, zoom } = args
  const budget = Math.max(0, rowHeight - barHeight)
  const nameWanted = readableScreenTextSize('taskName', nameBase, zoom)
  const durationWanted = readableScreenTextSize('taskDuration', durationBase, zoom)
  if ((nameWanted + durationWanted) * TEXT_BOX_RATIO <= budget)
    return { nameSize: nameWanted, durationSize: durationWanted, showDuration: true }
  return {
    nameSize: readableScreenTextSize('taskName', nameBase, zoom, budget / TEXT_BOX_RATIO),
    durationSize: durationBase,
    showDuration: false,
  }
}

/** Selectable 글꼴 options for the text-style inspector (export-safe Windows faces). */
export const FONT_FAMILY_OPTIONS: { label: string; value: string }[] = [
  { label: 'KoPub 굵게 (Bold)', value: KOPUB_BOLD },
  { label: 'KoPub 보통 (Medium)', value: KOPUB_MEDIUM },
  { label: '맑은 고딕', value: "'Malgun Gothic', sans-serif" },
  { label: '바탕 (명조)', value: "'Batang', '바탕', serif" },
  { label: '굴림', value: "'Gulim', '굴림', sans-serif" },
  { label: '돋움', value: "'Dotum', '돋움', sans-serif" },
]

/** Resolve a role to its concrete style, merging the user override over the
 *  default. `fontScale` is a global multiplier (1 = design size) so the whole
 *  drawing's text can grow/shrink together to stay legible on a given sheet. */
export function resolveTextStyle(
  role: TextRole,
  overrides?: Partial<Record<TextRole, TextStyle>>,
  fontScale = 1,
): { fontSize: number; fontFamily: string; fill: string; fontWeight: number } {
  const d = TEXT_ROLE_DEFAULTS[role]
  const o = overrides?.[role]
  const fontFamily = (o?.fontFamily && o.fontFamily.trim()) || d.fontFamily
  return {
    fontSize: (o?.fontSize ?? d.fontSize) * (fontScale > 0 ? fontScale : 1),
    fontFamily,
    fill: (o?.color && o.color.trim()) || d.color,
    fontWeight: /Bold/i.test(fontFamily) ? 700 : 500,
  }
}
