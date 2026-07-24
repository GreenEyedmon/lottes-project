import { describe, expect, it } from 'vitest'
import { CATALOG, describeRecurrence } from './catalog.ts'

describe('describeRecurrence', () => {
  it('labels the MVP modes', () => {
    expect(describeRecurrence({ mode: 'fixedWeekly', weekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe(
      'Every day',
    )
    expect(describeRecurrence({ mode: 'fixedWeekly', weekdays: [6] })).toBe('Sat')
    expect(describeRecurrence({ mode: 'fixedWeekly', weekdays: [3, 6] })).toBe('Wed, Sat')
    expect(describeRecurrence({ mode: 'completionRelative', everyDays: 14 })).toBe(
      'Every 14 days (after done)',
    )
  })
})

describe('CATALOG', () => {
  it('only uses implemented recurrence modes and has positive effort', () => {
    for (const pack of CATALOG) {
      for (const item of pack.items) {
        expect(item.recurrence.mode).not.toBe('frequencyTarget')
        expect(item.estimatedEffortMinutes).toBeGreaterThan(0)
      }
    }
  })
})
