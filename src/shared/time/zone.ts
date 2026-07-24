/**
 * IANA-timezone conversion between a UTC instant (epoch ms) and local wall-clock parts.
 *
 * The zone database comes from the platform's ICU-backed `Intl.DateTimeFormat`, so this
 * module carries no timezone data of its own and adds no dependency. `Date.UTC` and
 * `formatToParts(epochMs)` are pure (explicit arguments) — there is no ambient-clock
 * read here, which is what `CLAUDE.md` forbids in domain code.
 */

import type { LocalDate } from './civil.ts'

export interface TimeOfDay {
  readonly hour: number
  readonly minute: number
}

export interface ZonedDateTime extends LocalDate {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timeZone, created)
  return created
}

/** Wall-clock parts of an instant, as observed in `timeZone`. */
export function zonedPartsFromInstant(epochMs: number, timeZone: string): ZonedDateTime {
  const parts = formatterFor(timeZone).formatToParts(epochMs)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    if (!part) throw new Error(`Intl emitted no '${type}' part for zone '${timeZone}'`)
    return Number(part.value)
  }
  const rawHour = read('hour')
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: read('minute'),
    second: read('second'),
  }
}

/** The local calendar date of an instant in `timeZone`. */
export function localDateInZone(epochMs: number, timeZone: string): LocalDate {
  const parts = zonedPartsFromInstant(epochMs, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

/** Offset in ms east of UTC at `epochMs` (local-wall-clock-as-UTC minus the instant). */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const z = zonedPartsFromInstant(epochMs, timeZone)
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return asUtc - epochMs
}

/**
 * The instant (epoch ms) at which a local wall-clock time occurs in `timeZone`.
 *
 * Two-pass offset resolution makes this DST-correct: a spring-forward gap resolves
 * forward (the skipped time maps to the post-transition instant); a fall-back overlap
 * resolves to the later instant (standard time).
 */
export function instantFromZoned(date: LocalDate, time: TimeOfDay, timeZone: string): number {
  const naiveUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0)
  const offset1 = zoneOffsetMs(naiveUtc, timeZone)
  const candidate = naiveUtc - offset1
  const offset2 = zoneOffsetMs(candidate, timeZone)
  if (offset2 === offset1) return candidate
  return naiveUtc - offset2
}
