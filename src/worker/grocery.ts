/**
 * Grocery orchestration (Phase 4a): the household's item catalog and the shared shopping
 * list. A list line lives as a `needed` entry and becomes immutable `purchased` history on
 * checkout — that history is what Phase 4b's replenishment math reads. At most one open line
 * per item (enforced by a partial unique index); re-adding bumps the existing line.
 */

import { and, eq } from 'drizzle-orm'
import { analyzeReplenishment } from '../shared/grocery/replenish.ts'
import type { Db } from './db/index.ts'
import { groceryItems, shoppingEntries } from './db/schema.ts'

/** Lowercase, trim, collapse internal whitespace — the dedupe key for an item name. */
export function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface GroceryItemView {
  id: string
  name: string
  category: string | null
  defaultUnit: string | null
}

export interface ShoppingEntryView {
  id: string
  itemId: string
  name: string
  category: string | null
  quantity: string | null
  note: string | null
  addedBy: string
  addedAt: number
}

/** Find an item by normalized name, or create it; unarchive if it was archived. */
async function ensureItem(
  db: Db,
  householdId: string,
  name: string,
  opts: { category?: string; unit?: string },
  now: number,
): Promise<string> {
  const nameKey = normalizeNameKey(name)
  const [existing] = await db
    .select()
    .from(groceryItems)
    .where(and(eq(groceryItems.householdId, householdId), eq(groceryItems.nameKey, nameKey)))
    .limit(1)
  if (existing) {
    if (existing.archived) {
      await db.update(groceryItems).set({ archived: false }).where(eq(groceryItems.id, existing.id))
    }
    return existing.id
  }
  const id = crypto.randomUUID()
  await db.insert(groceryItems).values({
    id,
    householdId,
    name: name.trim(),
    nameKey,
    category: opts.category ?? null,
    defaultUnit: opts.unit ?? null,
    archived: false,
    createdAt: now,
  })
  return id
}

export async function createItem(
  db: Db,
  householdId: string,
  now: number,
  input: { name: string; category?: string; unit?: string },
): Promise<{ id: string }> {
  const id = await ensureItem(db, householdId, input.name, input, now)
  return { id }
}

export async function listCatalog(db: Db, householdId: string): Promise<GroceryItemView[]> {
  const rows = await db
    .select()
    .from(groceryItems)
    .where(and(eq(groceryItems.householdId, householdId), eq(groceryItems.archived, false)))
    .orderBy(groceryItems.name)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    defaultUnit: r.defaultUnit,
  }))
}

export async function listShopping(db: Db, householdId: string): Promise<ShoppingEntryView[]> {
  const rows = await db
    .select({
      entry: shoppingEntries,
      itemName: groceryItems.name,
      itemCategory: groceryItems.category,
    })
    .from(shoppingEntries)
    .innerJoin(groceryItems, eq(shoppingEntries.itemId, groceryItems.id))
    .where(and(eq(shoppingEntries.householdId, householdId), eq(shoppingEntries.status, 'needed')))
    .orderBy(shoppingEntries.addedAt)
  return rows.map(({ entry, itemName, itemCategory }) => ({
    id: entry.id,
    itemId: entry.itemId,
    name: itemName,
    category: itemCategory,
    quantity: entry.quantity,
    note: entry.note,
    addedBy: entry.addedBy,
    addedAt: entry.addedAt,
  }))
}

export interface AddToListInput {
  itemId?: string
  name?: string
  category?: string
  unit?: string
  quantity?: string
  note?: string
}

/** Add an item to the list — by existing itemId or by name (creating the item). */
export async function addToList(
  db: Db,
  householdId: string,
  memberId: string,
  now: number,
  input: AddToListInput,
): Promise<{ id: string } | 'invalid'> {
  let itemId = input.itemId
  if (itemId) {
    const [item] = await db
      .select({ id: groceryItems.id })
      .from(groceryItems)
      .where(and(eq(groceryItems.id, itemId), eq(groceryItems.householdId, householdId)))
      .limit(1)
    if (!item) return 'invalid'
  } else {
    if (!input.name || !input.name.trim()) return 'invalid'
    itemId = await ensureItem(db, householdId, input.name, input, now)
  }

  // One open line per item — bump the existing one rather than duplicating.
  const [open] = await db
    .select()
    .from(shoppingEntries)
    .where(
      and(
        eq(shoppingEntries.householdId, householdId),
        eq(shoppingEntries.itemId, itemId),
        eq(shoppingEntries.status, 'needed'),
      ),
    )
    .limit(1)
  if (open) {
    await db
      .update(shoppingEntries)
      .set({ quantity: input.quantity ?? open.quantity, note: input.note ?? open.note })
      .where(eq(shoppingEntries.id, open.id))
    return { id: open.id }
  }

  const id = crypto.randomUUID()
  await db.insert(shoppingEntries).values({
    id,
    householdId,
    itemId,
    quantity: input.quantity ?? null,
    note: input.note ?? null,
    status: 'needed',
    addedBy: memberId,
    addedAt: now,
    purchasedBy: null,
    purchasedAt: null,
    priceCents: null,
    store: null,
  })
  return { id }
}

export async function purchaseEntry(
  db: Db,
  householdId: string,
  memberId: string,
  entryId: string,
  now: number,
  input: { priceCents?: number; store?: string },
): Promise<'ok' | 'not-found'> {
  const [row] = await db
    .select()
    .from(shoppingEntries)
    .where(eq(shoppingEntries.id, entryId))
    .limit(1)
  if (!row || row.householdId !== householdId) return 'not-found'
  if (row.status !== 'needed') return 'ok' // idempotent
  await db
    .update(shoppingEntries)
    .set({
      status: 'purchased',
      purchasedBy: memberId,
      purchasedAt: now,
      priceCents: input.priceCents ?? null,
      store: input.store ?? null,
    })
    .where(and(eq(shoppingEntries.id, entryId), eq(shoppingEntries.status, 'needed')))
  return 'ok'
}

export interface RestockSuggestion {
  itemId: string
  name: string
  category: string | null
  explanation: string
  evidence: Record<string, number>
}

/**
 * Restock hints, computed on demand: for each catalog item *not* already on the list, run
 * the pure replenishment analyzer over its purchase history. Three reads, all household-
 * scoped — fine at grocery scale.
 */
export async function getRestockSuggestions(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
): Promise<RestockSuggestion[]> {
  const purchases = await db
    .select({ itemId: shoppingEntries.itemId, purchasedAt: shoppingEntries.purchasedAt })
    .from(shoppingEntries)
    .where(
      and(eq(shoppingEntries.householdId, householdId), eq(shoppingEntries.status, 'purchased')),
    )
  const historyByItem = new Map<string, number[]>()
  for (const p of purchases) {
    if (p.purchasedAt == null) continue
    const list = historyByItem.get(p.itemId) ?? []
    list.push(p.purchasedAt)
    historyByItem.set(p.itemId, list)
  }

  const openRows = await db
    .select({ itemId: shoppingEntries.itemId })
    .from(shoppingEntries)
    .where(and(eq(shoppingEntries.householdId, householdId), eq(shoppingEntries.status, 'needed')))
  const onList = new Set(openRows.map((r) => r.itemId))

  const items = await db
    .select()
    .from(groceryItems)
    .where(and(eq(groceryItems.householdId, householdId), eq(groceryItems.archived, false)))

  const result: RestockSuggestion[] = []
  for (const item of items) {
    if (onList.has(item.id)) continue
    const history = historyByItem.get(item.id)
    if (!history) continue
    const suggestion = analyzeReplenishment({ now, timeZone, purchases: history })
    if (!suggestion) continue
    result.push({
      itemId: item.id,
      name: item.name,
      category: item.category,
      explanation: suggestion.explanation,
      evidence: suggestion.evidence,
    })
  }
  // Most overdue first.
  result.sort((a, b) => (b.evidence.daysSince ?? 0) - (a.evidence.daysSince ?? 0))
  return result
}

/** Remove an open line. Purchased entries are history and are never deleted here. */
export async function removeEntry(
  db: Db,
  householdId: string,
  entryId: string,
): Promise<'ok' | 'not-found'> {
  const [row] = await db
    .select()
    .from(shoppingEntries)
    .where(eq(shoppingEntries.id, entryId))
    .limit(1)
  if (!row || row.householdId !== householdId || row.status !== 'needed') return 'not-found'
  await db.delete(shoppingEntries).where(eq(shoppingEntries.id, entryId))
  return 'ok'
}
