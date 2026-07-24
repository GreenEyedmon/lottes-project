/** Browser-side Web Push: request permission, subscribe, and register with the API. */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'unconfigured'

export async function enableNotifications(): Promise<EnableResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const res = await fetch('/api/push/vapid-public-key')
  const { publicKey } = (await res.json()) as { publicKey: string | null }
  if (!publicKey) return 'unconfigured'

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  const json = subscription.toJSON()
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
  return 'ok'
}

export async function sendTestNotification(): Promise<number> {
  const res = await fetch('/api/push/test', { method: 'POST' })
  if (!res.ok) return 0
  const { sent } = (await res.json()) as { sent?: number }
  return sent ?? 0
}
