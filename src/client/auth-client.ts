import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** Talks to the Better Auth handler on the same origin (`/api/auth/*`). */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
})
