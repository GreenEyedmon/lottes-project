/**
 * Minimal transactional email via the Resend REST API (no SDK dependency). When
 * `RESEND_API_KEY` is unset — local dev, or before Resend is configured — the message is
 * logged instead of sent, so the magic-link flow is testable with no email service.
 */

export async function sendMagicLinkEmail(env: Env, to: string, url: string): Promise<void> {
  const subject = 'Your Lottes Project sign-in link'
  const html = `<p>Click to sign in to Lottes Project:</p><p><a href="${url}">Sign in</a></p><p>If you didn't request this, you can ignore this email.</p>`

  if (!env.RESEND_API_KEY) {
    console.log(`[magic-link] would email ${to}: ${url}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.APP_EMAIL_FROM ?? 'Lottes Project <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend send failed (${response.status}): ${await response.text()}`)
  }
}
