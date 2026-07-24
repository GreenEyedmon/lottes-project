/**
 * Domain types for the chore engine. These are the canonical shapes the pure functions
 * operate on; the Phase 1 Drizzle schema will mirror (not import) them.
 *
 * A chore *template* is the recurring definition; a chore *occurrence* is one scheduled
 * instance. A one-off task is an occurrence with `templateId === null`.
 */

import type { LocalDate } from '../time/civil.ts'
import type { TimeOfDay } from '../time/zone.ts'

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type RecurrenceRule =
  | {
      readonly mode: 'fixedWeekly'
      readonly weekdays: readonly Weekday[]
      readonly interval?: number
    }
  | { readonly mode: 'fixedMonthly'; readonly dayOfMonth: number }
  | { readonly mode: 'completionRelative'; readonly everyDays: number }
  | { readonly mode: 'frequencyTarget'; readonly timesPerWeek: number }

/** Persisted lifecycle state. `upcoming/due/overdue` are derived, never stored. */
export type OccurrenceState = 'scheduled' | 'completed' | 'skipped' | 'cancelled' | 'missed'

/** Presentation-only status derived from the due time vs. now, while `scheduled`. */
export type TemporalStatus = 'upcoming' | 'due' | 'overdue'

export type MissedPolicy = 'collapse' | 'keep' | 'expire'

export type TemplateStatus = 'active' | 'paused' | 'archived'

export interface ChoreTemplate {
  readonly id: string
  readonly householdId: string
  readonly recurrence: RecurrenceRule
  readonly missedPolicy: MissedPolicy
  readonly status: TemplateStatus
  readonly startDate: LocalDate
  /** Absent ⇒ an all-day chore; a default reminder time is used for the instant. */
  readonly dueTime?: TimeOfDay
  readonly defaultResponsibleId?: string
}

export interface ChoreOccurrence {
  readonly id: string
  readonly householdId: string
  readonly templateId: string | null
  readonly dueDate: LocalDate
  readonly dueTime?: TimeOfDay
  readonly dueInstant: number
  readonly state: OccurrenceState
  readonly responsibleId?: string
  readonly postponedFrom?: LocalDate
  readonly generationKey: string
}

/** A not-yet-persisted occurrence produced by generation. */
export interface OccurrenceSeed {
  readonly householdId: string
  readonly templateId: string
  readonly dueDate: LocalDate
  readonly dueTime?: TimeOfDay
  readonly dueInstant: number
  readonly responsibleId?: string
  readonly generationKey: string
}

export interface CompletionInput {
  readonly completedById: string
  readonly completedAt: number
  readonly effortActualMinutes?: number
  readonly notes?: string
}

export interface CompletionEvent {
  readonly occurrenceId: string
  readonly completedById: string
  readonly completedAt: number
  readonly wasEarly: boolean
  readonly wasLate: boolean
  readonly byNonAssignee: boolean
  readonly effortActualMinutes?: number
  readonly notes?: string
}
