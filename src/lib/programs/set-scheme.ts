/**
 * The quick-entry SET SCHEME parser: one pure function that turns a coach's
 * shorthand (`5,5,3,3,1`, `3x8-12 @ 7RPE`) into an explicit list of planned-set
 * targets. No I/O, no unit conversion, no database — the callers
 * (`applyProgramSetScheme` in db/program-bulk.ts, and the `apply_set_scheme`
 * MCP tool) own the boundary work.
 *
 * DESIGN STANCE — fail loudly, never guess. A scheme string is a plan for what
 * someone will actually lift, so a shape this grammar does not recognise is an
 * ERROR that names the offending token, never a best-effort partial parse.
 * Silently dropping "@ 7RPE" because the qualifier sat in an unexpected place
 * would hand back a scheme that looks right and prescribes something else; that
 * is the one failure mode this module exists to prevent.
 *
 * ACCEPTED GRAMMAR (whitespace is free everywhere, matching is case-insensitive):
 *
 *   scheme     := segment ( "," segment )* ( qualifier )*
 *   segment    := count "x" reps | reps
 *   count      := 1 .. MAX_SCHEME_SETS
 *   reps       := int | int "-" int          (0 .. MAX_SCHEME_REPS, min <= max)
 *   qualifier  := "@"? ( rpe | rir | load )
 *   rpe        := num "rpe" | "rpe" num      (0 .. 10, whole or .5 steps)
 *   rir        := int "rir" | "rir" int      (0 .. 20)
 *   load       := num ( "kg" | "lb" | "lbs" )
 *
 * `x`, `X` and `×` are all set-count separators.
 *
 * QUALIFIERS ARE SCHEME-WIDE, and may appear only AFTER the last segment. One
 * effort qualifier (RPE *or* RIR, never both — they are the same axis) and at
 * most one load. Per-segment qualifiers are refused rather than guessed at:
 * `5,5,3@9RPE` reads either as "the 3 is at RPE 9" or "the whole thing is",
 * and picking one quietly is exactly the wrong-plan failure above. Per-set
 * divergence is what fill-down and the set grid are for.
 *
 * DELIBERATELY NOT ACCEPTED:
 * - percentages (`3x5 @ 75%`) — a percentage of WHAT is the exercise
 *   progression's business (percent-1rm / amrap-cycle read its training max).
 *   A scheme string has no access to that, so accepting `75%` here could only
 *   ever mean writing 75 kg. Refused with a message saying where percentages
 *   actually live.
 * - bare numeric loads (`3x5 @ 100`) — indistinguishable from reps, and the
 *   unit is the difference between a warm-up and a PR attempt.
 * - prose (`3 sets of 8`) — the offending token is echoed back so the typo is
 *   visible.
 */

/** A parsed load, still in the unit the author typed. The caller converts. */
export interface SchemeLoad {
  value: number
  unit: 'kg' | 'lb'
}

/** One planned set the scheme expands to — the target fields a `program_sets`
 *  row (or a per-week override) carries. `null` means "this scheme says
 *  nothing about that field", which the apply layer turns into a clear. */
export interface SchemeSet {
  repMin: number
  repMax: number
  rir: number | null
  rpe: number | null
  load: SchemeLoad | null
}

/** Why a scheme string was refused. `token` is the offending fragment when one
 *  can be pointed at — the UI underlines it, the MCP layer quotes it. */
export interface SchemeParseError {
  message: string
  token?: string
}

export type SchemeParseResult =
  | { ok: true; sets: SchemeSet[] }
  | { ok: false; error: SchemeParseError }

/**
 * Upper bound on the sets one scheme may expand to. Chosen to sit at
 * MAX_PROPOSAL_PATCHES (lib/patch-proposal.ts): a scheme is applied as ONE
 * batch op, but the ceiling keeps a fat-fingered `300x5` from minting a
 * three-hundred-row write behind a single confirm.
 */
export const MAX_SCHEME_SETS = 20
/** Reps per set. Deliberately tighter than the column bound (10_000): at
 *  quick-entry scale a four-digit rep target is a typo, not a plan. */
export const MAX_SCHEME_REPS = 1000
/** Longest input accepted — a scheme is shorthand, not an essay. */
export const MAX_SCHEME_INPUT = 200

const SEGMENT_RE = /^(?:(\d+)\s*[x×]\s*)?(\d+)(?:\s*-\s*(\d+))?$/i
const RPE_SUFFIX_RE = /^(\d+(?:\.\d+)?)\s*rpe$/i
const RPE_PREFIX_RE = /^rpe\s*(\d+(?:\.\d+)?)$/i
const RIR_SUFFIX_RE = /^(\d+)\s*rir$/i
const RIR_PREFIX_RE = /^rir\s*(\d+)$/i
const LOAD_RE = /^(\d+(?:\.\d+)?)\s*(kg|lbs|lb)$/i
const PERCENT_RE = /^\d+(?:\.\d+)?\s*%$/

function fail(message: string, token?: string): SchemeParseResult {
  return { ok: false, error: token === undefined ? { message } : { message, token } }
}

/**
 * Splits the trailing qualifier run off the segment list. Qualifiers are
 * introduced by `@`, or — for the no-`@` shorthand `3x8-12 7RPE` — by
 * whitespace-separated trailing tokens that carry letters or a `%`. Peeling
 * stops at the first token that looks numeric, so the scheme body itself can
 * never be eaten.
 */
function splitQualifiers(input: string): { body: string; qualifiers: string[] } {
  const [head, ...rest] = input.split('@')
  const tail = rest.map((q) => q.trim()).filter((q) => q.length > 0)
  const words = head.trim().split(/\s+/).filter((w) => w.length > 0)
  const peeled: string[] = []
  while (words.length > 1 && /[a-z%]/i.test(words[words.length - 1])) {
    peeled.unshift(words.pop()!)
  }
  return { body: words.join(' '), qualifiers: [...peeled, ...tail] }
}

interface Qualifiers {
  rir: number | null
  rpe: number | null
  load: SchemeLoad | null
}

function parseQualifiers(tokens: string[]): Qualifiers | SchemeParseError {
  const result: Qualifiers = { rir: null, rpe: null, load: null }
  for (const raw of tokens) {
    const token = raw.trim()
    if (PERCENT_RE.test(token)) {
      return {
        message:
          'percentages come from the exercise progression (percent-1rm / amrap-cycle read its training max), not from a set scheme — give an absolute load like "100kg" instead',
        token,
      }
    }
    const rpeMatch = RPE_SUFFIX_RE.exec(token) ?? RPE_PREFIX_RE.exec(token)
    if (rpeMatch) {
      if (result.rpe !== null) return { message: 'RPE given more than once', token }
      if (result.rir !== null) {
        return { message: 'give either RPE or RIR, not both — they are the same axis', token }
      }
      const rpe = Number(rpeMatch[1])
      if (rpe > 10) return { message: 'RPE must be between 0 and 10', token }
      if (rpe * 2 !== Math.trunc(rpe * 2)) {
        return { message: 'RPE moves in half points (7, 7.5, 8)', token }
      }
      result.rpe = rpe
      continue
    }
    const rirMatch = RIR_SUFFIX_RE.exec(token) ?? RIR_PREFIX_RE.exec(token)
    if (rirMatch) {
      if (result.rir !== null) return { message: 'RIR given more than once', token }
      if (result.rpe !== null) {
        return { message: 'give either RPE or RIR, not both — they are the same axis', token }
      }
      const rir = Number(rirMatch[1])
      if (rir > 20) return { message: 'RIR must be between 0 and 20', token }
      result.rir = rir
      continue
    }
    const loadMatch = LOAD_RE.exec(token)
    if (loadMatch) {
      if (result.load !== null) return { message: 'load given more than once', token }
      const value = Number(loadMatch[1])
      if (value <= 0) return { message: 'a load must be greater than 0', token }
      result.load = { value, unit: loadMatch[2].toLowerCase().startsWith('lb') ? 'lb' : 'kg' }
      continue
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      return {
        message: 'a bare number after "@" is ambiguous — say "100kg", "225lb", "8RPE" or "2RIR"',
        token,
      }
    }
    return { message: 'unrecognised qualifier — expected RPE, RIR or a load like "100kg"', token }
  }
  return result
}

/**
 * Expands a quick-entry scheme string into planned sets. Pure and total: every
 * input either yields sets or a named reason, and it never throws.
 *
 * @example parseSetScheme('5,5,3,3,1')      // five sets, fixed reps
 * @example parseSetScheme('3x8-12 @ 7RPE')  // three sets, 8–12 reps, RPE 7
 * @example parseSetScheme('5,5,3x3 @100kg') // mixed list + multiplier
 */
export function parseSetScheme(input: string): SchemeParseResult {
  if (typeof input !== 'string') return fail('a set scheme must be text')
  const trimmed = input.trim()
  if (trimmed.length === 0) return fail('enter a set scheme, e.g. "3x8-12" or "5,5,3,3,1"')
  if (trimmed.length > MAX_SCHEME_INPUT) {
    return fail(`a set scheme must be at most ${MAX_SCHEME_INPUT} characters`)
  }

  const { body, qualifiers } = splitQualifiers(trimmed)
  if (body.length === 0) return fail('the scheme has no sets — start with something like "3x8"')

  const parsedQualifiers = parseQualifiers(qualifiers)
  if ('message' in parsedQualifiers) {
    return { ok: false, error: parsedQualifiers }
  }

  const sets: SchemeSet[] = []
  for (const raw of body.split(',')) {
    const segment = raw.trim()
    if (segment.length === 0) {
      return fail('empty segment — check the commas', raw)
    }
    const match = SEGMENT_RE.exec(segment)
    if (!match) {
      // Name the likeliest cause rather than a generic parse failure.
      if (/[x×]/i.test(segment)) {
        return fail('a set count needs reps on both sides, e.g. "3x8" or "3x8-12"', segment)
      }
      return fail('expected reps like "8", "8-12" or "3x8-12"', segment)
    }
    const [, countText, minText, maxText] = match
    const count = countText === undefined ? 1 : Number(countText)
    if (count < 1) return fail('a set count must be at least 1', segment)
    const repMin = Number(minText)
    const repMax = maxText === undefined ? repMin : Number(maxText)
    if (repMin > MAX_SCHEME_REPS || repMax > MAX_SCHEME_REPS) {
      return fail(`reps must be at most ${MAX_SCHEME_REPS}`, segment)
    }
    if (repMin > repMax) {
      return fail('a rep range must read low-to-high, e.g. "8-12"', segment)
    }
    if (sets.length + count > MAX_SCHEME_SETS) {
      return fail(`a scheme can describe at most ${MAX_SCHEME_SETS} sets`, segment)
    }
    for (let i = 0; i < count; i += 1) {
      sets.push({
        repMin,
        repMax,
        rir: parsedQualifiers.rir,
        rpe: parsedQualifiers.rpe,
        load: parsedQualifiers.load,
      })
    }
  }

  return { ok: true, sets }
}
