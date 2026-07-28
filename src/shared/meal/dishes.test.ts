import { describe, expect, it } from 'vitest'
import { DISH_SUGGESTIONS, normalizeDishName, suggestIngredients } from './dishes.ts'

describe('suggestIngredients', () => {
  it('returns ingredients for a known dish, case/space-insensitively', () => {
    const a = suggestIngredients('Spaghetti Bolognese')
    const b = suggestIngredients('  spaghetti   bolognese ')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(a?.map((i) => i.name)).toContain('Minced beef')
  })

  it('marks pantry staples', () => {
    const pancakes = suggestIngredients('pancakes')
    expect(pancakes?.find((i) => i.name === 'Sugar')?.staple).toBe(true)
    expect(pancakes?.find((i) => i.name === 'Flour')?.staple).toBeFalsy()
  })

  it('matches on a contained dish name in both directions', () => {
    expect(suggestIngredients('veggie tacos')?.length).toBeGreaterThan(0) // input contains 'tacos'
    expect(suggestIngredients('tacos al pastor')?.length).toBeGreaterThan(0)
  })

  it('returns null for an unknown dish or empty input', () => {
    expect(suggestIngredients('beef wellington')).toBeNull()
    expect(suggestIngredients('   ')).toBeNull()
  })
})

describe('DISH_SUGGESTIONS', () => {
  it('has normalized keys and at least one non-staple ingredient each', () => {
    for (const dish of DISH_SUGGESTIONS) {
      expect(dish.nameKey).toBe(normalizeDishName(dish.nameKey))
      expect(dish.ingredients.some((i) => !i.staple)).toBe(true)
    }
  })
})
