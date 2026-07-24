/**
 * Runtime secrets/vars not declared in wrangler.jsonc (so `wrangler types` doesn't know
 * them). Set in production via `wrangler secret put`, and in `.dev.vars` locally.
 */
declare global {
  interface Env {
    /** Better Auth signing secret. Required. */
    BETTER_AUTH_SECRET: string
    /** Resend API key for magic-link email. Optional — absent ⇒ links are logged. */
    RESEND_API_KEY?: string
    /** From address for outgoing mail. Defaults to Resend's onboarding sender. */
    APP_EMAIL_FROM?: string
    /** VAPID keys for Web Push. Public key is also served to the client; private is secret. */
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
    /** VAPID `mailto:` subject. */
    VAPID_SUBJECT?: string
    // APP_ORIGIN is a wrangler.jsonc `var`, so it's typed by generated worker types.
  }
}

export {}
