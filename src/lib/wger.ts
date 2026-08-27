/**
 * Live proxy + cache for wger's public exercise catalog.
 *
 * The app hosts no exercise data: exercises are fetched from wger's public API
 * over HTTP. wger removed its dedicated `/exercise/search/` endpoint in 2.5
 * (wger.de runs 2.6), and the surviving endpoints have no server-side text
 * search — so this module fetches the full English catalog once (2 pages),
 * caches it in memory, and filters by name/category in-process. The catalog
 * changes rarely, so a wholesale cache is both simpler and faster than
 * per-query upstream calls.
 *
 * External data is never trusted: the upstream payload is validated at the
 * fetch boundary, and pagination only ever follows links on the configured
 * wger host.
 *
 * Server-only: this module uses the Next.js `fetch` cache extension and must
 * never be imported into a Client Component. Consumers should call
 * `/api/exercises` over HTTP, not import this directly.
 */

import { getRedis } from './redis'

const WGER_BASE_URL = process.env.WGER_API_BASE_URL ?? 'https://wger.de/api/v2'
const WGER_ENGLISH_LANGUAGE_ID = 2
const WGER_PAGE_SIZE = 999 // wger's max page size (catalog ~1275 → 2 pages)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // how long a snapshot counts as FRESH
// After a failed refresh, serve the stale snapshot and don't re-attempt for
// this long — otherwise every request re-hammers an upstream that is already
// known to be down.
const STALE_RETRY_MS = 5 * 60 * 1000
const MAX_PAGES = 20 // safety bound on the pagination loop
const UPSTREAM_REVALIDATE_S = 86400 // Next.js Data Cache TTL for upstream pages
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
// Shared cross-instance cache of the mapped catalog. The raw wger payload is
// ~4.6MB (too large for Next's 2MB Data Cache), but the mapped Exercise[] is
// small, so we cache that in Redis. Bump the version suffix if the stored
// shape changes — v2 wraps the array in a `fetchedAt` envelope.
const REDIS_CATALOG_KEY = 'wger:exercise-catalog:v2'
// The shape this replaced: a bare Exercise[] with no timestamp. Read ONLY as a
// last resort, and only until v2 is written. Without it the deploy that ships
// v2 opens the exact window this change exists to close — v2 absent, a good v1
// snapshot sitting right there in Redis, and a wger outage taking the catalog
// down anyway. Safe to delete once every environment has served a v2 write.
const REDIS_CATALOG_LEGACY_KEY = 'wger:exercise-catalog:v1'
// Retention, NOT freshness. v1 gave the key a 24h TTL, which destroyed the
// snapshot at exactly the moment it stopped being fresh — so a cold instance
// during a wger outage had nothing to fall back on and the catalog (and with
// it the exercise picker) failed outright. Freshness is now derived from
// `fetchedAt`, and the key outlives it by a month so a stale-but-usable
// snapshot is always there to serve.
const REDIS_CATALOG_RETAIN_S = 30 * 24 * 60 * 60

/** A single exercise, mapped to the minimal shape this app surfaces. */
export interface Exercise {
  id: number
  name: string
  category: string
  equipment?: string[]
  /** Primary muscles (wger English names). Omitted when wger lists none. */
  muscles?: string[]
  /** Secondary muscles (wger English names). Omitted when wger lists none. */
  musclesSecondary?: string[]
}

/** Filters applied in-process against the cached catalog. */
export interface SearchOptions {
  search?: string
  category?: string
  limit?: number
}

// --- Upstream (wger) shapes — only the fields we read. ---

interface WgerTranslation {
  name: string
  language: number
}

interface WgerMuscle {
  id: number
  name: string
  name_en: string
  is_front: boolean
}

interface WgerExerciseInfo {
  id: number
  category: { id: number; name: string } | null
  equipment: { id: number; name: string }[]
  muscles: WgerMuscle[]
  muscles_secondary: WgerMuscle[]
  translations: WgerTranslation[]
}

/**
 * Maps a wger muscles array to English display names — non-empty `name_en`
 * preferred, anatomical `name` as the fallback (wger often leaves `name_en`
 * blank). Malformed entries are dropped, mirroring the record-level policy.
 */
function mapMuscleNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((m) => {
      if (!m || typeof m !== 'object') return undefined
      const muscle = m as Partial<WgerMuscle>
      if (typeof muscle.name_en === 'string' && muscle.name_en.length > 0) return muscle.name_en
      if (typeof muscle.name === 'string' && muscle.name.length > 0) return muscle.name
      return undefined
    })
    .filter((name): name is string => typeof name === 'string')
}

/**
 * Validates the top-level shape of a wger list response, throwing on anything
 * unexpected rather than trusting a blind cast. Individual results stay
 * `unknown` and are validated per-record by `mapExercise`.
 */
function parseListResponse(data: unknown): { next: string | null; results: unknown[] } {
  if (!data || typeof data !== 'object') {
    throw new Error('wger response was not a JSON object')
  }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.results)) {
    throw new Error('wger response was missing a results array')
  }
  if (obj.next !== null && typeof obj.next !== 'string') {
    throw new Error('wger response had an invalid next field')
  }
  return { next: obj.next, results: obj.results }
}

/**
 * Maps a wger exercise to our `Exercise`, or `null` when the record is
 * malformed or lacks an English name or category. Every field read here is
 * validated first — a single bad record is dropped, not fatal.
 */
function mapExercise(raw: unknown): Exercise | null {
  if (!raw || typeof raw !== 'object') return null
  const info = raw as Partial<WgerExerciseInfo>

  if (typeof info.id !== 'number') return null
  if (!info.category || typeof info.category.name !== 'string') return null
  if (!Array.isArray(info.translations)) return null

  const name = info.translations.find(
    (t): t is WgerTranslation =>
      !!t && typeof t === 'object' && (t as WgerTranslation).language === WGER_ENGLISH_LANGUAGE_ID,
  )?.name
  if (typeof name !== 'string' || name.length === 0) return null

  const equipment = Array.isArray(info.equipment)
    ? info.equipment
        .map((e) => (e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined))
        .filter((n): n is string => typeof n === 'string')
    : []

  const exercise: Exercise = { id: info.id, name, category: info.category.name }
  // Keep `equipment` truly optional: omit the key entirely when there is none.
  if (equipment.length > 0) exercise.equipment = equipment
  // Same convention for the muscle arrays (Phase 5 tagging input).
  const muscles = mapMuscleNames(info.muscles)
  if (muscles.length > 0) exercise.muscles = muscles
  const musclesSecondary = mapMuscleNames(info.muscles_secondary)
  if (musclesSecondary.length > 0) exercise.musclesSecondary = musclesSecondary
  return exercise
}

/** Fetches and maps every English exercise, following wger's pagination. */
async function fetchAllExercises(): Promise<Exercise[]> {
  const baseOrigin = new URL(WGER_BASE_URL).origin
  const exercises: Exercise[] = []
  let url: string | null =
    `${WGER_BASE_URL}/exerciseinfo/?language=${WGER_ENGLISH_LANGUAGE_ID}` +
    `&limit=${WGER_PAGE_SIZE}&format=json`

  for (let page = 0; url && page < MAX_PAGES; page++) {
    // Only ever fetch from the configured wger host, even if a page's `next`
    // link points elsewhere (defense against a redirected/poisoned upstream).
    if (new URL(url).origin !== baseOrigin) {
      throw new Error('wger pagination pointed to an unexpected host')
    }

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: UPSTREAM_REVALIDATE_S },
    })
    if (!res.ok) throw new Error(`wger request failed: ${res.status}`)

    const { next, results } = parseListResponse(await res.json())
    for (const raw of results) {
      const mapped = mapExercise(raw)
      if (mapped) exercises.push(mapped)
    }
    url = next
  }

  return exercises
}

// Cache the catalog across requests (and dev HMR reloads) via a globalThis
// singleton, mirroring the DB client in src/db/index.ts.
/** A catalog snapshot and when it was taken. `retryAfter` is set only after a
 *  FAILED refresh: it holds the stale snapshot in service, and keeps the next
 *  requests off an upstream already known to be down. */
type CatalogCache = { data: Exercise[]; fetchedAt: number; retryAfter?: number }
const globalForWger = globalThis as unknown as {
  exerciseCache?: CatalogCache
  // Shared promise for an in-progress load, so concurrent cold callers collapse
  // into a single upstream fetch instead of each refetching the catalog.
  catalogInflight?: Promise<Exercise[]>
}

/** Whether a snapshot is still inside the freshness window. */
function isFresh(snapshot: { fetchedAt: number }, now: number): boolean {
  return now - snapshot.fetchedAt < CACHE_TTL_MS
}

/** The stored Redis envelope — an array plus the time it was fetched. */
type CatalogSnapshot = { data: Exercise[]; fetchedAt: number }

/** Narrows the un-$typed Redis payload. Stored JSON is data like any other:
 *  a missing or junk `fetchedAt` means we can't reason about age, so the
 *  snapshot is discarded rather than trusted as fresh. */
function isCatalogSnapshot(value: unknown): value is CatalogSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const { data, fetchedAt } = value as { data?: unknown; fetchedAt?: unknown }
  return Array.isArray(data) && data.length > 0 && typeof fetchedAt === 'number'
}

/** Reads the catalog snapshot from Redis. Never throws — returns null on miss,
 *  malformed payload, or error. May be STALE; the caller decides.
 *
 *  Falls back to the v1 key when v2 is absent, dating it to the epoch: a bare
 *  array carries no age, so it is permanently stale — it can never suppress a
 *  refresh, only rescue one that fails. */
async function readCatalogFromRedis(): Promise<CatalogSnapshot | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const stored = await redis.get<unknown>(REDIS_CATALOG_KEY)
    if (isCatalogSnapshot(stored)) return stored
    const legacy = await redis.get<unknown>(REDIS_CATALOG_LEGACY_KEY)
    return Array.isArray(legacy) && legacy.length > 0
      ? { data: legacy as Exercise[], fetchedAt: 0 }
      : null
  } catch (error: unknown) {
    console.error('Redis read failed for exercise catalog', error)
    return null
  }
}

/** Writes a snapshot to Redis under the retention TTL. Never throws — caching
 *  is best-effort. */
async function writeCatalogToRedis(snapshot: CatalogSnapshot): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(REDIS_CATALOG_KEY, snapshot, { ex: REDIS_CATALOG_RETAIN_S })
  } catch (error: unknown) {
    console.error('Redis write failed for exercise catalog', error)
  }
}

/** The newer of two snapshots — the best thing to fall back on. */
function newer(a: CatalogCache | null, b: CatalogSnapshot | null): CatalogSnapshot | null {
  if (!a) return b
  if (!b) return a
  return a.fetchedAt >= b.fetchedAt ? a : b
}

/**
 * Resolves the catalog through three layers, fastest first:
 *   1. in-memory singleton (same warm instance),
 *   2. Redis (shared across all instances — survives cold starts),
 *   3. wger upstream (then backfills Redis + memory).
 *
 * STALE BEATS NOTHING. A snapshot going stale is not a reason to discard it:
 * this is a public list of exercise names and categories that changes a few
 * times a year, and the alternative to a slightly-old catalog is a dead
 * exercise picker — mid-workout, you can't add or swap a movement. So a failed
 * refresh serves the newest snapshot we hold and schedules a retry, and only a
 * failure with NOTHING cached propagates. The remaining hole is a cold Redis
 * and a down upstream at the same moment; a committed seed file would close it,
 * at the cost of a snapshot that rots in the repo.
 */
async function getCatalog(): Promise<Exercise[]> {
  const now = Date.now()
  const cached = globalForWger.exerciseCache
  // Serve memory while it is fresh — or while a failed refresh's retry floor
  // still holds, which keeps a down upstream from being hammered per request.
  if (cached && (isFresh(cached, now) || (cached.retryAfter ?? 0) > now)) return cached.data

  // Collapse concurrent cold loads onto one shared promise.
  if (globalForWger.catalogInflight) return globalForWger.catalogInflight

  const load = (async () => {
    const fromRedis = await readCatalogFromRedis()
    if (fromRedis && isFresh(fromRedis, Date.now())) {
      globalForWger.exerciseCache = fromRedis
      return fromRedis.data
    }

    // Neither layer is fresh, so refresh — holding on to the best stale copy
    // as the fallback rather than dropping it on the way to upstream.
    const fallback = newer(cached ?? null, fromRedis)
    try {
      const snapshot: CatalogSnapshot = { data: await fetchAllExercises(), fetchedAt: Date.now() }
      globalForWger.exerciseCache = snapshot
      await writeCatalogToRedis(snapshot)
      return snapshot.data
    } catch (error: unknown) {
      if (!fallback) throw error
      // Logged, not swallowed: serving stale indefinitely would otherwise hide
      // a permanently broken upstream. The age is the signal worth watching.
      console.error('wger catalog refresh failed; serving stale snapshot', {
        ageMs: Date.now() - fallback.fetchedAt,
        error,
      })
      globalForWger.exerciseCache = { ...fallback, retryAfter: Date.now() + STALE_RETRY_MS }
      return fallback.data
    }
  })()

  globalForWger.catalogInflight = load
  try {
    return await load
  } finally {
    globalForWger.catalogInflight = undefined
  }
}

/** Clears the in-memory catalog cache (and any in-flight load). Exported for tests. */
export function clearExerciseCache(): void {
  globalForWger.exerciseCache = undefined
  globalForWger.catalogInflight = undefined
}

/**
 * Returns the entire mapped catalog (cached). Intended for clients that load
 * the catalog once and filter in-process — far faster than a request per
 * keystroke, since the list is small and changes rarely.
 */
export async function getAllExercises(): Promise<Exercise[]> {
  return getCatalog()
}

/** Returns exercises from the cached catalog, filtered and capped. */
export async function searchExercises(options: SearchOptions = {}): Promise<Exercise[]> {
  const catalog = await getCatalog()

  let results = catalog
  const term = options.search?.trim().toLowerCase()
  if (term) results = results.filter((e) => e.name.toLowerCase().includes(term))

  const category = options.category?.trim().toLowerCase()
  if (category) results = results.filter((e) => e.category.toLowerCase() === category)

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  return results.slice(0, limit)
}
