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
