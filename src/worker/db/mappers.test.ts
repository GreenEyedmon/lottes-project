import type { InferSelectModel } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { ChoreOccurrence, CompletionEvent } from '../../shared/chore/types.ts'
import {
  toCompletionRow,
  toEngineOccurrence,
  toEngineTemplate,
  toOccurrenceRow,
} from './mappers.ts'
import type { choreOccurrences, choreTemplates } from './schema.ts'

describe('toEngineTemplate', () => {
  it('projects a template row onto scheduling fields, parsing dates and JSON', () => {
    const row = {
      id: 't1',
      householdId: 'h1',
      name: 'Vacuum living room',
      category: 'cleaning',
      roomId: null,
      recurrence: { mode: 'fixedWeekly', weekdays: [2] },
      missedPolicy: 'collapse',
      status: 'active',
      startDate: '2025-07-01',
      dueTime: '18:00',
      estimatedEffortMinutes: 15,
      defaultResponsibleId: 'alex',
      rotate: false,
      version: 1,
      createdAt: 1000,
    } satisfies InferSelectModel<typeof choreTemplates>

    expect(toEngineTemplate(row)).toEqual({
      id: 't1',
      householdId: 'h1',
      recurrence: { mode: 'fixedWeekly', weekdays: [2] },
      missedPolicy: 'collapse',
      status: 'active',
      startDate: { year: 2025, month: 7, day: 1 },
      dueTime: { hour: 18, minute: 0 },
      defaultResponsibleId: 'alex',
    })
  })

  it('treats a null due time as all-day', () => {
    const row = {
      id: 't1',
      householdId: 'h1',
      name: 'x',
      category: null,
      roomId: null,
      recurrence: { mode: 'completionRelative', everyDays: 14 },
      missedPolicy: 'keep',
      status: 'paused',
      startDate: '2025-07-01',
      dueTime: null,
      estimatedEffortMinutes: null,
      defaultResponsibleId: null,
      rotate: true,
      version: 3,
      createdAt: 1000,
    } satisfies InferSelectModel<typeof choreTemplates>

    const engine = toEngineTemplate(row)
    expect(engine.dueTime).toBeUndefined()
    expect(engine.defaultResponsibleId).toBeUndefined()
    expect(engine.recurrence).toEqual({ mode: 'completionRelative', everyDays: 14 })
  })
})

describe('occurrence row round-trip', () => {
  const occurrence: ChoreOccurrence = {
    id: 'o1',
    householdId: 'h1',
    templateId: 't1',
    dueDate: { year: 2025, month: 7, day: 1 },
    dueTime: { hour: 18, minute: 5 },
    dueInstant: 1_751_390_700_000,
    state: 'scheduled',
    responsibleId: 'alex',
    postponedFrom: { year: 2025, month: 6, day: 28 },
    generationKey: 't1:2025-07-01',
  }

  it('serializes a domain occurrence to a row and back losslessly', () => {
    const row = toOccurrenceRow(occurrence, 1000)
    expect(row.dueDate).toBe('2025-07-01')
    expect(row.dueTime).toBe('18:05')
    expect(row.postponedFrom).toBe('2025-06-28')
    expect(row.createdAt).toBe(1000)

    // Rehydrate as a selected row (defaults filled) and map back.
    const selected = {
      ...row,
      dueTime: '18:05',
      responsibleId: 'alex',
      postponedFrom: '2025-06-28',
      templateId: 't1',
      title: null,
      priority: null,
      version: 1,
    } satisfies InferSelectModel<typeof choreOccurrences>
    expect(toEngineOccurrence(selected)).toEqual(occurrence)
  })

  it('maps an all-day, unassigned one-off occurrence', () => {
    const row = {
      id: 'o2',
      householdId: 'h1',
      templateId: null,
      dueDate: '2025-08-01',
      dueTime: null,
      dueInstant: 123,
      state: 'scheduled',
      responsibleId: null,
      postponedFrom: null,
      title: 'Call the plumber',
      priority: 1,
      generationKey: 'oneoff:o2',
      version: 1,
      createdAt: 1000,
    } satisfies InferSelectModel<typeof choreOccurrences>

    const engine = toEngineOccurrence(row)
    expect(engine.templateId).toBeNull()
    expect(engine.dueTime).toBeUndefined()
    expect(engine.responsibleId).toBeUndefined()
    expect(engine.postponedFrom).toBeUndefined()
  })
})

describe('toCompletionRow', () => {
  it('maps booleans and optional fields', () => {
    const event: CompletionEvent = {
      occurrenceId: 'o1',
      completedById: 'sam',
      completedAt: 5000,
      wasEarly: false,
      wasLate: true,
      byNonAssignee: true,
    }
    expect(toCompletionRow(event, 'c1')).toEqual({
      id: 'c1',
      occurrenceId: 'o1',
      completedById: 'sam',
      completedAt: 5000,
      wasEarly: false,
      wasLate: true,
      byNonAssignee: true,
      effortActualMinutes: null,
      notes: null,
    })
  })
})
