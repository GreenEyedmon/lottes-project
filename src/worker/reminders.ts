/**
 * Reminder cron: individual timed reminders (a timed occurrence just became due) and the
 * daily household digest. Delivery is Web Push with an email fallback, idempotent via the
 * `reminders.dedupeKey` unique constraint. Quiet hours and the digest time are per
 * household, evaluated in the household's zone.
 */

import { and, eq, gt, lte } from 'drizzle-orm'
import { resolveTemporalStatus } from '../shared/chore/lifecycle.ts'
import { isoDate } from '../shared/time/civil.ts'
import { zonedPartsFromInstant } from '../shared/time/zone.ts'
import { user } from './db/auth-schema.ts'
import type { Db } from './db/index.ts'
import { toEngineOccurrence } from './db/mappers.ts'
import {
  choreOccurrences,
  choreTemplates,
  households,
  members,
  pushSubscriptions,
  reminders,
} from './db/schema.ts'
import { sendEmail } from './email.ts'
import { type Notification, pushConfigured, sendPush } from './push.ts'

const LOOKBACK_MS = 15 * 60 * 1000

type HouseholdRow = typeof households.$inferSelect

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

/** Log a reminder; returns false if this dedupeKey was already sent (idempotent). */
async function claimReminder(
  db: Db,
  dedupeKey: string,
  occurrenceId: string | null,
  now: number,
): Promise<boolean> {
  const inserted = await db
    .insert(reminders)
    .values({
      id: crypto.randomUUID(),
      occurrenceId,
      remindAt: now,
      channel: 'push',
      sentAt: now,
      dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: reminders.id })
  return inserted.length > 0
}

async function notifyMember(
  db: Db,
  env: Env,
  memberId: string,
  notification: Notification,
): Promise<void> {
  let delivered = false
  if (pushConfigured(env)) {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, memberId))
    for (const sub of subs) {
      try {
        const status = await sendPush(env, sub, notification)
        if (status >= 200 && status < 300) delivered = true
        else if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        }
      } catch {
        // try the next endpoint
      }
    }
  }
  if (!delivered) {
    const [row] = await db
      .select({ email: user.email })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(eq(members.id, memberId))
      .limit(1)
    if (row?.email) {
      try {
        await sendEmail(env, row.email, notification.title, `<p>${notification.body}</p>`)
      } catch {
        // best effort
      }
    }
  }
}

async function notifyHousehold(
  db: Db,
  env: Env,
  householdId: string,
  notification: Notification,
): Promise<void> {
  const mems = await db.select().from(members).where(eq(members.householdId, householdId))
  for (const member of mems) await notifyMember(db, env, member.id, notification)
}

/**
 * Announce a member's action ("Alex completed Vacuum") to the rest of the household.
 * Opt-in per household (`activityEnabled`) and suppressed during quiet hours; the actor
 * never gets pinged about their own action. Called immediately from the action's request
 * path, not the cron — the in-app activity feed records it regardless of this switch.
 */
export async function announceActivity(
  db: Db,
  env: Env,
  household: HouseholdRow,
  actor: { id: string; displayName: string },
  occurrenceId: string,
  verb: string,
  now: number,
): Promise<void> {
  if (!household.activityEnabled) return
  const localHour = zonedPartsFromInstant(now, household.ianaTimeZone).hour
  if (inQuietHours(localHour, household.quietStartHour, household.quietEndHour)) return

  const [occ] = await db
    .select({ title: choreOccurrences.title, templateId: choreOccurrences.templateId })
    .from(choreOccurrences)
    .where(eq(choreOccurrences.id, occurrenceId))
    .limit(1)
  if (!occ) return
  let name = occ.title ?? 'a chore'
  if (occ.templateId) {
    const [template] = await db
      .select({ name: choreTemplates.name })
      .from(choreTemplates)
      .where(eq(choreTemplates.id, occ.templateId))
      .limit(1)
    if (template) name = template.name
  }

  const notification: Notification = {
    title: household.name,
    body: `${actor.displayName} ${verb} ${name}`,
  }
  const mems = await db.select().from(members).where(eq(members.householdId, household.id))
  for (const member of mems) {
    if (member.id === actor.id) continue
    await notifyMember(db, env, member.id, notification)
  }
}

async function timedReminders(db: Db, env: Env, household: HouseholdRow, now: number) {
  const due = await db
    .select()
    .from(choreOccurrences)
    .where(
      and(
        eq(choreOccurrences.householdId, household.id),
        eq(choreOccurrences.state, 'scheduled'),
        lte(choreOccurrences.dueInstant, now),
        gt(choreOccurrences.dueInstant, now - LOOKBACK_MS),
      ),
    )
  for (const occ of due) {
    if (!occ.dueTime) continue // all-day chores belong to the digest, not a timed ping
    if (!(await claimReminder(db, `due:${occ.id}`, occ.id, now))) continue
    let name = occ.title ?? 'A chore'
    if (occ.templateId) {
      const [template] = await db
        .select({ name: choreTemplates.name })
        .from(choreTemplates)
        .where(eq(choreTemplates.id, occ.templateId))
        .limit(1)
      if (template) name = template.name
    }
    const notification: Notification = { title: 'Chore due', body: `${name} is due now.` }
    if (occ.responsibleId) await notifyMember(db, env, occ.responsibleId, notification)
    else await notifyHousehold(db, env, household.id, notification)
  }
}

async function dailyDigest(db: Db, env: Env, household: HouseholdRow, now: number) {
  const parts = zonedPartsFromInstant(now, household.ianaTimeZone)
  if (parts.hour !== household.digestHour || parts.minute >= 5) return
  const localDate = isoDate({ year: parts.year, month: parts.month, day: parts.day })
  if (!(await claimReminder(db, `digest:${household.id}:${localDate}`, null, now))) return

  const rows = await db
    .select()
    .from(choreOccurrences)
    .where(
      and(eq(choreOccurrences.householdId, household.id), eq(choreOccurrences.state, 'scheduled')),
    )
  let dueCount = 0
  let overdueCount = 0
  let unassigned = 0
  for (const row of rows) {
    const status = resolveTemporalStatus(toEngineOccurrence(row), {
      now,
      timeZone: household.ianaTimeZone,
    })
    if (status === 'due') dueCount++
    else if (status === 'overdue') overdueCount++
    if ((status === 'due' || status === 'overdue') && !row.responsibleId) unassigned++
  }
  if (dueCount + overdueCount === 0) return
  await notifyHousehold(db, env, household.id, {
    title: 'Today in your household',
    body: `${dueCount} due, ${overdueCount} overdue, ${unassigned} unassigned.`,
  })
}

export async function runReminders(db: Db, env: Env, now: number): Promise<void> {
  const rows = await db.select().from(households)
  for (const household of rows) {
    const localHour = zonedPartsFromInstant(now, household.ianaTimeZone).hour
    if (
      household.remindersEnabled &&
      !inQuietHours(localHour, household.quietStartHour, household.quietEndHour)
    ) {
      await timedReminders(db, env, household, now)
    }
    if (household.digestEnabled) await dailyDigest(db, env, household, now)
  }
}
