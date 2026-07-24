import { describe, expect, it } from 'vitest'
import { isoDate } from '../time/civil.ts'
import { instantFromZoned } from '../time/zone.ts'
import {
  applyCompletion,
  applyMissedPolicy,
  cancel,
  postpone,
  reassign,
  resolveTemporalStatus,
  skip,
} from './lifecycle.ts'
import type { ChoreOccurrence, ChoreTemplate } from './types.ts'

const AMS = 'Europe/Amsterdam'

const at = (y: number, m: number, d: number, h = 9, min = 0): number =>
  instantFromZoned({ year: y, month: m, day: d }, { hour: h, minute: min }, AMS)

function occ(
  overrides: Partial<ChoreOccurrence> & { dueDate: ChoreOccurrence['dueDate'] },
): ChoreOccurrence {
  const { dueDate } = overrides
  const dueInstant = overrides.dueTime
    ? at(dueDate.year, dueDate.month, dueDate.day, overrides.dueTime.hour, overrides.dueTime.minute)
    : at(dueDate.year, dueDate.month, dueDate.day)
  return {
    id: 'o1',
    householdId: 'h1',
    templateId: 't1',
    dueInstant,
    state: 'scheduled',
    generationKey: `t1:${isoDate(dueDate)}`,
    ...overrides,
  }
}

function template(overrides: Partial<ChoreTemplate> = {}): ChoreTemplate {
  return {
    id: 't1',
    householdId: 'h1',
    recurrence: { mode: 'fixedWeekly', weekdays: [6] },
    missedPolicy: 'collapse',
    status: 'active',
    startDate: { year: 2025, month: 7, day: 5 },
    ...overrides,
  }
}

describe('resolveTemporalStatus', () => {
  it('classifies all-day occurrences by calendar date', () => {
    const now = at(2025, 7, 1)
    expect(
      resolveTemporalStatus(occ({ dueDate: { year: 2025, month: 7, day: 2 } }), {
        now,
        timeZone: AMS,
      }),
    ).toBe('upcoming')
    expect(
      resolveTemporalStatus(occ({ dueDate: { year: 2025, month: 7, day: 1 } }), {
        now,
        timeZone: AMS,
      }),
    ).toBe('due')
    expect(
      resolveTemporalStatus(occ({ dueDate: { year: 2025, month: 6, day: 30 } }), {
        now,
        timeZone: AMS,
      }),
    ).toBe('overdue')
  })

  it('classifies timed occurrences by the instant on the due date', () => {
    const due = occ({ dueDate: { year: 2025, month: 7, day: 1 }, dueTime: { hour: 18, minute: 0 } })
    expect(resolveTemporalStatus(due, { now: at(2025, 7, 1, 17, 0), timeZone: AMS })).toBe('due')
    expect(resolveTemporalStatus(due, { now: at(2025, 7, 1, 19, 0), timeZone: AMS })).toBe(
      'overdue',
    )
  })
})

describe('applyCompletion', () => {
  const base = occ({ dueDate: { year: 2025, month: 7, day: 5 }, responsibleId: 'alex' })

  it('marks completed and flags an early completion', () => {
    const { occurrence, event } = applyCompletion(
      base,
      { completedById: 'alex', completedAt: at(2025, 7, 3) },
      { now: at(2025, 7, 3), timeZone: AMS },
    )
    expect(occurrence.state).toBe('completed')
    expect(event.wasEarly).toBe(true)
    expect(event.wasLate).toBe(false)
    expect(event.byNonAssignee).toBe(false)
  })

  it('flags a late completion', () => {
    const { event } = applyCompletion(
      base,
      { completedById: 'alex', completedAt: at(2025, 7, 7) },
      { now: at(2025, 7, 7), timeZone: AMS },
    )
    expect(event.wasLate).toBe(true)
    expect(event.wasEarly).toBe(false)
  })

  it('flags completion by someone other than the assignee', () => {
    const { event } = applyCompletion(
      base,
      { completedById: 'rohit', completedAt: at(2025, 7, 5) },
      { now: at(2025, 7, 5), timeZone: AMS },
    )
    expect(event.byNonAssignee).toBe(true)
  })

  it('does not flag non-assignee when the occurrence is unassigned', () => {
    const unassigned = occ({ dueDate: { year: 2025, month: 7, day: 5 } })
    const { event } = applyCompletion(
      unassigned,
      { completedById: 'rohit', completedAt: at(2025, 7, 5) },
      { now: at(2025, 7, 5), timeZone: AMS },
    )
    expect(event.byNonAssignee).toBe(false)
  })

  it('refuses to complete a terminal occurrence', () => {
    const done = occ({ dueDate: { year: 2025, month: 7, day: 5 }, state: 'completed' })
    expect(() =>
      applyCompletion(
        done,
        { completedById: 'alex', completedAt: at(2025, 7, 5) },
        { now: at(2025, 7, 5), timeZone: AMS },
      ),
    ).toThrow(/Cannot complete/)
  })
})

describe('postpone', () => {
  const saturday = occ({ dueDate: { year: 2025, month: 7, day: 5 } }) // Saturday

  it('move-this changes only the occurrence, not the template anchor', () => {
    const result = postpone(saturday, 'this', { year: 2025, month: 7, day: 6 }, template(), {
      timeZone: AMS,
    })
    expect(result.occurrence.dueDate).toEqual({ year: 2025, month: 7, day: 6 })
    expect(result.occurrence.postponedFrom).toEqual({ year: 2025, month: 7, day: 5 })
    expect(result.template.recurrence).toEqual({ mode: 'fixedWeekly', weekdays: [6] })
  })

  it('shift-this-and-future moves the weekly anchor to the new weekday', () => {
    const result = postpone(
      saturday,
      'thisAndFuture',
      { year: 2025, month: 7, day: 6 },
      template(),
      { timeZone: AMS },
    )
    expect(result.template.recurrence).toEqual({ mode: 'fixedWeekly', weekdays: [7] }) // Sunday
  })

  it('shift-this-and-future moves the monthly anchor to the new day', () => {
    const monthly = template({ recurrence: { mode: 'fixedMonthly', dayOfMonth: 1 } })
    const result = postpone(
      occ({ dueDate: { year: 2025, month: 7, day: 1 } }),
      'thisAndFuture',
      { year: 2025, month: 7, day: 5 },
      monthly,
      { timeZone: AMS },
    )
    expect(result.template.recurrence).toEqual({ mode: 'fixedMonthly', dayOfMonth: 5 })
  })

  it('leaves completion-relative templates unchanged on shift', () => {
    const relative = template({ recurrence: { mode: 'completionRelative', everyDays: 14 } })
    const result = postpone(saturday, 'thisAndFuture', { year: 2025, month: 7, day: 6 }, relative, {
      timeZone: AMS,
    })
    expect(result.template.recurrence).toEqual({ mode: 'completionRelative', everyDays: 14 })
  })

  it('preserves the original postponedFrom across repeated postponements', () => {
    const already = occ({
      dueDate: { year: 2025, month: 7, day: 5 },
      postponedFrom: { year: 2025, month: 7, day: 4 },
    })
    const result = postpone(already, 'this', { year: 2025, month: 7, day: 6 }, template(), {
      timeZone: AMS,
    })
    expect(result.occurrence.postponedFrom).toEqual({ year: 2025, month: 7, day: 4 })
  })
})

describe('skip / cancel / reassign guards', () => {
  const scheduled = occ({ dueDate: { year: 2025, month: 7, day: 5 } })

  it('skip and cancel move to their terminal states', () => {
    expect(skip(scheduled).state).toBe('skipped')
    expect(cancel(scheduled).state).toBe('cancelled')
  })

  it('reassign changes the responsible member', () => {
    expect(reassign(scheduled, 'sam').responsibleId).toBe('sam')
  })

  it('all refuse to act on a terminal occurrence', () => {
    const done = occ({ dueDate: { year: 2025, month: 7, day: 5 }, state: 'completed' })
    expect(() => skip(done)).toThrow()
    expect(() => cancel(done)).toThrow()
    expect(() => reassign(done, 'sam')).toThrow()
  })
})

describe('applyMissedPolicy', () => {
  const now = at(2025, 7, 23)
  const overdue = [
    occ({ id: 'o1', dueDate: { year: 2025, month: 7, day: 1 } }),
    occ({ id: 'o2', dueDate: { year: 2025, month: 7, day: 8 } }),
    occ({ id: 'o3', dueDate: { year: 2025, month: 7, day: 15 } }),
  ]

  it('keep leaves the backlog intact', () => {
    expect(
      applyMissedPolicy(template({ missedPolicy: 'keep' }), overdue, { now, timeZone: AMS }),
    ).toEqual([])
  })

  it('expire marks every overdue occurrence missed', () => {
    const result = applyMissedPolicy(template({ missedPolicy: 'expire' }), overdue, {
      now,
      timeZone: AMS,
    })
    expect(result).toEqual([
      { occurrenceId: 'o1', to: 'missed' },
      { occurrenceId: 'o2', to: 'missed' },
      { occurrenceId: 'o3', to: 'missed' },
    ])
  })

  it('collapse keeps the earliest overdue and cancels the rest', () => {
    const result = applyMissedPolicy(template({ missedPolicy: 'collapse' }), overdue, {
      now,
      timeZone: AMS,
    })
    expect(result).toEqual([
      { occurrenceId: 'o2', to: 'cancelled' },
      { occurrenceId: 'o3', to: 'cancelled' },
    ])
  })

  it('collapse does nothing when only one is overdue', () => {
    const one = [occ({ id: 'o1', dueDate: { year: 2025, month: 7, day: 1 } })]
    expect(applyMissedPolicy(template(), one, { now, timeZone: AMS })).toEqual([])
  })

  it('ignores upcoming occurrences', () => {
    const mixed = [
      occ({ id: 'o1', dueDate: { year: 2025, month: 7, day: 1 } }),
      occ({ id: 'future', dueDate: { year: 2025, month: 8, day: 1 } }),
    ]
    expect(applyMissedPolicy(template(), mixed, { now, timeZone: AMS })).toEqual([])
  })
})
