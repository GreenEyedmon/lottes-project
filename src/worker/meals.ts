/**
 * Meal orchestration (Phase 5a): the household's recipe collection. A recipe's ingredients
 * resolve to `grocery_items` (via the shared find-or-create), so meals and the shopping list
 * share one item vocabulary — which is what lets Phase 5b compute "missing ingredients" and
 * add them to the list. Deletes are soft (`archived`) so meal history stays valid.
 */

import { and, eq, gte } from 'drizzle-orm'
import { computeMissing } from '../shared/meal/missing.ts'
import { type RecipeCandidate, recommendMeals } from '../shared/meal/recommend.ts'
import type { Db } from './db/index.ts'
import { groceryItems, mealLogs, recipeIngredients, recipes, shoppingEntries } from './db/schema.ts'
import { addToList, createItem, normalizeNameKey } from './grocery.ts'

/** Recent-purchase window: an item bought within this many days is assumed still on hand. */
const RECENT_PURCHASE_MS = 14 * 24 * 60 * 60 * 1000

export interface RecipeIngredientInput {
  name: string
  quantity?: string
  staple?: boolean
}

export interface NewRecipe {
  name: string
  dietaryTags?: string[]
  cookMinutes?: number
  servings?: number
  ingredients: RecipeIngredientInput[]
}

export interface RecipeIngredientView {
  itemId: string
  name: string
  quantity: string | null
  staple: boolean
}

export interface RecipeView {
  id: string
  name: string
  dietaryTags: string[]
  cookMinutes: number | null
  servings: number | null
  ingredients: RecipeIngredientView[]
}

export async function createRecipe(
  db: Db,
  householdId: string,
  memberId: string,
  now: number,
  input: NewRecipe,
): Promise<{ id: string } | 'invalid' | 'exists'> {
  if (!input.name?.trim()) return 'invalid'
  const named = input.ingredients.filter((i) => i.name?.trim())
  if (named.length === 0) return 'invalid'

  const nameKey = normalizeNameKey(input.name)
  const [existing] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        eq(recipes.nameKey, nameKey),
        eq(recipes.archived, false),
      ),
    )
    .limit(1)
  if (existing) return 'exists'

  const recipeId = crypto.randomUUID()
  // Resolve each ingredient to a catalog item first (find-or-create), so recipes and the
  // shopping list reference the same rows.
  const ingredientRows: (typeof recipeIngredients.$inferInsert)[] = []
  for (const ingredient of named) {
    const { id: itemId } = await createItem(db, householdId, now, { name: ingredient.name })
    ingredientRows.push({
      id: crypto.randomUUID(),
      recipeId,
      itemId,
      quantity: ingredient.quantity?.trim() || null,
      staple: ingredient.staple ?? false,
    })
  }

  await db.insert(recipes).values({
    id: recipeId,
    householdId,
    name: input.name.trim(),
    nameKey,
    dietaryTags: input.dietaryTags ?? [],
    cookMinutes: input.cookMinutes ?? null,
    servings: input.servings ?? null,
    createdBy: memberId,
    archived: false,
    createdAt: now,
  })
  for (const row of ingredientRows) await db.insert(recipeIngredients).values(row)
  return { id: recipeId }
}

export async function listRecipes(db: Db, householdId: string): Promise<RecipeView[]> {
  const recs = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), eq(recipes.archived, false)))
    .orderBy(recipes.name)
  if (recs.length === 0) return []

  const ings = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      itemId: recipeIngredients.itemId,
      quantity: recipeIngredients.quantity,
      staple: recipeIngredients.staple,
      itemName: groceryItems.name,
    })
    .from(recipeIngredients)
    .innerJoin(groceryItems, eq(recipeIngredients.itemId, groceryItems.id))
    .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
    .where(and(eq(recipes.householdId, householdId), eq(recipes.archived, false)))
  const byRecipe = new Map<string, RecipeIngredientView[]>()
  for (const row of ings) {
    const list = byRecipe.get(row.recipeId) ?? []
    list.push({
      itemId: row.itemId,
      name: row.itemName,
      quantity: row.quantity,
      staple: row.staple,
    })
    byRecipe.set(row.recipeId, list)
  }

  return recs.map((r) => ({
    id: r.id,
    name: r.name,
    dietaryTags: r.dietaryTags,
    cookMinutes: r.cookMinutes,
    servings: r.servings,
    ingredients: byRecipe.get(r.id) ?? [],
  }))
}

/** Soft-delete a recipe. History (meal logs) referencing it stays intact. */
export async function deleteRecipe(
  db: Db,
  householdId: string,
  recipeId: string,
): Promise<'ok' | 'not-found'> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1)
  if (!row || row.householdId !== householdId || row.archived) return 'not-found'
  await db.update(recipes).set({ archived: true }).where(eq(recipes.id, recipeId))
  return 'ok'
}

async function onListItemIds(db: Db, householdId: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: shoppingEntries.itemId })
    .from(shoppingEntries)
    .where(and(eq(shoppingEntries.householdId, householdId), eq(shoppingEntries.status, 'needed')))
  return new Set(rows.map((r) => r.itemId))
}

async function recentlyPurchasedItemIds(
  db: Db,
  householdId: string,
  since: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: shoppingEntries.itemId })
    .from(shoppingEntries)
    .where(
      and(
        eq(shoppingEntries.householdId, householdId),
        eq(shoppingEntries.status, 'purchased'),
        gte(shoppingEntries.purchasedAt, since),
      ),
    )
  return new Set(rows.map((r) => r.itemId))
}

async function lastCookedByRecipe(db: Db, householdId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ recipeId: mealLogs.recipeId, cookedAt: mealLogs.cookedAt })
    .from(mealLogs)
    .where(eq(mealLogs.householdId, householdId))
  const map = new Map<string, number>()
  for (const row of rows) {
    const prev = map.get(row.recipeId)
    if (prev == null || row.cookedAt > prev) map.set(row.recipeId, row.cookedAt)
  }
  return map
}

/**
 * Cook a recipe: add its missing ingredients (§ the heuristic in shared/meal/missing) to the
 * shopping list and log the meal. Returns how many items were added. This is the Phase 5 exit.
 */
export async function cookRecipe(
  db: Db,
  householdId: string,
  memberId: string,
  now: number,
  recipeId: string,
): Promise<{ added: number } | 'not-found'> {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1)
  if (!recipe || recipe.householdId !== householdId || recipe.archived) return 'not-found'

  const ingredients = await db
    .select({ itemId: recipeIngredients.itemId, staple: recipeIngredients.staple })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
  const missing = computeMissing({
    ingredients,
    onListItemIds: await onListItemIds(db, householdId),
    recentlyPurchasedItemIds: await recentlyPurchasedItemIds(
      db,
      householdId,
      now - RECENT_PURCHASE_MS,
    ),
  })
  for (const itemId of missing) {
    await addToList(db, householdId, memberId, now, { itemId })
  }
  await db.insert(mealLogs).values({
    id: crypto.randomUUID(),
    householdId,
    recipeId,
    cookedBy: memberId,
    cookedAt: now,
  })
  return { added: missing.length }
}

export interface SuggestedMeal extends RecipeView {
  missingCount: number
}

export interface MealPrefs {
  maxCookMinutes?: number
  requiredTags?: string[]
}

/** All recipes, annotated with their missing-ingredient count and ranked by the recommender. */
export async function suggestMeals(
  db: Db,
  householdId: string,
  now: number,
  prefs: MealPrefs,
): Promise<SuggestedMeal[]> {
  const list = await listRecipes(db, householdId)
  if (list.length === 0) return []

  const onList = await onListItemIds(db, householdId)
  const recent = await recentlyPurchasedItemIds(db, householdId, now - RECENT_PURCHASE_MS)
  const lastCooked = await lastCookedByRecipe(db, householdId)

  const byRecipe = new Map<string, SuggestedMeal>()
  const candidates: RecipeCandidate[] = list.map((recipe) => {
    const missingCount = computeMissing({
      ingredients: recipe.ingredients.map((i) => ({ itemId: i.itemId, staple: i.staple })),
      onListItemIds: onList,
      recentlyPurchasedItemIds: recent,
    }).length
    byRecipe.set(recipe.id, { ...recipe, missingCount })
    return {
      recipeId: recipe.id,
      cookMinutes: recipe.cookMinutes,
      dietaryTags: recipe.dietaryTags,
      missingCount,
      lastCookedAt: lastCooked.get(recipe.id) ?? null,
    }
  })

  return recommendMeals(candidates, prefs).flatMap((c) => {
    const meal = byRecipe.get(c.recipeId)
    return meal ? [meal] : []
  })
}
