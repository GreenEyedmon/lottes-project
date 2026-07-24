import { describe, expect, it } from 'vitest'
import { isoDate } from '../time/civil.ts'
import { instantFromZoned } from '../time/zone.ts'
import { applyCompletion, applyMissedPolicy, postpone, resolveTemporalStatus } from './lifecycle.ts'
import { generateUpTo } from './recurrence.ts'
import type { ChoreOccurrence, ChoreTemplate, OccurrenceSeed } from './types.ts'

const AMS = 'Europe/Amsterdam'

const at = (y: number, m: number, d: number, h = 9, min = 0): number =>
  instantFromZoned({ year: y, month: m, day: d }, { hour: h, minute: min }, AMS)

const dates = (seeds: OccurrenceSeed[]): string[] => seeds.map((s) => isoDate(s.dueDate))

function only(seeds: OccurrenceSeed[]): OccurrenceSeed {
  const seed = seeds[0]
  if (!seed) throw new Error('expected exactly one seed')
  return seed
}

/** Simulate persistence: turn a seed into a scheduled occurrence keyed by its slot. */
function materialize(seed: OccurrenceSeed): ChoreOccurrence {
  return {
    id: seed.generationKey,
    householdId: seed.householdId,
    templateId: seed.templateId,
    dueDate: seed.dueDate,
    dueTime: seed.dueTime,
    dueInstant: seed.dueInstant,
    state: 'scheduled',
    responsibleId: seed.responsibleId,
    generationKey: seed.generationKey,
  }
}

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

describe('fixed-weekly collapse over a timeline', () => {
  it('runs complete → regenerate → miss → collapse → complete-late without backlog', () => {
    const tpl = template()

    // 1. Fresh template generates the first Tuesday only.
    let seeds = generateUpTo(tpl, {
      fromInstant: at(2025, 7, 1),
      horizonDays: 28,
      timeZone: AMS,
      existing: [],
    })
    expect(dates(seeds)).toEqual(['2025-07-01'])
    const occ1 = materialize(only(seeds))

    // 2. Complete it on time.
    const c1 = applyCompletion(
      occ1,
      { completedById: 'alex', completedAt: at(2025, 7, 1) },
      { now: at(2025, 7, 1), timeZone: AMS },
    )
    expect(c1.event.wasLate).toBe(false)

    // 3. Regenerating produces the next Tuesday.
    seeds = generateUpTo(tpl, {
      fromInstant: at(2025, 7, 1, 10, 0),
      horizonDays: 28,
      timeZone: AMS,
      existing: [c1.occurrence],
    })
    expect(dates(seeds)).toEqual(['2025-07-08'])
    const occ2 = materialize(only(seeds))

    // 4. Three weeks later occ2 is overdue; nothing new generates and collapse is a no-op
    //    (a single overdue never stacks).
    const now4 = at(2025, 7, 23)
    const existing4 = [c1.occurrence, occ2]
    expect(resolveTemporalStatus(occ2, { now: now4, timeZone: AMS })).toBe('overdue')
    expect(
      generateUpTo(tpl, { fromInstant: now4, horizonDays: 28, timeZone: AMS, existing: existing4 }),
    ).toEqual([])
    expect(applyMissedPolicy(tpl, existing4, { now: now4, timeZone: AMS })).toEqual([])

    // 5. Completing occ2 late schedules the next *future* Tuesday, skipping the missed
    //    weeks — no backlog for a collapse chore.
    const c2 = applyCompletion(
      occ2,
      { completedById: 'alex', completedAt: now4 },
      { now: now4, timeZone: AMS },
    )
    expect(c2.event.wasLate).toBe(true)
    seeds = generateUpTo(tpl, {
      fromInstant: now4,
      horizonDays: 28,
      timeZone: AMS,
      existing: [c1.occurrence, c2.occurrence],
    })
    expect(dates(seeds)).toEqual(['2025-07-29'])
  })
})

describe('completion-relative over a timeline', () => {
  it('schedules the next occurrence from the actual completion date', () => {
    const tpl = template({ recurrence: { mode: 'completionRelative', everyDays: 14 } })

    const first = generateUpTo(tpl, {
      fromInstant: at(2025, 7, 1),
      horizonDays: 28,
      timeZone: AMS,
      existing: [],
    })
    expect(dates(first)).toEqual(['2025-07-01'])
    const occ1 = materialize(only(first))

    // Completed late, on the 5th → next is 14 days from the 5th, not from the due date.
    const done = applyCompletion(
      occ1,
      { completedById: 'sam', completedAt: at(2025, 7, 5) },
      { now: at(2025, 7, 5), timeZone: AMS },
    )
    const next = generateUpTo(tpl, {
      fromInstant: at(2025, 7, 5, 12, 0),
      horizonDays: 28,
      timeZone: AMS,
      existing: [done.occurrence],
      lastCompletionDate: { year: 2025, month: 7, day: 5 },
    })
    expect(dates(next)).toEqual(['2025-07-19'])
  })
})

describe('shift-this-and-future feeds back into generation', () => {
  it('moves subsequent occurrences to the new weekday', () => {
    const tpl = template({
      recurrence: { mode: 'fixedWeekly', weekdays: [6] },
      startDate: { year: 2025, month: 7, day: 5 },
    })
    const occSat = materialize(
      only(
        generateUpTo(tpl, {
          fromInstant: at(2025, 7, 5),
          horizonDays: 28,
          timeZone: AMS,
          existing: [],
        }),
      ),
    )
    expect(isoDate(occSat.dueDate)).toBe('2025-07-05') // Saturday

    // Shift this occurrence to Sunday and move the anchor with it.
    const shifted = postpone(occSat, 'thisAndFuture', { year: 2025, month: 7, day: 6 }, tpl, {
      timeZone: AMS,
    })
    expect(shifted.template.recurrence).toEqual({ mode: 'fixedWeekly', weekdays: [7] })

    const done = applyCompletion(
      shifted.occurrence,
      { completedById: 'sam', completedAt: at(2025, 7, 6) },
      { now: at(2025, 7, 6), timeZone: AMS },
    )
    const next = generateUpTo(shifted.template, {
      fromInstant: at(2025, 7, 6, 12, 0),
      horizonDays: 28,
      timeZone: AMS,
      existing: [done.occurrence],
    })
    expect(dates(next)).toEqual(['2025-07-13']) // the next Sunday
  })
})

describe('generation is idempotent', () => {
  it('re-running with the materialized occurrences produces no duplicates', () => {
    const tpl = template({ missedPolicy: 'keep' })
    const ctx = { fromInstant: at(2025, 7, 1), horizonDays: 21, timeZone: AMS }
    const firstRun = generateUpTo(tpl, { ...ctx, existing: [] })
    expect(firstRun).toHaveLength(4)
    const persisted = firstRun.map(materialize)
    const secondRun = generateUpTo(tpl, { ...ctx, existing: persisted })
    expect(secondRun).toEqual([])
  })
})
