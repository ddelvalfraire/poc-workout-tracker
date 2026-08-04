/**
 * Default compare pair — pure selection, no I/O. The one-tap promise: hitting
 * Compare should immediately show the user's real change, which means the
 * earliest vs the latest photo of the SAME pose (cross-pose compares are
 * apples to oranges). Untagged photos (pose null) form their own group — two
 * untagged mirror shots still compare honestly.
 */

/** The slice of a PhotoEntry the pair picker reads. */
export interface ComparablePhoto {
  id: string
  pose: string | null
  takenAtMs: number
}

/**
 * [earliest, latest] of the best same-pose group, or null when no pose group
 * has two photos (compare stays manual-pick only). Group choice: the group
 * containing the NEWEST photo wins when it has >= 2 members (the user's
 * current pose is what they're tracking); otherwise the group with the most
 * recent latest photo among groups of >= 2.
 */
export function defaultComparePair<T extends ComparablePhoto>(
  entries: readonly T[],
): [T, T] | null {
  if (entries.length < 2) return null
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    // Null pose gets a key no PhotoPose value can collide with.
    const key = entry.pose ?? ' untagged'
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }

  const pairFor = (group: T[]): [T, T] => {
    let earliest = group[0]
    let latest = group[0]
    for (const entry of group) {
      if (entry.takenAtMs < earliest.takenAtMs) earliest = entry
      if (entry.takenAtMs > latest.takenAtMs) latest = entry
    }
    return [earliest, latest]
  }

  const newest = entries.reduce((a, b) => (b.takenAtMs > a.takenAtMs ? b : a))
  const newestGroup = groups.get(newest.pose ?? ' untagged')
  if (newestGroup !== undefined && newestGroup.length >= 2) return pairFor(newestGroup)

  let best: T[] | null = null
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const latestMs = Math.max(...group.map((e) => e.takenAtMs))
    const bestMs = best === null ? -Infinity : Math.max(...best.map((e) => e.takenAtMs))
    if (latestMs > bestMs) best = group
  }
  return best === null ? null : pairFor(best)
}
