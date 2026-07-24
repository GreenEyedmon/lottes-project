import { describe, expect, it } from 'vitest'
import { analyzeRotation } from './rotation.ts'
import type { RotationSignals } from './types.ts'

function signals(over: Partial<RotationSignals>): RotationSignals {
  return { rotateEnabled: false, memberCount: 2, tally: [], ...over }
}

describe('analyzeRotation', () => {
  it('suggests rotation when one member carries a shared chore', () => {
    const s = analyzeRotation(
      signals({
        tally: [
          { memberId: 'alex', completed: 8 },
          { memberId: 'bo', completed: 2 },
        ],
      }),
    )
    expect(s?.kind).toBe('enableRotation')
    expect(s?.evidence).toEqual({ sampleSize: 10, topCompleted: 8 })
    expect(s?.explanation).toContain('8 of the last 10')
  })

  it('stays quiet when rotation is already on', () => {
    expect(
      analyzeRotation(
        signals({
          rotateEnabled: true,
          tally: [
            { memberId: 'alex', completed: 8 },
            { memberId: 'bo', completed: 2 },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('needs at least two members', () => {
    expect(
      analyzeRotation(signals({ memberCount: 1, tally: [{ memberId: 'alex', completed: 10 }] })),
    ).toBeNull()
  })

  it('does not touch a one-person chore (nobody else does it)', () => {
    expect(analyzeRotation(signals({ tally: [{ memberId: 'alex', completed: 10 }] }))).toBeNull()
  })

  it('leaves an already-even split alone', () => {
    expect(
      analyzeRotation(
        signals({
          tally: [
            { memberId: 'alex', completed: 5 },
            { memberId: 'bo', completed: 5 },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('needs the minimum sample', () => {
    expect(
      analyzeRotation(
        signals({
          tally: [
            { memberId: 'alex', completed: 2 },
            { memberId: 'bo', completed: 1 },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('fires right at the dominance threshold', () => {
    const s = analyzeRotation(
      signals({
        tally: [
          { memberId: 'alex', completed: 7 },
          { memberId: 'bo', completed: 3 },
        ],
      }),
    )
    expect(s?.kind).toBe('enableRotation')
  })
})
