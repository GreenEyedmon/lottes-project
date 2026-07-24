/** Typed fetch helpers for the household API. All calls are same-origin, cookie-authed. */

export interface HouseholdView {
  household: { id: string; name: string; ianaTimeZone: string }
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
