/**
 * Better Auth, instantiated per-request from `env.DB` (the D1 binding only exists inside
 * the request handler on Workers). Passwordless magic link; Better Auth owns the
 * user/session/account/verification tables.
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { account, session, user, verification } from './db/auth-schema.ts'
import { getDb } from './db/index.ts'
import { sendMagicLinkEmail } from './email.ts'

export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(getDb(env.DB), {
      provider: 'sqlite',
      schema: { user, session, account, verification },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_ORIGIN,
    trustedOrigins: env.APP_ORIGIN ? [env.APP_ORIGIN] : [],
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(env, email, url)
        },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

/** The authenticated user resolved from the request's session cookie, or null. */
export async function getSessionUser(env: Env, headers: Headers) {
  const result = await createAuth(env).api.getSession({ headers })
  return result?.user ?? null
}
