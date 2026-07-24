import { describe, expect, it } from 'vitest'
import { app } from './index.ts'

describe('worker', () => {
  it('reports healthy', async () => {
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('404s unknown non-api routes', async () => {
    const res = await app.request('/nope')

    expect(res.status).toBe(404)
  })

  // NOTE: `/api/*` routes are session-gated and hit the DB via Better Auth, so they
  // need real D1 bindings. Those are covered by workers-pool integration tests
  // (added alongside the query layer), not these bare unit tests.
})
