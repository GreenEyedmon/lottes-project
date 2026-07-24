import { describe, expect, it } from 'vitest'
import type { RecurrenceRule } from '../chore/types.ts'
import { analyzeFrequency, MIN_SAMPLE } from './frequency.ts'
import type { FrequencySignals } from './types.ts'

const daily14: RecurrenceRule = { mode: 'completionRelative', everyDays: 14 }
const weekly: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [1] }

function signals(over: Partial<FrequencySignals>): FrequencySignals {
  return { rule: daily14, sampleSize: 6, postponedCount: 0, lateCount: 0, earlyCount: 0, ...over }
}

describe('analyzeFrequency', () => {
  it('returns null below the minimum sample', () => {
    expect(analyzeFrequency(signals({ sampleSize: MIN_SAMPLE - 1, postponedCount: 3 }))).toBeNull()
  })

  it('suggests a longer interval when the household runs behind', () => {
    const s = analyzeFrequency(signals({ sampleSize: 5, postponedCount: 3, lateCount: 1 }))
    expect(s?.direction).toBe('longer')
    // 14 → max(15, round(21)) = 21
    expect(s?.proposedRule).toEqual({ mode: 'completionRelative', everyDays: 21 })
    expect(s?.explanation).toContain('every 21 days')
  })

  it('does not double-count an occurrence that was both postponed and late', () => {
    // 3 behind out of 4 → strain 0.75, still ≥ threshold; behind capped at sampleSize
    const s = analyzeFrequency(signals({ sampleSize: 4, postponedCount: 4, lateCount: 4 }))
    expect(s?.direction).toBe('longer')
    expect(s?.evidence.sampleSize).toBe(4)
  })

  it('suggests a shorter interval when always early and never behind', () => {
    const s = analyzeFrequency(signals({ sampleSize: 6, earlyCount: 5 }))
    expect(s?.direction).toBe('shorter')
    // 14 → round(10.5) = 11
    expect(s?.proposedRule).toEqual({ mode: 'completionRelative', everyDays: 11 })
  })

  it('never suggests shorter if there is any strain', () => {
    expect(analyzeFrequency(signals({ sampleSize: 6, earlyCount: 5, lateCount: 1 }))).toBeNull()
  })

  it('lengthens a weekly chore by bumping the interval', () => {
    const s = analyzeFrequency(signals({ rule: weekly, sampleSize: 5, postponedCount: 4 }))
    expect(s?.proposedRule).toEqual({ mode: 'fixedWeekly', weekdays: [1], interval: 2 })
  })

  it('will not shorten a weekly chore already at interval 1', () => {
    expect(analyzeFrequency(signals({ rule: weekly, sampleSize: 6, earlyCount: 6 }))).toBeNull()
  })

  it('shortens a biweekly chore back toward weekly', () => {
    const biweekly: RecurrenceRule = { mode: 'fixedWeekly', weekdays: [1], interval: 2 }
    const s = analyzeFrequency(signals({ rule: biweekly, sampleSize: 6, earlyCount: 5 }))
    expect(s?.proposedRule).toEqual({ mode: 'fixedWeekly', weekdays: [1], interval: 1 })
  })

  it('gives no suggestion for a mode without a frequency knob', () => {
    const monthly: RecurrenceRule = { mode: 'fixedMonthly', dayOfMonth: 1 }
    expect(
      analyzeFrequency(signals({ rule: monthly, sampleSize: 6, postponedCount: 5 })),
    ).toBeNull()
  })

  it('stays quiet when behavior is unremarkable', () => {
    expect(
      analyzeFrequency(signals({ sampleSize: 6, postponedCount: 1, earlyCount: 1 })),
    ).toBeNull()
  })
})
