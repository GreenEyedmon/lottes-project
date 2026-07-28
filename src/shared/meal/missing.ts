/**
 * "Missing ingredients" for cooking a recipe (Phase 5b). Pure. There is no real inventory,
 * so this is a stated heuristic: an ingredient needs buying only if it is not a pantry
 * staple, not already on the shopping list, and not purchased recently (which we take as a
 * sign it's probably still on hand).
 */

export interface MissingIngredient {
  itemId: string
  staple: boolean
}

export interface MissingInput {
  ingredients: readonly MissingIngredient[]
  /** Item ids already on the shopping list. */
  onListItemIds: ReadonlySet<string>
  /** Item ids purchased recently enough to assume they're still on hand. */
  recentlyPurchasedItemIds: ReadonlySet<string>
}

/** Distinct item ids to add to the shopping list. */
export function computeMissing(input: MissingInput): string[] {
  const { ingredients, onListItemIds, recentlyPurchasedItemIds } = input
  const seen = new Set<string>()
  const missing: string[] = []
  for (const ingredient of ingredients) {
    if (ingredient.staple) continue
    if (onListItemIds.has(ingredient.itemId)) continue
    if (recentlyPurchasedItemIds.has(ingredient.itemId)) continue
    if (seen.has(ingredient.itemId)) continue
    seen.add(ingredient.itemId)
    missing.push(ingredient.itemId)
  }
  return missing
}
