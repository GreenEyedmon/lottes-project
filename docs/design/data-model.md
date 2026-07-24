# Phase 1 · Step 1a — Data model (D1 + Drizzle)

**Status: draft for review.** No schema code written yet. Per `CLAUDE.md`, schema is
reviewed before code. This maps the Phase 0 domain types (`src/shared/chore/types.ts`)
to D1 tables and defines the migration workflow.

## Phase 1 decomposition (each its own PR, stacked in order)

| Step | Scope | This doc |
|------|-------|----------|
| **1a Data model** | Drizzle schema, migrations, repository, wire D1 | ← here |
| 1b Identity | Better Auth + households / members / rooms setup | |
| 1c Chores | Template + occurrence + one-off CRUD, generation cron | |
| 1d Daily UI | Today / Upcoming, complete / claim / postpone / skip (TanStack Router + Query) | |
| 1e Notifications | Web Push + VAPID, Resend fallback, reminder cron, quiet hours | |
| 1f History | Completion history + weekly/monthly tally | |

## Principles

- **SQLite via D1.** Text UUID primary keys (`crypto.randomUUID()` in the Worker).
- **Instants are `INTEGER` epoch-ms UTC.** Local dates are `TEXT` `YYYY-MM-DD`
  (sortable, matches the Phase 0 `isoDate`). Day-boundary logic stays in TypeScript.
- **The recurrence rule is stored as JSON** (`text({ mode: 'json' })`) — it is a typed
  union owned by `src/shared`, not something to normalize into columns.
- **One-way mapping.** `src/worker/db` (Workers-only) maps rows ↔ the pure `src/shared`
  domain types. `src/shared` never imports Drizzle or the schema.
- **Idempotency** via a `UNIQUE` `generation_key` on occurrences — the DB enforces what
  the Phase 0 engine already guarantees, so a retried generation can't double-insert.
- **Optimistic concurrency** via an `INTEGER version` on mutable rows (templates,
  occurrences); D1 has no interactive transactions, so read-compute-write uses a
  `WHERE version = ?` guard and atomic multi-row writes go in one `db.batch()`.

## Tables

`households`
- `id` PK, `name`, `iana_time_zone`, `created_at`

`members` — a person within a household
- `id` PK, `household_id` → households, `display_name`, `role`
- `user_id` (nullable until Better Auth lands in 1b), `created_at`
- index on `household_id`

`rooms`
- `id` PK, `household_id` → households, `name`

`chore_templates`
- `id` PK, `household_id` → households, `name`, `category`, `room_id` → rooms (nullable)
- `recurrence` JSON (`RecurrenceRule`), `missed_policy`, `status`
- `start_date` TEXT (ISO), `due_time` TEXT `HH:MM` (nullable ⇒ all-day)
- `estimated_effort_minutes` (nullable), `default_responsible_id` → members (nullable)
- `version`, `created_at`
- index on `(household_id, status)`

`chore_occurrences`
- `id` PK, `household_id` → households, `template_id` → templates (**nullable ⇒ one-off**)
- `due_date` TEXT (ISO), `due_time` TEXT (nullable), `due_instant` INTEGER
- `state` (`scheduled|completed|skipped|cancelled|missed`), `responsible_id` → members (nullable)
- `postponed_from` TEXT (nullable), `priority` INTEGER (one-off tasks), `title` (one-off; else null)
- `generation_key` TEXT **UNIQUE**, `version`, `created_at`
- indexes on `(household_id, state, due_date)` and `(template_id)`

`completion_events` — append-only
- `id` PK, `occurrence_id` → occurrences, `completed_by_id` → members, `completed_at` INTEGER
- `was_early`, `was_late`, `by_non_assignee` (INTEGER 0/1), `effort_actual_minutes` (nullable), `notes` (nullable)

`activity_events` — append-only audit log
- `id` PK, `household_id`, `occurrence_id` (nullable), `actor_id` (nullable)
- `type`, `payload` JSON, `at` INTEGER
- index on `(household_id, at)`

`reminders` — drives the notification cron (chores and one-off tasks)
- `id` PK, `occurrence_id` → occurrences, `remind_at` INTEGER, `channel`
- `sent_at` INTEGER (nullable), `dedupe_key` TEXT **UNIQUE** (idempotent delivery)
- index on `(remind_at)` where `sent_at IS NULL`

## Enums

Stored as `TEXT`, typed at the Drizzle layer with `{ enum: [...] }` to mirror the
`src/shared` unions — no separate lookup tables. Kept in one place and asserted by a
mapping test so the DB and domain can't drift.

## Migration workflow

- **Author** with `drizzle-kit generate` → versioned SQL files in `migrations/`.
- **Apply** with `wrangler d1 migrations apply lottes-db` (`--local` for dev, `--remote`
  in CI). SQL lives in the repo and is reviewed in the PR; the apply reuses the
  `CLOUDFLARE_API_TOKEN` already in CI. (I'll confirm the exact `drizzle.config.ts` +
  `migrations_pattern` against current docs when implementing — not from memory.)
- **CI**: add a migrate step to the `deploy` job that runs **before** `wrangler deploy`,
  so schema changes are live before the code that needs them.
- **Scripts**: `db:generate`, `db:migrate:local`, `db:migrate` (remote).

## New dependencies

`drizzle-orm` (runtime) and `drizzle-kit` (dev) — both MIT, no service, free at any
scale. Nothing else added in this step.

## Decisions to confirm

1. **Local dates as ISO `TEXT`** + instants as epoch-ms `INTEGER` (vs. storing date
   parts) — my recommendation; sortable and matches Phase 0.
2. **One `chore_occurrences` table for chores *and* one-off tasks** (`template_id` null,
   plus `title`/`priority`), rather than a separate tasks table — the spec models one-offs
   as occurrences without a template.
3. **`reminders` as its own table** driven by a cron, vs. computing reminders on the fly
   — a table makes delivery idempotent and quiet-hours easy.
4. **App-generated UUID text PKs** (`crypto.randomUUID()`), vs. integer autoincrement.
5. **Migrations applied via `wrangler` in CI** (SQL in repo), vs. Drizzle's direct
   `d1-http` apply — keeps migrations reviewable and reuses the CI token.
