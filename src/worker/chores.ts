/**
 * Orchestration: load rows → run the pure Phase 0 engine → persist atomically. This is
 * the only worker code that both queries D1 and drives `src/shared/chore`. Every mutation
 * goes through a single `db.batch()` (D1 has no interactive transactions).
 */

import { and, desc, eq, ne } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { rotatedResponsible } from '../shared/chore/assignment.ts'
import {
  applyCompletion,
  applyMissedPolicy,
  type PostponeMode,
  postpone,
  resolveTemporalStatus,
} from '../shared/chore/lifecycle.ts'
import { DEFAULT_DUE_TIME, generateUpTo } from '../shared/chore/recurrence.ts'
import type {
  ChoreOccurrence,
  MissedPolicy,
  OccurrenceSeed,
  RecurrenceRule,
  TemporalStatus,
} from '../shared/chore/types.ts'
import type { LocalDate } from '../shared/time/civil.ts'
import { addDays, compareLocalDate, isoDate } from '../shared/time/civil.ts'
import type { TimeOfDay } from '../shared/time/zone.ts'
import { instantFromZoned, localDateInZone } from '../shared/time/zone.ts'
import type { Db } from './db/index.ts'
import {
  formatTimeOfDay,
  toCompletionRow,
  toEngineOccurrence,
  toEngineTemplate,
  toOccurrenceRow,
} from './db/mappers.ts'
import {
  activityEvents,
  choreOccurrences,
  choreTemplates,
  completionEvents,
  members,
  rooms,
} from './db/schema.ts'

const HORIZON_DAYS = 28

type Write = BatchItem<'sqlite'>
type TemplateRow = typeof choreTemplates.$inferSelect

function occurrenceFromSeed(seed: OccurrenceSeed): ChoreOccurrence {
  return { ...seed, id: crypto.randomUUID(), state: 'scheduled' }
}

/** Household members in stable join order — the rotation ring. */
async function orderedMemberIds(db: Db, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.householdId, householdId))
    .orderBy(members.createdAt)
  return rows.map((r) => r.id)
}

/** The assignee of the latest-dated occurrence, i.e. who to rotate away from next. */
function mostRecentResponsible(existing: readonly ChoreOccurrence[]): string | null {
  let latest: ChoreOccurrence | null = null
  for (const occ of existing) {
    if (!latest || compareLocalDate(occ.dueDate, latest.dueDate) > 0) latest = occ
  }
  return latest?.responsibleId ?? null
}

/**
 * Generate the insert statements to top a template up to the horizon, applying round-robin
 * rotation when the template opts in. `existing` must already reflect the resolution being
 * processed (e.g. the just-completed occurrence marked `completed`) so the engine's
 * open-occurrence check and the rotation anchor both see the new state.
 */
async function generationWrites(
  db: Db,
  templateRow: TemplateRow,
  existing: readonly ChoreOccurrence[],
  timeZone: string,
  now: number,
  lastCompletion: LocalDate | undefined,
): Promise<Write[]> {
  const seeds = generateUpTo(toEngineTemplate(templateRow), {
    fromInstant: now,
    horizonDays: HORIZON_DAYS,
    timeZone,
    existing,
    lastCompletionDate: lastCompletion,
  })
  if (seeds.length === 0) return []

  let ring: string[] | null = null
  let previous = mostRecentResponsible(existing)
  const writes: Write[] = []
  for (const seed of seeds) {
    let occ = occurrenceFromSeed(seed)
    if (templateRow.rotate) {
      ring ??= await orderedMemberIds(db, templateRow.householdId)
      const next = rotatedResponsible(ring, previous)
      previous = next
      occ = { ...occ, responsibleId: next ?? undefined }
    }
    writes.push(db.insert(choreOccurrences).values(toOccurrenceRow(occ, now)))
  }
  return writes
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

  const writes = await generationWrites(
    db,
    templateRow,
    existing,
    timeZone,
    now,
    template.recurrence.mode === 'completionRelative'
      ? await lastCompletionDate(db, templateRow.id, timeZone)
      : undefined,
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
  templateId: string | null
  roomName: string | null
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
      roomName: rooms.name,
    })
    .from(choreOccurrences)
    .leftJoin(choreTemplates, eq(choreOccurrences.templateId, choreTemplates.id))
    .leftJoin(rooms, eq(choreTemplates.roomId, rooms.id))
    .where(
      and(eq(choreOccurrences.householdId, householdId), eq(choreOccurrences.state, 'scheduled')),
    )
  return rows.map(({ occurrence, templateName, roomName }) => ({
    id: occurrence.id,
    name: occurrence.title ?? templateName ?? 'Chore',
    dueDate: occurrence.dueDate,
    temporalStatus: resolveTemporalStatus(toEngineOccurrence(occurrence), { now, timeZone }),
    responsibleId: occurrence.responsibleId,
    templateId: occurrence.templateId,
    roomName: roomName ?? null,
  }))
}

export async function completeOccurrence(
  db: Db,
  householdId: string,
  timeZone: string,
  occurrenceId: string,
  memberId: string,
  now: number,
): Promise<'ok' | 'not-found' | 'not-due'> {
  const [row] = await db
    .select()
    .from(choreOccurrences)
    .where(eq(choreOccurrences.id, occurrenceId))
    .limit(1)
  if (!row || row.householdId !== householdId) return 'not-found'
  if (row.state !== 'scheduled') return 'ok' // idempotent
  // Only due/overdue occurrences may be completed — completing a not-yet-due one would
  // let a recurring chore race ahead of its schedule.
  if (resolveTemporalStatus(toEngineOccurrence(row), { now, timeZone }) === 'upcoming') {
    return 'not-due'
  }

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
      const others = (
        await db
          .select()
          .from(choreOccurrences)
          .where(eq(choreOccurrences.templateId, row.templateId))
      )
        .map(toEngineOccurrence)
        .map((o) => (o.id === occurrenceId ? { ...o, state: 'completed' as const } : o))
      writes.push(
        ...(await generationWrites(
          db,
          templateRow,
          others,
          timeZone,
          now,
          localDateInZone(now, timeZone),
        )),
      )
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
  rotate?: boolean
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
    rotate: input.rotate ?? false,
    version: 1,
    createdAt: now,
  }
  await db.insert(choreTemplates).values(templateRow)
  await runBatch(db, await templateWrites(db, templateRow, timeZone, now))
  return { id }
}

function activityWrite(
  db: Db,
  householdId: string,
  occurrenceId: string | null,
  actorId: string,
  type: string,
  now: number,
): Write {
  return db
    .insert(activityEvents)
    .values({ id: crypto.randomUUID(), householdId, occurrenceId, actorId, type, at: now })
}

/** Generate the follow-up occurrence after `resolvedId` is resolved (skipped/completed). */
async function followUpWrites(
  db: Db,
  templateId: string,
  resolvedId: string,
  timeZone: string,
  now: number,
  lastCompletion?: LocalDate,
): Promise<Write[]> {
  const [templateRow] = await db
    .select()
    .from(choreTemplates)
    .where(eq(choreTemplates.id, templateId))
    .limit(1)
  if (!templateRow || templateRow.status !== 'active') return []
  const existing = (
    await db.select().from(choreOccurrences).where(eq(choreOccurrences.templateId, templateId))
  )
    .map(toEngineOccurrence)
    .map((o) => (o.id === resolvedId ? { ...o, state: 'skipped' as const } : o))
  return generationWrites(db, templateRow, existing, timeZone, now, lastCompletion)
}

export async function skipOccurrence(
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
  if (row.state !== 'scheduled') return 'ok'
  const writes: Write[] = [
    db
      .update(choreOccurrences)
      .set({ state: 'skipped', version: row.version + 1 })
      .where(and(eq(choreOccurrences.id, occurrenceId), eq(choreOccurrences.version, row.version))),
    activityWrite(db, householdId, occurrenceId, memberId, 'skipped', now),
  ]
  if (row.templateId) {
    const last = await lastCompletionDate(db, row.templateId, timeZone)
    writes.push(...(await followUpWrites(db, row.templateId, occurrenceId, timeZone, now, last)))
  }
  await runBatch(db, writes)
  return 'ok'
}

export async function claimOccurrence(
  db: Db,
  householdId: string,
  occurrenceId: string,
  memberId: string,
  now: number,
): Promise<'ok' | 'not-found' | 'taken'> {
  const [row] = await db
    .select()
    .from(choreOccurrences)
    .where(eq(choreOccurrences.id, occurrenceId))
    .limit(1)
  if (!row || row.householdId !== householdId || row.state !== 'scheduled') return 'not-found'
  if (row.responsibleId && row.responsibleId !== memberId) return 'taken'
  await runBatch(db, [
    db
      .update(choreOccurrences)
      .set({ responsibleId: memberId, version: row.version + 1 })
      .where(and(eq(choreOccurrences.id, occurrenceId), eq(choreOccurrences.version, row.version))),
    activityWrite(db, householdId, occurrenceId, memberId, 'claimed', now),
  ])
  return 'ok'
}

export async function postponeOccurrence(
  db: Db,
  householdId: string,
  timeZone: string,
  occurrenceId: string,
  memberId: string,
  mode: PostponeMode,
  days: number,
  now: number,
): Promise<'ok' | 'not-found'> {
  const [row] = await db
    .select()
    .from(choreOccurrences)
    .where(eq(choreOccurrences.id, occurrenceId))
    .limit(1)
  if (!row || row.householdId !== householdId || row.state !== 'scheduled') return 'not-found'
  const occ = toEngineOccurrence(row)
  const newDueDate = addDays(occ.dueDate, days)

  if (!row.templateId) {
    await runBatch(db, [
      db
        .update(choreOccurrences)
        .set({
          dueDate: isoDate(newDueDate),
          dueInstant: instantFromZoned(newDueDate, occ.dueTime ?? DEFAULT_DUE_TIME, timeZone),
          postponedFrom: row.postponedFrom ?? row.dueDate,
          version: row.version + 1,
        })
        .where(
          and(eq(choreOccurrences.id, occurrenceId), eq(choreOccurrences.version, row.version)),
        ),
      activityWrite(db, householdId, occurrenceId, memberId, 'postponed', now),
    ])
    return 'ok'
  }

  const [templateRow] = await db
    .select()
    .from(choreTemplates)
    .where(eq(choreTemplates.id, row.templateId))
    .limit(1)
  if (!templateRow) return 'not-found'
  const moved = postpone(occ, mode, newDueDate, toEngineTemplate(templateRow), { timeZone })
  const writes: Write[] = [
    db
      .update(choreOccurrences)
      .set({
        dueDate: isoDate(moved.occurrence.dueDate),
        dueInstant: moved.occurrence.dueInstant,
        postponedFrom: isoDate(moved.occurrence.postponedFrom ?? occ.dueDate),
        version: row.version + 1,
      })
      .where(and(eq(choreOccurrences.id, occurrenceId), eq(choreOccurrences.version, row.version))),
    activityWrite(db, householdId, occurrenceId, memberId, 'postponed', now),
  ]
  if (mode === 'thisAndFuture') {
    writes.push(
      db
        .update(choreTemplates)
        .set({ recurrence: moved.template.recurrence, version: templateRow.version + 1 })
        .where(
          and(
            eq(choreTemplates.id, templateRow.id),
            eq(choreTemplates.version, templateRow.version),
          ),
        ),
    )
    writes.push(
      db
        .update(choreOccurrences)
        .set({ state: 'cancelled' })
        .where(
          and(
            eq(choreOccurrences.templateId, templateRow.id),
            eq(choreOccurrences.state, 'scheduled'),
            ne(choreOccurrences.id, occurrenceId),
          ),
        ),
    )
  }
  await runBatch(db, writes)
  if (mode === 'thisAndFuture') {
    const [updated] = await db
      .select()
      .from(choreTemplates)
      .where(eq(choreTemplates.id, templateRow.id))
      .limit(1)
    if (updated) await runBatch(db, await templateWrites(db, updated, timeZone, now))
  }
  return 'ok'
}

export interface NewOneOff {
  title: string
  dueDate: LocalDate
  dueTime?: TimeOfDay
  priority?: number
  responsibleId?: string
}

export async function createOneOff(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
  input: NewOneOff,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  await db.insert(choreOccurrences).values({
    id,
    householdId,
    templateId: null,
    dueDate: isoDate(input.dueDate),
    dueTime: input.dueTime ? formatTimeOfDay(input.dueTime) : null,
    dueInstant: instantFromZoned(input.dueDate, input.dueTime ?? DEFAULT_DUE_TIME, timeZone),
    state: 'scheduled',
    responsibleId: input.responsibleId ?? null,
    title: input.title,
    priority: input.priority ?? null,
    generationKey: `oneoff:${id}`,
    createdAt: now,
  })
  return { id }
}

export interface TemplateChange {
  recurrence?: RecurrenceRule
  dueTime?: TimeOfDay | null
  rotate?: boolean
}

/**
 * Apply a schedule change to a template (used by accepted Phase 3 suggestions): bump the
 * template, cancel its future `scheduled` occurrences, regenerate from the new rule, and
 * log a `ruleChanged` activity. Optimistically concurrent on the template version.
 */
export async function applyTemplateChange(
  db: Db,
  householdId: string,
  timeZone: string,
  templateId: string,
  change: TemplateChange,
  actorId: string,
  now: number,
): Promise<'ok' | 'not-found'> {
  const [templateRow] = await db
    .select()
    .from(choreTemplates)
    .where(eq(choreTemplates.id, templateId))
    .limit(1)
  if (!templateRow || templateRow.householdId !== householdId) return 'not-found'

  const set: Partial<typeof choreTemplates.$inferInsert> = { version: templateRow.version + 1 }
  if (change.recurrence) set.recurrence = change.recurrence
  if (change.dueTime !== undefined) {
    set.dueTime = change.dueTime ? formatTimeOfDay(change.dueTime) : null
  }
  if (change.rotate !== undefined) set.rotate = change.rotate

  await runBatch(db, [
    db
      .update(choreTemplates)
      .set(set)
      .where(
        and(eq(choreTemplates.id, templateId), eq(choreTemplates.version, templateRow.version)),
      ),
    db
      .update(choreOccurrences)
      .set({ state: 'cancelled' })
      .where(
        and(eq(choreOccurrences.templateId, templateId), eq(choreOccurrences.state, 'scheduled')),
      ),
    activityWrite(db, householdId, null, actorId, 'ruleChanged', now),
  ])

  const [updated] = await db
    .select()
    .from(choreTemplates)
    .where(eq(choreTemplates.id, templateId))
    .limit(1)
  if (updated) await runBatch(db, await templateWrites(db, updated, timeZone, now))
  return 'ok'
}
