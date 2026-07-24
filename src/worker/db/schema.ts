/**
 * D1 (SQLite) schema. Instants are epoch-ms integers, local dates are ISO `TEXT`
 * (`YYYY-MM-DD`), and the recurrence rule is stored as JSON. Enum columns mirror the
 * `src/shared/chore` unions. `src/shared` never imports this file — the mapping is
 * one-way, in `mappers.ts`.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { RecurrenceRule } from '../../shared/chore/types.ts'

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ianaTimeZone: text('iana_time_zone').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    // Linked to a Better Auth user in step 1b; null until then.
    userId: text('user_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('members_household_idx').on(t.householdId)],
)

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id),
  name: text('name').notNull(),
})

export const choreTemplates = sqliteTable(
  'chore_templates',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    category: text('category'),
    roomId: text('room_id').references(() => rooms.id),
    recurrence: text('recurrence', { mode: 'json' }).$type<RecurrenceRule>().notNull(),
    missedPolicy: text('missed_policy', { enum: ['collapse', 'keep', 'expire'] }).notNull(),
    status: text('status', { enum: ['active', 'paused', 'archived'] }).notNull(),
    startDate: text('start_date').notNull(),
    dueTime: text('due_time'),
    estimatedEffortMinutes: integer('estimated_effort_minutes'),
    defaultResponsibleId: text('default_responsible_id').references(() => members.id),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('templates_household_status_idx').on(t.householdId, t.status)],
)

export const choreOccurrences = sqliteTable(
  'chore_occurrences',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    // Null ⇒ a one-off task (uses `title`/`priority` below).
    templateId: text('template_id').references(() => choreTemplates.id),
    dueDate: text('due_date').notNull(),
    dueTime: text('due_time'),
    dueInstant: integer('due_instant').notNull(),
    state: text('state', {
      enum: ['scheduled', 'completed', 'skipped', 'cancelled', 'missed'],
    }).notNull(),
    responsibleId: text('responsible_id').references(() => members.id),
    postponedFrom: text('postponed_from'),
    title: text('title'),
    priority: integer('priority'),
    generationKey: text('generation_key').notNull().unique(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('occurrences_household_state_due_idx').on(t.householdId, t.state, t.dueDate),
    index('occurrences_template_idx').on(t.templateId),
  ],
)

export const completionEvents = sqliteTable('completion_events', {
  id: text('id').primaryKey(),
  occurrenceId: text('occurrence_id')
    .notNull()
    .references(() => choreOccurrences.id),
  completedById: text('completed_by_id')
    .notNull()
    .references(() => members.id),
  completedAt: integer('completed_at').notNull(),
  wasEarly: integer('was_early', { mode: 'boolean' }).notNull(),
  wasLate: integer('was_late', { mode: 'boolean' }).notNull(),
  byNonAssignee: integer('by_non_assignee', { mode: 'boolean' }).notNull(),
  effortActualMinutes: integer('effort_actual_minutes'),
  notes: text('notes'),
})

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    occurrenceId: text('occurrence_id').references(() => choreOccurrences.id),
    actorId: text('actor_id').references(() => members.id),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }),
    at: integer('at').notNull(),
  },
  (t) => [index('activity_household_at_idx').on(t.householdId, t.at)],
)

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id),
  code: text('code').notNull().unique(),
  email: text('email'),
  expiresAt: integer('expires_at').notNull(),
  acceptedBy: text('accepted_by').references(() => members.id),
  createdAt: integer('created_at').notNull(),
})

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    occurrenceId: text('occurrence_id')
      .notNull()
      .references(() => choreOccurrences.id),
    remindAt: integer('remind_at').notNull(),
    channel: text('channel', { enum: ['push', 'email'] }).notNull(),
    sentAt: integer('sent_at'),
    dedupeKey: text('dedupe_key').notNull().unique(),
  },
  (t) => [index('reminders_pending_idx').on(t.remindAt)],
)
