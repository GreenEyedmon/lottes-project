/**
 * History & workload: read-only aggregates over the append-only completion/activity logs.
 * Effort is a chore's estimated minutes (or the recorded actual for one-offs). Framing is
 * informational — shares of effort, never a ranking that shames.
 */

import { and, desc, eq, gte } from 'drizzle-orm'
import type { LocalDate } from '../shared/time/civil.ts'
import { addDays, isoWeekday } from '../shared/time/civil.ts'
import { instantFromZoned, localDateInZone } from '../shared/time/zone.ts'
import type { Db } from './db/index.ts'
import {
  activityEvents,
  choreOccurrences,
  choreTemplates,
  completionEvents,
  members,
} from './db/schema.ts'

export type HistoryWindow = 'week' | 'month'

/** The instant that starts the current calendar week (Monday) or month, in `tz`. */
function windowStartInstant(window: HistoryWindow, tz: string, now: number): number {
  const today = localDateInZone(now, tz)
  const start: LocalDate =
    window === 'week'
      ? addDays(today, 1 - isoWeekday(today))
      : { year: today.year, month: today.month, day: 1 }
  return instantFromZoned(start, { hour: 0, minute: 0 }, tz)
}

export interface TallyEntry {
  memberId: string
  name: string
  completed: number
  effortMinutes: number
}

export interface ActivityEntry {
  id: string
  text: string
  at: number
}

export interface HistoryView {
  window: HistoryWindow
  tally: TallyEntry[]
  totalEffort: number
  activity: ActivityEntry[]
}

const VERB: Record<string, string> = {
  completed: 'completed',
  skipped: 'skipped',
  postponed: 'postponed',
  claimed: 'claimed',
}

export async function getHistory(
  db: Db,
  householdId: string,
  tz: string,
  window: HistoryWindow,
  now: number,
): Promise<HistoryView> {
  const start = windowStartInstant(window, tz, now)

  const completions = await db
    .select({
      completedById: completionEvents.completedById,
      name: members.displayName,
      effortActual: completionEvents.effortActualMinutes,
      effortEstimate: choreTemplates.estimatedEffortMinutes,
    })
    .from(completionEvents)
    .innerJoin(choreOccurrences, eq(completionEvents.occurrenceId, choreOccurrences.id))
    .innerJoin(members, eq(completionEvents.completedById, members.id))
    .leftJoin(choreTemplates, eq(choreOccurrences.templateId, choreTemplates.id))
    .where(
      and(eq(choreOccurrences.householdId, householdId), gte(completionEvents.completedAt, start)),
    )

  const byMember = new Map<string, TallyEntry>()
  for (const row of completions) {
    const effort = row.effortActual ?? row.effortEstimate ?? 0
    const entry = byMember.get(row.completedById) ?? {
      memberId: row.completedById,
      name: row.name,
      completed: 0,
      effortMinutes: 0,
    }
    entry.completed += 1
    entry.effortMinutes += effort
    byMember.set(row.completedById, entry)
  }
  const tally = [...byMember.values()].sort((a, b) => b.effortMinutes - a.effortMinutes)
  const totalEffort = tally.reduce((sum, entry) => sum + entry.effortMinutes, 0)

  const events = await db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      at: activityEvents.at,
      actor: members.displayName,
      title: choreOccurrences.title,
      templateName: choreTemplates.name,
    })
    .from(activityEvents)
    .leftJoin(members, eq(activityEvents.actorId, members.id))
    .leftJoin(choreOccurrences, eq(activityEvents.occurrenceId, choreOccurrences.id))
    .leftJoin(choreTemplates, eq(choreOccurrences.templateId, choreTemplates.id))
    .where(eq(activityEvents.householdId, householdId))
    .orderBy(desc(activityEvents.at))
    .limit(20)

  const activity: ActivityEntry[] = events.map((e) => ({
    id: e.id,
    at: e.at,
    text: `${e.actor ?? 'Someone'} ${VERB[e.type] ?? e.type} ${e.title ?? e.templateName ?? 'a chore'}`,
  }))

  return { window, tally, totalEffort, activity }
}
