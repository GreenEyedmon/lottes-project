import { describe, expect, it } from 'vitest'
import {
  addDays,
  civilFromDays,
  compareLocalDate,
  daysFromCivil,
  daysInMonth,
  isoDate,
  isoWeekday,
  maxLocalDate,
} from './civil.ts'

describe('daysFromCivil / civilFromDays', () => {
  it('anchors the Unix epoch at 0', () => {
    expect(daysFromCivil({ year: 1970, month: 1, day: 1 })).toBe(0)
  })

  it('round-trips a spread of dates, including leap day and boundaries', () => {
    const dates = [
      { year: 1970, month: 1, day: 1 },
      { year: 2000, month: 2, day: 29 },
      { year: 2024, month: 2, day: 29 },
      { year: 2025, month: 7, day: 1 },
      { year: 2025, month: 12, day: 31 },
      { year: 1999, month: 12, day: 31 },
      { year: 2100, month: 3, day: 1 },
    ]
    for (const d of dates) {
      expect(civilFromDays(daysFromCivil(d))).toEqual(d)
    }
  })
})

describe('addDays', () => {
  it('crosses a leap-year February', () => {
    expect(addDays({ year: 2024, month: 2, day: 28 }, 1)).toEqual({ year: 2024, month: 2, day: 29 })
    expect(addDays({ year: 2025, month: 2, day: 28 }, 1)).toEqual({ year: 2025, month: 3, day: 1 })
  })

  it('crosses a year boundary in both directions', () => {
    expect(addDays({ year: 2024, month: 12, day: 31 }, 1)).toEqual({ year: 2025, month: 1, day: 1 })
    expect(addDays({ year: 2025, month: 1, day: 1 }, -1)).toEqual({
      year: 2024,
      month: 12,
      day: 31,
    })
  })

  it('is the inverse of itself', () => {
    const d = { year: 2025, month: 7, day: 24 }
    expect(addDays(addDays(d, 40), -40)).toEqual(d)
  })
})

describe('isoWeekday', () => {
  it('maps known dates (Mon=1 … Sun=7)', () => {
    expect(isoWeekday({ year: 1970, month: 1, day: 1 })).toBe(4) // Thursday
    expect(isoWeekday({ year: 2025, month: 7, day: 1 })).toBe(2) // Tuesday
    expect(isoWeekday({ year: 2025, month: 7, day: 6 })).toBe(7) // Sunday
    expect(isoWeekday({ year: 2025, month: 7, day: 7 })).toBe(1) // Monday
  })
})

describe('daysInMonth', () => {
  it('handles 28/29/30/31', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2025, 2)).toBe(28)
    expect(daysInMonth(2025, 4)).toBe(30)
    expect(daysInMonth(2025, 1)).toBe(31)
    expect(daysInMonth(2025, 12)).toBe(31)
  })
})

describe('compareLocalDate / maxLocalDate', () => {
  it('orders dates', () => {
    const a = { year: 2025, month: 7, day: 1 }
    const b = { year: 2025, month: 7, day: 2 }
    expect(compareLocalDate(a, b)).toBe(-1)
    expect(compareLocalDate(b, a)).toBe(1)
    expect(compareLocalDate(a, a)).toBe(0)
    expect(maxLocalDate(a, b)).toEqual(b)
    expect(maxLocalDate(b, a)).toEqual(b)
  })
})

describe('isoDate', () => {
  it('zero-pads', () => {
    expect(isoDate({ year: 2025, month: 7, day: 1 })).toBe('2025-07-01')
    expect(isoDate({ year: 2025, month: 12, day: 9 })).toBe('2025-12-09')
  })
})
