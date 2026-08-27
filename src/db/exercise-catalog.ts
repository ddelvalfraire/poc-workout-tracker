import { cache } from 'react'
import { catalogKey, type ExerciseCatalog } from '@/lib/exercise-catalog'
import { getAllExercises, type Exercise } from '@/lib/wger'
import { listCustomExercises } from './custom-exercises'

/**
 * Loads the one merged exercise catalog — wger's shared catalog plus the
 * calling user's custom exercises. The shape and the pure accessors live in
 * lib/exercise-catalog (client-safe); this module is the server-only half,
 * because the customs read touches Postgres.
 *
 * ONE LOAD PER REQUEST: `cache()`-wrapped, the same request-memoization the
 * preference reads use (db/preferences.ts) — six callers, one query. Call it
 * from as many places as read it; only the first pays. The wger half costs
 * nothing on a warm instance (lib/wger.ts holds a 24h in-memory singleton,
 * with Redis as the cold-start backstop), so the memoized cost is a single
 * indexed customs query.
 *
 * Failure-tolerant PER SOURCE: catalog data is enrichment, not integrity, so a
 * wger outage still resolves custom slots (and vice versa); both failing yields
 * null and callers proceed unenriched. Never called inside a transaction — the
 * wger half can reach the network on a cold instance.
 */
export const getExerciseCatalog = cache(async (userId: string): Promise<ExerciseCatalog | null> => {
  // Async wrappers so even a synchronous throw lands as a rejection.
  const [wger, customs] = await Promise.allSettled([
    (async () => getAllExercises())(),
    (async () => listCustomExercises(userId))(),
  ])
  if (wger.status === 'rejected' && customs.status === 'rejected') return null
  const catalog = new Map<string, Exercise>()
  if (wger.status === 'fulfilled') {
    for (const e of wger.value) catalog.set(catalogKey('wger', e.id), e)
  }
  if (customs.status === 'fulfilled') {
    for (const c of customs.value) {
      catalog.set(catalogKey('custom', c.id), {
        id: c.id,
        name: c.name,
        category: c.category,
        ...(c.muscles && c.muscles.length > 0 ? { muscles: c.muscles } : {}),
        ...(c.musclesSecondary && c.musclesSecondary.length > 0
          ? { musclesSecondary: c.musclesSecondary }
          : {}),
      })
    }
  }
  return catalog
})
