/**
 * Replenishment analysis (Phase 4b): from an item's purchase history, is it probably time
 * to buy it again? Pure — takes the purchase instants + the current instant + the household
 * zone, returns at most one suggestion. This restock signal *is* the "lightweight pantry
 * estimate"; there is no inventory count behind it.
 *
 * Intervals are computed on local **calendar days** (each instant resolved to a date in the
 * household zone, then integer day math), so a DST day never skews a gap by an hour.
 */

import { daysFromCivil } from '../time/civil.ts'
import { localDateInZone } from '../time/zone.ts'

/** Need at least this many purchases (≥ 2 gaps) before a median cadence is meaningful. */
export const MIN_PURCHASES = 3

export interface ReplenishInput {
  now: number
  timeZone: string
  /** Purchase instants (epoch ms), any order. */
  purchases: readonly number[]
}

export type ReplenishEvidence = {
  purchaseCount: number
  medianDays: number
  daysSince: number
}

export interface ReplenishSuggestion {
  explanation: string
  evidence: ReplenishEvidence
}

/** Median of a non-empty list; even counts average the two middles, rounded to whole days. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  if (sorted.length % 2 === 1) return hi
  return Math.round(((sorted[mid - 1] ?? 0) + hi) / 2)
}

const plural = (n: number): string => (n === 1 ? '' : 's')

export function analyzeReplenishment(input: ReplenishInput): ReplenishSuggestion | null {
  const { now, timeZone, purchases } = input
  if (purchases.length < MIN_PURCHASES) return null

  const days = purchases
    .map((ms) => daysFromCivil(localDateInZone(ms, timeZone)))
    .sort((a, b) => a - b)
  const gaps = days.slice(1).map((day, i) => day - (days[i] ?? day))
  const medianDays = median(gaps)
  if (medianDays <= 0) return null // same-day repeats — no meaningful cadence

  const lastDay = days[days.length - 1] ?? 0
  const daysSince = daysFromCivil(localDateInZone(now, timeZone)) - lastDay
  if (daysSince < medianDays) return null // not due yet

  return {
    explanation: `Usually bought about every ${medianDays} day${plural(medianDays)} — last one ${daysSince} day${plural(daysSince)} ago.`,
    evidence: { purchaseCount: purchases.length, medianDays, daysSince },
  }
}
