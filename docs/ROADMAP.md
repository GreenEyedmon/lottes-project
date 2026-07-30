# Lottes Project — Build Roadmap

Derived from `ProjectSpec.md` and constrained by `CLAUDE.md`. This is a **plan for
review**, not a commitment to code. Nothing here has been built yet.

The spec's central instruction shapes everything below:

> A recurring chore and an occurrence of that chore must be **separate objects**.
> Completion, postponement, reassignment, and reminders apply to the **occurrence**,
> not the template.

And its recommended first step, which this roadmap honors:

> Specify the chore lifecycle and recurrence rules as a **state machine** before
> designing the database or screens.

---

## Guiding principles (spec + CLAUDE.md)

- **Template ≠ occurrence.** The one modeling decision the whole app rests on.
- **Correctness before features.** "Bugs in the chore engine undermine trust in the
  entire app." The engine is built and tested to death before UI polish.
- **Pure domain logic in `src/shared`.** Recurrence and date math take the instant +
  IANA timezone as explicit inputs; no `Date.now()`, no DB, no network. This is what
  makes DST and month-boundary behavior testable.
- **Bounded occurrence horizon.** Generate only the next several weeks; never
  materialize years of future occurrences. Create more as the window rolls forward.
- **Idempotent writes.** A double-tap completion or a retried reminder must not create
  duplicate completion events or duplicate notifications. D1 has no interactive
  transactions — atomic work goes in one `db.batch()` with a version column.
- **Recommend, never impose.** Suggested frequencies and assignments are editable
  proposals, not silent changes.
- **Groceries and meals are separate, later modules.** The data model leaves room for
  them, but they are not part of the chore MVP.
- **Free tier is a design constraint** (D1, Workers Cron, Web Push, Resend fallback).

---

## Open design questions — now resolved by the spec

The seven questions that were blocking schema design are all answered:

| # | Question | Spec's answer |
|---|----------|---------------|
| 1 | Does completing early shift the next due date? | **Depends on mode.** Completion-relative: yes (next computed from completion). Fixed-calendar: no. |
| 2 | Floating cadence vs. calendar-fixed — one model or both? | **Both, plus a third.** Fixed-calendar + completion-relative in MVP; frequency-target deferred. |
| 3 | Store future instances, or compute forward? | **Bounded generation.** Roll a limited horizon; regenerate only future occurrences on rule change; preserve history; prevent duplicates. |
| 4 | Groceries item-level from day one? | **No.** Groceries are a separate module (Phase 4); item-level shopping list starts there. |
| 5 | Households as the core entity? | **Yes**, one household per user initially; multi-household membership deferred. |
| 6 | Notification channels — push only or fallback? | **Push + email fallback**; three types: individual reminder, household digest, activity. |
| 7 | Tally — competitive or informational? | **Informational**, effort-weighted; no permanent competitive leaderboard. |

---

## Phases

### Phase 0 — Design & domain core  *(review gate before any feature code)*

**Goal:** Lock the model so feature code doesn't churn. This is design + the pure,
testable heart of the engine — the spec's "state machine first" step.

- Chore-occurrence **lifecycle state machine**: `upcoming → due → overdue →
  completed / skipped / cancelled`, plus postpone and shift transitions.
- **Recurrence semantics** locked as pure functions: fixed-calendar and
  completion-relative next-date math (frequency-target explicitly deferred).
- **Postponement distinction** modeled explicitly: *move this occurrence* vs.
  *shift this and future occurrences* (anchor change).
- **Missed-occurrence policies**: collapse / keep-every / expire, with collapse as
  the default.
- **Data model design** for the six entities — Household, Chore Template, Chore
  Occurrence, Assignment, Completion Event, Activity Event — plus one-off tasks
  (an occurrence with no template). Responsible-person vs. completed-by kept distinct.
- **Occurrence-generation horizon** strategy (rolling window; regenerate future only
  on rule change; preserve completed history; dedupe).
- **Timezone model**: store UTC epoch ms + household IANA zone; all day-boundary logic
  in TypeScript.

**Buildable here:** the pure recurrence/date functions in `src/shared` with exhaustive
unit tests (DST spring-forward/fall-back, month-end, leap year). No DB, no UI.
**Exit gate:** reviewed design doc + green domain test suite.

---

### Phase 1 — Reliable chore engine  *(shippable MVP — spec §13)*

**Goal:** A household can run its real chores end-to-end. The foundation the spec
says must be rock-solid.

- **Schema → Drizzle + D1 migrations** implementing the Phase 0 model.
- **Auth** (Better Auth): sign-in and household membership.
- **Household setup**: create household, invite members, add rooms/areas.
- **Chore management**: small built-in catalog + custom chores + one-off tasks;
  fixed and completion-relative recurrence; assign or leave unassigned; edit frequency.
- **Occurrence generation** via a Workers **Cron Trigger** over the bounded horizon.
- **Daily workflow UI** (TanStack Router + Query wired here): Today (my / shared /
  overdue) and Upcoming; one-tap **Complete**; **Claim**; **Postpone this**;
  **Shift this and future**; **Skip**.
- **Completion as an event** (who, when, early/late, whether someone other than the
  assignee did it) + append-only **activity log**.
- **Basic notifications**: personal timed reminder + daily household digest + basic
  quiet hours. Web Push (self-hosted VAPID) with Resend email fallback, cron-driven.
  iOS PWA install onboarding (Web Push needs the installed PWA).
- **History**: completion activity, completed-by, estimated effort, simple weekly /
  monthly tally (informational, non-competitive).
- **Idempotency** on completion and notification delivery (single `db.batch()` +
  version column).

**Exit:** the MVP in spec §13, deployed and usable by a real household.

---

### Phase 2 — Household coordination  *(spec §14 Phase 2)*

**Goal:** Multi-person households coordinate fairly, with notifications tuned so
nobody abandons the app from overload.

- **(2a) ✅ Chore catalog + onboarding recommendations** (rules-based, every suggestion
  editable, "recommended starting frequency" phrasing). — PR #11
- **(2b) ✅ Rotation assignment** — round-robin across members, one turn each;
  stateless anchor off the latest occurrence. — PR #12
- **(2c) ✅ Missed-occurrence policies** surfaced and configurable per chore
  (roll forward / pile up / let it go). — PR #13
- **(2d) ✅ Flexible notification settings**: per-type toggles (reminders / digest /
  activity), activity notifications ("Alex completed X"), quiet hours — all
  timezone/DST-correct. — PR #14
- **Workload analytics**: effort contributed, assigned vs. completed vs. voluntarily
  picked up, distribution by week/month. — delivered in Phase 1f (History section).

**Exit:** ✅ fair coordination and controllable notifications for a shared household.

---

### Phase 3 — Adaptive scheduling  *(spec §14 Phase 3)*

**Goal:** Use accumulated behavior to *suggest* improvements — explainable and
user-approved, never automatic. Scoped in
[docs/design/adaptive-scheduling.md](design/adaptive-scheduling.md).

Full-spec scope; suggestions surface **inline on the chore** they concern:

- **(3a) ✅ Infrastructure + frequency-fit suggestions** — `suggestions` table, pure
  analyzer, weekly generation cron, `applyTemplateChange` helper, accept/dismiss,
  inline 💡 on the chore row. (Signals already captured: postpones, late/early.) — PR #15
- **(3b) ✅ Day & time suggestions** — better weekday and due/reminder time from observed
  completion instants (reminder fires at the due instant, so it's one knob). — PR #16
- **(3c) ✅ Rotation-fairness suggestions** — `enableRotation` when a shared chore falls
  lopsidedly on one person (completion tally). Reorder deliberately dropped (round-robin
  is already order-independent). — PR #17
- **(3d) ✅ `frequencyTarget` recurrence mode** — the third mode deferred from Phase 0;
  flexible "~N×/week" evenly-spread placement, day-tolerant, no backlog. — PR #18

Guardrails: analyzer stays pure + hard-tested; signals gathered with aggregate
queries (well under the D1 50-query cap); no external ML — deterministic and local.

**Exit:** ✅ the app proposes schedule improvements; the user stays in control.

---

### Phase 4 — Grocery tracking  *(spec §14 Phase 4 — separate module)*

**Goal:** A shared shopping list that gradually gets smarter, without pretending to
know exact inventory. Scoped in [docs/design/grocery.md](design/grocery.md).

A separate module reusing the chores architecture. Lives behind an in-page
**Chores ⇄ Shopping** tab; items tracked via a reusable per-household catalog.

- **(4a) ✅ Shared shopping list** — `grocery_items` + `shopping_entries` tables, add/
  remove, mark purchased, member attribution, the Shopping tab. (Price/store + category
  grouping UI in 4c.) — PR #19
- **(4b) ✅ Replenishment intelligence** — pure median-interval engine (`src/shared/grocery/`)
  + tests; "usually every ~N days → probably running low" restock hints, computed on view,
  one-tap add. This *is* the lightweight pantry estimate (a signal, not an inventory count). — PR #20
- **(4c) ✅ List ergonomics** — category grouping, price/store capture on checkout,
  catalog quick-add chips. — PR #21

Deferred (per the spec): detailed pantry inventory, receipt scanning, price analytics.

**Exit:** ✅ shared list + basic replenishment intelligence.

---

### Phase 5 — Meal planning  *(spec §14 Phase 5)*

**Goal:** Close the meal → grocery loop. Scoped in [docs/design/meals.md](design/meals.md).

Builds on grocery: recipe ingredients reference `grocery_items`. Household-authored
recipes, but naming a dish surfaces suggested ingredients from a curated dictionary
(no AI). Third top-level **Meals** tab.

- **(5a) ✅ Recipe collection + ingredient suggestions** — `recipes` + `recipe_ingredients`
  (ref `grocery_items`, `staple` flag); pure dish→ingredients dictionary; the Meals tab
  (author by name → suggested ingredients → edit → save). (`meal_logs` lands in 5b.) — PR #22
- **(5b) ✅ Suggestions, cook, add-to-list** — pure "missing ingredients" heuristic (not on
  list AND not recently bought AND not a staple) + a deterministic recommender (cook time /
  dietary filters, rank by fewest missing → least-recently cooked → shortest cook time);
  **Cook this** adds the missing ingredients and logs the meal (`meal_logs`). — PR #23
- **(5c) ✅** meal history ("recently cooked" + "cook again") and recipe editing. — PR #24

Deferred (per the spec): AI meal generation, real inventory/leftovers, budget ranking,
nutrition, quantity scaling.

**Exit:** ✅ pick a meal, get the missing ingredients on the list.

---

### Phase 6 — UI/UX overhaul  *(household design direction)*

**Goal:** Refine presentation, navigation, and workflows without adding domain features.
Minimal, deterministic, text-first, mobile-first. Scoped in
[docs/design/ui-overhaul.md](design/ui-overhaul.md).

- **(6a) ✅ Design-system foundation** — sentence-case headings, button hierarchy,
  unit normalization, text-first audit (emoji-only affordances → text). Deeper per-screen
  color/mobile continues through 6b–6d. — PR #25
- **(6b) ✅ Settings section + member display names** — dedicated Settings destination
  (header link) holding notification prefs/quiet hours/members/rooms/invite; members rename
  themselves independent of email. — PR #26
- **(6c) Chores grouped by room** — assign a room per chore, group the list by room, remove
  the standalone Rooms card.
- **(6d) Dashboard landing page** — prioritized overview (due today, overdue, shopping,
  today's meal, activity, workload); every card navigates to its workspace.
- **(6e) Meal → shopping pre-cook checklist** — choose which ingredients to add rather than
  auto-adding all missing.
- **(6f) Browse recipes catalog** — built-in recipe catalog with one-tap add (mirrors chores).
- **(6g) Workload visualization options** — mockups to choose from, then implement the pick.
- Item 5 (group shopping by category) already delivered in Phase 4c.

Deferred: microinteractions/animations. Rejected: layout re-centering, extra whitespace,
icon/emoji-primary navigation, emojis on meals, icon-based room identification.

**Exit:** the household lands on a useful Dashboard; color and layout communicate state
clearly; settings are separate; mobile is first-class — all text-first.

---

## Deliberately deferred (from the spec)

Not built in any phase above until explicitly revisited: AI-generated chore schedules,
fully automatic assignment, complex gamification, household chat, photo proof of
completion, detailed pantry inventory, receipt scanning, meal-recommendation AI,
smart-home integrations, external calendar sync, multiple homes per user.

---

## Cross-cutting technical foundations

| Concern | First appears | Notes |
|---------|---------------|-------|
| Domain state machine + recurrence (pure, `src/shared`) | Phase 0 | Hard-tested; no ambient clock. |
| Drizzle schema + D1 migrations | Phase 1 (design in 0) | Forward-only SQL; review before apply; apply step in CI deploy job. |
| Auth (Better Auth) | Phase 1 | Owns its own tables. |
| Workers Cron Triggers | Phase 1 | Occurrence generation + reminder firing. |
| Web Push (VAPID) + Resend email fallback | Phase 1 (basic), Phase 2 (rich) | iOS needs installed PWA. |
| TanStack Router + Query | Phase 1 | Wired when the client UI starts. |
| Idempotency + optimistic concurrency | Phase 1 | `db.batch()` + version column; no interactive txns. |
| Timezone / DST correctness | Phase 0 onward | UTC epoch ms + IANA zone; boundaries in TS. |

---

## Suggested immediate next step

Begin **Phase 0** with the chore-lifecycle state machine and the recurrence rules,
reviewed before any schema or screens — exactly as the spec and `CLAUDE.md` both
require. No feature code until that design is signed off.
