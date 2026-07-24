/**
 * Pure proleptic-Gregorian calendar arithmetic over `{year, month, day}`.
 *
 * No clock, no timezone, no `Date.now()`/`new Date()` — every function is total and
 * deterministic. Based on Howard Hinnant's `days_from_civil` / `civil_from_days`.
 * Day-of-month and month are 1-based.
 */

export interface LocalDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Days since 1970-01-01 for a civil date (negative before the epoch). */
export function daysFromCivil(date: LocalDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year
  const era = Math.floor((y >= 0 ? y : y - 399) / 400)
  const yoe = y - era * 400
  const mp = (date.month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + date.day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Inverse of {@link daysFromCivil}. */
export function civilFromDays(days: number): LocalDate {
  const z = days + 719468
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = month <= 2 ? y + 1 : y
  return { year, month, day }
}

/** Add (or subtract) whole calendar days. DST-safe because it is pure calendar math. */
export function addDays(date: LocalDate, days: number): LocalDate {
  return civilFromDays(daysFromCivil(date) + days)
}

/** -1, 0, or 1 for `a` before / same / after `b` by calendar position. */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  const diff = daysFromCivil(a) - daysFromCivil(b)
  return diff === 0 ? 0 : diff < 0 ? -1 : 1
}

/** The later of two dates. */
export function maxLocalDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareLocalDate(a, b) >= 0 ? a : b
}

export function isoWeekday(date: LocalDate): IsoWeekday {
  const dow = (((daysFromCivil(date) + 3) % 7) + 7) % 7
  return (dow + 1) as IsoWeekday
}

export function daysInMonth(year: number, month: number): number {
  const first: LocalDate = { year, month, day: 1 }
  const next: LocalDate =
    month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }
  return daysFromCivil(next) - daysFromCivil(first)
}

/** `YYYY-MM-DD`, zero-padded. */
export function isoDate(date: LocalDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${date.year}-${month}-${day}`
}
