/**
 * Minimal transactional email via the Resend REST API (no SDK dependency). When
 * `RESEND_API_KEY` is unset — local dev, or before Resend is configured — the message is
 * logged instead of sent, so flows are testable with no email service.
 */

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] would send to ${to}: ${subject}`)
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

export function sendMagicLinkEmail(env: Env, to: string, url: string): Promise<void> {
  return sendEmail(
    env,
    to,
    'Your Lottes Project sign-in link',
    `<p>Click to sign in to Lottes Project:</p><p><a href="${url}">Sign in</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  )
}
