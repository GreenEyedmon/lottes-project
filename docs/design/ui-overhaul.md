# UI/UX overhaul (Phase 6)

Accepted design direction from the household. Refines the existing philosophy — the app
stays **minimal, deterministic, single-household, text-first, mobile-first**. No new domain
features; this is presentation, navigation, and workflow refinement.

Source requirements are the household's numbered list (items 1–11), reproduced per sub-step
below. Two items are already satisfied and one needs a design choice — noted inline.

## Design philosophy (unchanged, reaffirmed)

- Minimal and deterministic; fast to use; optimized for one household.
- **Text-first, not icon-first.** The interface must be fully usable through text alone.
  Icons/emoji may appear sparingly only when they add clear value, never as the sole
  affordance for an action, and never for navigation or categorization.
- Every overview allows immediate navigation to the detailed page behind it.
- Settings live in their own area, not mixed into operational screens.
- The **Dashboard** is the central hub; Chores, Shopping, Meals stay dedicated workspaces.

## Sub-steps (each its own PR, design-gated, checked before building)

Ordered so cross-cutting foundations land first and later screens inherit them.

### 6a — Design-system foundation *(items 3, 10, 11 + text-first audit)*
- **Color as communication** (item 3): semantic DaisyUI roles — primary (primary actions),
  success (completed), warning (due today), error (overdue/destructive), plus clear button
  hierarchy (primary stands out; secondary/destructive recede). Move off grayscale.
- **Typography & polish** (item 11): sentence-case section headings (drop ALL-CAPS), stronger
  hierarchy, normalized units ("250 g", "1 L"), better button hierarchy. No decorative
  whitespace inflation.
- **Mobile-first** (item 10): thumb-sized touch targets, efficient vertical layouts, minimal
  typing; desktop still works but mobile drives decisions.
- **Text-first audit** (from the Rejected list): replace emoji-only affordances — `🧾`
  price control → a text control; `✕` remove → text/labelled control; drop decorative
  `💡`/`✓`/`🎉` or keep only where text already carries the meaning.

### 6b — Settings section + member display names *(item 4)*
- Dedicated **Settings** destination. Move notification preferences and quiet hours off the
  operational pages into it.
- Members can edit their **display name** independently of their login/email (new member-
  rename endpoint + UI). Foundation for future account/household preferences.

### 6c — Chores grouped by room *(item 7)*
- Assign a room when creating a chore (picker; `roomId` already exists on the schema/API).
- Group the chore list under room headings (Kitchen → its chores, etc.); occurrence view
  returns the room name.
- Remove the standalone **Rooms** management card; room management moves into Settings.
  Rooms become an organizational layer for chores, not a standalone feature.

### 6d — Dashboard landing page *(items 1, 2)*
- New **default landing view** (not a replacement for the workspaces). Overview prioritized
  by importance, showing: tasks due today, overdue chores, shopping summary, today's meal
  suggestion, recent activity, household workload summary.
- **Every card is clickable** and opens the corresponding workspace (e.g. the shopping
  summary card → Shopping). Aggregates existing endpoints; no new domain data.

### 6e — Meal → shopping pre-cook checklist *(item 6)*
- Cooking a recipe no longer auto-adds every missing ingredient. Instead it presents all
  ingredients with checkboxes (missing ones pre-checked via the existing heuristic); the
  user confirms the subset to add. Prevents shopping-list clutter.

### 6f — Browse recipes catalog *(item 8)*
- A built-in recipe catalog with one-tap "add to our recipes," mirroring the existing chore
  catalog onboarding. No emoji on meals/recipes (Rejected list).

### 6g — Workload visualization options *(item 9)* — needs a design choice
- Current workload stats are visually weak. Produce several styles (horizontal progress
  bars, stacked contribution bars, pie, weekly contribution timeline) as mockups for the
  household to choose, then implement the chosen one.

### Already satisfied
- **Item 5 (group shopping by category):** implemented in Phase 4c (`groupEntriesByCategory`,
  one header per category). Verify it matches the desired grouped format; no new work
  expected.

## Deferred (do NOT implement yet)
Microinteractions: completed items animating away, smooth tab transitions, success toasts,
animated add/remove, small completion animations. Polish for after the overhaul lands.

## Explicitly rejected (do NOT implement)
- Do not re-center / change the overall layout; current layout is acceptable.
- Do not significantly increase whitespace.
- Do not use icons or emoji as primary navigation or categorization; never depend on them
  for usability.
- No emoji on meals/recipes. No icon-based room identification.

## Open decisions (confirm before/while building)
1. **Navigation structure.** Adding Dashboard + Settings alongside Chores/Shopping/Meals =
   5 top-level destinations — crowded as a single mobile tab bar. Options: primary tab bar
   (Dashboard/Chores/Shopping/Meals) with Settings reached separately; a scrollable/again
   nav; or a different pattern. Decide during 6a/6b.
2. **Workload viz (6g):** deliver mockups to choose from before implementing.
