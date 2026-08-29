import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { parseProgramInput } from '@/lib/program-input'
import { workouts, programDays } from './schema'

/**
 * The full-replace path behind /programs/[id]/edit, pinned on the thing it used
 * to destroy.
 *
 * `updateProgram` still replaces a program's children by DELETING every
 * `program_days` row and re-inserting them — but the days now carry a DURABLE
 * `slotKey` that the replace hands back to the day inheriting the slot, and the
 * workouts logged against that slot are re-pointed at the recreated row before
 * the transaction commits. `workouts.program_day_id` remains ON DELETE SET
 * NULL, so the wipe still nulls it; the re-attach is what makes that transient
 * instead of permanent.
 *
 * A sibling branch (`test/provenance-loss`, not an ancestor of this one) has a
 * `program-provenance-loss.test.ts` that recorded the loss (delete → re-insert
 * with no id carried over) as characterization. This suite was written against
 * the same mechanism rather than derived from that file: it pins the
 * preservation the fix introduces, not a literal inversion of those
 * assertions.
 *
 * Layer note: these db tests run against a recording Drizzle stub (the
 * established convention in save-program.test.ts / save-workout.test.ts) — no
 * Postgres is involved. So this file proves the WRITE SEQUENCE (which slot key
 * lands on which re-inserted day, and which workouts get re-pointed) and the
 * schema rules it rests on. The user-visible consequence is proved separately,
 * at the view layer, in app/programs/[id]/week-view.test.ts.
 */

interface InsertRecord {
  table: string
  values: unknown
}

const inserts: InsertRecord[] = []
const deletes: string[] = []
/** Call order across insert/delete/update, so "wipe THEN re-insert THEN
 *  re-attach" is assertable. */
const opLog: string[] = []
/** `programDayId` written by each workouts re-attach, in call order. */
const workoutRepoints: (string | undefined)[] = []

/** The day slots the program holds BEFORE the edit — what `snapshotDaySlots`
 *  reads back, and the identities a preserved day re-keys on. */
let existingSlots: { slotKey: string; position: number; name: string }[] = []

/**
 * Ids handed back by `.returning()`, minted per table so a day always reads as
 * `day-new-N`. The pre-edit ids (`day-old-N`) can never appear here — a full
 * replace has no way to ask for them. That is precisely why day identity has to
 * ride the slot key instead of the row id.
 */
const idCounters = new Map<string, number>()
const NEW_ID_PREFIX: Record<string, string> = {
  program_days: 'day-new-',
  program_exercises: 'ex-new-',
}
function mintId(table: string): string {
  const n = (idCounters.get(table) ?? 0) + 1
  idCounters.set(table, n)
  return `${NEW_ID_PREFIX[table] ?? `${table}-`}${n}`
}

type AnyTable = Parameters<typeof getTableName>[0]

/** The re-inserted days, as the stub minted them — what the post-insert
 *  `program_days` read (inside `reattachWorkoutProvenance`) hands back. */
function insertedDays(): { id: string; slotKey: string }[] {
  return inserts
    .filter((r) => r.table === 'program_days')
    .map((r, i) => ({
      id: `day-new-${i + 1}`,
      slotKey: (r.values as { slotKey?: string }).slotKey ?? `minted-slot-${i + 1}`,
    }))
}

function makeTx() {
  // The two `program_days` reads are told apart by order: the pre-wipe
  // snapshot comes first, the post-insert re-read second.
  let dayReads = 0
  return {
    insert: (table: AnyTable) => ({
      values: (v: unknown) => {
        const name = getTableName(table)
        inserts.push({ table: name, values: v })
        opLog.push(`insert:${name}`)
        return { returning: () => Promise.resolve([{ id: mintId(name) }]) }
      },
    }),
    select: () => {
      let table = ''
      const rows = (): unknown[] => {
        if (table !== 'program_days') return []
        dayReads += 1
        return dayReads === 1 ? existingSlots : insertedDays()
      }
      const builder = {
        from: (t: AnyTable) => {
          table = getTableName(t)
          return builder
        },
        innerJoin: () => builder,
        where: () => Promise.resolve(rows()),
      }
      return builder
    },
    update: (table: AnyTable) => ({
      set: (v: unknown) => ({
        where: () => {
          if (getTableName(table) === 'workouts') {
            opLog.push('update:workouts')
            workoutRepoints.push((v as { programDayId?: string }).programDayId)
            return Promise.resolve(undefined)
          }
          return Object.assign(Promise.resolve(undefined), {
            returning: () => Promise.resolve([{ id: 'p1', status: 'active' }]),
          })
        },
      }),
    }),
    delete: (table: AnyTable) => {
      const name = getTableName(table)
      deletes.push(name)
      opLog.push(`delete:${name}`)
      return { where: () => Promise.resolve(undefined) }
    },
  }
}

vi.mock('./index', () => ({
  db: { transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()) },
}))

const { getAllExercises } = vi.hoisted(() => ({ getAllExercises: vi.fn() }))
vi.mock('@/lib/exercises/wger', () => ({ getAllExercises }))

const { listCustomExercises } = vi.hoisted(() => ({ listCustomExercises: vi.fn() }))
vi.mock('./custom-exercises', () => ({ listCustomExercises }))

const { requireFeature, hasFeature } = vi.hoisted(() => ({
  requireFeature: vi.fn(),
  hasFeature: vi.fn(),
}))
vi.mock('./entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entitlements')>()),
  requireFeature,
  hasFeature,
}))

import { updateProgram, matchDaySlots } from './programs'

const USER = 'user_123'
const PROGRAM = 'prog_1'

const SLOT_PUSH = '11111111-1111-4111-8111-111111111111'
const SLOT_PULL = '22222222-2222-4222-8222-222222222222'
const SLOT_LEGS = '33333333-3333-4333-8333-333333333333'

/** The stored slots for the three-day block below. */
const storedSlots = [
  { slotKey: SLOT_PUSH, position: 0, name: 'Push' },
  { slotKey: SLOT_PULL, position: 1, name: 'Pull' },
  { slotKey: SLOT_LEGS, position: 2, name: 'Legs' },
]

/**
 * A realistic three-day block, as the EDITOR submits it: every day round-trips
 * the slot key it was loaded with (detailToProgramDraft → draftToProgramInput).
 */
const threeDayPlan = (
  overrides: { pushName?: string; keyed?: boolean; days?: ('Push' | 'Pull' | 'Legs')[] } = {},
) => {
  const { pushName = 'Push', keyed = true, days = ['Push', 'Pull', 'Legs'] } = overrides
  const byName = {
    Push: { name: pushName, slotKey: SLOT_PUSH, id: 73, exercise: 'Bench' },
    Pull: { name: 'Pull', slotKey: SLOT_PULL, id: 85, exercise: 'Row' },
    Legs: { name: 'Legs', slotKey: SLOT_LEGS, id: 90, exercise: 'Squat' },
  }
  return parseProgramInput({
    name: 'Volume Cut',
    mesocycleWeeks: 6,
    days: days.map((d) => ({
      ...(keyed ? { slotKey: byName[d].slotKey } : {}),
      name: byName[d].name,
      exercises: [{ wgerExerciseId: byName[d].id, name: byName[d].exercise, sets: [{ repMin: 5 }] }],
    })),
  })
}

/** The slot key written onto each re-inserted day, in insert order. */
const insertedSlotKeys = () =>
  inserts
    .filter((r) => r.table === 'program_days')
    .map((r) => (r.values as { slotKey?: string }).slotKey)

beforeEach(() => {
  inserts.length = 0
  deletes.length = 0
  opLog.length = 0
  workoutRepoints.length = 0
  idCounters.clear()
  existingSlots = storedSlots.map((s) => ({ ...s }))
  getAllExercises.mockResolvedValue([])
  listCustomExercises.mockResolvedValue([])
  requireFeature.mockReset()
  hasFeature.mockReset()
  hasFeature.mockResolvedValue(true)
})

describe('program_days.slot_key — the durable day identity', () => {
  it('is NOT NULL with a database-side default, so every day has one', () => {
    // Arrange / Act
    const slotKey = getTableConfig(programDays).columns.find((c) => c.name === 'slot_key')

    // Assert — a day without a slot key could never be preserved
    expect(slotKey).toBeDefined()
    expect(slotKey?.notNull).toBe(true)
    expect(slotKey?.hasDefault).toBe(true)
  })

  it('is unique, so a slot key names exactly one live day', () => {
    // Arrange / Act
    const uniques = getTableConfig(programDays).uniqueConstraints.map((u) =>
      u.columns.map((c) => c.name),
    )

    // Assert
    expect(uniques).toContainEqual(['slot_key'])
  })
})

describe('workouts provenance columns', () => {
  it('keeps program_day_id ON DELETE SET NULL — the wipe still nulls it', () => {
    // Arrange — the FK from workouts onto program_days
    const fk = getTableConfig(workouts).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'program_day_id'),
    )

    // Assert — unchanged on purpose: RESTRICT would forbid the replace's own
    // delete (and forbid a user deleting a day they trained). The re-attach,
    // not the FK, is what makes the null transient.
    expect(fk).toBeDefined()
    expect(fk?.onDelete).toBe('set null')
    expect(getTableName(fk!.reference().foreignTable)).toBe('program_days')
  })

  it('carries program_day_slot_key with NO foreign key — it must outlive the row', () => {
    // Arrange
    const config = getTableConfig(workouts)
    const column = config.columns.find((c) => c.name === 'program_day_slot_key')

    // Act
    const fks = config.foreignKeys.filter((f) =>
      f.reference().columns.some((c) => c.name === 'program_day_slot_key'),
    )

    // Assert — an FK here would be nulled by the very delete this column
    // exists to survive; nullable because history predates it.
    expect(column).toBeDefined()
    expect(column?.notNull).toBe(false)
    expect(fks).toEqual([])
  })

  it('carries the frozen day name/position, both nullable (never backfilled)', () => {
    // Arrange / Act
    const frozen = getTableConfig(workouts).columns.filter(
      (c) => c.name === 'program_day_name' || c.name === 'program_day_position',
    )

    // Assert
    expect(frozen).toHaveLength(2)
    for (const column of frozen) expect(column.notNull).toBe(false)
  })
})

describe('matchDaySlots', () => {
  it('follows the KEY, not the position, when days are reordered', () => {
    // Arrange — the editor moved Legs to the top; every day kept its key
    const incoming = [
      { slotKey: SLOT_LEGS, name: 'Legs' },
      { slotKey: SLOT_PUSH, name: 'Push' },
      { slotKey: SLOT_PULL, name: 'Pull' },
    ]

    // Act
    const carried = matchDaySlots(storedSlots, incoming)

    // Assert — history follows the day it was trained from, not the slot that
    // slid into its old position
    expect(carried).toEqual([SLOT_LEGS, SLOT_PUSH, SLOT_PULL])
  })

  it('gives a genuinely new day no slot, and leaves the others intact', () => {
    // Arrange — a fourth day added at the end
    const incoming = [
      { slotKey: SLOT_PUSH, name: 'Push' },
      { slotKey: SLOT_PULL, name: 'Pull' },
      { slotKey: SLOT_LEGS, name: 'Legs' },
      { name: 'Arms' },
    ]

    // Act / Assert
    expect(matchDaySlots(storedSlots, incoming)).toEqual([
      SLOT_PUSH,
      SLOT_PULL,
      SLOT_LEGS,
      undefined,
    ])
  })

  it('ignores a key the program does not hold', () => {
    // Arrange — a stale key, or one copied from another program
    const foreign = '99999999-9999-4999-8999-999999999999'

    // Act / Assert — it matches nothing; it can never adopt someone else's slot
    expect(matchDaySlots(storedSlots, [{ slotKey: foreign, name: 'Push' }])).toEqual([undefined])
  })

  it('hands one slot to at most one day, so a duplicated key cannot fan out', () => {
    // Arrange — two days claiming the same slot (a client bug, or a day
    // duplicated in the editor)
    const incoming = [
      { slotKey: SLOT_PUSH, name: 'Push' },
      { slotKey: SLOT_PUSH, name: 'Push (copy)' },
    ]

    // Act / Assert — the first claims it; the copy is a new day
    expect(matchDaySlots(storedSlots, incoming)).toEqual([SLOT_PUSH, undefined])
  })

  it('falls back to position ONLY when no key is offered and the shape is untouched', () => {
    // Arrange — an adapter that cannot round-trip the key (MCP upsert_program)
    // re-sending the same three days
    const incoming = [{ name: 'Push' }, { name: 'Pull' }, { name: 'Legs' }]

    // Act
    const carried = matchDaySlots(storedSlots, incoming)

    // Assert — same count, same names, same order: the mapping is the
    // identity, so nothing is being re-assigned
    expect(carried).toEqual([SLOT_PUSH, SLOT_PULL, SLOT_LEGS])
  })

  it('refuses the fallback when an unkeyed plan reorders days', () => {
    // Arrange — the names no longer line up with the stored positions
    const incoming = [{ name: 'Legs' }, { name: 'Push' }, { name: 'Pull' }]

    // Act / Assert — every day reads as new. Losing the links is the correct
    // outcome: attaching Push's history to Legs would read as recorded fact.
    expect(matchDaySlots(storedSlots, incoming)).toEqual([undefined, undefined, undefined])
  })

  it('refuses the fallback when an unkeyed plan renames a day', () => {
    // Arrange
    const incoming = [{ name: 'Push (heavy)' }, { name: 'Pull' }, { name: 'Legs' }]

    // Act / Assert — a rename could equally be a replacement; without a key
    // there is no evidence, so nothing is preserved
    expect(matchDaySlots(storedSlots, incoming)).toEqual([undefined, undefined, undefined])
  })

  it('refuses the fallback when an unkeyed plan adds or removes a day', () => {
    // Arrange / Act / Assert — a count change slides every later day
    expect(matchDaySlots(storedSlots, [{ name: 'Push' }, { name: 'Legs' }])).toEqual([
      undefined,
      undefined,
    ])
  })

  it('refuses the fallback when two stored days share a name, even in order', () => {
    // Arrange — `program_days` only enforces unique(programId, position), so one
    // program can legally hold two days called Legs. The unkeyed plan re-sends
    // them unchanged.
    const duplicated = [
      { slotKey: SLOT_LEGS, position: 0, name: 'Legs' },
      { slotKey: SLOT_PUSH, position: 1, name: 'Legs' },
    ]
    const incoming = [{ name: 'Legs' }, { name: 'Legs' }]

    // Act / Assert — the names match at every position, but names cannot tell
    // these two days apart, so "unchanged" is unprovable and nothing is carried
    expect(matchDaySlots(duplicated, incoming)).toEqual([undefined, undefined])
  })

  it('refuses the fallback when two stored days share a name and are swapped', () => {
    // Arrange — THE failure this clause exists for: the squat Legs day and the
    // deadlift Legs day trade places in an unkeyed save
    const duplicated = [
      { slotKey: SLOT_LEGS, position: 0, name: 'Legs' }, // squat day
      { slotKey: SLOT_PUSH, position: 1, name: 'Legs' }, // deadlift day
    ]
    const incoming = [{ name: 'Legs' }, { name: 'Legs' }]

    // Act / Assert — a positional carry would re-point every squat session at
    // the deadlift day and present it as recorded fact. Losing the link is
    // recoverable; that is not.
    expect(matchDaySlots(duplicated, incoming)).toEqual([undefined, undefined])
  })

  it('refuses the fallback when a plan with duplicate names renames one of them', () => {
    // Arrange — one of the two Legs days is renamed; which one is unknowable
    const duplicated = [
      { slotKey: SLOT_LEGS, position: 0, name: 'Legs' },
      { slotKey: SLOT_PUSH, position: 1, name: 'Legs' },
    ]
    const incoming = [{ name: 'Legs' }, { name: 'Legs (deadlift)' }]

    // Act / Assert
    expect(matchDaySlots(duplicated, incoming)).toEqual([undefined, undefined])
  })

  it('still carries KEYS across days that share a name', () => {
    // Arrange — duplicate names only defeat the nameless fallback; a
    // round-tripped key is direct evidence of identity
    const duplicated = [
      { slotKey: SLOT_LEGS, position: 0, name: 'Legs' },
      { slotKey: SLOT_PUSH, position: 1, name: 'Legs' },
    ]
    const incoming = [
      { slotKey: SLOT_PUSH, name: 'Legs' },
      { slotKey: SLOT_LEGS, name: 'Legs' },
    ]

    // Act / Assert — the swap follows the keys, not the positions
    expect(matchDaySlots(duplicated, incoming)).toEqual([SLOT_PUSH, SLOT_LEGS])
  })

  it('does not fall back for the unkeyed days of a PARTIALLY keyed plan', () => {
    // Arrange — one day carries its key, one does not
    const incoming = [{ slotKey: SLOT_PUSH, name: 'Push' }, { name: 'Pull' }, { name: 'Legs' }]

    // Act / Assert — a client that can round-trip keys and omitted one is
    // saying "this is a new day", not "guess"
    expect(matchDaySlots(storedSlots, incoming)).toEqual([SLOT_PUSH, undefined, undefined])
  })
})

describe('updateProgram (full replace) — provenance preserved', () => {
  it('still deletes every program_days row before re-inserting the plan', async () => {
    // Arrange
    const input = threeDayPlan()

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — the write shape is unchanged; identity is what now survives it
    expect(deletes).toEqual(['program_days'])
    const wipeAt = opLog.indexOf('delete:program_days')
    expect(wipeAt).toBeGreaterThanOrEqual(0)
    expect(opLog.indexOf('insert:program_days')).toBeGreaterThan(wipeAt)
  })

  it('re-inserts each preserved day UNDER ITS ORIGINAL SLOT KEY', async () => {
    // Arrange — only day 1's name differs; the editor round-trips every key
    const input = threeDayPlan({ pushName: 'Push (heavy)' })

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — the inverse of the old "no id column, every id freshly minted"
    expect(insertedSlotKeys()).toEqual([SLOT_PUSH, SLOT_PULL, SLOT_LEGS])
    const dayNames = inserts
      .filter((r) => r.table === 'program_days')
      .map((r) => (r.values as { name: string }).name)
    expect(dayNames).toEqual(['Push (heavy)', 'Pull', 'Legs'])
  })

  it('re-points the workouts of every preserved slot at the recreated day', async () => {
    // Arrange
    const input = threeDayPlan()

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — one re-attach per surviving slot, each carrying the NEW row id
    // the day was just re-inserted with. This is what heals the SET NULL.
    expect(workoutRepoints).toEqual(['day-new-1', 'day-new-2', 'day-new-3'])
    const wipeAt = opLog.indexOf('delete:program_days')
    expect(opLog.indexOf('update:workouts')).toBeGreaterThan(wipeAt)
  })

  it('re-attaches AFTER the days exist, never before', async () => {
    // Arrange
    const input = threeDayPlan()

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — a re-point issued before the insert would write a dangling FK
    const lastInsert = opLog.lastIndexOf('insert:program_days')
    expect(opLog.indexOf('update:workouts')).toBeGreaterThan(lastInsert)
  })

  it('leaves a REMOVED day orphaned — a deleted day is a deletion, not a move', async () => {
    // Arrange — the editor dropped Pull; Push and Legs keep their keys
    const input = threeDayPlan({ days: ['Push', 'Legs'] })

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — Pull's slot is not carried anywhere, and no workout is
    // re-pointed onto Push or Legs to compensate
    expect(insertedSlotKeys()).toEqual([SLOT_PUSH, SLOT_LEGS])
    expect(workoutRepoints).toEqual(['day-new-1', 'day-new-2'])
  })

  it('preserves an unkeyed replace of an unchanged plan (the MCP path)', async () => {
    // Arrange — upsert_program re-sending the same three days without keys
    const input = threeDayPlan({ keyed: false })

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — the guarded position fallback keeps all three slots
    expect(insertedSlotKeys()).toEqual([SLOT_PUSH, SLOT_PULL, SLOT_LEGS])
    expect(workoutRepoints).toEqual(['day-new-1', 'day-new-2', 'day-new-3'])
  })

  it('mints fresh slots — and re-points nothing — for an unkeyed renamed plan', async () => {
    // Arrange — the degradation's honest failure mode
    const input = threeDayPlan({ keyed: false, pushName: 'Push (heavy)' })

    // Act
    await updateProgram(USER, PROGRAM, input, 'ui')

    // Assert — no slot carried, so the days are new and NOTHING is re-attached
    expect(insertedSlotKeys()).toEqual([undefined, undefined, undefined])
    expect(workoutRepoints).toEqual([])
  })

  it('treats a program with no stored slots as all-new (first save after adoption)', async () => {
    // Arrange
    existingSlots = []

    // Act
    await updateProgram(USER, PROGRAM, threeDayPlan(), 'ui')

    // Assert — nothing to preserve, nothing re-pointed
    expect(insertedSlotKeys()).toEqual([undefined, undefined, undefined])
    expect(workoutRepoints).toEqual([])
  })
})
