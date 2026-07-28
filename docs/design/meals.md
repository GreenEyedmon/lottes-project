# Meal planning (Phase 5)

**Goal:** close the meal → grocery loop. **Exit:** pick a meal, get the missing ingredients
on the shopping list.

A separate module that *builds on* grocery: a recipe's ingredients reference the same
`grocery_items` catalog, so "missing ingredients" is computable against the shopping list +
purchase history, and adding them reuses `addToList`.

Scope decisions (2026-07-25):
- Recipes are **household-authored**, but **naming a dish surfaces suggested ingredients**
  from a built-in dictionary that the user edits before saving. No AI — a curated
  dish→ingredients map (the roadmap defers meal-recommendation AI).
- Meals live behind a **third top-level tab** (Chores | Shopping | Meals).
- "Missing" uses a **smart heuristic** (see §3) — there is no real inventory.

---

## 1. Data model

Three tables; ingredients reference the grocery catalog.

```
recipes
  id            text pk
  household_id  text -> households.id
  name          text
  name_key      text                 -- normalized, for dedupe
  dietary_tags  json  string[]        -- "vegetarian", "vegan", "gluten-free", …
  cook_minutes  integer null
  servings      integer null
  created_by    text -> members.id
  archived      integer bool default false
  created_at    integer
  -- unique (household_id, name_key)

recipe_ingredients
  id            text pk
  recipe_id     text -> recipes.id
  item_id       text -> grocery_items.id   -- shared vocabulary with the shopping list
  quantity      text null
  staple        integer bool default false -- pantry staple (salt, oil): never auto-added

meal_logs                             -- "cooked" history → recent-meal avoidance + history
  id            text pk
  household_id  text -> households.id
  recipe_id     text -> recipes.id
  cooked_by     text -> members.id
  cooked_at     integer
```

Deleting is soft (`archived`) so `meal_logs` history stays valid.

---

## 2. Ingredient suggestions when naming a dish (pure, tested)

`src/shared/meal/dishes.ts` — a curated `DISH_SUGGESTIONS` map: normalized dish name →
suggested ingredient lines `{ name, staple? }`. `suggestIngredients(dishName)` normalizes
the typed name and returns the matching dish's lines (exact match, else a contains match),
or `null`. Small starter set (a dozen common dishes); household-agnostic and deterministic.

Flow (5a): user types "Spaghetti bolognese" → suggested lines appear (pasta, minced beef,
tomatoes, onion, garlic, …) → user adds/removes/edits → save. Each ingredient name is
resolved to a `grocery_items` row via the existing find-or-create, so meals and the shopping
list share one item vocabulary from day one. The dictionary only *assists* entry; the recipe
is whatever the household saves.

---

## 3. "Missing ingredients" — the smart heuristic (pure, tested)

`src/shared/meal/missing.ts`. Given a recipe's ingredients plus two sets — item ids already
on the shopping list, and item ids **purchased within the last N days** (≈ still on hand) —
returns the item ids to add:

```
add = ingredients
  where NOT staple
  and NOT alreadyOnList(itemId)
  and NOT recentlyPurchased(itemId)   // assume still in the pantry
```

This is a heuristic, stated plainly: with no inventory we *guess* you still have what you
recently bought. Staples are never auto-added. `N` starts at ~14 days.

---

## 4. Meal suggestions — the recommender (pure, tested)

`src/shared/meal/recommend.ts`. Deterministic ranking over the household's recipes given
lightweight preferences:

- **Hard filters:** `cookMinutes ≤ maxCookMinutes` (if set); recipe includes every requested
  dietary tag.
- **Avoid repeats:** drop recipes cooked within the last M days (from `meal_logs`).
- **Rank:** fewest missing ingredients first (cheaper / less shopping), then shorter cook
  time, then least-recently cooked. Stable, explainable — no scores from a black box.

Honestly scoped: budget and leftovers from the spec are **not** modeled (no price ranking
beyond "fewest missing," no leftover tracking); on-hand is the §3 approximation. Noted as
deferred rather than faked.

---

## 5. Cooking a meal — the exit condition

"Cook this" on a recipe:
1. Compute missing ingredients (§3).
2. Add each to the shopping list (reusing `addToList`), in one pass.
3. Append a `meal_logs` row (feeds recent-meal avoidance and a history view).

Selecting a meal thus puts exactly the missing ingredients on the list — the Phase 5 exit.

---

## 6. Sub-steps (each its own PR)

- **5a — Recipe collection + ingredient suggestions.** The three tables + migration; the
  dish→ingredients dictionary (pure + tests); the Meals tab: author a recipe (name → suggested
  ingredients → edit → save), list/view/delete recipes.
- **5b — Suggestions, cook, and add-to-list.** Pure `missing.ts` + `recommend.ts` (+ tests);
  "Suggest a meal" with cook-time/dietary controls; **Cook this** adds missing ingredients to
  the shopping list and logs the meal. Meets the exit condition.
- **5c — *(optional)* polish.** Meal history view, "cook again," editing an existing recipe's
  ingredients, richer dietary filters.

---

## 7. Deliberately out of scope (per the spec)

- AI-generated meals or ingredient inference — the dish dictionary is a fixed, curated map.
- Real inventory / leftovers tracking; budget-based recommendation.
- Nutrition, scaling quantities by servings, external recipe import.
