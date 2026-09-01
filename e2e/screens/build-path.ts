import type { ResolvedManifest } from './resolve-manifest'

export interface RouteParam {
  name: string
  source: keyof ResolvedManifest | 'literal'
  literal?: string
  /** For a composite field like `exerciseRef` ("wger:345"), splits the
   *  resolved value on `on` and takes the segment at `index` — e.g.
   *  `{ on: ':', index: 0 }` for the source, `{ on: ':', index: 1 }` for
   *  the numeric id. Omitted for plain single-value params. */
  split?: { on: string; index: number }
}

/** Substitutes a route template's `:param` placeholders from the resolved
 *  manifest. Any param whose value is missing (undefined/null) is reported
 *  in `missing` instead of throwing — callers skip the test for that route
 *  rather than fail it (a fresh persona legitimately has no workouts yet). */
export function buildPath(
  template: string,
  params: RouteParam[],
  resolved: ResolvedManifest,
): { path: string; missing: string[] } {
  const missing: string[] = []
  let path = template
  for (const p of params) {
    const raw = p.source === 'literal' ? p.literal : resolved[p.source]
    if (raw === undefined || raw === null) {
      missing.push(p.name)
      continue
    }
    const value = p.split ? String(raw).split(p.split.on)[p.split.index] : raw
    if (value === undefined) {
      missing.push(p.name)
      continue
    }
    path = path.replace(`:${p.name}`, String(value))
  }
  return { path, missing }
}
