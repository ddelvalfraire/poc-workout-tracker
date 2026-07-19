/**
 * Live proxy for wger's PUBLIC routine templates (the `wger.ts` sibling for
 * routines instead of exercises).
 *
 * wger's routine endpoints — unlike its exercise catalog — require token
 * authentication (`RoutinePermission` demands an authenticated user even for
 * public templates), so this module needs `WGER_API_KEY` (a free wger.de
 * account's API key). Without it, or when wger is down, callers get a typed
 * unavailability result — the browse page renders an explanatory empty state
 * instead of erroring ("graceful downtime" over hard failure).
 *
 * Upstream calls ride the Next.js Data Cache with a 1-day revalidate — the
 * template catalog changes rarely, and the same cached structure serves both
 * the browse list and the import action. External data is never trusted: the
 * payload is shape-checked at the fetch boundary, and requests are pinned to
 * the configured wger host (same policy as `wger.ts`).
 *
 * Server-only: never import from a Client Component.
 */
import type { WgerRoutineStructure } from './wger-template-map'

const WGER_BASE_URL = process.env.WGER_API_BASE_URL ?? 'https://wger.de/api/v2'
const UPSTREAM_REVALIDATE_S = 86_400 // templates change rarely; 1-day TTL
/** Browse-surface cap: wger's public catalog is small; 50 is generous. */
const MAX_TEMPLATES = 50

/** Why the catalog could not be served — drives the empty-state copy. */
export type TemplatesUnavailableReason = 'unconfigured' | 'unavailable'

export type PublicTemplatesResult =
  | { ok: true; templates: WgerRoutineStructure[] }
  | { ok: false; reason: TemplatesUnavailableReason }

/** Auth header for wger's routine endpoints, or null when no key is set. */
function wgerAuthHeaders(): Record<string, string> | null {
  const key = process.env.WGER_API_KEY
  if (!key) return null
  return { Accept: 'application/json', Authorization: `Token ${key}` }
}

/** Validates a wger list response's top-level shape (same policy as wger.ts). */
function parseListResponse(data: unknown): { results: unknown[] } {
  if (!data || typeof data !== 'object') {
    throw new Error('wger response was not a JSON object')
  }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.results)) {
    throw new Error('wger response was missing a results array')
  }
  return { results: obj.results }
}

/** Narrows one routine payload to the mapper's input, or null when malformed.
 *  Only `id` is load-bearing here — the mapper defends every other field. */
function parseRoutine(raw: unknown): WgerRoutineStructure | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'number') return null
  return obj as unknown as WgerRoutineStructure
}

/** Fetches JSON from a wger endpoint with auth + the daily Data Cache TTL. */
async function fetchWgerJson(path: string, headers: Record<string, string>): Promise<unknown> {
  const url = `${WGER_BASE_URL}${path}`
  // Requests never leave the configured wger host (defense in depth — `path`
  // is caller-built, but a misconfigured base URL should fail loudly too).
  if (new URL(url).origin !== new URL(WGER_BASE_URL).origin) {
    throw new Error('wger request pointed to an unexpected host')
  }
  const res = await fetch(url, { headers, next: { revalidate: UPSTREAM_REVALIDATE_S } })
  if (!res.ok) throw new Error(`wger request failed: ${res.status}`)
  return res.json()
}

/**
 * Fetches one routine's full nested structure (days → slots → entries →
 * configs). Returns null when the key is missing, the routine is gone, or the
 * payload is malformed — the caller decides how loud to be.
 */
export async function getRoutineStructure(id: number): Promise<WgerRoutineStructure | null> {
  const headers = wgerAuthHeaders()
  if (!headers) return null
  try {
    const data = await fetchWgerJson(`/routine/${id}/structure/?format=json`, headers)
    return parseRoutine(data)
  } catch (error: unknown) {
    console.error(`wger routine structure fetch failed for #${id}`, error)
    return null
  }
}

/**
 * Lists wger's public routine templates WITH their full structures — the
 * browse page needs day counts and the import needs the tree, so one cached
 * fetch pass serves both. Malformed or unfetchable routines are dropped, not
 * fatal; a dead upstream or missing key yields a typed unavailability.
 */
export async function listPublicTemplates(): Promise<PublicTemplatesResult> {
  const headers = wgerAuthHeaders()
  if (!headers) return { ok: false, reason: 'unconfigured' }

  let summaries: WgerRoutineStructure[]
  try {
    const data = await fetchWgerJson(
      `/public-templates/?format=json&limit=${MAX_TEMPLATES}`,
      headers,
    )
    summaries = parseListResponse(data)
      .results.map(parseRoutine)
      .filter((r): r is WgerRoutineStructure => r !== null)
  } catch (error: unknown) {
    console.error('wger public-templates fetch failed', error)
    return { ok: false, reason: 'unavailable' }
  }

  const structures = await Promise.all(summaries.map((s) => getRoutineStructure(s.id)))
  return {
    ok: true,
    templates: structures.filter((s): s is WgerRoutineStructure => s !== null),
  }
}
