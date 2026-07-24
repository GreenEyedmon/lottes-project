import { Hono } from 'hono'
import { api } from './api.ts'
import { createAuth } from './auth.ts'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Better Auth owns all auth endpoints (magic-link request/verify, session, sign-out).
// Registered before the gated API so it is never blocked by requireAuth.
app.on(['POST', 'GET'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

// Household / member / room / invite API — session-gated.
app.route('/api', api)

export default app
