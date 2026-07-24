import { describe, expect, it } from 'vitest'
import { isInviteUsable } from './invites.ts'

describe('isInviteUsable', () => {
  const now = 1_000_000

  it('is usable when unaccepted and not expired', () => {
    expect(isInviteUsable({ expiresAt: now + 1000, acceptedBy: null }, now)).toBe(true)
  })

  it('is unusable once accepted', () => {
    expect(isInviteUsable({ expiresAt: now + 1000, acceptedBy: 'member-1' }, now)).toBe(false)
  })

  it('is unusable once expired', () => {
    expect(isInviteUsable({ expiresAt: now - 1, acceptedBy: null }, now)).toBe(false)
  })
})
