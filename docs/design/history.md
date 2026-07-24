# Phase 1 · Step 1f — History & tally

**Status: draft for review.** Rounds out the MVP (spec §13 "History"). Read-only — the
data already exists (`completion_events`, `activity_events`, `estimated_effort_minutes`);
1f is queries + two UI cards. No schema change.

## Backend — one endpoint

`GET /api/history` (session-gated) returns:

- **`activity`** — the last ~20 append-only events for the household, each resolved to
  friendly text: actor display name + chore/task name + type + `at`
  (e.g. "Sam completed Vacuum living room").
- **`tally`** — per-member totals over a **rolling 30-day window**: chores completed and
  **effort contributed** (sum of the chore's `estimated_effort_minutes`, or the recorded
  actual for one-offs). Plus the window total, so the client can show shares.

Joins: `completion_events → chore_occurrences → chore_templates` (effort/name) and
`→ members`/`user` (names). Household-scoped; ≪ 50 D1 queries.

## UI — two cards on the household home

- **Workload** (last 30 days): each member as a share of household effort —
  "Rohit · 42% · 5 chores · 75 min", with a slim daisyUI progress bar. **Informational,
  not competitive** (resolved design question #7 — no leaderboard / "worst").
- **Recent activity**: a compact feed — "Sam completed Vacuum living room · 2h ago".

## Framing

Distinguish, per the spec, **work completed** and **who did it** (completed-by is already
separate from responsible). Present shares and effort, never a ranking that shames.

## Decisions to confirm

1. **Rolling 30-day window** for the tally (recommended) vs. a week/month toggle.
2. Include **both** the Workload tally **and** the Recent-activity feed (recommended) vs.
   just the workload numbers.
