# Phase 1 · Step 1c — Chores (engine ↔ DB ↔ API + generation cron)

**Status: draft for review.** No code yet. This wires the already-tested Phase 0 engine
(`src/shared/chore`) to the D1 repository (1a mappers) and the session-gated API (1b
`requireMember`), and adds the occurrence-generation cron. No new dependencies; no new
engine logic (Phase 0 is done).

## The orchestration layer (`src/worker/chores.ts`)

Thin functions that load rows → call the pure engine → persist, **atomically**:

- **generate(householdId, now)** — for each `active` template: map rows → engine, run
  `generateUpTo` (horizon 28d) and `applyMissedPolicy`, then persist new seeds +
  state transitions in **one `db.batch()`**. The `UNIQUE generation_key` makes reruns
  idempotent.
- **complete(occurrenceId, memberId, now)** — `applyCompletion` → in one batch: insert
  the completion event, set the occurrence `completed` (guarded by `WHERE version = ?`),
  and materialize the next occurrence (completion-relative / collapse produce one).
  A repeat call on an already-completed occurrence is a no-op (idempotent).
- **postpone / skip / claim** — call the engine transition, persist the occurrence (and,
  for shift-this-and-future, the template's new anchor). `claim` = reassign an
  unassigned occurrence to the caller.
- **rescheduleTemplate** — on a recurrence change: cancel future `scheduled`
  occurrences, regenerate from the change point, append an activity event (Phase 0 §4).

Every mutation appends an **activity event**.

## API (all behind `requireMember`)

- **Templates**: `POST /api/templates`, `GET /api/templates`, `PATCH /api/templates/:id`
  (rename / pause / archive / change rule), from a small built-in catalog or custom.
- **One-off tasks**: `POST /api/tasks` — an occurrence with `templateId = null`, plus
  `title` / `priority` / optional `dueTime`.
- **Occurrences**: `GET /api/occurrences` — returns each open occurrence with its
  **derived** `temporalStatus` (`resolveTemporalStatus` at read time, in the household
  zone), so the client gets Today / Upcoming / Overdue without storing status.
- **Actions**: `POST /api/occurrences/:id/{complete,skip,postpone,claim}`.

## Generation cron

- A `scheduled()` handler (worker exports `{ fetch, scheduled }`) runs `generate(...)`
  for every household and sweeps missed-occurrence policies.
- **Schedule: daily** (`"0 3 * * *"`, 03:00 UTC) — the horizon only needs periodic
  top-up, and "due today" is derived at read time, so generation lag is harmless. The
  minute-granularity reminder cron is a separate 1e concern. Cron Triggers are free.
- Added as `"triggers": { "crons": ["0 3 * * *"] }` in wrangler.jsonc.

## Correctness

- **Atomicity** via single `db.batch()` per operation (D1 has no interactive txns).
- **Optimistic concurrency**: bump `version` on occurrence/template writes; guard
  read-compute-write with `WHERE version = ?`.
- **Idempotency**: `generation_key` for occurrences; completed-state check for repeats.

## Testing

The engine is already hard-tested (Phase 0). 1c adds unit tests for any *pure*
orchestration helpers (e.g. "compute the write-set for a completion") and a light happy
path. Full DB-backed API tests use the workers-pool harness (introduced here or 1d).

## Decisions to confirm

1. **Generation cron = daily 03:00 UTC** (reminders' finer cron comes in 1e).
2. **`claim` = reassign an unassigned occurrence to the caller** (rotation is Phase 2).
3. **Scope**: backend API + cron only (UI in 1d) — *or* also add a **minimal chore list**
   to the household home now (add a chore, see today's occurrences, tap to complete) so
   chores are visible/usable this step. Bigger PR, but you'd see it working.
