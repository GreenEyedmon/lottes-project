/**
 * Dashboard aggregator (Phase 6d): one call that composes the household overview from the
 * existing per-area functions, so the landing page loads in a single round-trip. Read-only.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import { listOpenOccurrences } from './chores.ts'
import type { Db } from './db/index.ts'
import { shoppingEntries } from './db/schema.ts'
import { listShopping } from './grocery.ts'
import { getHistory } from './history.ts'
import { suggestMeals } from './meals.ts'

export interface DashboardView {
  chores: { overdue: number; dueToday: number; upcoming: number }
  shopping: { itemCount: number; estimatedCents: number | null }
  meal: { id: string; name: string; missingCount: number } | null
  activity: { id: string; text: string; at: number }[]
  workload: { memberId: string; name: string; completed: number }[]
}

export async function getDashboard(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
): Promise<DashboardView> {
  const occurrences = await listOpenOccurrences(db, householdId, timeZone, now)
  const chores = { overdue: 0, dueToday: 0, upcoming: 0 }
  for (const occ of occurrences) {
    if (occ.temporalStatus === 'overdue') chores.overdue++
    else if (occ.temporalStatus === 'due') chores.dueToday++
    else chores.upcoming++
  }

  // Estimated total for the list: each needed item's most recent known purchase price.
  const shopping = await listShopping(db, householdId)
  const neededIds = new Set(shopping.map((e) => e.itemId))
  let estimatedCents: number | null = null
  if (neededIds.size > 0) {
    const priced = await db
      .select({
        itemId: shoppingEntries.itemId,
        priceCents: shoppingEntries.priceCents,
        purchasedAt: shoppingEntries.purchasedAt,
      })
      .from(shoppingEntries)
      .where(
        and(
          eq(shoppingEntries.householdId, householdId),
          eq(shoppingEntries.status, 'purchased'),
          isNotNull(shoppingEntries.priceCents),
        ),
      )
    const latest = new Map<string, { price: number; at: number }>()
    for (const row of priced) {
      if (!neededIds.has(row.itemId) || row.priceCents == null) continue
      const at = row.purchasedAt ?? 0
      const prev = latest.get(row.itemId)
      if (!prev || at > prev.at) latest.set(row.itemId, { price: row.priceCents, at })
    }
    if (latest.size > 0) {
      estimatedCents = [...latest.values()].reduce((sum, v) => sum + v.price, 0)
    }
  }

  const meals = await suggestMeals(db, householdId, now, {})
  const top = meals[0]
  const meal = top ? { id: top.id, name: top.name, missingCount: top.missingCount } : null

  const history = await getHistory(db, householdId, timeZone, 'week', now)

  return {
    chores,
    shopping: { itemCount: shopping.length, estimatedCents },
    meal,
    activity: history.activity.slice(0, 5),
    workload: history.tally.map((t) => ({
      memberId: t.memberId,
      name: t.name,
      completed: t.completed,
    })),
  }
}
