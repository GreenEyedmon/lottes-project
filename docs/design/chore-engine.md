# Phase 0 — Chore Engine Design

**Status: draft for review.** No engine code has been written. Per `CLAUDE.md`,
recurrence and lifecycle design are reviewed before code. Once this is signed off, it
becomes the spec for the pure `src/shared` domain functions and their tests.

Scope: the chore *engine* only — lifecycle, recurrence, occurrence generation,
postponement, missed-occurrence handling, and the domain types. Auth, DB schema, cron
wiring, and UI are Phase 1 and only referenced here where they constrain the design.

---

## 1. The one rule everything rests on

A **Chore Template** (the recurring definition) and a **Chore Occurrence** (one
scheduled instance) are separate objects. Completion, postponement, reassignment, and
reminders act on the **occurrence**. A **one-off task** is an occurrence with no
template.

---

## 2. Occurrence lifecycle state machine

### 2.1 Persisted state vs. derived temporal status  *(design decision — please confirm)*

The spec lists six statuses: Upcoming, Due, Overdue, Completed, Skipped, Cancelled.
Three of those (Upcoming / Due / Overdue) are purely a function of *the due date vs.
the current time in the household's zone* — nothing a user or the system "sets." If we
persist them, we need a cron job whose only purpose is flipping rows from due→overdue
at midnight, and rows drift whenever it lags.

Proposed refinement:

- **Persisted `state`** (what actually happened): `scheduled | completed | skipped |
  cancelled | missed`.
- **Derived `temporalStatus`** (presentation only, computed at read/notify time from
  `dueInstant`, `now`, and the household zone), defined only while `state = scheduled`:
  `upcoming | due | overdue`.

This removes a whole class of drift bugs and keeps day-boundary logic in TypeScript,
never SQL (a `CLAUDE.md` requirement). `missed` is the terminal state produced by the
"expire" missed-occurrence policy (§5).

### 2.2 States

| State | Meaning | Terminal? |
|-------|---------|-----------|
| `scheduled` | Generated and open. Presented as upcoming / due / overdue. | no |
| `completed` | A completion event was recorded. | yes |
| `skipped` | User chose to skip; schedule preserved. | yes |
| `cancelled` | Voided by a rule change, pause, or template archive. | yes |
| `missed` | "Expire" policy: the window passed unfulfilled. | yes |

### 2.3 Transitions

```
                     complete (early/on-time/late)
   ┌────────────────────────────────────────────────────────┐
   │                                                         ▼
scheduled ──skip──────────────────────────────────────► skipped
   │  │                                                      
   │  ├─ postpone(this) ─────► scheduled (new dueInstant)    
   │  ├─ postpone(this+future) ─► scheduled (+ template anchor moves)
   │  ├─ reassign ───────────► scheduled (responsible changes)
   │  │                                                      
   │  ├─ rule change / pause / archive ─► cancelled          
   │  └─ expire policy, window passed ──► missed ──► (next generated)
   ▼
completed ──► (next occurrence generated per recurrence mode)
```

- Only `scheduled` occurrences accept actions. Terminal states are immutable except
  for app: an `ActivityEvent` is always appended.
- `complete` is valid from `scheduled` regardless of temporal status — completing
  **early** (before due) and **late** (after due) are both allowed and are recorded as
  flags on the completion event, not different states.

---

## 3. Recurrence modes

MVP implements **fixed-calendar** and **completion-relative**. **Frequency-target** is
modeled here but deferred to Phase 3.

Rule representation *(design decision — recommend a typed union over an RRULE subset;*
*simpler, fully typed, and we don't need RRULE's breadth)*:

```ts
type RecurrenceRule =
  | { mode: 'fixedWeekly';   weekdays: Weekday[]; interval?: number } // every Tue; every 2nd Mon
  | { mode: 'fixedMonthly';  dayOfMonth: number }                     // pay rent on the 1st
  | { mode: 'completionRelative'; everyDays: number }                 // 14 days after last done
  | { mode: 'frequencyTarget'; timesPerWeek: number }                 // Phase 3, deferred
```

### 3.1 Fixed-calendar
Next date is always the next matching calendar slot **strictly after a reference
date**, computed in the household zone. Completing an occurrence late does **not** move
the next one. Example: "every Tuesday", Tuesday's task done Thursday → next is still the
following Tuesday.

### 3.2 Completion-relative
Next date = **completion date + N days**, in the household zone, at the template's
default due time. If never completed, anchor from the template's `startDate`. Because
the next date depends on completion, a completion-relative template has **exactly one
open occurrence at a time** — the following one is generated on completion.

### 3.3 Frequency-target *(deferred)*
"~N times per week", flexible placement. Noted for the type surface only; no MVP
behavior.

### 3.4 Timezone / DST correctness  *(design decision — library TBD)*
All interval math is done on the **local wall-clock calendar** then converted to a UTC
instant, so "every 14 days at 08:00" lands at 08:00 local even across a DST change.
This needs a real IANA-aware date library that runs in both `workerd` and the Node test
runner — candidates are **Luxon** or TC39 **Temporal** (if available in workerd). I'll
confirm against current docs before picking (per `CLAUDE.md`: don't answer date/tz
behavior from memory). Everything stays pure: functions receive the instant and the
IANA zone; never `Date.now()`.

---

## 4. Occurrence generation (bounded horizon)

- Maintain occurrences only up to `now + HORIZON_DAYS` (e.g. 28). Never materialize
  years ahead. A Phase-1 cron tops up the window; generation itself is a pure function
  here.
- **Create template** → generate from `startDate` up to the horizon.
- **Fixed-calendar** → potentially several future occurrences inside the horizon.
- **Completion-relative** → exactly one open occurrence; next generated on completion.
- **Rule change** → (1) preserve completed/skipped/missed history, (2) `cancel` future
  `scheduled` occurrences, (3) regenerate from the change point, (4) append an
  `ActivityEvent`, (5) dedupe via a unique `generationKey` = `(templateId, localDueDate)`
  so retries never double-create.
- Generation and completion are **idempotent** — a retry or double-tap yields the same
  result (one completion event, no duplicate occurrence). Atomic writes go in a single
  `db.batch()` with a version column (Phase 1).

---

## 5. Missed-occurrence policy (per template)

Default is **collapse**. All three are modeled now; MVP fully implements collapse, with
keep/expire surfaced for configuration in Phase 2.

| Policy | Behavior | Good for |
|--------|----------|----------|
| **collapse** (default) | Never more than one open occurrence per template. Missed slots don't pile up; the single occurrence stays overdue until done or skipped. | Vacuuming, mopping, bathroom, bedding |
| **keep** | Every missed slot remains its own overdue occurrence (a real backlog). | Payments, inspections, admin deadlines |
| **expire** | When a slot's window passes, mark it `missed` and generate the next normally. | Bin day, a specific weekly shop |

---

## 6. Postponement semantics (never silent)

Two explicit choices on a `scheduled` occurrence:

- **Move this occurrence** — change this occurrence's `dueInstant`. Template anchor and
  all future occurrences unchanged.
- **Shift this and future** — change this occurrence's `dueInstant` **and** move the
  template's recurrence anchor, so future generated occurrences follow the new cadence.

For completion-relative chores, "shift future" is usually a no-op because the actual
completion date already drives the next date; the UI should reflect that.

Also: **skip** (keep schedule), **pause** (stop generating until resumed → future
occurrences `cancelled`), **reschedule** (edit the rule → §4 rule-change path),
**complete early**.

---

## 7. Domain model (shapes, not the final schema)

These are the pure `src/shared` types that inform — but are not — the Phase 1 Drizzle
schema. Auth identity is owned separately by Better Auth.

```ts
Household        { id, name, ianaTimeZone, createdAt }
Member           { id, householdId, displayName }            // linked to auth user in P1
Room             { id, householdId, name }
ChoreTemplate    { id, householdId, name, category, roomId?,
                   recurrence: RecurrenceRule, estimatedEffort,
                   defaultAssigneeId?, reminderPrefs, missedPolicy,
                   status: 'active'|'paused'|'archived', startDate, createdAt }
ChoreOccurrence  { id, householdId, templateId?,             // templateId null ⇒ one-off
                   dueLocalDate, dueTime?, dueInstant,        // UTC epoch ms
                   responsibleId?, state, postponedFrom?,
                   generationKey, createdAt }
CompletionEvent  { id, occurrenceId, completedById, completedAt,
                   wasEarly, wasLate, byNonAssignee,
                   effortActual?, notes? }
ActivityEvent    { id, householdId, occurrenceId?, actorId?,
                   type, payload, at }                        // append-only
OneOffTask fields on occurrence: priority, reminders[] (multiple), notes
```

Assignment keeps the two spec concepts distinct: **responsible** (`responsibleId` on
the occurrence) vs. **completed-by** (`completedById` on the completion event).

---

## 8. Pure function surface (to implement after sign-off)

All take the instant and zone explicitly; none read an ambient clock.

```ts
nextOccurrenceDate(rule, ctx): LocalDate
generateUpTo(template, { fromInstant, horizonDays, tz, existing }): OccurrenceSeed[]
resolveTemporalStatus(occ, { now, tz }): 'upcoming' | 'due' | 'overdue'
canTransition(occ, action): boolean
applyCompletion(occ, event, template): { occ, next?: OccurrenceSeed }
postpone(occ, { mode, newDueLocalDate }, template): { occ, template? }
applyMissedPolicy(template, occ, { now, tz }): { occ, next?: OccurrenceSeed }
```

Each gets exhaustive unit tests: DST spring-forward/fall-back, month-end (28/29/30/31),
leap year, late completion not moving fixed-calendar, collapse never exceeding one open
occurrence, idempotent regeneration.

---

## 9. Decisions I need you to confirm before I write code

1. **Persisted `state` + derived `temporalStatus`** (§2.1) instead of persisting
   upcoming/due/overdue — my recommendation, to kill status-drift.
2. **Typed `RecurrenceRule` union** (§3) rather than an RRULE subset — simpler and
   fully typed.
3. **Horizon length** — default **28 days**? (configurable per household later.)
4. **Timezone library** — I'll verify workerd support and recommend Luxon vs. Temporal;
   OK to let that be a short spike inside Phase 0?
5. **All-day vs. timed occurrences** — support an optional `dueTime`, defaulting to a
   household-level default reminder time when absent. Agree?

Everything else follows the spec directly.
