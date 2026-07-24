/**
 * Orchestration: load rows → run the pure Phase 0 engine → persist atomically. This is
 * the only worker code that both queries D1 and drives `src/shared/chore`. Every mutation
 * goes through a single `db.batch()` (D1 has no interactive transactions).
 */

import { and, desc, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import {
  applyCompletion,
  applyMissedPolicy,
  resolveTemporalStatus,
} from '../shared/chore/lifecycle.ts'
import { generateUpTo } from '../shared/chore/recurrence.ts'
import type {
  ChoreOccurrence,
  MissedPolicy,
  OccurrenceSeed,
  RecurrenceRule,
  TemporalStatus,
} from '../shared/chore/types.ts'
import type { LocalDate } from '../shared/time/civil.ts'
import { isoDate } from '../shared/time/civil.ts'
import type { TimeOfDay } from '../shared/time/zone.ts'
import { localDateInZone } from '../shared/time/zone.ts'
import type { Db } from './db/index.ts'
import {
  formatTimeOfDay,
  toCompletionRow,
  toEngineOccurrence,
  toEngineTemplate,
  toOccurrenceRow,
} from './db/mappers.ts'
import { activityEvents, choreOccurrences, choreTemplates, completionEvents } from './db/schema.ts'

const HORIZON_DAYS = 28

type Write = BatchItem<'sqlite'>
type TemplateRow = typeof choreTemplates.$inferSelect

function occurrenceFromSeed(seed: OccurrenceSeed): ChoreOccurrence {
  return { ...seed, id: crypto.randomUUID(), state: 'scheduled' }
}

async function runBatch(db: Db, writes: Write[]): Promise<void> {
  const [first, ...rest] = writes
  if (first) await db.batch([first, ...rest])
}

async function lastCompletionDate(db: Db, templateId: string, timeZone: string) {
  const rows = await db
    .select({ completedAt: completionEvents.completedAt })
    .from(completionEvents)
    .innerJoin(choreOccurrences, eq(completionEvents.occurrenceId, choreOccurrences.id))
    .where(eq(choreOccurrences.templateId, templateId))
    .orderBy(desc(completionEvents.completedAt))
    .limit(1)
  const row = rows[0]
  return row ? localDateInZone(row.completedAt, timeZone) : undefined
}

/** Write statements to bring one template's occurrences up to the horizon + apply policy. */
async function templateWrites(
  db: Db,
  templateRow: TemplateRow,
  timeZone: string,
  now: number,
): Promise<Write[]> {
  const template = toEngineTemplate(templateRow)
  const rows = await db
    .select()
    .from(choreOccurrences)
    .where(eq(choreOccurrences.templateId, templateRow.id))
  const existing = rows.map(toEngineOccurrence)

  const seeds = generateUpTo(template, {
    fromInstant: now,
    horizonDays: HORIZON_DAYS,
    timeZone,
    existing,
    lastCompletionDate:
      template.recurrence.mode === 'completionRelative'
        ? await lastCompletionDate(db, templateRow.id, timeZone)
        : undefined,
  })

  const writes: Write[] = seeds.map((seed) =>
    db.insert(choreOccurrences).values(toOccurrenceRow(occurrenceFromSeed(seed), now)),
  )
  for (const transition of applyMissedPolicy(template, existing, { now, timeZone })) {
    writes.push(
      db
        .update(choreOccurrences)
        .set({ state: transition.to })
        .where(eq(choreOccurrences.id, transition.occurrenceId)),
    )
  }
  return writes
}

/** Cron entry point: top up + sweep every active template in a household. */
export async function generateForHousehold(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
): Promise<void> {
  const templates = await db
    .select()
    .from(choreTemplates)
    .where(and(eq(choreTemplates.householdId, householdId), eq(choreTemplates.status, 'active')))
  const writes: Write[] = []
  for (const templateRow of templates) {
    writes.push(...(await templateWrites(db, templateRow, timeZone, now)))
  }
  await runBatch(db, writes)
}

export interface OccurrenceView {
  id: string
  name: string
  dueDate: string
  temporalStatus: TemporalStatus
  responsibleId: string | null
}

export async function listOpenOccurrences(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
): Promise<OccurrenceView[]> {
  const rows = await db
    .select({
      occurrence: choreOccurrences,
      templateName: choreTemplates.name,
    })
    .from(choreOccurrences)
    .leftJoin(choreTemplates, eq(choreOccurrences.templateId, choreTemplates.id))
    .where(
      and(eq(choreOccurrences.householdId, householdId), eq(choreOccurrences.state, 'scheduled')),
    )
  return rows.map(({ occurrence, templateName }) => ({
    id: occurrence.id,
    name: occurrence.title ?? templateName ?? 'Chore',
    dueDate: occurrence.dueDate,
    temporalStatus: resolveTemporalStatus(toEngineOccurrence(occurrence), { now, timeZone }),
    responsibleId: occurrence.responsibleId,
  }))
}

export async function completeOccurrence(
  db: Db,
  householdId: string,
  timeZone: string,
  occurrenceId: string,
  memberId: string,
  now: number,
): Promise<'ok' | 'not-found'> {
  const [row] = await db
    .select()
    .from(choreOccurrences)
    .where(eq(choreOccurrences.id, occurrenceId))
    .limit(1)
  if (!row || row.householdId !== householdId) return 'not-found'
  if (row.state !== 'scheduled') return 'ok' // idempotent

  const { event } = applyCompletion(
    toEngineOccurrence(row),
    { completedById: memberId, completedAt: now },
    { now, timeZone },
  )
  const writes: Write[] = [
    db
      .update(choreOccurrences)
      .set({ state: 'completed', version: row.version + 1 })
      .where(and(eq(choreOccurrences.id, occurrenceId), eq(choreOccurrences.version, row.version))),
    db.insert(completionEvents).values(toCompletionRow(event, crypto.randomUUID())),
    db.insert(activityEvents).values({
      id: crypto.randomUUID(),
      householdId,
      occurrenceId,
      actorId: memberId,
      type: 'completed',
      at: now,
    }),
  ]

  // Generate the follow-up occurrence (completion-relative / collapse produce one).
  if (row.templateId) {
    const [templateRow] = await db
      .select()
      .from(choreTemplates)
      .where(eq(choreTemplates.id, row.templateId))
      .limit(1)
    if (templateRow && templateRow.status === 'active') {
      const template = toEngineTemplate(templateRow)
      const others = (
        await db
          .select()
          .from(choreOccurrences)
          .where(eq(choreOccurrences.templateId, row.templateId))
      )
        .map(toEngineOccurrence)
        .map((o) => (o.id === occurrenceId ? { ...o, state: 'completed' as const } : o))
      const seeds = generateUpTo(template, {
        fromInstant: now,
        horizonDays: HORIZON_DAYS,
        timeZone,
        existing: others,
        lastCompletionDate: localDateInZone(now, timeZone),
      })
      for (const seed of seeds) {
        writes.push(
          db.insert(choreOccurrences).values(toOccurrenceRow(occurrenceFromSeed(seed), now)),
        )
      }
    }
  }

  await runBatch(db, writes)
  return 'ok'
}

export interface NewTemplate {
  name: string
  category?: string
  roomId?: string
  recurrence: RecurrenceRule
  missedPolicy: MissedPolicy
  startDate: LocalDate
  dueTime?: TimeOfDay
  estimatedEffortMinutes?: number
  defaultResponsibleId?: string
}

/** Create a chore template and generate its first occurrences. */
export async function createTemplate(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
  input: NewTemplate,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const templateRow: TemplateRow = {
    id,
    householdId,
    name: input.name,
    category: input.category ?? null,
    roomId: input.roomId ?? null,
    recurrence: input.recurrence,
    missedPolicy: input.missedPolicy,
    status: 'active',
    startDate: isoDate(input.startDate),
    dueTime: input.dueTime ? formatTimeOfDay(input.dueTime) : null,
    estimatedEffortMinutes: input.estimatedEffortMinutes ?? null,
    defaultResponsibleId: input.defaultResponsibleId ?? null,
    version: 1,
    createdAt: now,
  }
  await db.insert(choreTemplates).values(templateRow)
  await runBatch(db, await templateWrites(db, templateRow, timeZone, now))
  return { id }
}
