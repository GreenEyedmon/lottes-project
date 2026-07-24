/** Round-robin assignment: the member after `previous` in the ordered list, wrapping. */
export function rotatedResponsible(
  memberIds: readonly string[],
  previous: string | null,
): string | null {
  if (memberIds.length === 0) return null
  if (!previous) return memberIds[0] ?? null
  const index = memberIds.indexOf(previous)
  if (index === -1) return memberIds[0] ?? null
  return memberIds[(index + 1) % memberIds.length] ?? null
}
