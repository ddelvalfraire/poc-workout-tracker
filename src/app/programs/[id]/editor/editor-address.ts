import { parseWeekParam } from '../week-view'

/**
 * Pure logic for the program editor's ADDRESS — what is selected, resolved from
 * the URL alone. Kept free of JSX so it unit-tests as plain functions (same
 * convention as ../week-view and ../derived-format).
 *
 * WHY THE URL AND NOT REACT STATE. DESIGN.md admits the editor as the only
 * multi-pane surface, on one condition: below `editor-pane-breakpoint` the
 * editor IS the phone column and drilling into a day NAVIGATES, at or above it
 * the same routes project into panes and drilling SELECTS — and "the panes are
 * the same routes and the same state, never a second implementation."
 *
 * That rule is only enforceable if selection has ONE home, and the URL is the
 * only home both projections can share. Held in React state, the phone's
 * navigation and the desktop's selection become two mechanisms kept in sync by
 * hand — the second implementation the rule forbids — and it breaks Back, deep
 * links, and refresh on the wide layout for free.
 *
 * So: the day is a PATH SEGMENT (it is a place you can be), while the week and
 * the inspected exercise are SEARCH PARAMS (they qualify where you are). The
 * split matters on phone, where a segment is a page you navigate to and a param
 * opens a sheet over the page you are on — exactly the projection DESIGN.md
 * describes, with the inspector standing in for the sheet at width. Same
 * address, two renderings, no duplicated state.
 *
 * The week parser is IMPORTED from ../week-view rather than restated. An editor
 * that disagreed with the detail page about what `?week=9` means would be its
 * own bug, and two copies of the rule is how that disagreement arrives.
 *
 * Everything here treats the URL as user-editable input, because it is:
 * repeated params take the first value, junk falls back rather than throwing,
 * and out-of-range values resolve to something honest rather than 404ing a
 * stale or shared link.
 */

/** A single search param as Next hands it over: absent, one value, or repeated. */
export type RawParam = string | string[] | undefined

/**
 * What the editor has selected, derived entirely from the URL.
 *
 * `day` is null when the address names no day — the structure-only view, which
 * is the phone's list page and the wide layout's empty canvas. `exercise` is
 * null when nothing is inspected, which is what collapses the inspector.
 */
export interface EditorAddress {
  /** 0-based day position, or null when no day is addressed. */
  day: number | null
  /** 0-based exercise position within the addressed day, or null. */
  exercise: number | null
  /** 1-based week, always resolved — the editor always shows some week. */
  week: number
}

/** First value of a possibly-repeated param; undefined when absent or empty. */
function first(raw: RawParam): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === undefined || value === '' ? undefined : value
}

/**
 * A non-negative integer from a raw param, or null. Rejects anything that is
 * not a clean base-10 integer — `parseInt` alone accepts "2abc" as 2 and "1e3"
 * as 1, and a mistyped URL silently selecting the wrong exercise is worse than
 * selecting none.
 */
function nonNegativeInt(raw: RawParam): number | null {
  const value = first(raw)
  if (value === undefined || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * The addressed day from its path segment, or null when it names no real day.
 *
 * Returns null — not 0 — for junk or an out-of-range segment. A day segment is
 * a PLACE: if the URL names a day that no longer exists (a deleted day, a link
 * from an older shape of the program), silently landing on day 1 would show one
 * day's sets under a URL claiming another. Falling back to the structure view
 * is honest, and on both projections it is a state the user can see and act on.
 */
export function parseDaySegment(raw: string | undefined, dayCount: number): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return null
  return parsed < dayCount ? parsed : null
}

/**
 * The inspected exercise, valid only within a day that is itself addressed.
 *
 * An exercise index without a day has no day to index into, so it resolves to
 * null rather than being carried around waiting for a day to appear.
 * Out-of-range CLEARS the inspector instead of clamping: unlike the week (a
 * continuous axis where the nearest legal value is a good guess), exercise
 * positions are identities, and the neighbour of a deleted exercise is a
 * different movement, not an approximation of it.
 */
export function parseExerciseParam(
  raw: RawParam,
  day: number | null,
  exerciseCount: number,
): number | null {
  if (day === null) return null
  const parsed = nonNegativeInt(raw)
  if (parsed === null) return null
  return parsed < exerciseCount ? parsed : null
}

/** The counts the address is resolved against — the program's real shape. */
export interface AddressBounds {
  /** How many days the program has. */
  dayCount: number
  /** How many exercises a given day has; called only for a day that resolved. */
  exerciseCountForDay: (day: number) => number
  /** The block length, for clamping the week. */
  mesocycleWeeks: number
  /** Where the week lands when the URL says nothing — the user's current week. */
  currentWeek: number
}

/**
 * Resolves the whole address in one pass, in dependency order: the day first
 * (the exercise is meaningless without it), then the exercise against THAT
 * day's length, then the week independently.
 *
 * Resolution order is the point — checking the exercise against the wrong day's
 * exercise count is how an inspector ends up open on a movement that isn't
 * there.
 */
export function resolveEditorAddress(
  params: { day?: string; exercise?: RawParam; week?: RawParam },
  bounds: AddressBounds,
): EditorAddress {
  const day = parseDaySegment(params.day, bounds.dayCount)
  const exercise = parseExerciseParam(
    params.exercise,
    day,
    day === null ? 0 : bounds.exerciseCountForDay(day),
  )
  const week = parseWeekParam(params.week, bounds.currentWeek, bounds.mesocycleWeeks)
  return { day, exercise, week }
}

/**
 * The address as a URL, for links and for the wide layout's selection writes.
 *
 * One builder for both projections, so a phone navigation and a desktop
 * selection can never mint different URLs for the same address — the "never a
 * second implementation" rule enforced at the one place addresses are made.
 * Defaults are omitted so the common URL stays short and shareable rather than
 * accumulating `?week=1` noise.
 */
export function editorHref(
  programId: string,
  address: { day?: number | null; exercise?: number | null; week?: number },
): string {
  const path =
    address.day === null || address.day === undefined
      ? `/programs/${programId}/editor`
      : `/programs/${programId}/editor/${address.day}`

  const search = new URLSearchParams()
  if (address.week !== undefined && address.week > 1) search.set('week', String(address.week))
  if (address.exercise !== null && address.exercise !== undefined) {
    search.set('exercise', String(address.exercise))
  }
  const query = search.toString()
  return query === '' ? path : `${path}?${query}`
}
