import { describe, expect, it } from 'vitest'
import { computeMissing, type MissingIngredient } from './missing.ts'

const ing = (itemId: string, staple = false): MissingIngredient => ({ itemId, staple })

describe('computeMissing', () => {
  it('adds ingredients that are not staples, not on the list, and not recently bought', () => {
    const missing = computeMissing({
      ingredients: [ing('pasta'), ing('beef'), ing('onion')],
      onListItemIds: new Set(),
      recentlyPurchasedItemIds: new Set(),
    })
    expect(missing).toEqual(['pasta', 'beef', 'onion'])
  })

  it('skips pantry staples', () => {
    const missing = computeMissing({
      ingredients: [ing('pasta'), ing('salt', true), ing('oil', true)],
      onListItemIds: new Set(),
      recentlyPurchasedItemIds: new Set(),
    })
    expect(missing).toEqual(['pasta'])
  })

  it('skips items already on the list or recently purchased', () => {
    const missing = computeMissing({
      ingredients: [ing('pasta'), ing('beef'), ing('onion')],
      onListItemIds: new Set(['pasta']),
      recentlyPurchasedItemIds: new Set(['onion']),
    })
    expect(missing).toEqual(['beef'])
  })

  it('de-duplicates a repeated ingredient', () => {
    const missing = computeMissing({
      ingredients: [ing('beef'), ing('beef')],
      onListItemIds: new Set(),
      recentlyPurchasedItemIds: new Set(),
    })
    expect(missing).toEqual(['beef'])
  })
})
