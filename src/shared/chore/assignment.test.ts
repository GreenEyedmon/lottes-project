import { describe, expect, it } from 'vitest'
import { rotatedResponsible } from './assignment.ts'

describe('rotatedResponsible', () => {
  const members = ['a', 'b', 'c']

  it('starts at the first member when there is no previous assignee', () => {
    expect(rotatedResponsible(members, null)).toBe('a')
  })

  it('advances to the next member and wraps around', () => {
    expect(rotatedResponsible(members, 'a')).toBe('b')
    expect(rotatedResponsible(members, 'b')).toBe('c')
    expect(rotatedResponsible(members, 'c')).toBe('a')
  })

  it('falls back to the first member when the previous is unknown', () => {
    expect(rotatedResponsible(members, 'gone')).toBe('a')
  })

  it('returns null with no members', () => {
    expect(rotatedResponsible([], 'a')).toBeNull()
  })
})
