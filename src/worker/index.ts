import { Hono } from 'hono'
import { api } from './api.ts'
import { createAuth } from './auth.ts'
import { generateForHousehold } from './chores.ts'
import { getDb } from './db/index.ts'
import { households } from './db/schema.ts'

export const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Better Auth owns all auth endpoints (magic-link request/verify, session, sign-out).
// Registered before the gated API so it is never blocked by requireAuth.
app.on(['POST', 'GET'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

// Household / member / room / invite / chore API — session-gated.
app.route('/api', api)

export default {
  fetch: app.fetch,

  // Daily generation cron: top up each household's occurrence horizon and sweep
  // missed-occurrence policies. Day-boundary logic lives in the engine, in the
  // household's timezone.
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const db = getDb(env.DB)
    const now = Date.now()
    const rows = await db.select().from(households)
    for (const household of rows) {
      await generateForHousehold(db, household.id, household.ianaTimeZone, now)
    }
  },
}
