import { describe, expect, it } from 'vitest'
import { instantFromZoned, localDateInZone, zonedPartsFromInstant } from './zone.ts'

const AMS = 'Europe/Amsterdam'

describe('zonedPartsFromInstant', () => {
  it('reads UTC parts of the epoch', () => {
    expect(zonedPartsFromInstant(0, 'UTC')).toEqual({
      year: 1970,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('shifts the epoch back five hours in winter New York', () => {
    expect(zonedPartsFromInstant(0, 'America/New_York')).toEqual({
      year: 1969,
      month: 12,
      day: 31,
      hour: 19,
      minute: 0,
      second: 0,
    })
  })
})

describe('instantFromZoned', () => {
  it('applies a summer +2 offset in Amsterdam', () => {
    const instant = instantFromZoned({ year: 2025, month: 7, day: 1 }, { hour: 18, minute: 0 }, AMS)
    expect(instant).toBe(Date.UTC(2025, 6, 1, 16, 0, 0))
  })

  it('round-trips a local wall-clock time', () => {
    const local = { year: 2025, month: 7, day: 1 }
    const instant = instantFromZoned(local, { hour: 18, minute: 30 }, AMS)
    const parts = zonedPartsFromInstant(instant, AMS)
    expect(parts).toEqual({ year: 2025, month: 7, day: 1, hour: 18, minute: 30, second: 0 })
    expect(localDateInZone(instant, AMS)).toEqual(local)
  })
})

describe('instantFromZoned across DST', () => {
  it('keeps offsets correct either side of spring-forward (2025-03-30, +1 → +2)', () => {
    const before = instantFromZoned({ year: 2025, month: 3, day: 30 }, { hour: 1, minute: 0 }, AMS)
    const after = instantFromZoned({ year: 2025, month: 3, day: 30 }, { hour: 4, minute: 0 }, AMS)
    expect(before).toBe(Date.UTC(2025, 2, 30, 0, 0, 0)) // 01:00 local, +1
    expect(after).toBe(Date.UTC(2025, 2, 30, 2, 0, 0)) // 04:00 local, +2
  })

  it('resolves a skipped spring-forward time forward', () => {
    // 02:30 does not exist (clocks jump 02:00 → 03:00); it maps to 03:30 local.
    const instant = instantFromZoned(
      { year: 2025, month: 3, day: 30 },
      { hour: 2, minute: 30 },
      AMS,
    )
    expect(instant).toBe(Date.UTC(2025, 2, 30, 1, 30, 0))
    expect(zonedPartsFromInstant(instant, AMS)).toMatchObject({ hour: 3, minute: 30 })
  })

  it('resolves an ambiguous fall-back time to the later instant (2025-10-26)', () => {
    // 02:30 occurs twice; we choose the later (standard time, +1) instant.
    const instant = instantFromZoned(
      { year: 2025, month: 10, day: 26 },
      { hour: 2, minute: 30 },
      AMS,
    )
    expect(instant).toBe(Date.UTC(2025, 9, 26, 1, 30, 0))
    expect(zonedPartsFromInstant(instant, AMS)).toMatchObject({ hour: 2, minute: 30 })
  })

  it('adds a 14-day interval that survives spring-forward at the same wall time', () => {
    // 08:00 local before and after the 2025-03-30 transition stays 08:00 local.
    const start = instantFromZoned({ year: 2025, month: 3, day: 24 }, { hour: 8, minute: 0 }, AMS)
    const plus14 = instantFromZoned({ year: 2025, month: 4, day: 7 }, { hour: 8, minute: 0 }, AMS)
    // The raw instant gap is 14 days minus the hour lost to DST.
    expect(plus14 - start).toBe(14 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)
    expect(zonedPartsFromInstant(plus14, AMS)).toMatchObject({ hour: 8, minute: 0 })
  })
})
