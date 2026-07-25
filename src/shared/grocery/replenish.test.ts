import { describe, expect, it } from 'vitest'
import { instantFromZoned } from '../time/zone.ts'
import { analyzeReplenishment, MIN_PURCHASES } from './replenish.ts'

const AMS = 'Europe/Amsterdam'
const day = (y: number, m: number, d: number): number =>
  instantFromZoned({ year: y, month: m, day: d }, { hour: 12, minute: 0 }, AMS)

describe('analyzeReplenishment', () => {
  it('returns null below the minimum purchase count', () => {
    const purchases = [day(2025, 7, 1), day(2025, 7, 6)] // only 2
    expect(analyzeReplenishment({ now: day(2025, 7, 20), timeZone: AMS, purchases })).toBeNull()
    expect(MIN_PURCHASES).toBe(3)
  })

  it('flags an item due for restock at its median cadence', () => {
    const purchases = [day(2025, 7, 1), day(2025, 7, 6), day(2025, 7, 11)] // every 5 days
    const s = analyzeReplenishment({ now: day(2025, 7, 16), timeZone: AMS, purchases })
    expect(s?.evidence).toEqual({ purchaseCount: 3, medianDays: 5, daysSince: 5 })
    expect(s?.explanation).toContain('every 5 days')
    expect(s?.explanation).toContain('5 days ago')
  })

  it('stays quiet when the item is not due yet', () => {
    const purchases = [day(2025, 7, 1), day(2025, 7, 6), day(2025, 7, 11)]
    // only 3 days since last, median 5
    expect(analyzeReplenishment({ now: day(2025, 7, 14), timeZone: AMS, purchases })).toBeNull()
  })

  it('uses the median so one long gap does not skew the cadence', () => {
    // gaps: 5, 5, 30 → median 5, not the mean (~13)
    const purchases = [day(2025, 6, 1), day(2025, 6, 6), day(2025, 6, 11), day(2025, 7, 11)]
    const s = analyzeReplenishment({ now: day(2025, 7, 17), timeZone: AMS, purchases })
    expect(s?.evidence.medianDays).toBe(5)
  })

  it('measures gaps in whole calendar days across a DST change', () => {
    // Amsterdam springs forward 30 Mar 2025. 5-day-spaced buys straddling it stay 5-day gaps.
    const purchases = [day(2025, 3, 24), day(2025, 3, 29), day(2025, 4, 3)]
    const s = analyzeReplenishment({ now: day(2025, 4, 8), timeZone: AMS, purchases })
    expect(s?.evidence).toEqual({ purchaseCount: 3, medianDays: 5, daysSince: 5 })
  })

  it('ignores degenerate same-day repeats', () => {
    const purchases = [day(2025, 7, 1), day(2025, 7, 1), day(2025, 7, 1)]
    expect(analyzeReplenishment({ now: day(2025, 7, 10), timeZone: AMS, purchases })).toBeNull()
  })
})
