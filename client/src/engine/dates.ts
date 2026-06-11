// Minimal, dependency-free date math. Kept tiny on purpose so the eventual
// Electron `.exe` bundle stays light (no date library needed).
//
// The schedule works in integer "day offsets" from the project start date.
// All calendar conversion funnels through these helpers.

const MS_PER_DAY = 86_400_000

/** Parse a YYYY-MM-DD string into a local Date at midnight. */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Whole-day difference b - a (calendar based, DST-safe). */
export function diffDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / MS_PER_DAY)
}

export function addDays(date: Date, days: number): Date {
  const r = new Date(date)
  r.setDate(r.getDate() + days)
  return r
}

/** Convert a day offset (from project start) to a calendar Date. */
export function dayToDate(startDate: string, dayOffset: number): Date {
  return addDays(parseISO(startDate), dayOffset)
}

/** Convert a calendar Date to a day offset from project start. */
export function dateToDay(startDate: string, date: Date): number {
  return diffDays(parseISO(startDate), date)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

// Recurring (month, day) ↔ day-of-year, using a fixed non-leap reference year so
// rainy-season edges order/clamp consistently regardless of the actual year.
export function monthDayToDoy(month1: number, day: number): number {
  return diffDays(new Date(2001, 0, 1), new Date(2001, month1 - 1, day)) + 1
}
export function doyToMonthDay(doy: number): { month: number; day: number } {
  const d = new Date(2001, 0, 1)
  d.setDate(Math.max(1, Math.min(365, Math.round(doy))))
  return { month: d.getMonth() + 1, day: d.getDate() }
}

export const MONTH_LABELS_KO = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
]

/** Returns true if a given 0-based month index falls inside a recurring band. */
export function monthInRange(monthIndex0: number, startMonth1: number, endMonth1: number): boolean {
  const m = monthIndex0 + 1
  if (startMonth1 <= endMonth1) return m >= startMonth1 && m <= endMonth1
  // wraps year boundary (e.g. Nov..Feb)
  return m >= startMonth1 || m <= endMonth1
}
