/** Invite-code helpers. `isInviteUsable` is pure and unit-tested. */

export function newInviteCode(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10)
}

export function isInviteUsable(
  invite: { expiresAt: number; acceptedBy: string | null },
  now: number,
): boolean {
  return invite.acceptedBy === null && invite.expiresAt > now
}
