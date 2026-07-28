/**
 * A small curated dictionary mapping common dish names to their typical ingredients, used to
 * pre-fill suggestions when someone names a recipe. Pure data + a lookup — no AI, no network.
 * The household edits whatever comes back before saving; this only saves typing.
 *
 * `staple` marks pantry basics (salt, oil) that Phase 5b never auto-adds to the shopping list.
 */

export interface SuggestedIngredient {
  name: string
  staple?: boolean
}

export interface DishSuggestion {
  /** Normalized dish name (see `normalizeDishName`). */
  nameKey: string
  ingredients: readonly SuggestedIngredient[]
}

export function normalizeDishName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

const S = (name: string): SuggestedIngredient => ({ name, staple: true })

export const DISH_SUGGESTIONS: readonly DishSuggestion[] = [
  {
    nameKey: 'spaghetti bolognese',
    ingredients: [
      { name: 'Spaghetti' },
      { name: 'Minced beef' },
      { name: 'Canned tomatoes' },
      { name: 'Onion' },
      { name: 'Garlic' },
      S('Olive oil'),
      S('Salt'),
      S('Pepper'),
    ],
  },
  {
    nameKey: 'pancakes',
    ingredients: [
      { name: 'Flour' },
      { name: 'Milk' },
      { name: 'Eggs' },
      { name: 'Butter' },
      S('Sugar'),
      S('Salt'),
    ],
  },
  {
    nameKey: 'omelette',
    ingredients: [{ name: 'Eggs' }, { name: 'Butter' }, { name: 'Cheese' }, S('Salt'), S('Pepper')],
  },
  {
    nameKey: 'chili con carne',
    ingredients: [
      { name: 'Minced beef' },
      { name: 'Kidney beans' },
      { name: 'Canned tomatoes' },
      { name: 'Onion' },
      { name: 'Garlic' },
      { name: 'Chili powder' },
      S('Cumin'),
      S('Olive oil'),
    ],
  },
  {
    nameKey: 'chicken stir fry',
    ingredients: [
      { name: 'Rice' },
      { name: 'Chicken breast' },
      { name: 'Mixed vegetables' },
      { name: 'Soy sauce' },
      { name: 'Garlic' },
      { name: 'Ginger' },
    ],
  },
  {
    nameKey: 'tacos',
    ingredients: [
      { name: 'Tortillas' },
      { name: 'Minced beef' },
      { name: 'Cheese' },
      { name: 'Lettuce' },
      { name: 'Tomato' },
      { name: 'Taco seasoning' },
    ],
  },
  {
    nameKey: 'chicken curry',
    ingredients: [
      { name: 'Rice' },
      { name: 'Chicken breast' },
      { name: 'Curry paste' },
      { name: 'Coconut milk' },
      { name: 'Onion' },
      { name: 'Garlic' },
    ],
  },
  {
    nameKey: 'risotto',
    ingredients: [
      { name: 'Arborio rice' },
      { name: 'Vegetable stock' },
      { name: 'Parmesan' },
      { name: 'Onion' },
      { name: 'White wine' },
      { name: 'Butter' },
    ],
  },
  {
    nameKey: 'tomato soup',
    ingredients: [
      { name: 'Canned tomatoes' },
      { name: 'Onion' },
      { name: 'Garlic' },
      { name: 'Vegetable stock' },
      { name: 'Cream' },
      S('Olive oil'),
    ],
  },
  {
    nameKey: 'pasta pesto',
    ingredients: [
      { name: 'Pasta' },
      { name: 'Pesto' },
      { name: 'Parmesan' },
      { name: 'Pine nuts' },
    ],
  },
  {
    nameKey: 'fried rice',
    ingredients: [
      { name: 'Rice' },
      { name: 'Eggs' },
      { name: 'Mixed vegetables' },
      { name: 'Soy sauce' },
      { name: 'Garlic' },
    ],
  },
  {
    nameKey: 'mac and cheese',
    ingredients: [
      { name: 'Macaroni' },
      { name: 'Cheese' },
      { name: 'Milk' },
      { name: 'Butter' },
      S('Flour'),
    ],
  },
  {
    nameKey: 'caesar salad',
    ingredients: [
      { name: 'Romaine lettuce' },
      { name: 'Chicken breast' },
      { name: 'Parmesan' },
      { name: 'Croutons' },
      { name: 'Caesar dressing' },
    ],
  },
  {
    nameKey: 'margherita pizza',
    ingredients: [
      { name: 'Pizza dough' },
      { name: 'Tomato sauce' },
      { name: 'Mozzarella' },
      { name: 'Basil' },
      S('Olive oil'),
    ],
  },
]

/**
 * Suggested ingredients for a dish name, or null if unknown. Tries an exact normalized match
 * first, then a contains-match either way ("veggie tacos" → "tacos", "tacos" → "beef tacos").
 */
export function suggestIngredients(dishName: string): readonly SuggestedIngredient[] | null {
  const key = normalizeDishName(dishName)
  if (!key) return null
  const exact = DISH_SUGGESTIONS.find((d) => d.nameKey === key)
  if (exact) return exact.ingredients
  const partial = DISH_SUGGESTIONS.find((d) => key.includes(d.nameKey) || d.nameKey.includes(key))
  return partial ? partial.ingredients : null
}
