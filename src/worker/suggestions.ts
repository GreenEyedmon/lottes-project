/**
 * Adaptive-scheduling orchestration (Phase 3a): gather each template's recent behavior with
 * aggregate queries, run the pure analyzers, and persist pending suggestions idempotently.
 * Accepting one applies the change through `applyTemplateChange`; dismissing starts a
 * cooldown so the same idea doesn't nag. Nothing here decides on its own — it only proposes.
 */

import { and, eq, gte } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { analyzeFrequency } from '../shared/suggest/frequency.ts'
import { analyzeRotation } from '../shared/suggest/rotation.ts'
import { analyzeDueTime, analyzeWeekday } from '../shared/suggest/timing.ts'
import type { CompletionMoment, SuggestionKind, SuggestionPatch } from '../shared/suggest/types.ts'
import { isoWeekday } from '../shared/time/civil.ts'
import { zonedPartsFromInstant } from '../shared/time/zone.ts'
import { applyTemplateChange } from './chores.ts'
import type { Db } from './db/index.ts'
import { toEngineTemplate } from './db/mappers.ts'
import {
  choreOccurrences,
  choreTemplates,
  completionEvents,
  members,
  suggestions,
} from './db/schema.ts'

type Write = BatchItem<'sqlite'>

/** Behavior older than this doesn't inform today's cadence. */
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000
/** Don't re-raise a dismissed suggestion for this long. */
const COOLDOWN_MS = 28 * 24 * 60 * 60 * 1000

async function runBatch(db: Db, writes: Write[]): Promise<void> {
  const [first, ...rest] = writes
  if (first) await db.batch([first, ...rest])
}

/** A proposed change, ready to persist under `(templateId, kind)`. */
interface Candidate {
  kind: SuggestionKind
  patch: SuggestionPatch
  explanation: string
  evidence: Record<string, number>
}

/** Per-template behavior accumulated from recent completions, feeding every analyzer. */
interface Behavior {
  sampleSize: number
  late: number
  early: number
  postponed: number
  moments: CompletionMoment[]
  /** Completions per member — the rotation-fairness tally. */
  byMember: Map<string, number>
}

/** Recompute and persist suggestions for one household. Idempotent per `(template, kind)`. */
export async function generateSuggestionsForHousehold(
  db: Db,
  householdId: string,
  timeZone: string,
  now: number,
): Promise<void> {
  const templates = await db
    .select()
    .from(choreTemplates)
    .where(and(eq(choreTemplates.householdId, householdId), eq(choreTemplates.status, 'active')))
  if (templates.length === 0) return

  const memberCount = (
    await db.select({ id: members.id }).from(members).where(eq(members.householdId, householdId))
  ).length

  // One pass over recently completed occurrences → per-template behavior (counts + when + who).
  const rows = await db
    .select({
      templateId: choreOccurrences.templateId,
      completedAt: completionEvents.completedAt,
      completedById: completionEvents.completedById,
      wasLate: completionEvents.wasLate,
      wasEarly: completionEvents.wasEarly,
      postponedFrom: choreOccurrences.postponedFrom,
    })
    .from(completionEvents)
    .innerJoin(choreOccurrences, eq(completionEvents.occurrenceId, choreOccurrences.id))
    .where(
      and(
        eq(choreOccurrences.householdId, householdId),
        gte(completionEvents.completedAt, now - WINDOW_MS),
      ),
    )
  const behaviorByTemplate = new Map<string, Behavior>()
  for (const row of rows) {
    if (!row.templateId) continue
    let behavior = behaviorByTemplate.get(row.templateId)
    if (!behavior) {
      behavior = {
        sampleSize: 0,
        late: 0,
        early: 0,
        postponed: 0,
        moments: [],
        byMember: new Map(),
      }
      behaviorByTemplate.set(row.templateId, behavior)
    }
    behavior.sampleSize++
    if (row.wasLate) behavior.late++
    if (row.wasEarly) behavior.early++
    if (row.postponedFrom) behavior.postponed++
    behavior.byMember.set(row.completedById, (behavior.byMember.get(row.completedById) ?? 0) + 1)
    const parts = zonedPartsFromInstant(row.completedAt, timeZone)
    behavior.moments.push({
      weekday: isoWeekday({ year: parts.year, month: parts.month, day: parts.day }),
      hour: parts.hour,
    })
  }

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
    const behavior = behaviorByTemplate.get(template.id)
    if (!behavior) continue
    const rule = template.recurrence
    const currentDueTime = toEngineTemplate(template).dueTime ?? null

    const candidates: Candidate[] = []
    const frequency = analyzeFrequency({
      rule,
      sampleSize: behavior.sampleSize,
      postponedCount: behavior.postponed,
      lateCount: behavior.late,
      earlyCount: behavior.early,
    })
    if (frequency) {
      candidates.push({
        kind: frequency.kind,
        patch: { recurrence: frequency.proposedRule },
        explanation: frequency.explanation,
        evidence: frequency.evidence,
      })
    }
    const weekday = analyzeWeekday({ rule, currentDueTime, moments: behavior.moments })
    if (weekday) {
      candidates.push({
        kind: weekday.kind,
        patch: { recurrence: weekday.proposedRule },
        explanation: weekday.explanation,
        evidence: weekday.evidence,
      })
    }
    const dueTime = analyzeDueTime({ rule, currentDueTime, moments: behavior.moments })
    if (dueTime) {
      candidates.push({
        kind: dueTime.kind,
        patch: { dueTime: dueTime.proposedDueTime },
        explanation: dueTime.explanation,
        evidence: dueTime.evidence,
      })
    }
    const rotation = analyzeRotation({
      rotateEnabled: template.rotate,
      memberCount,
      tally: [...behavior.byMember].map(([memberId, completed]) => ({ memberId, completed })),
    })
    if (rotation) {
      candidates.push({
        kind: rotation.kind,
        patch: { rotate: true },
        explanation: rotation.explanation,
        evidence: rotation.evidence,
      })
    }

    for (const candidate of candidates) {
      const key = `${template.id}:${candidate.kind}`
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
              patch: candidate.patch,
              explanation: candidate.explanation,
              evidence: candidate.evidence,
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
            kind: candidate.kind,
            status: 'pending',
            patch: candidate.patch,
            explanation: candidate.explanation,
            evidence: candidate.evidence,
            createdAt: now,
            resolvedAt: null,
            resolvedBy: null,
            dedupeKey: key,
          }),
        )
      }
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
