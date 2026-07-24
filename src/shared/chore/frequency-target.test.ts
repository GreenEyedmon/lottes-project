import { describe, expect, it } from 'vitest'
import { isoDate, type LocalDate } from '../time/civil.ts'
import { instantFromZoned } from '../time/zone.ts'
import { applyMissedPolicy } from './lifecycle.ts'
import { generateUpTo, weeklyTargetOffsets } from './recurrence.ts'
import type { ChoreOccurrence, ChoreTemplate } from './types.ts'

const AMS = 'Europe/Amsterdam'
const at = (y: number, m: number, d: number, h = 9): number =>
  instantFromZoned({ year: y, month: m, day: d }, { hour: h, minute: 0 }, AMS)

function template(timesPerWeek: number, overrides: Partial<ChoreTemplate> = {}): ChoreTemplate {
  return {
    id: 't1',
    householdId: 'h1',
    recurrence: { mode: 'frequencyTarget', timesPerWeek },
    missedPolicy: 'collapse',
    status: 'active',
    startDate: { year: 2025, month: 7, day: 7 }, // a Monday
    ...overrides,
  }
}

function ctx(fromInstant: number, horizonDays: number, existing: ChoreOccurrence[] = []) {
  return { fromInstant, horizonDays, timeZone: AMS, existing }
}

const dates = (seeds: { dueDate: LocalDate }[]): string[] => seeds.map((s) => isoDate(s.dueDate))

describe('weeklyTargetOffsets', () => {
  it('spreads N slots evenly across the week', () => {
    expect(weeklyTargetOffsets(1)).toEqual([0])
    expect(weeklyTargetOffsets(2)).toEqual([0, 3])
    expect(weeklyTargetOffsets(3)).toEqual([0, 2, 4])
    expect(weeklyTargetOffsets(4)).toEqual([0, 1, 3, 5])
    expect(weeklyTargetOffsets(7)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('clamps out-of-range targets to 1–7', () => {
    expect(weeklyTargetOffsets(0)).toEqual([0])
    expect(weeklyTargetOffsets(9)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('generateUpTo — frequencyTarget', () => {
  it('places evenly-spread slots each week within the horizon', () => {
    // 2×/week from Mon Jul 7, today = Mon Jul 7, 14-day horizon → Mon/Thu each week to Jul 21
    const seeds = generateUpTo(template(2), ctx(at(2025, 7, 7), 14))
    expect(dates(seeds)).toEqual([
      '2025-07-07',
      '2025-07-10',
      '2025-07-14',
      '2025-07-17',
      '2025-07-21',
    ])
  })

  it('only materializes the remaining slots in a partial first week', () => {
    // today = Wed Jul 9 → this week's Monday slot is already past and is never created
    const seeds = generateUpTo(template(2), ctx(at(2025, 7, 9), 7))
    expect(dates(seeds)).toEqual(['2025-07-10', '2025-07-14'])
  })

  it('never recreates a slot that already exists', () => {
    const existing: ChoreOccurrence[] = [
      {
        id: 'o1',
        householdId: 'h1',
        templateId: 't1',
        dueDate: { year: 2025, month: 7, day: 7 },
        dueInstant: at(2025, 7, 7),
        state: 'completed',
        generationKey: 't1:2025-07-07',
      },
    ]
    const seeds = generateUpTo(template(2), ctx(at(2025, 7, 7), 7, existing))
    expect(dates(seeds)).toEqual(['2025-07-10', '2025-07-14']) // Jul 7 already exists → skipped
  })

  it('crosses a DST spring-forward week without skipping or duplicating a day', () => {
    // Week of Mon Mar 24 2025 contains the 30 Mar clock change; 7×/week = one per day.
    const seeds = generateUpTo(
      template(7, { startDate: { year: 2025, month: 3, day: 24 } }),
      ctx(at(2025, 3, 24), 6),
    )
    expect(dates(seeds)).toEqual([
      '2025-03-24',
      '2025-03-25',
      '2025-03-26',
      '2025-03-27',
      '2025-03-28',
      '2025-03-29',
      '2025-03-30',
    ])
  })
})

describe('applyMissedPolicy — frequencyTarget', () => {
  function scheduledOcc(day: number): ChoreOccurrence {
    return {
      id: `o${day}`,
      householdId: 'h1',
      templateId: 't1',
      dueDate: { year: 2025, month: 7, day: day },
      dueInstant: at(2025, 7, day),
      state: 'scheduled',
      generationKey: `t1:2025-07-${day}`,
    }
  }

  it('lapses every overdue slot regardless of the stored policy (no backlog)', () => {
    const now = at(2025, 7, 15)
    const occurrences = [scheduledOcc(10), scheduledOcc(12), scheduledOcc(20)] // 20th is future
    // Even with `keep`, a frequencyTarget slot must lapse rather than pile up.
    const result = applyMissedPolicy(template(2, { missedPolicy: 'keep' }), occurrences, {
      now,
      timeZone: AMS,
    })
    expect(result).toEqual([
      { occurrenceId: 'o10', to: 'missed' },
      { occurrenceId: 'o12', to: 'missed' },
    ])
  })
})
