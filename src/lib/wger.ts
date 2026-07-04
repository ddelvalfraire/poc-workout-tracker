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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // exercise list changes rarely
const MAX_PAGES = 20 // safety bound on the pagination loop
const UPSTREAM_REVALIDATE_S = 86400 // Next.js Data Cache TTL for upstream pages
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
// Shared cross-instance cache of the mapped catalog. The raw wger payload is
// ~4.6MB (too large for Next's 2MB Data Cache), but the mapped Exercise[] is
// small, so we cache that in Redis. Bump the version suffix if Exercise changes.
const REDIS_CATALOG_KEY = 'wger:exercise-catalog:v1'
const REDIS_CATALOG_TTL_S = 86400

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
type CatalogCache = { data: Exercise[]; expiresAt: number }
const globalForWger = globalThis as unknown as {
  exerciseCache?: CatalogCache
  // Shared promise for an in-progress load, so concurrent cold callers collapse
  // into a single upstream fetch instead of each refetching the catalog.
  catalogInflight?: Promise<Exercise[]>
}

/** Reads the mapped catalog from Redis. Never throws — returns null on miss or error. */
async function readCatalogFromRedis(): Promise<Exercise[] | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const data = await redis.get<Exercise[]>(REDIS_CATALOG_KEY)
    return Array.isArray(data) && data.length > 0 ? data : null
  } catch (error: unknown) {
    console.error('Redis read failed for exercise catalog', error)
    return null
  }
}

/** Writes the mapped catalog to Redis with a TTL. Never throws — caching is best-effort. */
async function writeCatalogToRedis(data: Exercise[]): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(REDIS_CATALOG_KEY, data, { ex: REDIS_CATALOG_TTL_S })
  } catch (error: unknown) {
    console.error('Redis write failed for exercise catalog', error)
  }
}

/**
 * Resolves the catalog through three cache layers, fastest first:
 *   1. in-memory singleton (same warm instance),
 *   2. Redis (shared across all instances — survives cold starts),
 *   3. wger upstream (then backfills Redis + memory).
 */
async function getCatalog(): Promise<Exercise[]> {
  const cached = globalForWger.exerciseCache
  if (cached && cached.expiresAt > Date.now()) return cached.data

  // Collapse concurrent cold loads onto one shared promise.
  if (globalForWger.catalogInflight) return globalForWger.catalogInflight

  const load = (async () => {
    const fromRedis = await readCatalogFromRedis()
    const data = fromRedis ?? (await fetchAllExercises())
    globalForWger.exerciseCache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
    // Backfill Redis only when the data came from upstream, not from Redis.
    if (!fromRedis) await writeCatalogToRedis(data)
    return data
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
