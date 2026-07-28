/**
 * Meal recommendation (Phase 5b). Pure, deterministic ranking over the household's recipes —
 * no AI, no scores from a black box. Hard filters are the user's explicit preferences
 * (max cook time, dietary tags); nothing is hidden for being cooked recently, it just ranks
 * lower to encourage variety.
 */

export interface RecipeCandidate {
  recipeId: string
  cookMinutes: number | null
  dietaryTags: readonly string[]
  missingCount: number
  /** Epoch ms of the most recent time it was cooked, or null if never. */
  lastCookedAt: number | null
}

export interface RecommendPrefs {
  maxCookMinutes?: number
  requiredTags?: readonly string[]
}

/**
 * Filter by explicit prefs, then rank: fewest missing ingredients first (less shopping),
 * then least-recently cooked (variety; never-cooked ranks first), then shortest cook time.
 * A recipe with unknown cook time is not excluded by a max-time filter.
 */
export function recommendMeals(
  candidates: readonly RecipeCandidate[],
  prefs: RecommendPrefs = {},
): RecipeCandidate[] {
  const { maxCookMinutes, requiredTags = [] } = prefs
  return candidates
    .filter(
      (c) => maxCookMinutes == null || c.cookMinutes == null || c.cookMinutes <= maxCookMinutes,
    )
    .filter((c) => requiredTags.every((tag) => c.dietaryTags.includes(tag)))
    .slice()
    .sort((a, b) => {
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount
      const aCooked = a.lastCookedAt ?? 0
      const bCooked = b.lastCookedAt ?? 0
      if (aCooked !== bCooked) return aCooked - bCooked
      const aTime = a.cookMinutes ?? Number.POSITIVE_INFINITY
      const bTime = b.cookMinutes ?? Number.POSITIVE_INFINITY
      return aTime - bTime
    })
}
