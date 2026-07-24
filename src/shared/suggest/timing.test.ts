import { describe, expect, it } from 'vitest'
import type { RecurrenceRule, Weekday } from '../chore/types.ts'
import { analyzeDueTime, analyzeWeekday, MIN_SAMPLE } from './timing.ts'
import type { CompletionMoment, TimingSignals } from './types.ts'

const mondayWeekly: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [1] }

/** Build N moments on a given weekday/hour. */
function moments(n: number, weekday: Weekday, hour: number): CompletionMoment[] {
  return Array.from({ length: n }, () => ({ weekday, hour }))
}

function signals(over: Partial<TimingSignals>): TimingSignals {
  return { rule: mondayWeekly, currentDueTime: null, moments: [], ...over }
}

describe('analyzeWeekday', () => {
  it('suggests moving to the weekday completions actually cluster on', () => {
    const s = analyzeWeekday(signals({ moments: moments(5, 6, 10) })) // all Saturdays
    expect(s?.proposedRule).toEqual({ mode: 'fixedWeekly', weekdays: [6] })
    expect(s?.explanation).toContain('Saturday')
    expect(s?.evidence).toEqual({ sampleSize: 5, onProposedWeekday: 5 })
  })

  it('stays quiet when completions already match the scheduled day', () => {
    expect(analyzeWeekday(signals({ moments: moments(5, 1, 10) }))).toBeNull()
  })

  it('needs a dominant day, not just a plurality', () => {
    // 3 Sat, 2 Mon out of 5 → 0.6 exactly meets dominance
    const mixed = [...moments(3, 6, 10), ...moments(2, 1, 10)]
    expect(analyzeWeekday(signals({ moments: mixed }))?.proposedRule).toEqual({
      mode: 'fixedWeekly',
      weekdays: [6],
    })
    // 2 Sat, 3 spread (Mon/Tue/Wed) → no day dominates
    const scattered: CompletionMoment[] = [
      ...moments(2, 6, 10),
      { weekday: 1, hour: 10 },
      { weekday: 2, hour: 10 },
      { weekday: 3, hour: 10 },
    ]
    expect(analyzeWeekday(signals({ moments: scattered }))).toBeNull()
  })

  it('ignores multi-day and non-weekly rules', () => {
    const twoDays: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [1, 4] }
    expect(analyzeWeekday(signals({ rule: twoDays, moments: moments(6, 6, 10) }))).toBeNull()
    const monthly: RecurrenceRule = { mode: 'fixedMonthly', dayOfMonth: 1 }
    expect(analyzeWeekday(signals({ rule: monthly, moments: moments(6, 6, 10) }))).toBeNull()
  })

  it('needs the minimum sample', () => {
    expect(analyzeWeekday(signals({ moments: moments(MIN_SAMPLE - 1, 6, 10) }))).toBeNull()
  })
})

describe('analyzeDueTime', () => {
  it('suggests the hour completions cluster on when far from the due time', () => {
    // due defaults to 9am; done at 20:00
    const s = analyzeDueTime(signals({ moments: moments(5, 3, 20) }))
    expect(s?.proposedDueTime).toEqual({ hour: 20, minute: 0 })
    expect(s?.explanation).toContain('8pm')
    expect(s?.evidence).toEqual({ sampleSize: 5, typicalHour: 20, currentHour: 9 })
  })

  it('respects the current due time when computing drift', () => {
    // due set to 8pm, done at 8pm → no drift
    const s = analyzeDueTime(
      signals({ currentDueTime: { hour: 20, minute: 0 }, moments: moments(5, 3, 20) }),
    )
    expect(s).toBeNull()
  })

  it('stays within the margin', () => {
    // due 9am, done 10am → 1h < 2h margin
    expect(analyzeDueTime(signals({ moments: moments(5, 3, 10) }))).toBeNull()
  })

  it('uses the median so an outlier does not swing it', () => {
    const m: CompletionMoment[] = [...moments(4, 3, 19), { weekday: 3, hour: 3 }] // one 3am outlier
    expect(analyzeDueTime(signals({ moments: m }))?.proposedDueTime).toEqual({
      hour: 19,
      minute: 0,
    })
  })

  it('needs the minimum sample', () => {
    expect(analyzeDueTime(signals({ moments: moments(MIN_SAMPLE - 1, 3, 20) }))).toBeNull()
  })
})
