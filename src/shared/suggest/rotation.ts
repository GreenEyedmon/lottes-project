/**
 * Rotation-fairness analysis: is a non-rotating chore effectively falling on one person?
 * Pure — takes the completion tally (who did it, how often) plus household size, and
 * proposes turning on rotation when the load is both *shared* and *lopsided*.
 *
 * Only `enableRotation` is offered. Reordering a rotation ring is intentionally not
 * suggested: round-robin already gives everyone equal turns regardless of order, so a
 * reorder changes only who goes next — not long-run fairness.
 */

import type { RotationSignals, RotationSuggestion } from './types.ts'

/** Fewer completions than this and the split isn't meaningful yet. */
export const MIN_SAMPLE = 4
/** One member's share of completions before the load counts as lopsided. */
export const DOMINANCE = 0.7

export function analyzeRotation(signals: RotationSignals): RotationSuggestion | null {
  const { rotateEnabled, memberCount, tally } = signals
  if (rotateEnabled) return null // already rotating
  if (memberCount < 2) return null // nobody to share with

  const total = tally.reduce((sum, t) => sum + t.completed, 0)
  if (total < MIN_SAMPLE) return null

  const distinctCompleters = tally.filter((t) => t.completed > 0).length
  if (distinctCompleters < 2) return null // one person's chore, not a shared one

  const topCompleted = tally.reduce((max, t) => Math.max(max, t.completed), 0)
  if (topCompleted / total < DOMINANCE) return null // already reasonably even

  return {
    kind: 'enableRotation',
    explanation: `One person is doing most of this (${topCompleted} of the last ${total}). Rotate turns to share it?`,
    evidence: { sampleSize: total, topCompleted },
  }
}
