# Phase 1 · Step 1e — Notifications

**Status: draft for review.** No code yet. The final MVP piece: timed reminders and a
daily digest, so people actually get nudged. Web Push first-class, email as fallback.

This is the largest step, so it splits into two PRs:

## 1e-i — Web Push foundation (PWA + subscribe + send)

- **PWA**: a minimal `manifest.webmanifest` + a hand-written service worker
  (`public/sw.js`) that handles `push` (show notification) and `notificationclick`
  (focus/open the app). No offline caching — we only need push. Makes the app
  installable, which **iOS requires before Web Push works** (onboarding will nudge iOS
  users to "Add to Home Screen").
- **VAPID**: a self-hosted ES256 key pair (no service, no cost). *You generate it*; the
  **private** key is a Worker secret, the **public** key is exposed to the client.
- **Subscribe**: a "Turn on notifications" control asks for permission, subscribes via
  `PushManager` (using the VAPID public key), and POSTs the subscription to the API.
- **Store**: a new `push_subscriptions` table (member, endpoint, keys, createdAt).
- **Send**: the Worker sends pushes via a Web-Crypto Web Push library
  (e.g. `@block65/webcrypto-web-push` — zero-dep, Workers-compatible; confirmed at
  implementation). A "send test notification" endpoint proves the loop end to end.

## 1e-ii — Reminders, digest, quiet hours (the reminder cron)

- **Reminder scheduling**: when a timed occurrence is generated/created, enqueue a row in
  the existing **`reminders`** table (`remindAt`, `channel`, unique `dedupeKey`).
- **Reminder cron**: a second cron (**every 5 min**) finds due, unsent reminders and
  delivers them — **Web Push**, falling back to **Resend email** when a member has no push
  subscription. Marks `sentAt` (idempotent via `dedupeKey`).
- **Daily household digest**: a per-household summary ("3 due, 1 overdue, 2 unassigned")
  sent at each household's configured morning time (in its zone).
- **Quiet hours + settings**: a `notification_settings` per member — quiet-hours window,
  digest time, and per-type toggles (my reminders / overdue / digest). Reminders inside
  quiet hours are held or dropped per setting.

Activity notifications ("Alex completed X") stay Phase 2 — MVP is reminders + digest.

## Correctness / constraints

- Day-boundary and quiet-hours math run in the member/household zone, in TypeScript
  (the pure `src/shared` time helpers), never SQL.
- Delivery is **idempotent** (`reminders.dedupeKey`, `sentAt` guard) so a cron retry or
  overlap never double-sends.
- Free tier holds: Web Push is a protocol (no cost), Resend free covers household email,
  Workers Cron is free.

## Prerequisite (you, at deploy) — VAPID keys

I'll give you a one-command generator; you set:
- `VAPID_PRIVATE_KEY` (Worker secret) and `VAPID_SUBJECT` (a `mailto:` — Worker var).
- `VAPID_PUBLIC_KEY` — a Worker var (also read by the client).

## Decisions to confirm

1. **Split into 1e-i then 1e-ii** (recommended — 1e is big) vs. one PR.
2. **Reminder cron cadence = every 5 minutes** (reminders fire within 5 min of their
   time) — vs. every minute (exact, more invocations). Recommend 5 min.
3. **Minimal hand-written service worker** (push only) vs. `vite-plugin-pwa`/Workbox
   (heavier, adds offline caching we don't need). Recommend hand-written.
