/**
 * Occurrence lifecycle transitions. Every mutating function is pure and returns new
 * objects; the caller persists the result and appends an activity event. Only
 * `scheduled` occurrences accept actions.
 */

import type { LocalDate } from '../time/civil.ts'
import { compareLocalDate, isoWeekday } from '../time/civil.ts'
import { instantFromZoned, localDateInZone } from '../time/zone.ts'
import { DEFAULT_DUE_TIME } from './recurrence.ts'
import type {
  ChoreOccurrence,
  ChoreTemplate,
  CompletionEvent,
  CompletionInput,
  TemporalStatus,
} from './types.ts'

export interface ClockContext {
  readonly now: number
  readonly timeZone: string
}

/** Derive upcoming/due/overdue from the due date/time vs. now, in the household zone. */
export function resolveTemporalStatus(
  occurrence: ChoreOccurrence,
  ctx: ClockContext,
): TemporalStatus {
  const today = localDateInZone(ctx.now, ctx.timeZone)
  const cmp = compareLocalDate(occurrence.dueDate, today)
  if (cmp > 0) return 'upcoming'
  if (cmp < 0) return 'overdue'
  if (occurrence.dueTime && ctx.now >= occurrence.dueInstant) return 'overdue'
  return 'due'
}

/** True when the occurrence is in a state that accepts user actions. */
export function isActionable(occurrence: ChoreOccurrence): boolean {
  return occurrence.state === 'scheduled'
}

function assertScheduled(occurrence: ChoreOccurrence, action: string): void {
  if (occurrence.state !== 'scheduled') {
    throw new Error(`Cannot ${action} an occurrence in state '${occurrence.state}'`)
  }
}

function completedBeforeDue(
  occurrence: ChoreOccurrence,
  completedAt: number,
  timeZone: string,
): number {
  if (occurrence.dueTime) return Math.sign(completedAt - occurrence.dueInstant)
  const completedDate = localDateInZone(completedAt, timeZone)
  return compareLocalDate(completedDate, occurrence.dueDate)
}

/** Record a completion. Returns the completed occurrence and its normalized event. */
export function applyCompletion(
  occurrence: ChoreOccurrence,
  input: CompletionInput,
  ctx: ClockContext,
): { occurrence: ChoreOccurrence; event: CompletionEvent } {
  assertScheduled(occurrence, 'complete')
  const delta = completedBeforeDue(occurrence, input.completedAt, ctx.timeZone)
  const event: CompletionEvent = {
    occurrenceId: occurrence.id,
    completedById: input.completedById,
    completedAt: input.completedAt,
    wasEarly: delta < 0,
    wasLate: delta > 0,
    byNonAssignee:
      occurrence.responsibleId !== undefined && input.completedById !== occurrence.responsibleId,
    effortActualMinutes: input.effortActualMinutes,
    notes: input.notes,
  }
  return { occurrence: { ...occurrence, state: 'completed' }, event }
}

export function skip(occurrence: ChoreOccurrence): ChoreOccurrence {
  assertScheduled(occurrence, 'skip')
  return { ...occurrence, state: 'skipped' }
}

export function cancel(occurrence: ChoreOccurrence): ChoreOccurrence {
  assertScheduled(occurrence, 'cancel')
  return { ...occurrence, state: 'cancelled' }
}

export function reassign(occurrence: ChoreOccurrence, responsibleId: string): ChoreOccurrence {
  assertScheduled(occurrence, 'reassign')
  return { ...occurrence, responsibleId }
}

export type PostponeMode = 'this' | 'thisAndFuture'

/**
 * Postpone an occurrence to a new date. `this` moves only the occurrence; `thisAndFuture`
 * also moves the template's recurrence anchor so future occurrences follow the new
 * cadence. For completion-relative chores the anchor is completion-driven, so the
 * template is returned unchanged.
 */
export function postpone(
  occurrence: ChoreOccurrence,
  mode: PostponeMode,
  newDueDate: LocalDate,
  template: ChoreTemplate,
  ctx: { timeZone: string },
): { occurrence: ChoreOccurrence; template: ChoreTemplate } {
  assertScheduled(occurrence, 'postpone')
  const time = occurrence.dueTime ?? template.dueTime ?? DEFAULT_DUE_TIME
  const moved: ChoreOccurrence = {
    ...occurrence,
    dueDate: newDueDate,
    dueInstant: instantFromZoned(newDueDate, time, ctx.timeZone),
    postponedFrom: occurrence.postponedFrom ?? occurrence.dueDate,
  }
  const nextTemplate = mode === 'thisAndFuture' ? shiftAnchor(template, newDueDate) : template
  return { occurrence: moved, template: nextTemplate }
}

function shiftAnchor(template: ChoreTemplate, newDueDate: LocalDate): ChoreTemplate {
  const rule = template.recurrence
  if (rule.mode === 'fixedWeekly') {
    return { ...template, recurrence: { ...rule, weekdays: [isoWeekday(newDueDate)] } }
  }
  if (rule.mode === 'fixedMonthly') {
    return { ...template, recurrence: { ...rule, dayOfMonth: newDueDate.day } }
  }
  return template
}

export interface MissedTransition {
  readonly occurrenceId: string
  readonly to: 'cancelled' | 'missed'
}

/**
 * Given a template's occurrences and the current time, decide which overdue occurrences
 * change state under the template's missed-occurrence policy:
 *
 * - `keep`: nothing changes (the backlog stands).
 * - `expire`: every overdue occurrence becomes `missed`.
 * - `collapse`: keep the earliest overdue, cancel the rest (one overdue, never a pile-up).
 */
export function applyMissedPolicy(
  template: ChoreTemplate,
  occurrences: readonly ChoreOccurrence[],
  ctx: ClockContext,
): MissedTransition[] {
  const overdue = occurrences.filter(
    (o) => o.state === 'scheduled' && resolveTemporalStatus(o, ctx) === 'overdue',
  )
  // A frequency-target slot is a specific day within a "~N times per week" pattern: once it
  // passes it just lapses, so the week's other slots stand and nothing backlogs. This is
  // intrinsic to the mode and overrides the template's stored missed policy.
  if (template.recurrence.mode === 'frequencyTarget') {
    return overdue.map((o) => ({ occurrenceId: o.id, to: 'missed' }))
  }
  if (template.missedPolicy === 'keep') return []
  if (template.missedPolicy === 'expire') {
    return overdue.map((o) => ({ occurrenceId: o.id, to: 'missed' }))
  }
  if (overdue.length <= 1) return []
  const sorted = [...overdue].sort((a, b) => compareLocalDate(a.dueDate, b.dueDate))
  return sorted.slice(1).map((o) => ({ occurrenceId: o.id, to: 'cancelled' }))
}
