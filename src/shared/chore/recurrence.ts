/**
 * Recurrence math and bounded-horizon occurrence generation. Pure: the caller passes in
 * the current instant, the household zone, and the existing occurrences.
 */

import type { LocalDate } from '../time/civil.ts'
import {
  addDays,
  compareLocalDate,
  daysFromCivil,
  daysInMonth,
  isoDate,
  isoWeekday,
  maxLocalDate,
} from '../time/civil.ts'
import type { TimeOfDay } from '../time/zone.ts'
import { instantFromZoned, localDateInZone } from '../time/zone.ts'
import type { ChoreOccurrence, ChoreTemplate, OccurrenceSeed, RecurrenceRule } from './types.ts'

/** Reminder instant used for all-day chores (no explicit `dueTime`). */
export const DEFAULT_DUE_TIME: TimeOfDay = { hour: 9, minute: 0 }

export interface GenerationContext {
  readonly fromInstant: number
  readonly horizonDays: number
  readonly timeZone: string
  readonly existing: readonly ChoreOccurrence[]
  /** For completion-relative chores: the date the chore was last completed, if any. */
  readonly lastCompletionDate?: LocalDate
}

function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date))
}

/**
 * The next calendar date strictly after `after` that satisfies a fixed-calendar rule,
 * anchored to `startDate` for multi-week intervals. Returns `null` for non-calendar
 * modes (completion-relative / frequency-target), which are not slot-based.
 */
export function nextSlotAfter(
  rule: RecurrenceRule,
  after: LocalDate,
  startDate: LocalDate,
): LocalDate | null {
  if (rule.mode === 'fixedWeekly') {
    if (rule.weekdays.length === 0) return null
    const interval = rule.interval && rule.interval > 0 ? rule.interval : 1
    const anchorMonday = daysFromCivil(mondayOf(startDate))
    for (let i = 1; i <= 366; i++) {
      const candidate = addDays(after, i)
      if (!rule.weekdays.includes(isoWeekday(candidate))) continue
      if (interval === 1) return candidate
      const weekIndex = Math.floor((daysFromCivil(mondayOf(candidate)) - anchorMonday) / 7)
      if (((weekIndex % interval) + interval) % interval === 0) return candidate
    }
    return null
  }
  if (rule.mode === 'fixedMonthly') {
    const dayIn = (year: number, month: number): number =>
      Math.min(rule.dayOfMonth, daysInMonth(year, month))
    const sameMonth: LocalDate = {
      year: after.year,
      month: after.month,
      day: dayIn(after.year, after.month),
    }
    if (compareLocalDate(sameMonth, after) > 0) return sameMonth
    const year = after.month === 12 ? after.year + 1 : after.year
    const month = after.month === 12 ? 1 : after.month + 1
    return { year, month, day: dayIn(year, month) }
  }
  return null
}

/**
 * Materialize the occurrences a template should have, up to `now + horizonDays`, without
 * duplicating any that already exist (matched by `generationKey`).
 *
 * - `completionRelative` and any `collapse` template keep at most one open occurrence.
 * - `keep`/`expire` fixed templates materialize every slot in the window.
 * - `frequencyTarget` is deferred to Phase 3 and throws if reached.
 */
export function generateUpTo(template: ChoreTemplate, ctx: GenerationContext): OccurrenceSeed[] {
  if (template.status !== 'active') return []

  const { timeZone } = ctx
  const today = localDateInZone(ctx.fromInstant, timeZone)
  const horizonEnd = addDays(today, ctx.horizonDays)
  const existingKeys = new Set(ctx.existing.map((o) => o.generationKey))
  const hasOpen = ctx.existing.some((o) => o.state === 'scheduled')

  const seedFor = (dueDate: LocalDate): OccurrenceSeed | null => {
    const generationKey = `${template.id}:${isoDate(dueDate)}`
    if (existingKeys.has(generationKey)) return null
    const time = template.dueTime ?? DEFAULT_DUE_TIME
    return {
      householdId: template.householdId,
      templateId: template.id,
      dueDate,
      dueTime: template.dueTime,
      dueInstant: instantFromZoned(dueDate, time, timeZone),
      responsibleId: template.defaultResponsibleId,
      generationKey,
    }
  }

  const rule = template.recurrence

  if (rule.mode === 'frequencyTarget') {
    throw new Error('frequencyTarget recurrence is not implemented until Phase 3')
  }

  if (rule.mode === 'completionRelative') {
    if (hasOpen) return []
    const nextDue = ctx.lastCompletionDate
      ? addDays(ctx.lastCompletionDate, rule.everyDays)
      : template.startDate
    if (compareLocalDate(nextDue, horizonEnd) > 0) return []
    const seed = seedFor(nextDue)
    return seed ? [seed] : []
  }

  const oneAtATime = template.missedPolicy === 'collapse'
  if (oneAtATime) {
    if (hasOpen) return []
    const maxExisting = ctx.existing.reduce<LocalDate | null>(
      (acc, o) => (acc === null ? o.dueDate : maxLocalDate(acc, o.dueDate)),
      null,
    )
    const floor = addDays(today, -1)
    const baseline = maxExisting
      ? maxLocalDate(maxExisting, floor)
      : maxLocalDate(addDays(template.startDate, -1), floor)
    const nextDue = nextSlotAfter(rule, baseline, template.startDate)
    if (!nextDue || compareLocalDate(nextDue, horizonEnd) > 0) return []
    const seed = seedFor(nextDue)
    return seed ? [seed] : []
  }

  // keep / expire: every slot in [max(startDate, today), horizonEnd].
  const windowStart = maxLocalDate(template.startDate, today)
  const seeds: OccurrenceSeed[] = []
  let cursor = nextSlotAfter(rule, addDays(windowStart, -1), template.startDate)
  while (cursor && compareLocalDate(cursor, horizonEnd) <= 0) {
    const seed = seedFor(cursor)
    if (seed) seeds.push(seed)
    cursor = nextSlotAfter(rule, cursor, template.startDate)
  }
  return seeds
}
