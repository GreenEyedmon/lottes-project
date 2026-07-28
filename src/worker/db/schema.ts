/**
 * D1 (SQLite) schema. Instants are epoch-ms integers, local dates are ISO `TEXT`
 * (`YYYY-MM-DD`), and the recurrence rule is stored as JSON. Enum columns mirror the
 * `src/shared/chore` unions. `src/shared` never imports this file — the mapping is
 * one-way, in `mappers.ts`.
 */

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RecurrenceRule } from '../../shared/chore/types.ts'
import type { SuggestionKind, SuggestionPatch } from '../../shared/suggest/types.ts'

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ianaTimeZone: text('iana_time_zone').notNull(),
  // Local hour (0-23) for the daily digest, and the quiet-hours window.
  digestHour: integer('digest_hour').notNull().default(8),
  quietStartHour: integer('quiet_start_hour').notNull().default(22),
  quietEndHour: integer('quiet_end_hour').notNull().default(7),
  // Per-type notification switches. Reminders + digest default on; activity
  // ("Alex completed Vacuum") defaults off so it's opt-in.
  remindersEnabled: integer('reminders_enabled', { mode: 'boolean' }).notNull().default(true),
  digestEnabled: integer('digest_enabled', { mode: 'boolean' }).notNull().default(true),
  activityEnabled: integer('activity_enabled', { mode: 'boolean' }).notNull().default(false),
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
    // When true, each generated occurrence rotates to the next household member (round-robin).
    rotate: integer('rotate', { mode: 'boolean' }).notNull().default(false),
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

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('push_member_idx').on(t.memberId)],
)

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    // Null for a household digest (no single occurrence).
    occurrenceId: text('occurrence_id').references(() => choreOccurrences.id),
    remindAt: integer('remind_at').notNull(),
    channel: text('channel', { enum: ['push', 'email'] }).notNull(),
    sentAt: integer('sent_at'),
    dedupeKey: text('dedupe_key').notNull().unique(),
  },
  (t) => [index('reminders_pending_idx').on(t.remindAt)],
)

export const suggestions = sqliteTable(
  'suggestions',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    templateId: text('template_id')
      .notNull()
      .references(() => choreTemplates.id),
    kind: text('kind').$type<SuggestionKind>().notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'dismissed'] }).notNull(),
    // The change an Accept applies, and the numbers that justify it.
    patch: text('patch', { mode: 'json' }).$type<SuggestionPatch>().notNull(),
    explanation: text('explanation').notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, number>>().notNull(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by').references(() => members.id),
    // `${templateId}:${kind}` while pending, NULL once resolved — so at most one open
    // suggestion of a kind per chore, while history (many NULLs) is retained.
    dedupeKey: text('dedupe_key').unique(),
  },
  (t) => [index('suggestions_household_status_idx').on(t.householdId, t.status)],
)

// --- Grocery module (Phase 4) ---

export const groceryItems = sqliteTable(
  'grocery_items',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    // Normalized (lowercased, trimmed, collapsed whitespace) for dedupe.
    nameKey: text('name_key').notNull(),
    category: text('category'),
    defaultUnit: text('default_unit'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('grocery_items_household_name_idx').on(t.householdId, t.nameKey)],
)

export const shoppingEntries = sqliteTable(
  'shopping_entries',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    itemId: text('item_id')
      .notNull()
      .references(() => groceryItems.id),
    // Free-text hint, never decremented — this is not inventory.
    quantity: text('quantity'),
    note: text('note'),
    status: text('status', { enum: ['needed', 'purchased'] }).notNull(),
    addedBy: text('added_by')
      .notNull()
      .references(() => members.id),
    addedAt: integer('added_at').notNull(),
    purchasedBy: text('purchased_by').references(() => members.id),
    purchasedAt: integer('purchased_at'),
    priceCents: integer('price_cents'),
    store: text('store'),
  },
  (t) => [
    index('shopping_household_status_idx').on(t.householdId, t.status),
    // At most one open line per item; re-adding bumps the existing line instead.
    uniqueIndex('shopping_open_line_idx')
      .on(t.householdId, t.itemId)
      .where(sql`${t.status} = 'needed'`),
  ],
)

// --- Meal planning (Phase 5) ---

export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    dietaryTags: text('dietary_tags', { mode: 'json' }).$type<string[]>().notNull(),
    cookMinutes: integer('cook_minutes'),
    servings: integer('servings'),
    createdBy: text('created_by')
      .notNull()
      .references(() => members.id),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('recipes_household_name_idx').on(t.householdId, t.nameKey)],
)

export const recipeIngredients = sqliteTable(
  'recipe_ingredients',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    // Shares the grocery catalog, so a recipe's ingredients speak the same item vocabulary
    // as the shopping list.
    itemId: text('item_id')
      .notNull()
      .references(() => groceryItems.id),
    quantity: text('quantity'),
    // Pantry basics (salt, oil) — never auto-added to the list when cooking.
    staple: integer('staple', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('recipe_ingredients_recipe_idx').on(t.recipeId)],
)
