// Design tokens distilled from Design.md (Mistral editorial system):
// warm cream/orange/sunset palette, sober editorial geometry, Inter for UI.
// These are the single source of truth for colours used by both the React
// chrome and the SVG chart renderer (so exports match the on-screen look).

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

/** Default palette assigned to new 공종 lanes, cycled by index. */
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
