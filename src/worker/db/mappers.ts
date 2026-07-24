/**
 * Convert between D1 rows and the pure `src/shared` domain types. This is the only place
 * that knows about both. The engine domain `ChoreTemplate` is a scheduling *projection*
 * of the fuller template row (name/category/etc. stay in the row for the app layer).
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { ChoreOccurrence, ChoreTemplate, CompletionEvent } from '../../shared/chore/types.ts'
import type { LocalDate } from '../../shared/time/civil.ts'
import { isoDate } from '../../shared/time/civil.ts'
import type { TimeOfDay } from '../../shared/time/zone.ts'
import type { choreOccurrences, choreTemplates, completionEvents } from './schema.ts'

type TemplateRow = InferSelectModel<typeof choreTemplates>
type OccurrenceRow = InferSelectModel<typeof choreOccurrences>
type OccurrenceInsert = InferInsertModel<typeof choreOccurrences>
type CompletionInsert = InferInsertModel<typeof completionEvents>

function parseIsoDate(value: string): LocalDate {
  const parts = value.split('-')
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) }
}

function parseTimeOfDay(value: string): TimeOfDay {
  const parts = value.split(':')
  return { hour: Number(parts[0]), minute: Number(parts[1]) }
}

function formatTimeOfDay(time: TimeOfDay): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

/** Project a template row onto the scheduling fields the Phase 0 engine consumes. */
export function toEngineTemplate(row: TemplateRow): ChoreTemplate {
  return {
    id: row.id,
    householdId: row.householdId,
    recurrence: row.recurrence,
    missedPolicy: row.missedPolicy,
    status: row.status,
    startDate: parseIsoDate(row.startDate),
    dueTime: row.dueTime ? parseTimeOfDay(row.dueTime) : undefined,
    defaultResponsibleId: row.defaultResponsibleId ?? undefined,
  }
}

export function toEngineOccurrence(row: OccurrenceRow): ChoreOccurrence {
  return {
    id: row.id,
    householdId: row.householdId,
    templateId: row.templateId,
    dueDate: parseIsoDate(row.dueDate),
    dueTime: row.dueTime ? parseTimeOfDay(row.dueTime) : undefined,
    dueInstant: row.dueInstant,
    state: row.state,
    responsibleId: row.responsibleId ?? undefined,
    postponedFrom: row.postponedFrom ? parseIsoDate(row.postponedFrom) : undefined,
    generationKey: row.generationKey,
  }
}

/** A domain occurrence → an insertable row (adds `createdAt`; `version` defaults to 1). */
export function toOccurrenceRow(occurrence: ChoreOccurrence, createdAt: number): OccurrenceInsert {
  return {
    id: occurrence.id,
    householdId: occurrence.householdId,
    templateId: occurrence.templateId,
    dueDate: isoDate(occurrence.dueDate),
    dueTime: occurrence.dueTime ? formatTimeOfDay(occurrence.dueTime) : null,
    dueInstant: occurrence.dueInstant,
    state: occurrence.state,
    responsibleId: occurrence.responsibleId ?? null,
    postponedFrom: occurrence.postponedFrom ? isoDate(occurrence.postponedFrom) : null,
    generationKey: occurrence.generationKey,
    createdAt,
  }
}

export function toCompletionRow(event: CompletionEvent, id: string): CompletionInsert {
  return {
    id,
    occurrenceId: event.occurrenceId,
    completedById: event.completedById,
    completedAt: event.completedAt,
    wasEarly: event.wasEarly,
    wasLate: event.wasLate,
    byNonAssignee: event.byNonAssignee,
    effortActualMinutes: event.effortActualMinutes ?? null,
    notes: event.notes ?? null,
  }
}
