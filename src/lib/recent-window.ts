/**
 * Rows whose `startedAt` falls within the trailing `hours` window (future
 * dates included — client/server clock skew must never hide a just-logged
 * session). Used by the home page to bound what the "Done today" strip
 * receives without a row cap that backdated entries could crowd out; the
 * exact local-calendar-day filter runs client-side.
 *
 * `now` is injectable for tests; the default keeps call sites clean. Lives in
 * lib (not the component) so the server component's render stays free of
 * impure Date.now() calls the React compiler rejects.
 */
export function startedWithinLastHours<T extends { startedAt: Date }>(
  rows: readonly T[],
  hours: number,
  now: Date = new Date(),
): T[] {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000
  return rows.filter((r) => r.startedAt.getTime() >= cutoff)
}

/**
 * Whether any row FINISHED within the trailing `hours` window — the home
 * page's "already trained today" approximation (the server can't know the
 * user's calendar day), which stands the Up-next hero down. In-progress rows
 * (null completedAt) never count: a live session is the banner's business.
 * Future-dated completions count (clock-skew symmetry with the filter above).
 */
export function completedWithinLastHours(
  rows: readonly { completedAt: Date | null }[],
  hours: number,
  now: Date = new Date(),
): boolean {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000
  return rows.some((r) => r.completedAt !== null && r.completedAt.getTime() >= cutoff)
}
