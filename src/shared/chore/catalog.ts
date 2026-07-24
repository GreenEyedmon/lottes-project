/**
 * A curated, rules-based chore catalog with recommended starting frequencies and effort.
 * Pure data — the recurrence rules are type-checked here, and everything a household adds
 * from it stays fully editable. Weekdays are ISO (1 = Monday … 7 = Sunday).
 */

import type { RecurrenceRule } from './types.ts'

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A short human label for a recurrence rule, e.g. "Every day" or "Every 14 days". */
export function describeRecurrence(rule: RecurrenceRule): string {
  switch (rule.mode) {
    case 'fixedWeekly':
      return rule.weekdays.length === 7
        ? 'Every day'
        : rule.weekdays.map((d) => WEEKDAY_NAMES[d] ?? '').join(', ')
    case 'fixedMonthly':
      return `Day ${rule.dayOfMonth} monthly`
    case 'completionRelative':
      return `Every ${rule.everyDays} days (after done)`
    case 'frequencyTarget':
      return `${rule.timesPerWeek}× per week`
  }
}

export interface CatalogItem {
  name: string
  recurrence: RecurrenceRule
  estimatedEffortMinutes: number
  /** Why this frequency is suggested — shown as a gentle hint, never a mandate. */
  reason: string
}

export interface CatalogPack {
  category: string
  items: CatalogItem[]
}

export const CATALOG: CatalogPack[] = [
  {
    category: 'Kitchen',
    items: [
      {
        name: 'Wipe the counters',
        recurrence: { mode: 'fixedWeekly', weekdays: [1, 2, 3, 4, 5, 6, 7] },
        estimatedEffortMinutes: 5,
        reason: 'Used every day',
      },
      {
        name: 'Empty the bins',
        recurrence: { mode: 'fixedWeekly', weekdays: [2, 5] },
        estimatedEffortMinutes: 5,
        reason: 'Twice a week keeps smells down',
      },
      {
        name: 'Clean the stovetop',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 15,
        reason: 'Weekly is usually enough',
      },
      {
        name: 'Mop the floor',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 20,
        reason: 'Weekly for a used kitchen',
      },
      {
        name: 'Clean the refrigerator',
        recurrence: { mode: 'completionRelative', everyDays: 30 },
        estimatedEffortMinutes: 30,
        reason: 'Every month or so',
      },
    ],
  },
  {
    category: 'Bathroom',
    items: [
      {
        name: 'Clean the toilet',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 10,
        reason: 'Weekly is the norm',
      },
      {
        name: 'Clean the sink',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 5,
        reason: 'Weekly',
      },
      {
        name: 'Clean the shower',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 15,
        reason: 'Weekly stops build-up',
      },
      {
        name: 'Replace the towels',
        recurrence: { mode: 'fixedWeekly', weekdays: [7] },
        estimatedEffortMinutes: 5,
        reason: 'Fresh towels weekly',
      },
      {
        name: 'Deep-clean the bathroom',
        recurrence: { mode: 'completionRelative', everyDays: 30 },
        estimatedEffortMinutes: 45,
        reason: 'Monthly reset',
      },
    ],
  },
  {
    category: 'Bedroom',
    items: [
      {
        name: 'Change the bedding',
        recurrence: { mode: 'completionRelative', everyDays: 14 },
        estimatedEffortMinutes: 15,
        reason: 'Every two weeks',
      },
      {
        name: 'Vacuum the bedroom',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 15,
        reason: 'Weekly',
      },
      {
        name: 'Dust the surfaces',
        recurrence: { mode: 'fixedWeekly', weekdays: [6] },
        estimatedEffortMinutes: 10,
        reason: 'Weekly',
      },
    ],
  },
  {
    category: 'Living areas',
    items: [
      {
        name: 'Vacuum the living room',
        recurrence: { mode: 'fixedWeekly', weekdays: [3, 6] },
        estimatedEffortMinutes: 15,
        reason: 'Frequently used room',
      },
      {
        name: 'Tidy up',
        recurrence: { mode: 'fixedWeekly', weekdays: [7] },
        estimatedEffortMinutes: 15,
        reason: 'A weekly reset',
      },
      {
        name: 'Take out the recycling',
        recurrence: { mode: 'fixedWeekly', weekdays: [1] },
        estimatedEffortMinutes: 5,
        reason: 'Weekly collection',
      },
      {
        name: 'Water the plants',
        recurrence: { mode: 'fixedWeekly', weekdays: [3] },
        estimatedEffortMinutes: 5,
        reason: 'Once a week',
      },
    ],
  },
]
