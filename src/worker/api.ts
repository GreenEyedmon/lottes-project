/**
 * Household / member / room / invite API. Every route here requires a session (the
 * requireAuth middleware runs first). Chore routes arrive in step 1c.
 */

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PostponeMode } from '../shared/chore/lifecycle.ts'
import type { RecurrenceRule } from '../shared/chore/types.ts'
import type { LocalDate } from '../shared/time/civil.ts'
import type { TimeOfDay } from '../shared/time/zone.ts'
import { localDateInZone } from '../shared/time/zone.ts'
import { getSessionUser } from './auth.ts'
import {
  claimOccurrence,
  completeOccurrence,
  createOneOff,
  createTemplate,
  listOpenOccurrences,
  type NewTemplate,
  postponeOccurrence,
  skipOccurrence,
} from './chores.ts'
import { getDb } from './db/index.ts'
import { households, invites, members, rooms } from './db/schema.ts'
import { isInviteUsable, newInviteCode } from './invites.ts'

type SessionUser = { id: string; email: string; name: string }

/** A member's display name, falling back to the email's local part when unset. */
function displayNameFor(user: SessionUser): string {
  return user.name.trim() || user.email.split('@')[0] || 'Member'
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const api = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

api.use('*', async (c, next) => {
  const user = await getSessionUser(c.env, c.req.raw.headers)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', { id: user.id, email: user.email, name: user.name })
  await next()
})

/** Create a household and the caller's owner membership. One household per user (MVP). */
api.post('/households', async (c) => {
  const user = c.get('user')
  const { name, timeZone } = await c.req.json<{ name: string; timeZone: string }>()
  if (!name || !timeZone) return c.json({ error: 'name and timeZone are required' }, 400)
  const db = getDb(c.env.DB)

  const [existing] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1)
  if (existing) return c.json({ error: 'already in a household' }, 409)

  const now = Date.now()
  const householdId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  await db.batch([
    db.insert(households).values({ id: householdId, name, ianaTimeZone: timeZone, createdAt: now }),
    db.insert(members).values({
      id: memberId,
      householdId,
      displayName: displayNameFor(user),
      role: 'owner',
      userId: user.id,
      createdAt: now,
    }),
  ])
  return c.json({ id: householdId, name, timeZone }, 201)
})

/** The caller's household with its members and rooms. */
api.get('/households/current', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env.DB)
  const [me] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1)
  if (!me) return c.json({ error: 'no household' }, 404)

  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, me.householdId))
    .limit(1)
  const memberList = await db.select().from(members).where(eq(members.householdId, me.householdId))
  const roomList = await db.select().from(rooms).where(eq(rooms.householdId, me.householdId))
  return c.json({ household, me, members: memberList, rooms: roomList })
})

/** Owner-only: mint an invite code. */
api.post('/households/:id/invites', async (c) => {
  const user = c.get('user')
  const householdId = c.req.param('id')
  const db = getDb(c.env.DB)
  const [me] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1)
  if (!me || me.householdId !== householdId || me.role !== 'owner') {
    return c.json({ error: 'forbidden' }, 403)
  }

  const now = Date.now()
  const code = newInviteCode()
  await db.insert(invites).values({
    id: crypto.randomUUID(),
    householdId,
    code,
    expiresAt: now + INVITE_TTL_MS,
    createdAt: now,
  })
  return c.json({ code, expiresAt: now + INVITE_TTL_MS }, 201)
})

/** Join a household via an invite code. */
api.post('/invites/:code/accept', async (c) => {
  const user = c.get('user')
  const code = c.req.param('code')
  const db = getDb(c.env.DB)

  const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1)
  if (!invite || !isInviteUsable(invite, Date.now())) {
    return c.json({ error: 'invalid or expired invite' }, 400)
  }
  const [existing] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1)
  if (existing) return c.json({ error: 'already in a household' }, 409)

  const now = Date.now()
  const memberId = crypto.randomUUID()
  await db.batch([
    db.insert(members).values({
      id: memberId,
      householdId: invite.householdId,
      displayName: displayNameFor(user),
      role: 'member',
      userId: user.id,
      createdAt: now,
    }),
    db.update(invites).set({ acceptedBy: memberId }).where(eq(invites.id, invite.id)),
  ])
  return c.json({ householdId: invite.householdId }, 201)
})

async function callerHouseholdId(env: Env, userId: string): Promise<string | null> {
  const db = getDb(env.DB)
  const [me] = await db.select().from(members).where(eq(members.userId, userId)).limit(1)
  return me?.householdId ?? null
}

api.post('/rooms', async (c) => {
  const user = c.get('user')
  const { name } = await c.req.json<{ name: string }>()
  if (!name) return c.json({ error: 'name is required' }, 400)
  const householdId = await callerHouseholdId(c.env, user.id)
  if (!householdId) return c.json({ error: 'no household' }, 404)

  const id = crypto.randomUUID()
  await getDb(c.env.DB).insert(rooms).values({ id, householdId, name })
  return c.json({ id, name }, 201)
})

api.get('/rooms', async (c) => {
  const user = c.get('user')
  const householdId = await callerHouseholdId(c.env, user.id)
  if (!householdId) return c.json({ error: 'no household' }, 404)
  const roomList = await getDb(c.env.DB)
    .select()
    .from(rooms)
    .where(eq(rooms.householdId, householdId))
  return c.json({ rooms: roomList })
})

api.delete('/rooms/:id', async (c) => {
  const user = c.get('user')
  const householdId = await callerHouseholdId(c.env, user.id)
  if (!householdId) return c.json({ error: 'no household' }, 404)
  const db = getDb(c.env.DB)
  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, c.req.param('id')))
    .limit(1)
  if (!room || room.householdId !== householdId) return c.json({ error: 'not found' }, 404)
  await db.delete(rooms).where(eq(rooms.id, room.id))
  return c.body(null, 204)
})

// --- Chores (step 1c) ---

/** Resolve the caller's member + household (with its timezone), or null. */
async function callerContext(env: Env, userId: string) {
  const db = getDb(env.DB)
  const [member] = await db.select().from(members).where(eq(members.userId, userId)).limit(1)
  if (!member) return null
  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, member.householdId))
    .limit(1)
  return household ? { member, household } : null
}

api.post('/templates', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const body = await c.req.json<Partial<NewTemplate> & { recurrence?: RecurrenceRule }>()
  if (!body.name || !body.recurrence) {
    return c.json({ error: 'name and recurrence are required' }, 400)
  }
  const now = Date.now()
  const timeZone = ctx.household.ianaTimeZone
  const result = await createTemplate(getDb(c.env.DB), ctx.household.id, timeZone, now, {
    name: body.name,
    recurrence: body.recurrence,
    missedPolicy: body.missedPolicy ?? 'collapse',
    startDate: body.startDate ?? localDateInZone(now, timeZone),
    dueTime: body.dueTime,
    category: body.category,
    roomId: body.roomId,
    estimatedEffortMinutes: body.estimatedEffortMinutes,
    defaultResponsibleId: body.defaultResponsibleId,
  })
  return c.json(result, 201)
})

api.get('/occurrences', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const occurrences = await listOpenOccurrences(
    getDb(c.env.DB),
    ctx.household.id,
    ctx.household.ianaTimeZone,
    Date.now(),
  )
  return c.json({ occurrences })
})

api.post('/occurrences/:id/complete', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const result = await completeOccurrence(
    getDb(c.env.DB),
    ctx.household.id,
    ctx.household.ianaTimeZone,
    c.req.param('id'),
    ctx.member.id,
    Date.now(),
  )
  if (result === 'not-found') return c.json({ error: 'not found' }, 404)
  if (result === 'not-due') return c.json({ error: 'not due yet' }, 400)
  return c.json({ ok: true })
})

api.post('/occurrences/:id/skip', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const result = await skipOccurrence(
    getDb(c.env.DB),
    ctx.household.id,
    ctx.household.ianaTimeZone,
    c.req.param('id'),
    ctx.member.id,
    Date.now(),
  )
  if (result === 'not-found') return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

api.post('/occurrences/:id/claim', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const result = await claimOccurrence(
    getDb(c.env.DB),
    ctx.household.id,
    c.req.param('id'),
    ctx.member.id,
    Date.now(),
  )
  if (result === 'not-found') return c.json({ error: 'not found' }, 404)
  if (result === 'taken') return c.json({ error: 'already claimed' }, 409)
  return c.json({ ok: true })
})

api.post('/occurrences/:id/postpone', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const body = await c.req.json<{ mode?: PostponeMode; days?: number }>()
  const result = await postponeOccurrence(
    getDb(c.env.DB),
    ctx.household.id,
    ctx.household.ianaTimeZone,
    c.req.param('id'),
    ctx.member.id,
    body.mode ?? 'this',
    body.days ?? 1,
    Date.now(),
  )
  if (result === 'not-found') return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

api.post('/tasks', async (c) => {
  const user = c.get('user')
  const ctx = await callerContext(c.env, user.id)
  if (!ctx) return c.json({ error: 'no household' }, 404)
  const body = await c.req.json<{ title?: string; dueDate?: LocalDate; dueTime?: TimeOfDay }>()
  if (!body.title) return c.json({ error: 'title is required' }, 400)
  const now = Date.now()
  const timeZone = ctx.household.ianaTimeZone
  const result = await createOneOff(getDb(c.env.DB), ctx.household.id, timeZone, now, {
    title: body.title,
    dueDate: body.dueDate ?? localDateInZone(now, timeZone),
    dueTime: body.dueTime,
  })
  return c.json(result, 201)
})
