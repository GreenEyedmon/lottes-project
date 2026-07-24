import { describe, expect, it } from 'vitest'
import { isoDate } from '../time/civil.ts'
import { instantFromZoned } from '../time/zone.ts'
import { generateUpTo, nextSlotAfter } from './recurrence.ts'
import type { ChoreOccurrence, ChoreTemplate, RecurrenceRule } from './types.ts'

const AMS = 'Europe/Amsterdam'

const at = (y: number, m: number, d: number, h = 9, min = 0): number =>
  instantFromZoned({ year: y, month: m, day: d }, { hour: h, minute: min }, AMS)

function template(overrides: Partial<ChoreTemplate> = {}): ChoreTemplate {
  return {
    id: 't1',
    householdId: 'h1',
    recurrence: { mode: 'fixedWeekly', weekdays: [2] },
    missedPolicy: 'collapse',
    status: 'active',
    startDate: { year: 2025, month: 7, day: 1 },
    ...overrides,
  }
}

function occ(
  overrides: Partial<ChoreOccurrence> & { dueDate: ChoreOccurrence['dueDate'] },
): ChoreOccurrence {
  const { dueDate } = overrides
  return {
    id: 'o1',
    householdId: 'h1',
    templateId: 't1',
    dueInstant: at(dueDate.year, dueDate.month, dueDate.day),
    state: 'scheduled',
    generationKey: `t1:${isoDate(dueDate)}`,
    ...overrides,
  }
}

const dates = (seeds: { dueDate: ChoreTemplate['startDate'] }[]): string[] =>
  seeds.map((s) => isoDate(s.dueDate))

describe('nextSlotAfter', () => {
  const start = { year: 2025, month: 7, day: 1 }

  it('fixedWeekly finds the next matching weekday, strictly after', () => {
    const rule: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [2] }
    expect(nextSlotAfter(rule, { year: 2025, month: 7, day: 1 }, start)).toEqual({
      year: 2025,
      month: 7,
      day: 8,
    })
    expect(nextSlotAfter(rule, { year: 2025, month: 6, day: 30 }, start)).toEqual({
      year: 2025,
      month: 7,
      day: 1,
    })
  })

  it('fixedWeekly honours a multi-week interval anchored to startDate', () => {
    const rule: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [2], interval: 2 }
    // "On" Tuesdays are 07-01, 07-15, 07-29; the one after 07-01 is 07-15.
    expect(nextSlotAfter(rule, { year: 2025, month: 7, day: 1 }, start)).toEqual({
      year: 2025,
      month: 7,
      day: 15,
    })
  })

  it('fixedMonthly finds the next matching day of month', () => {
    const rule: RecurrenceRule = { mode: 'fixedMonthly', dayOfMonth: 1 }
    expect(nextSlotAfter(rule, { year: 2025, month: 7, day: 15 }, start)).toEqual({
      year: 2025,
      month: 8,
      day: 1,
    })
  })

  it('fixedMonthly clamps to the last day of short months', () => {
    const rule: RecurrenceRule = { mode: 'fixedMonthly', dayOfMonth: 31 }
    expect(nextSlotAfter(rule, { year: 2025, month: 1, day: 15 }, start)).toEqual({
      year: 2025,
      month: 1,
      day: 31,
    })
    expect(nextSlotAfter(rule, { year: 2025, month: 1, day: 31 }, start)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    })
  })

  it('returns null for non-calendar modes', () => {
    expect(nextSlotAfter({ mode: 'completionRelative', everyDays: 14 }, start, start)).toBeNull()
    expect(nextSlotAfter({ mode: 'frequencyTarget', timesPerWeek: 2 }, start, start)).toBeNull()
  })
})

describe('generateUpTo — fixed calendar, collapse (one at a time)', () => {
  it('generates a single next occurrence from a fresh template', () => {
    const seeds = generateUpTo(template(), {
      fromInstant: at(2025, 7, 1),
      horizonDays: 28,
      timeZone: AMS,
      existing: [],
    })
    expect(dates(seeds)).toEqual(['2025-07-01'])
    expect(seeds[0]?.dueInstant).toBe(at(2025, 7, 1, 9, 0))
    expect(seeds[0]?.generationKey).toBe('t1:2025-07-01')
  })

  it('generates nothing while an open occurrence already exists', () => {
    const seeds = generateUpTo(template(), {
      fromInstant: at(2025, 7, 1),
      horizonDays: 28,
      timeZone: AMS,
      existing: [occ({ dueDate: { year: 2025, month: 7, day: 8 } })],
    })
    expect(seeds).toEqual([])
  })
})

describe('generateUpTo — fixed calendar, keep (materialize the window)', () => {
  it('generates every slot up to the horizon', () => {
    const seeds = generateUpTo(template({ missedPolicy: 'keep' }), {
      fromInstant: at(2025, 7, 1),
      horizonDays: 21,
      timeZone: AMS,
      existing: [],
    })
    expect(dates(seeds)).toEqual(['2025-07-01', '2025-07-08', '2025-07-15', '2025-07-22'])
  })

  it('skips slots that already exist (dedup by generationKey)', () => {
    const seeds = generateUpTo(template({ missedPolicy: 'keep' }), {
      fromInstant: at(2025, 7, 1),
      horizonDays: 21,
      timeZone: AMS,
      existing: [occ({ id: 'x', dueDate: { year: 2025, month: 7, day: 8 }, state: 'completed' })],
    })
    expect(dates(seeds)).toEqual(['2025-07-01', '2025-07-15', '2025-07-22'])
  })
})

describe('generateUpTo — completion-relative', () => {
  const relative = template({ recurrence: { mode: 'completionRelative', everyDays: 14 } })

  it('starts at startDate when never completed', () => {
    const seeds = generateUpTo(relative, {
      fromInstant: at(2025, 7, 1),
      horizonDays: 28,
      timeZone: AMS,
      existing: [],
    })
    expect(dates(seeds)).toEqual(['2025-07-01'])
  })

  it('schedules the next from the last completion date', () => {
    const seeds = generateUpTo(relative, {
      fromInstant: at(2025, 7, 5),
      horizonDays: 28,
      timeZone: AMS,
      existing: [],
      lastCompletionDate: { year: 2025, month: 7, day: 5 },
    })
    expect(dates(seeds)).toEqual(['2025-07-19'])
  })

  it('never stacks a second open occurrence', () => {
    const seeds = generateUpTo(relative, {
      fromInstant: at(2025, 7, 5),
      horizonDays: 28,
      timeZone: AMS,
      existing: [occ({ dueDate: { year: 2025, month: 7, day: 1 } })],
      lastCompletionDate: { year: 2025, month: 7, day: 5 },
    })
    expect(seeds).toEqual([])
  })

  it('stays within the horizon', () => {
    const seeds = generateUpTo(
      template({ recurrence: { mode: 'completionRelative', everyDays: 60 } }),
      {
        fromInstant: at(2025, 7, 5),
        horizonDays: 28,
        timeZone: AMS,
        existing: [],
        lastCompletionDate: { year: 2025, month: 7, day: 5 },
      },
    )
    expect(seeds).toEqual([])
  })
})

describe('generateUpTo — guards', () => {
  it('generates nothing for paused or archived templates', () => {
    const ctx = { fromInstant: at(2025, 7, 1), horizonDays: 28, timeZone: AMS, existing: [] }
    expect(generateUpTo(template({ status: 'paused' }), ctx)).toEqual([])
    expect(generateUpTo(template({ status: 'archived' }), ctx)).toEqual([])
  })

  it('throws for the deferred frequency-target mode', () => {
    expect(() =>
      generateUpTo(template({ recurrence: { mode: 'frequencyTarget', timesPerWeek: 2 } }), {
        fromInstant: at(2025, 7, 1),
        horizonDays: 28,
        timeZone: AMS,
        existing: [],
      }),
    ).toThrow(/frequencyTarget/)
  })
})
