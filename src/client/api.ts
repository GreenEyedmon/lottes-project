/** Typed fetch helpers for the household API. All calls are same-origin, cookie-authed. */

import type { RecurrenceRule } from '../shared/chore/types.ts'

export interface HouseholdView {
  household: {
    id: string
    name: string
    ianaTimeZone: string
    digestHour: number
    quietStartHour: number
    quietEndHour: number
    remindersEnabled: boolean
    digestEnabled: boolean
    activityEnabled: boolean
  }
  me: { id: string; displayName: string; role: string }
  members: { id: string; displayName: string; role: string }[]
  rooms: { id: string; name: string }[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

/** The caller's household, or null if they don't have one yet. */
export async function getCurrentHousehold(): Promise<HouseholdView | null> {
  const res = await fetch('/api/households/current')
  if (res.status === 404 || res.status === 401) return null
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return (await res.json()) as HouseholdView
}

export function createHousehold(name: string, timeZone: string): Promise<{ id: string }> {
  return request('/api/households', { method: 'POST', body: JSON.stringify({ name, timeZone }) })
}

export function createInvite(householdId: string): Promise<{ code: string; expiresAt: number }> {
  return request(`/api/households/${householdId}/invites`, { method: 'POST' })
}

export function acceptInvite(code: string): Promise<{ householdId: string }> {
  return request(`/api/invites/${code}/accept`, { method: 'POST' })
}

export function addRoom(name: string): Promise<{ id: string; name: string }> {
  return request('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) })
}

export type TemporalStatus = 'upcoming' | 'due' | 'overdue'

export interface OccurrenceView {
  id: string
  name: string
  dueDate: string
  temporalStatus: TemporalStatus
  responsibleId: string | null
  templateId: string | null
}

export async function listOccurrences(): Promise<OccurrenceView[]> {
  const data = await request<{ occurrences: OccurrenceView[] }>('/api/occurrences')
  return data.occurrences
}

export function completeOccurrence(id: string): Promise<{ ok: boolean }> {
  return request(`/api/occurrences/${id}/complete`, { method: 'POST' })
}

export type MissedPolicy = 'collapse' | 'keep' | 'expire'

export function createChore(
  name: string,
  recurrence: Record<string, unknown>,
  options: { rotate?: boolean; missedPolicy?: MissedPolicy } = {},
): Promise<{ id: string }> {
  return request('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name, recurrence, ...options }),
  })
}

export interface CatalogChoreInput {
  name: string
  recurrence: RecurrenceRule
  estimatedEffortMinutes: number
  category: string
}

export function addCatalogChore(input: CatalogChoreInput): Promise<{ id: string }> {
  return request('/api/templates', { method: 'POST', body: JSON.stringify(input) })
}

export function skipOccurrence(id: string): Promise<{ ok: boolean }> {
  return request(`/api/occurrences/${id}/skip`, { method: 'POST' })
}

export function claimOccurrence(id: string): Promise<{ ok: boolean }> {
  return request(`/api/occurrences/${id}/claim`, { method: 'POST' })
}

export function postponeOccurrence(
  id: string,
  mode: 'this' | 'thisAndFuture',
  days: number,
): Promise<{ ok: boolean }> {
  return request(`/api/occurrences/${id}/postpone`, {
    method: 'POST',
    body: JSON.stringify({ mode, days }),
  })
}

export function createTask(title: string): Promise<{ id: string }> {
  return request('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) })
}

export interface NotificationSettings {
  digestHour: number
  quietStartHour: number
  quietEndHour: number
  remindersEnabled: boolean
  digestEnabled: boolean
  activityEnabled: boolean
}

export function updateSettings(
  id: string,
  settings: NotificationSettings,
): Promise<{ ok: boolean }> {
  return request(`/api/households/${id}/settings`, {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}

export type HistoryWindow = 'week' | 'month'

export interface TallyEntry {
  memberId: string
  name: string
  completed: number
  effortMinutes: number
}

export interface ActivityEntry {
  id: string
  text: string
  at: number
}

export interface HistoryView {
  window: HistoryWindow
  tally: TallyEntry[]
  totalEffort: number
  activity: ActivityEntry[]
}

export function getHistory(window: HistoryWindow): Promise<HistoryView> {
  return request(`/api/history?window=${window}`)
}

export interface SuggestionView {
  id: string
  templateId: string
  kind: string
  explanation: string
  evidence: Record<string, number>
}

export async function listSuggestions(): Promise<SuggestionView[]> {
  const data = await request<{ suggestions: SuggestionView[] }>('/api/suggestions')
  return data.suggestions
}

export function acceptSuggestion(id: string): Promise<{ ok: boolean }> {
  return request(`/api/suggestions/${id}/accept`, { method: 'POST' })
}

export function dismissSuggestion(id: string): Promise<{ ok: boolean }> {
  return request(`/api/suggestions/${id}/dismiss`, { method: 'POST' })
}

export interface GroceryItem {
  id: string
  name: string
  category: string | null
  defaultUnit: string | null
}

export interface ShoppingEntry {
  id: string
  itemId: string
  name: string
  category: string | null
  quantity: string | null
  note: string | null
  addedBy: string
  addedAt: number
}

export async function listGroceryItems(): Promise<GroceryItem[]> {
  const data = await request<{ items: GroceryItem[] }>('/api/grocery/items')
  return data.items
}

export interface RestockSuggestion {
  itemId: string
  name: string
  category: string | null
  explanation: string
  evidence: Record<string, number>
}

export interface ShoppingView {
  entries: ShoppingEntry[]
  restock: RestockSuggestion[]
}

export function getShopping(): Promise<ShoppingView> {
  return request<ShoppingView>('/api/grocery/list')
}

export function addToShoppingList(input: {
  itemId?: string
  name?: string
  category?: string
  quantity?: string
}): Promise<{ id: string }> {
  return request('/api/grocery/list', { method: 'POST', body: JSON.stringify(input) })
}

export function purchaseShoppingEntry(
  id: string,
  input: { priceCents?: number; store?: string } = {},
): Promise<{ ok: boolean }> {
  return request(`/api/grocery/entries/${id}/purchase`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function removeShoppingEntry(id: string): Promise<{ ok: boolean }> {
  return request(`/api/grocery/entries/${id}/remove`, { method: 'POST' })
}

export interface RecipeIngredient {
  itemId: string
  name: string
  quantity: string | null
  staple: boolean
}

export interface Recipe {
  id: string
  name: string
  dietaryTags: string[]
  cookMinutes: number | null
  servings: number | null
  ingredients: RecipeIngredient[]
}

export async function listRecipes(): Promise<Recipe[]> {
  const data = await request<{ recipes: Recipe[] }>('/api/meals/recipes')
  return data.recipes
}

export interface NewRecipeInput {
  name: string
  dietaryTags?: string[]
  cookMinutes?: number
  servings?: number
  ingredients: { name: string; quantity?: string; staple?: boolean }[]
}

export function createRecipe(input: NewRecipeInput): Promise<{ id: string }> {
  return request('/api/meals/recipes', { method: 'POST', body: JSON.stringify(input) })
}

export function deleteRecipe(id: string): Promise<{ ok: boolean }> {
  return request(`/api/meals/recipes/${id}/delete`, { method: 'POST' })
}

export interface SuggestedMeal extends Recipe {
  missingCount: number
}

export interface MealPrefs {
  maxCookMinutes?: number
  requiredTags?: string[]
}

export async function suggestMeals(prefs: MealPrefs = {}): Promise<SuggestedMeal[]> {
  const params = new URLSearchParams()
  if (prefs.maxCookMinutes != null) params.set('maxCookMinutes', String(prefs.maxCookMinutes))
  if (prefs.requiredTags?.length) params.set('tags', prefs.requiredTags.join(','))
  const qs = params.toString()
  const data = await request<{ meals: SuggestedMeal[] }>(`/api/meals/suggest${qs ? `?${qs}` : ''}`)
  return data.meals
}

export function cookRecipe(id: string): Promise<{ added: number }> {
  return request(`/api/meals/recipes/${id}/cook`, { method: 'POST' })
}

export function updateRecipe(id: string, input: NewRecipeInput): Promise<{ ok: boolean }> {
  return request(`/api/meals/recipes/${id}/update`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export interface MealHistoryEntry {
  id: string
  recipeId: string
  recipeName: string
  cookedBy: string
  cookedAt: number
}

export async function mealHistory(): Promise<MealHistoryEntry[]> {
  const data = await request<{ history: MealHistoryEntry[] }>('/api/meals/history')
  return data.history
}
