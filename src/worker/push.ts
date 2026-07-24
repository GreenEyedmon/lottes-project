/**
 * Web Push delivery via the Web Push Protocol + Web Crypto (Workers-compatible, no Node
 * crypto). VAPID keys are self-hosted secrets/vars — no third-party push service.
 */

import type { PushMessage, PushSubscription } from '@block65/webcrypto-web-push'
import { buildPushPayload } from '@block65/webcrypto-web-push'

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** True when VAPID is configured; push is optional until the keys are set. */
export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export interface Notification {
  title: string
  body: string
  url?: string
}

/**
 * Send one notification. Returns the push service's HTTP status — callers should delete
 * the subscription on 404/410 (it's gone).
 */
export async function sendPush(
  env: Env,
  sub: StoredSubscription,
  notification: Notification,
): Promise<number> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  }
  const message: PushMessage = { data: JSON.stringify(notification), options: { ttl: 60 } }
  const vapid = {
    subject: env.VAPID_SUBJECT ?? '',
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
  }
  const payload = await buildPushPayload(message, subscription, vapid)
  const response = await fetch(subscription.endpoint, payload)
  return response.status
}
