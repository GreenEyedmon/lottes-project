# Grocery tracking (Phase 4)

**Goal:** a shared shopping list that gradually gets smarter about *replenishment*, without
pretending to know exact inventory. **Exit:** shared list + basic replenishment intelligence.

A separate module from chores, reusing the same architecture: D1 + Drizzle, Hono routes,
household-scoped with member attribution, and a pure hard-tested domain module for the
interval math (like the Phase 3 analyzers).

Scope decisions (2026-07-25): the list lives behind an in-page **Chores ⇄ Shopping tab**
switch on the household home; items are tracked with a **reusable per-household catalog**.

---

## 1. Data model

Two tables. Purchase history is not separate — a purchased list entry *is* the history.

```
grocery_items                       -- the household's known groceries
  id            text pk
  household_id  text -> households.id
  name          text                -- display name
  name_key      text                -- normalized (lower/trim) for dedupe
  category      text null           -- "Produce", "Dairy", … (free label)
  default_unit  text null           -- "carton", "kg", "loaf"
  archived      integer bool default false
  created_at    integer
  -- unique (household_id, name_key): one catalog row per grocery

shopping_entries                    -- live list lines AND purchase history
  id            text pk
  household_id  text -> households.id
  item_id       text -> grocery_items.id
  quantity      text null           -- "2", "500g" — free text, not inventory
  note          text null
  status        text 'needed' | 'purchased'
  added_by      text -> members.id
  added_at      integer
  purchased_by  text null -> members.id
  purchased_at  integer null
  price_cents   integer null        -- optional
  store         text null           -- optional
  -- partial unique (household_id, item_id) WHERE status='needed':
  --   at most one open line per item; re-adding bumps quantity instead of duplicating
```

- **Lifecycle:** add → a `needed` entry; check off → `purchased` + `purchased_at` (+ optional
  price/store). A `purchased` entry is immutable history.
- **Replenishment history** for an item = its `purchased` entries ordered by `purchased_at`.
- **Not** modeled (deferred in the roadmap): quantity-on-hand, receipt scanning, real pantry
  inventory. `quantity` is a free-text hint, never decremented.

---

## 2. Replenishment intelligence — pure, tested

`src/shared/grocery/replenish.ts`, mirroring the Phase 3 analyzers: pure, takes signals +
the current instant + IANA zone, returns at most one suggestion with an explanation and
evidence. Nothing auto-adds to the list.

- Convert each purchase instant to a **local date** in the household zone, then take integer
  **day gaps** between consecutive purchases (DST-safe — never raw `ms / 86_400_000`).
- Need **≥ 3 purchases** (≥ 2 gaps) or there's no median. Below that → no suggestion.
- `median(gaps)` = the typical cadence. If `daysSince(lastPurchase) ≥ median` → *probably
  running low*.
- Evidence `{ purchaseCount, medianDays, daysSince }`; explanation like *"Usually bought
  about every 5 days — last one 6 days ago."* This restock signal **is** the "lightweight
  pantry estimate"; there is no inventory count behind it.

Recompute strategy: **on view**, not a cron. Grocery data is small and the user opens the
Shopping tab deliberately; the list endpoint computes hints for catalog items not currently
on the list. No suggestions table, no third cron.

---

## 3. Surfacing

Inside the Shopping tab:

- **The list** — open `needed` entries, grouped by category, each check-off-able (with an
  optional price/store on checkout) and removable.
- **Add** — pick from the catalog (typeahead) or create a new item inline.
- **Suggested restocks** — a small section of catalog items the replenishment analyzer flags
  as probably-low and *not already on the list*, each with its reasoning + one-tap "Add".

The home screen gains a top-level **Chores | Shopping** segmented control (in-page tab state,
no new route). Chores stays exactly as it is under its tab.

---

## 4. Sub-steps (each its own PR)

- **4a — Shared shopping list (core).** `grocery_items` + `shopping_entries` + migration;
  catalog + list endpoints (add / edit / remove / mark purchased with optional price+store);
  the Shopping tab and its list UI. The usable core.
- **4b — Replenishment intelligence.** Pure `replenish.ts` + unit tests; the list endpoint
  returns restock hints; "Suggested restocks" section with one-tap add. Delivers the exit
  condition.
- **4c — List ergonomics.** Category grouping, quantity + units, recent-items quick-add.
  Polish; foldable into 4a if preferred.

---

## 5. Deliberately out of scope for Phase 4

- Detailed pantry inventory / quantity-on-hand tracking (roadmap-deferred).
- Receipt scanning (roadmap-deferred).
- Price analytics / budgeting — `price_cents` is captured but only shown, not analyzed.
- Meal planning and auto-adding ingredients — that's Phase 5, which builds on this list.
