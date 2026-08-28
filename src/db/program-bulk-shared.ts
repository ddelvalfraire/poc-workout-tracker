import { inArray } from 'drizzle-orm'
import type { Technique } from '@/lib/program-input'
import { ProgramPatchError, type Tx } from './program-ownership'
import { programSetOverrides } from './schema'

/**
 * The vocabulary the bulk ops copy WITH — which target columns travel, how a
 * row is trimmed to them, and how a caller-named subset is checked. Kept in one
 * module because several ops need each piece and none of them owns it: a fill,
 * a scheme apply, a day duplicate and a week copy must agree about what "the
 * targets" are, and the moment that list exists twice they can drift apart
 * silently — a duplicate that quietly drops `restSec` looks identical in the
 * builder and trains differently.
 *
 * Everything here is pure or read-only. No function in this module writes a
 * row, bumps `updatedAt`, or records an event; those belong to the ops.
 */

/** The target fields a fill / scheme / override copy may carry. Deliberately
 *  excludes `setType` and `metricMode`: those are a set's SHAPE, and changing
 *  shape is an edit, not a fill (same stance as `setOverrideSchema`). */
export interface SetTargets {
  repMin?: number | null
  repMax?: number | null
  rir?: number | null
  rpe?: number | null
  suggestedLoadKg?: number | null
  tempo?: string | null
  durationSec?: number | null
  distanceM?: number | null
  restSec?: number | null
  technique?: Technique | null
}

/** The fillable target columns, in one list so the fill, scheme and week ops
 *  can never drift on WHICH fields travel. */
export const TARGET_FIELDS = [
  'repMin',
  'repMax',
  'rir',
  'rpe',
  'suggestedLoadKg',
  'tempo',
  'durationSec',
  'distanceM',
  'restSec',
  'technique',
] as const

/** The per-week override columns (mirrors OVERRIDE_FIELDS in program-patches). */
export const OVERRIDE_FIELDS = TARGET_FIELDS

/** Buckets rows by a key — the id-remap tables the copy paths zip against. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = map.get(key(row))
    if (bucket) bucket.push(row)
    else map.set(key(row), [row])
  }
  return map
}

/** Copies exactly the named fields off a row (a missing key becomes null, so a
 *  fill STATES every field it owns rather than leaving a stale one behind). */
export function pickFields<T extends object, K extends keyof T & string>(
  row: T,
  fields: readonly K[],
): { [P in K]: T[P] | null } {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null])) as {
    [P in K]: T[P] | null
  }
}

/** Validates a caller-supplied field subset against the fillable list — an
 *  unknown field name is a caller bug, not something to quietly ignore. */
export function normalizeFields(
  fields: readonly (keyof SetTargets)[] | undefined,
): readonly (typeof TARGET_FIELDS)[number][] {
  if (fields === undefined) return TARGET_FIELDS
  if (fields.length === 0) throw new ProgramPatchError('fill needs at least one field')
  for (const field of fields) {
    if (!(TARGET_FIELDS as readonly string[]).includes(field)) {
      throw new ProgramPatchError(`"${field}" is not a fillable set target`)
    }
  }
  return fields as readonly (typeof TARGET_FIELDS)[number][]
}

/** Every override row on the given sets, all columns. Read by BOTH the week ops
 *  (which replace them) and the day duplicate (which re-keys them onto the copy),
 *  so it sits here rather than in either. */
export function selectOverrides(tx: Tx, setIds: string[]) {
  return tx
    .select({
      id: programSetOverrides.id,
      programSetId: programSetOverrides.programSetId,
      week: programSetOverrides.week,
      repMin: programSetOverrides.repMin,
      repMax: programSetOverrides.repMax,
      rir: programSetOverrides.rir,
      rpe: programSetOverrides.rpe,
      suggestedLoadKg: programSetOverrides.suggestedLoadKg,
      tempo: programSetOverrides.tempo,
      durationSec: programSetOverrides.durationSec,
      distanceM: programSetOverrides.distanceM,
      restSec: programSetOverrides.restSec,
      technique: programSetOverrides.technique,
    })
    .from(programSetOverrides)
    .where(inArray(programSetOverrides.programSetId, setIds))
}
