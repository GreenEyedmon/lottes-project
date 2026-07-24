/**
 * Adaptive-scheduling suggestions (Phase 3). A suggestion is a *proposed* change to a
 * chore, carrying the reasoning and the evidence behind it. Nothing here mutates state —
 * the analyzers are pure, and a suggestion only takes effect when the user accepts it.
 */

import type { RecurrenceRule } from '../chore/types.ts'
import type { TimeOfDay } from '../time/zone.ts'

/**
 * The concrete change an accepted suggestion applies to a template. A superset across all
 * suggestion kinds; each kind fills only the fields it needs. Stored as JSON on the row.
 */
export interface SuggestionPatch {
  recurrence?: RecurrenceRule
  dueTime?: TimeOfDay | null
  rotate?: boolean
  responsibleOrder?: string[]
}

export type SuggestionKind =
  | 'adjustFrequency'
  // Reserved for later Phase 3 steps:
  | 'shiftWeekday'
  | 'shiftDueTime'
  | 'shiftReminder'
  | 'enableRotation'
  | 'reorderRotation'

/**
 * The numbers behind a frequency suggestion, shown to the user as justification. A `type`
 * (not `interface`) so it stays assignable to the `Record<string, number>` JSON column.
 */
export type FrequencyEvidence = {
  sampleSize: number
  postponedCount: number
  lateCount: number
  earlyCount: number
}

/** Per-template behavioral signals over the analysis window, already aggregated. */
export interface FrequencySignals {
  rule: RecurrenceRule
  /** Completions considered (the sample). */
  sampleSize: number
  /** Of those, how many were postponed at least once before completion. */
  postponedCount: number
  /** Of those, how many were completed late. */
  lateCount: number
  /** Of those, how many were completed early. */
  earlyCount: number
}

export interface FrequencySuggestion {
  kind: 'adjustFrequency'
  /** `longer` = space it out (running behind); `shorter` = do it more often (always early). */
  direction: 'longer' | 'shorter'
  proposedRule: RecurrenceRule
  explanation: string
  evidence: FrequencyEvidence
}
