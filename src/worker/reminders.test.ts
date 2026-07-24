import { describe, expect, it } from 'vitest'
import { inQuietHours } from './reminders.ts'

describe('inQuietHours', () => {
  it('handles a same-day window (09:00–17:00)', () => {
    expect(inQuietHours(12, 9, 17)).toBe(true)
    expect(inQuietHours(9, 9, 17)).toBe(true) // inclusive start
    expect(inQuietHours(17, 9, 17)).toBe(false) // exclusive end
    expect(inQuietHours(8, 9, 17)).toBe(false)
  })

  it('handles a window that wraps midnight (22:00–07:00)', () => {
    expect(inQuietHours(23, 22, 7)).toBe(true)
    expect(inQuietHours(3, 22, 7)).toBe(true)
    expect(inQuietHours(22, 22, 7)).toBe(true) // inclusive start
    expect(inQuietHours(7, 22, 7)).toBe(false) // exclusive end
    expect(inQuietHours(12, 22, 7)).toBe(false)
  })

  it('is never quiet when the window is empty', () => {
    expect(inQuietHours(3, 8, 8)).toBe(false)
  })
})
