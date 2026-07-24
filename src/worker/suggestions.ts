/**
 * Adaptive-scheduling orchestration (Phase 3a): gather each template's recent behavior with
 * aggregate queries, run the pure analyzers, and persist pending suggestions idempotently.
 * Accepting one applies the change through `applyTemplateChange`; dismissing starts a
 * cooldown so the same idea doesn't nag. Nothing here decides on its own — it only proposes.
 */

import { and, eq, gte, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { analyzeFrequency } from '../shared/suggest/frequency.ts'
import type { SuggestionKind } from '../shared/suggest/types.ts'
import { applyTemplateChange } from './chores.ts'
import type { Db } from './db/index.ts'
import { choreOccurrences, choreTemplates, completionEvents, suggestions } from './db/schema.ts'

type Write = BatchItem<'sqlite'>

/** Behavior older than this doesn't inform today's cadence. */
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000
/** Don't re-raise a dismissed suggestion for this long. */
const COOLDOWN_MS = 28 * 24 * 60 * 60 * 1000

async function runBatch(db: Db, writes: Write[]): Promise<void> {
  const [first, ...rest] = writes
  if (first) await db.batch([first, ...rest])
}

/** Recompute and persist suggestions for one household. Idempotent per `(template, kind)`. */
export async function generateSuggestionsForHousehold(
  db: Db,
  householdId: string,
  now: number,
): Promise<void> {
  const templates = await db
    .select()
    .from(choreTemplates)
    .where(and(eq(choreTemplates.householdId, householdId), eq(choreTemplates.status, 'active')))
  if (templates.length === 0) return

  // One aggregate pass over recently completed occurrences → per-template signal counts.
  const stats = await db
    .select({
      templateId: choreOccurrences.templateId,
      completions: sql<number>`count(*)`,
      late: sql<number>`coalesce(sum(${completionEvents.wasLate}), 0)`,
      early: sql<number>`coalesce(sum(${completionEvents.wasEarly}), 0)`,
      postponed: sql<number>`coalesce(sum(case when ${choreOccurrences.postponedFrom} is not null then 1 else 0 end), 0)`,
    })
    .from(completionEvents)
    .innerJoin(choreOccurrences, eq(completionEvents.occurrenceId, choreOccurrences.id))
    .where(
      and(
        eq(choreOccurrences.householdId, householdId),
        gte(completionEvents.completedAt, now - WINDOW_MS),
      ),
    )
    .groupBy(choreOccurrences.templateId)
  const statByTemplate = new Map<string, (typeof stats)[number]>()
  for (const stat of stats) if (stat.templateId) statByTemplate.set(stat.templateId, stat)

  // Existing suggestions: the open one per key (to refresh) and the latest resolved (cooldown).
  const existing = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.householdId, householdId))
  const pendingByKey = new Map<string, (typeof existing)[number]>()
  const latestResolved = new Map<string, (typeof existing)[number]>()
  for (const row of existing) {
    const key = `${row.templateId}:${row.kind}`
    if (row.status === 'pending') {
      pendingByKey.set(key, row)
    } else {
      const prev = latestResolved.get(key)
      if (!prev || (row.resolvedAt ?? 0) > (prev.resolvedAt ?? 0)) latestResolved.set(key, row)
    }
  }

  const writes: Write[] = []
  for (const template of templates) {
    const stat = statByTemplate.get(template.id)
    if (!stat) continue
    const suggestion = analyzeFrequency({
      rule: template.recurrence,
      sampleSize: stat.completions,
      postponedCount: stat.postponed,
      lateCount: stat.late,
      earlyCount: stat.early,
    })
    if (!suggestion) continue

    const kind: SuggestionKind = suggestion.kind
    const key = `${template.id}:${kind}`
    const resolved = latestResolved.get(key)
    if (resolved?.status === 'dismissed' && (resolved.resolvedAt ?? 0) > now - COOLDOWN_MS) {
      continue // still in cooldown
    }

    const open = pendingByKey.get(key)
    if (open) {
      writes.push(
        db
          .update(suggestions)
          .set({
            patch: { recurrence: suggestion.proposedRule },
            explanation: suggestion.explanation,
            evidence: suggestion.evidence,
            createdAt: now,
          })
          .where(eq(suggestions.id, open.id)),
      )
    } else {
      writes.push(
        db.insert(suggestions).values({
          id: crypto.randomUUID(),
          householdId,
          templateId: template.id,
          kind,
          status: 'pending',
          patch: { recurrence: suggestion.proposedRule },
          explanation: suggestion.explanation,
          evidence: suggestion.evidence,
          createdAt: now,
          resolvedAt: null,
          resolvedBy: null,
          dedupeKey: key,
        }),
      )
    }
  }
  await runBatch(db, writes)
}

export interface PendingSuggestion {
  id: string
  templateId: string
  kind: SuggestionKind
  explanation: string
  evidence: Record<string, number>
}

export async function listPendingSuggestions(
  db: Db,
  householdId: string,
): Promise<PendingSuggestion[]> {
  const rows = await db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.householdId, householdId), eq(suggestions.status, 'pending')))
  return rows.map((row) => ({
    id: row.id,
    templateId: row.templateId,
    kind: row.kind,
    explanation: row.explanation,
    evidence: row.evidence,
  }))
}

export async function acceptSuggestion(
  db: Db,
  householdId: string,
  timeZone: string,
  suggestionId: string,
  memberId: string,
  now: number,
): Promise<'ok' | 'not-found'> {
  const [row] = await db.select().from(suggestions).where(eq(suggestions.id, suggestionId)).limit(1)
  if (!row || row.householdId !== householdId || row.status !== 'pending') return 'not-found'

  const applied = await applyTemplateChange(
    db,
    householdId,
    timeZone,
    row.templateId,
    { recurrence: row.patch.recurrence, dueTime: row.patch.dueTime, rotate: row.patch.rotate },
    memberId,
    now,
  )
  if (applied !== 'ok') return applied

  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: now, resolvedBy: memberId, dedupeKey: null })
    .where(eq(suggestions.id, suggestionId))
  return 'ok'
}

export async function dismissSuggestion(
  db: Db,
  householdId: string,
  suggestionId: string,
  memberId: string,
  now: number,
): Promise<'ok' | 'not-found'> {
  const [row] = await db.select().from(suggestions).where(eq(suggestions.id, suggestionId)).limit(1)
  if (!row || row.householdId !== householdId || row.status !== 'pending') return 'not-found'
  await db
    .update(suggestions)
    .set({ status: 'dismissed', resolvedAt: now, resolvedBy: memberId, dedupeKey: null })
    .where(eq(suggestions.id, suggestionId))
  return 'ok'
}
