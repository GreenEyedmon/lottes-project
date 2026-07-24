import { describe, expect, it } from 'vitest'
import app from './index.ts'

describe('worker', () => {
  it('reports healthy', async () => {
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('404s unknown api routes', async () => {
    const res = await app.request('/api/nope')

    expect(res.status).toBe(404)
  })
})
