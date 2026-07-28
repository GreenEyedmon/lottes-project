import { describe, expect, it } from 'vitest'
import { type RecipeCandidate, recommendMeals } from './recommend.ts'

function candidate(over: Partial<RecipeCandidate> & { recipeId: string }): RecipeCandidate {
  return { cookMinutes: null, dietaryTags: [], missingCount: 0, lastCookedAt: null, ...over }
}

const ids = (list: RecipeCandidate[]): string[] => list.map((c) => c.recipeId)

describe('recommendMeals', () => {
  it('ranks fewest missing ingredients first', () => {
    const ranked = recommendMeals([
      candidate({ recipeId: 'a', missingCount: 3 }),
      candidate({ recipeId: 'b', missingCount: 0 }),
      candidate({ recipeId: 'c', missingCount: 1 }),
    ])
    expect(ids(ranked)).toEqual(['b', 'c', 'a'])
  })

  it('breaks ties toward the least-recently-cooked (never-cooked first)', () => {
    const ranked = recommendMeals([
      candidate({ recipeId: 'recent', missingCount: 1, lastCookedAt: 1000 }),
      candidate({ recipeId: 'never', missingCount: 1, lastCookedAt: null }),
      candidate({ recipeId: 'older', missingCount: 1, lastCookedAt: 500 }),
    ])
    expect(ids(ranked)).toEqual(['never', 'older', 'recent'])
  })

  it('then breaks ties toward the shorter cook time', () => {
    const ranked = recommendMeals([
      candidate({ recipeId: 'slow', missingCount: 0, cookMinutes: 60 }),
      candidate({ recipeId: 'fast', missingCount: 0, cookMinutes: 15 }),
    ])
    expect(ids(ranked)).toEqual(['fast', 'slow'])
  })

  it('hard-filters by max cook time but keeps unknown-time recipes', () => {
    const ranked = recommendMeals(
      [
        candidate({ recipeId: 'quick', cookMinutes: 20 }),
        candidate({ recipeId: 'long', cookMinutes: 90 }),
        candidate({ recipeId: 'untimed', cookMinutes: null }),
      ],
      { maxCookMinutes: 30 },
    )
    expect(ids(ranked).sort()).toEqual(['quick', 'untimed'])
  })

  it('hard-filters by required dietary tags', () => {
    const ranked = recommendMeals(
      [
        candidate({ recipeId: 'veg', dietaryTags: ['vegetarian'] }),
        candidate({ recipeId: 'vegan', dietaryTags: ['vegetarian', 'vegan'] }),
        candidate({ recipeId: 'meat', dietaryTags: [] }),
      ],
      { requiredTags: ['vegetarian'] },
    )
    expect(ids(ranked).sort()).toEqual(['veg', 'vegan'])
  })

  it('does not mutate the input array', () => {
    const input = [
      candidate({ recipeId: 'a', missingCount: 2 }),
      candidate({ recipeId: 'b', missingCount: 1 }),
    ]
    recommendMeals(input)
    expect(ids(input)).toEqual(['a', 'b'])
  })
})
