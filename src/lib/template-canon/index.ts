/**
 * The template library's canonical seed content: the published-canon programs
 * the system account owns, authored as plain `ProgramInputUnparsed` payloads
 * and validated by the same `parseProgramInput` boundary every other create
 * path uses. The unit tests parse every payload; the seed script refuses to
 * write anything that fails the boundary, and re-checks every wger id against
 * the live catalog before it writes at all.
 *
 * The canon is split by what a lifter is actually shopping for:
 *  - `strength.ts`      — barbell programs organized around a number going up
 *  - `hypertrophy.ts`   — splits organized around weekly volume per muscle
 *  - `conditioning.ts`  — minimal-equipment and clock-based programs
 *
 * Exercise identity lives in `wger-ids.ts` (verified ids only) and slot
 * shapes in `builders.ts`. Nothing here names a raw catalog id.
 *
 * Names are the seed's idempotency key: re-seeding UPDATES the row with the
 * same name (full-replace via updateProgram) and CREATES anything new. So
 * renaming a template in this file orphans the old row rather than moving it
 * — rename deliberately, and clean up the orphan by hand.
 */
import type { ProgramInputUnparsed } from '../program-input'
import { STRENGTH_CANON } from './strength'
import { HYPERTROPHY_CANON } from './hypertrophy'
import { CONDITIONING_CANON } from './conditioning'

export { WGER } from './wger-ids'

/** The library, in the order the seed script writes it. */
export const TEMPLATE_CANON: readonly ProgramInputUnparsed[] = [
  ...STRENGTH_CANON,
  ...HYPERTROPHY_CANON,
  ...CONDITIONING_CANON,
]
