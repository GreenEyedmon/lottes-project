/**
 * Frequency-fit analysis: does a chore's cadence match how the household actually keeps
 * up with it? Pure — takes pre-aggregated signals, returns at most one suggestion.
 *
 * Signals point two ways:
 *   - Running behind (postponed / late a lot) → propose a *longer* interval.
 *   - Always early, never behind          → propose a *shorter* interval.
 * Only `completionRelative` (everyDays) and `fixedWeekly` (interval) have an adjustable
 * frequency knob; other modes yield no suggestion here.
 */

import type { RecurrenceRule } from '../chore/types.ts'
import type { FrequencySignals, FrequencySuggestion } from './types.ts'

/** Below this many completions we don't have enough signal to suggest anything. */
export const MIN_SAMPLE = 4
/** Share of the sample that must be behind (postponed/late) to suggest easing off. */
export const STRAIN_THRESHOLD = 0.6
/** Share of the sample completed early to suggest doing it more often. */
export const SLACK_THRESHOLD = 0.6

function lengthen(rule: RecurrenceRule): RecurrenceRule | null {
  if (rule.mode === 'completionRelative') {
    const everyDays = Math.max(rule.everyDays + 1, Math.round(rule.everyDays * 1.5))
    return { mode: 'completionRelative', everyDays }
  }
  if (rule.mode === 'fixedWeekly') {
    return { ...rule, interval: (rule.interval ?? 1) + 1 }
  }
  return null
}

function shorten(rule: RecurrenceRule): RecurrenceRule | null {
  if (rule.mode === 'completionRelative') {
    const everyDays = Math.round(rule.everyDays * 0.75)
    return everyDays >= 1 && everyDays < rule.everyDays
      ? { mode: 'completionRelative', everyDays }
      : null
  }
  if (rule.mode === 'fixedWeekly') {
    const interval = rule.interval ?? 1
    return interval > 1 ? { ...rule, interval: interval - 1 } : null
  }
  return null
}

/** Human phrase for a rule's cadence, e.g. "every 10 days" / "every 2 weeks" / "weekly". */
function cadence(rule: RecurrenceRule): string {
  if (rule.mode === 'completionRelative') return `every ${rule.everyDays} days`
  if (rule.mode === 'fixedWeekly') {
    const interval = rule.interval ?? 1
    return interval === 1 ? 'weekly' : `every ${interval} weeks`
  }
  return 'a new schedule'
}

export function analyzeFrequency(signals: FrequencySignals): FrequencySuggestion | null {
  const { rule, sampleSize, postponedCount, lateCount, earlyCount } = signals
  if (sampleSize < MIN_SAMPLE) return null

  const behind = Math.min(sampleSize, postponedCount + lateCount)
  const strain = behind / sampleSize
  const slack = earlyCount / sampleSize
  const evidence = { sampleSize, postponedCount, lateCount, earlyCount }

  if (strain >= STRAIN_THRESHOLD) {
    const proposedRule = lengthen(rule)
    if (!proposedRule) return null
    return {
      kind: 'adjustFrequency',
      direction: 'longer',
      proposedRule,
      explanation: `Behind on ${behind} of the last ${sampleSize}. Ease off to ${cadence(proposedRule)}?`,
      evidence,
    }
  }

  // Only suggest doing it more often when nothing points the other way.
  if (slack >= SLACK_THRESHOLD && strain === 0) {
    const proposedRule = shorten(rule)
    if (!proposedRule) return null
    return {
      kind: 'adjustFrequency',
      direction: 'shorter',
      proposedRule,
      explanation: `Finished early ${earlyCount} of the last ${sampleSize}. Do it ${cadence(proposedRule)}?`,
      evidence,
    }
  }

  return null
}
