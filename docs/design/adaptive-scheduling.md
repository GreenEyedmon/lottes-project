# Adaptive scheduling (Phase 3)

**Goal:** use a household's own accumulated behavior to *propose* schedule improvements —
more realistic frequencies, better days/times, fairer rotation. Every proposal is
**explainable** and **user-approved**; nothing is ever applied automatically.

Scope decisions (2026-07-25): **full spec** — the three suggestion types *and* the
deferred `frequencyTarget` recurrence mode. Suggestions surface **inline on the chore**
they concern, not in a separate inbox.

---

## 1. We already have the signals

No new capture plumbing is needed for the suggestion types. What exists today:

| Signal | Source | Powers |
| --- | --- | --- |
| Postpones (count + original date) | `chore_occurrences.postponed_from`, `activity_events type='postponed'` | Frequency too aggressive |
| Late / early completion | `completion_events.was_late` / `was_early` | Frequency fit |
| Completion instant | `completion_events.completed_at` → local weekday/hour | Better day, better due time |
| Reminder sent vs. acted | `reminders.sent_at` vs. `completion_events.completed_at` | Better reminder time |
| Done by non-assignee | `completion_events.by_non_assignee`, `completed_by_id` | Rotation fairness |
| Actual effort | `completion_events.effort_actual_minutes` | (future) effort-weighted fairness |

The one genuinely new capability is `frequencyTarget` recurrence (§6), which is an engine
feature, not a signal.

---

## 2. Principle: explain, then ask

- The analyzer is **pure** (`src/shared/suggest/`). It takes a signal bag + the current
  instant + the IANA zone and returns zero or more `Suggestion` values. No DB, no clock,
  no network — tested as hard as recurrence (thresholds, min-data gating, DST-safe
  weekday/hour bucketing).
- Every `Suggestion` carries a human `explanation` and an `evidence` snapshot (the raw
  numbers behind it) so the UI can show *why* without recomputing.
- Nothing mutates a schedule until the user hits **Accept**. **Dismiss** records a
  cooldown so the same idea does not nag next week.

```ts
type Suggestion =
  | { kind: 'adjustFrequency'; proposedRule: RecurrenceRule; explanation; evidence }
  | { kind: 'shiftWeekday';    proposedRule: RecurrenceRule; explanation; evidence }
  | { kind: 'shiftDueTime';    proposedDueTime: TimeOfDay;   explanation; evidence }
  | { kind: 'shiftReminder';   proposedDueTime: TimeOfDay;   explanation; evidence }
  | { kind: 'enableRotation';  proposedRotate: true;         explanation; evidence }
  | { kind: 'reorderRotation'; proposedOrder: string[];      explanation; evidence }
```

`proposed*` fields are the *patch* an Accept applies. A rule/weekday change reuses the
existing rule-change path; a due-time / rotation change is a narrower template update.

---

## 3. Storage — `suggestions` table

```
suggestions
  id            text pk
  household_id  text  -> households.id
  template_id   text  -> chore_templates.id
  kind          text                         -- the union tag above
  status        text  'pending'|'accepted'|'dismissed'
  patch         json                         -- proposedRule / proposedDueTime / order…
  explanation   text
  evidence      json                         -- numbers shown in the UI
  created_at    integer
  resolved_at   integer  null
  resolved_by   text     null -> members.id
  dedupe_key    text unique                  -- `${templateId}:${kind}` while pending
```

- **Idempotent generation:** upsert on `dedupe_key` so the weekly recompute refreshes an
  open suggestion rather than duplicating it. Once resolved, the row keeps history and the
  key frees up.
- **Cooldown:** a dismissed `(template, kind)` is not re-raised for `SUGGESTION_COOLDOWN`
  (start at 4 weeks); enforced by checking the most recent resolved row before inserting.

---

## 4. Generation — when analysis runs

- **Weekly cron.** Add a third trigger (e.g. `0 4 * * 1`, Monday 04:00 UTC) — or fold into
  the existing daily generation cron gated to once/week — that, per household, gathers
  signals and upserts suggestions. Deliberately infrequent: schedules are habits, not
  real-time state.
- **Signals gathered with aggregate queries**, not a query-per-template loop: one
  `GROUP BY template_id` over recent `completion_events` and one over `activity_events`
  per household. Two-ish queries per household keeps us far under the D1 50-query/invocation
  free-plan cap regardless of chore count.
- Analysis window: last ~60 days / last ~6 resolved occurrences per template, whichever is
  smaller. Below a **minimum sample** (start at 4 resolved occurrences) → no suggestion.

---

## 5. Surfacing — inline on the chore

Chosen UX: the suggestion lives on the chore it concerns.

- `GET /api/occurrences` (or a sibling `GET /api/suggestions`) returns pending suggestions
  keyed by `templateId`; `OccurrenceRow` shows a **💡** affordance when its template has one.
- Expanding it shows the `explanation` ("Postponed 4 of the last 5 times") and **Accept** /
  **Dismiss**. Accept calls `POST /api/suggestions/:id/accept`; Dismiss →
  `POST /api/suggestions/:id/dismiss`.
- One-off tasks (no `templateId`) never carry suggestions.

Accept flow reuses the **cancel-future-`scheduled` + regenerate + `ActivityEvent`** logic
that already exists inside `postponeOccurrence`'s `thisAndFuture` branch — 3a extracts it
into a shared `applyTemplateChange` helper so every suggestion type applies consistently.

---

## 6. `frequencyTarget` mode (deferred third recurrence mode)

"~N times per week", flexible placement — the type already exists on the `RecurrenceRule`
union (`{ mode: 'frequencyTarget'; timesPerWeek }`) but has no engine behavior.

- **Generation:** place `timesPerWeek` occurrences within each local ISO week, spread
  evenly (e.g. even spacing across available days), respecting `startDate` and the horizon.
- **Completion-relative vs. calendar:** frequencyTarget is calendar-anchored (per week) but
  tolerant of *which* day — completing early does not pull the whole week forward.
- **Missed policy:** a missed one inside the week collapses toward the week's remaining
  slots; unmet weekly target simply ends when the week rolls over (no infinite backlog).
- Pure engine work in `recurrence.ts` + `lifecycle.ts`, mapped through `mappers.ts`, with a
  `describeRecurrence` label and a catalog/preset entry. **Hard-tested**: week boundaries,
  DST weeks (23/25-hour days), partial first week.

This mode also lets the frequency analyzer propose *"you actually do this about twice a
week — switch to a 2×/week target?"* instead of guessing a fixed interval.

---

## 7. Sub-steps (each its own PR)

- **3a — Infrastructure + frequency-fit suggestions.** `suggestions` table + migration,
  pure `analyzeFrequency`, weekly cron generation, `applyTemplateChange` helper, accept /
  dismiss endpoints, inline 💡 on the chore row. First vertical slice.
- **3b — Day & time-of-day suggestions.** `shiftWeekday`, `shiftDueTime`, `shiftReminder`
  analyzers + their apply paths. Reuses 3a infra.
- **3c — Rotation-fairness suggestions.** `enableRotation`, `reorderRotation` from
  `by_non_assignee` + completion tally. Reuses 3a infra.
- **3d — `frequencyTarget` recurrence mode.** Pure engine implementation (independent of
  3a–3c; can be built in parallel). Enables the 2×/week chore type and richer frequency
  suggestions.

---

## 8. Deliberately out of scope for Phase 3

- Auto-applying any change (the whole point is human-approved).
- Cross-household learning or any external ML/AI call — analysis is local, per household,
  deterministic, and explainable.
- Effort-weighted fairness (we capture `effort_actual_minutes`; using it can come later).
- Reminder-time A/B experimentation; we suggest from observed behavior, we don't experiment.
