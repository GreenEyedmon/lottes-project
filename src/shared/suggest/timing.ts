/**
 * Timing analysis: does a chore's scheduled day and time-of-day match when the household
 * actually does it? Pure — takes completion moments (already resolved to the household's
 * local weekday/hour) and the current schedule, returns at most one suggestion each.
 *
 * Note: a timed reminder fires at the occurrence's due instant, so "when the reminder
 * lands" and "the due time" are the same knob — a `shiftDueTime` suggestion moves both.
 */

import { DEFAULT_DUE_TIME } from '../chore/recurrence.ts'
import type {
  CompletionMoment,
  DueTimeSuggestion,
  TimingSignals,
  WeekdaySuggestion,
} from './types.ts'

/** Below this many completions there isn't enough signal to move a schedule. */
export const MIN_SAMPLE = 4
/** Share of completions on one weekday before we suggest moving the chore there. */
export const WEEKDAY_DOMINANCE = 0.6
/** How many hours the typical completion must drift from the due hour to suggest a move. */
export const HOUR_MARGIN = 2

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function dayName(weekday: number): string {
  return DAY_NAMES[weekday] ?? `day ${weekday}`
}

/** 14 → "2pm", 0 → "12am", 9 → "9am". */
function formatHour(hour: number): string {
  const period = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${period}`
}

/** Most frequent value and its count; ties break toward the smaller key (stable). */
function mode<T extends number>(values: readonly T[]): { value: T; count: number } {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: { value: T; count: number } | null = null
  for (const [value, count] of counts) {
    if (!best || count > best.count || (count === best.count && value < best.value)) {
      best = { value, count }
    }
  }
  if (!best) throw new Error('mode of an empty list')
  return best
}

/** Lower-median hour (no averaging, so it stays an integer clock hour). */
function medianHour(hours: readonly number[]): number {
  const sorted = [...hours].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

/** fixedWeekly chore whose completions cluster on a different weekday → move it there. */
export function analyzeWeekday(signals: TimingSignals): WeekdaySuggestion | null {
  const { rule, moments } = signals
  // Only unambiguous single-day weekly chores; multi-day rules have no single "right" day.
  if (rule.mode !== 'fixedWeekly' || rule.weekdays.length !== 1) return null
  if (moments.length < MIN_SAMPLE) return null

  const current = rule.weekdays[0]
  if (current === undefined) return null
  const top = mode(moments.map((m: CompletionMoment) => m.weekday))
  if (top.value === current) return null
  if (top.count / moments.length < WEEKDAY_DOMINANCE) return null

  return {
    kind: 'shiftWeekday',
    proposedRule: { ...rule, weekdays: [top.value] },
    explanation: `Usually done on ${dayName(top.value)}, not ${dayName(current)}. Move it to ${dayName(top.value)}?`,
    evidence: { sampleSize: moments.length, onProposedWeekday: top.count },
  }
}

/** Completions land at a consistently different hour than the due time → shift the due time. */
export function analyzeDueTime(signals: TimingSignals): DueTimeSuggestion | null {
  const { currentDueTime, moments } = signals
  if (moments.length < MIN_SAMPLE) return null

  const currentHour = (currentDueTime ?? DEFAULT_DUE_TIME).hour
  const typicalHour = medianHour(moments.map((m: CompletionMoment) => m.hour))
  if (Math.abs(typicalHour - currentHour) < HOUR_MARGIN) return null

  return {
    kind: 'shiftDueTime',
    proposedDueTime: { hour: typicalHour, minute: 0 },
    explanation: `Usually done around ${formatHour(typicalHour)}, not ${formatHour(currentHour)}. Move the reminder to ${formatHour(typicalHour)}?`,
    evidence: { sampleSize: moments.length, typicalHour, currentHour },
  }
}
