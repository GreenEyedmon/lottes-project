# Phase 1 · Step 1d — Daily workflow

**Status: draft for review.** No code yet. Completes the MVP's daily experience by adding
the remaining occurrence actions and grouping the list into a real "what should we do
today?" view. Uses the Phase 0 engine (postpone/skip/reassign already implemented) — no
new engine logic.

## Backend — finish the occurrence actions (`chores.ts` + API)

Each mirrors `completeOccurrence`: load row → engine transition → persist in one
`db.batch()` → append an activity event. All session-gated, household-scoped.

- **skip** — `skip(occ)` → state `skipped`. `POST /api/occurrences/:id/skip`.
- **claim** — `reassign(occ, myMemberId)` for an unassigned occurrence.
  `POST /api/occurrences/:id/claim`. (Rotation stays Phase 2.)
- **postpone** — `postpone(occ, mode, newDueDate, template, tz)`.
  `POST /api/occurrences/:id/postpone` with `{ mode: 'this' | 'thisAndFuture', days }`
  (new date = due + `days`; template anchor moves for `thisAndFuture`). Persists the
  occurrence and, for shift, the template's new rule.
- **one-off tasks** — `createOneOff` (occurrence, `templateId = null`, `title`,
  optional `dueTime`, `priority`). `POST /api/tasks`.

Guards already in place carry over: only `due`/`overdue` complete; version-checked writes;
idempotent generation.

## UI — a proper daily view

Restructure the household home's chores area:

- **Grouped list**: **Overdue**, **Today**, **Upcoming** sections (badges become section
  headers). Each row shows the chore/task name, its room/assignee if any, and actions.
- **Row actions**: primary **Done** (due/overdue only), plus a small menu (daisyUI
  `dropdown`) with **Postpone** (Tomorrow / +1 week; and a "…and future" toggle),
  **Skip**, and **Claim** (shown when unassigned).
- **Assignment**: show the responsible member; **Claim** assigns it to you.
- **One-off tasks**: an "Add task" affordance (name + optional date) alongside chores;
  they render in the same grouped list.

TanStack Router/Query are already wired; this stays within the existing single view (no
new routes) — the roadmap's separate Today/Plan/Household nav is a later polish.

## Testing

Engine transitions are already unit-tested (Phase 0). 1d adds unit tests for any pure
helpers (e.g. postpone date math wrapper) and relies on live verification for the DB
orchestration, as with 1c.

## Decisions to confirm

1. **Postpone options** = quick **Tomorrow** / **+1 week**, with a **"and future"**
   toggle for shift-this-and-future — vs. a full date picker (heavier). Recommend the
   quick options for the MVP.
2. **One-off tasks** included in 1d (recommended — they round out the daily view) — or
   defer to keep 1d smaller.
3. **Grouped sections** (Overdue / Today / Upcoming) vs. tabs. Recommend simple stacked
   sections.
