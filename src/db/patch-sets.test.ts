import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording mock for the set-level ops, extending the update-workout idiom.
 * `selectQueue` feeds the ownership lookup and the max(setNumber) read in call
 * order; the *Rows vars toggle the update/delete/returning outcomes so a test can
 * drive the owned vs not-owned and found vs missing gates without a database.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
let updatedSetRows: { id: string }[] = [{ id: 's9' }]
let deletedSetRows: { id: string }[] = [{ id: 's9' }]
let ownedWorkoutRows: { id: string }[] = [{ id: 'w1' }]

type Resolve = (value: unknown) => unknown

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    leftJoin: () => obj,
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

// Derive the real table name from the arg so a test asserts WHICH table an
// update targeted (e.g. the renumber must hit `sets`, not `workouts`).
function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    returning: () => ({
      then: (resolve: Resolve) =>
        Promise.resolve(name === 'workouts' ? ownedWorkoutRows : updatedSetRows).then(resolve),
    }),
    // The renumber path awaits .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain() {
  records.push({ op: 'delete' })
  const obj = {
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(deletedSetRows).then(resolve) }),
  }
  return obj
}

function insertChain() {
  return {
    values: (values: unknown) => {
      records.push({ op: 'insert', values })
      return Promise.resolve()
    },
  }
}

function makeTx() {
  return {
    select: () => selectChain(),
    update: (table: unknown) => updateChain(table),
    delete: () => deleteChain(),
    insert: () => insertChain(),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
    update: (table: unknown) => updateChain(table),
  },
}))

import { updateSet, addSet, removeSet, updateWorkoutMeta, updateExerciseMeta } from './workouts'
import { SetCompletionError } from './workout-errors'

const USER = 'user_123'
const WID = '11111111-1111-1111-1111-111111111111'

/** The row shape updateSet's completion read-gate selects, with overridable
 *  fields — defaults model an uncompleted reps_weight set on a weight_reps
 *  exercise. */
function rowRead(
  overrides: Partial<{
    completed: boolean
    reps: number | null
    weight: number | null
    rir: number | null
    rpe: number | null
    durationSec: number | null
    distanceM: number | null
    metricMode: string
    loggingType: string
  }> = {},
) {
  return {
    completed: false,
    reps: null,
    weight: null,
    rir: null,
    rpe: null,
    durationSec: null,
    distanceM: null,
    metricMode: 'reps_weight',
    loggingType: 'weight_reps',
    ...overrides,
  }
}

beforeEach(() => {
  records.length = 0
  selectQueue = []
  updatedSetRows = [{ id: 's9' }]
  deletedSetRows = [{ id: 's9' }]
  ownedWorkoutRows = [{ id: 'w1' }]
})

const CTX = { actor: 'mcp', kind: 'amendment' } as const

describe('updateSet (user-scoped)', () => {
  it('updates the addressed set, then stamps workout completion', async () => {
    // Arrange — ownership lookup, then the (now unconditional) before-image
    selectQueue = [[{ id: 'ex1' }], [rowRead()]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 }, CTX)

    // Assert — set write, completedAt stamp, then the changelog row
    expect(records.map((r) => r.op)).toEqual(['update:sets', 'update:workouts', 'insert'])
    expect(records[0].values).toEqual({ reps: 5, weight: 100 })
    // completedAt and NOTHING ELSE: a set-level touch must never move
    // `originalRecordedAt`, or an agent patching one set of a live session
    // would make the lifter's own first persist look like a correction.
    expect(Object.keys(records[1].values as object)).toEqual(['completedAt'])
    expect(result).toEqual({ id: 's9' })
  })

  it('completes a set after the pre-write read proves its metric is present', async () => {
    // Arrange — ownership lookup, then the completion read-gate's row
    selectQueue = [[{ id: 'ex1' }], [rowRead({ weight: 100 })]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { completed: true }, CTX)

    // Assert — only the flag written, and it still counts as a non-empty patch
    expect(records[0].values).toEqual({ completed: true })
    expect(result).toEqual({ id: 's9' })
  })

  it('refuses completing a weight-less weight_reps set (SetCompletionError, no write)', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [rowRead({ weight: null })]]

    // Act + Assert — #206 at the db boundary
    await expect(updateSet(USER, WID, 0, 3, { completed: true }, CTX)).rejects.toBeInstanceOf(
      SetCompletionError,
    )
    expect(records).toEqual([])
  })

  it('refuses nulling the weight of a completed weight_reps set; bodyweight is exempt', async () => {
    // Arrange — the row is already completed; the patch would blank its metric
    selectQueue = [[{ id: 'ex1' }], [rowRead({ completed: true, weight: 80 })]]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { weight: null }, CTX)).rejects.toBeInstanceOf(
      SetCompletionError,
    )
    expect(records).toEqual([])

    // Arrange — same patch on a bodyweight exercise reads fine
    selectQueue = [
      [{ id: 'ex1' }],
      [rowRead({ completed: true, weight: null, loggingType: 'bodyweight_reps' })],
    ]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { weight: null }, CTX)

    // Assert
    expect(result).toEqual({ id: 's9' })
  })

  it('refuses nulling the duration of a completed cardio set, and a mode flip that strands one', async () => {
    // Arrange — completed duration set; the patch blanks its metric
    selectQueue = [
      [{ id: 'ex1' }],
      [rowRead({ completed: true, durationSec: 1800, metricMode: 'duration' })],
    ]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { durationSec: null }, CTX)).rejects.toBeInstanceOf(
      SetCompletionError,
    )

    // Arrange — flipping a completed reps_weight set to duration with no duration
    selectQueue = [[{ id: 'ex1' }], [rowRead({ completed: true, weight: 100 })]]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { metricMode: 'duration' }, CTX)).rejects.toBeInstanceOf(
      SetCompletionError,
    )
  })

  it('reads the before-image even when the patch cannot break completion', async () => {
    // The old fast path skipped this read. The change log killed it: an
    // amendment without a before-image is not a record of anything, and
    // RETURNING only ever sees the after state. An unqueued read would shift
    // an empty result and null the call, so success proves the read happened.
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [rowRead()]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 }, CTX)

    // Assert
    expect(result).toEqual({ id: 's9' })
    expect(records.map((r) => r.op)).toEqual(['update:sets', 'update:workouts', 'insert'])
  })

  it('returns null (not-found) when the completion read finds no such set', async () => {
    // Arrange — owned, but the read-gate finds no row
    selectQueue = [[{ id: 'ex1' }], []]

    // Act
    const result = await updateSet(USER, WID, 0, 9, { completed: true }, CTX)

    // Assert — no write, no completion stamp
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('does not stamp completion when no such set exists', async () => {
    // Arrange — owned, the row exists, but the update matches no row
    selectQueue = [[{ id: 'ex1' }], [rowRead()]]
    updatedSetRows = []

    // Act
    const result = await updateSet(USER, WID, 0, 9, { reps: 5 }, CTX)

    // Assert — the failed set write must not mark the workout completed
    expect(result).toBeNull()
    expect(records.map((r) => r.op)).toEqual(['update:sets'])
  })

  it('returns null and writes nothing when the workout is not owned', async () => {
    // Arrange — ownership lookup finds nothing
    selectQueue = [[]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5 }, CTX)

    // Assert — security-critical: no update issued
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null for an empty patch without querying', async () => {
    // Act
    const result = await updateSet(USER, WID, 0, 3, {}, CTX)

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('addSet (user-scoped)', () => {
  it('numbers the new set one past the current max and stamps completion', async () => {
    // Arrange — owned, current max setNumber is 3
    selectQueue = [[{ id: 'ex1' }], [{ value: 3 }]]

    // Act
    const result = await addSet(USER, WID, 0, { reps: 8, weight: 60 }, CTX)

    // Assert — the row, the completion stamp, then the changelog row
    expect(records.map((r) => r.op)).toEqual(['insert', 'update:workouts', 'insert'])
    expect(records[0].values).toEqual({
      workoutExerciseId: 'ex1',
      setNumber: 4,
      reps: 8,
      weight: 60,
      completed: false,
    })
    expect(result).toEqual({ setNumber: 4 })
  })

  it('inserts a checked-off set when the patch says completed', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [{ value: 0 }]]

    // Act
    await addSet(USER, WID, 0, { reps: 8, weight: 60, completed: true }, CTX)

    // Assert
    expect(records[0].values).toMatchObject({ setNumber: 1, completed: true })
  })

  it('numbers the first set 1 when the exercise has none', async () => {
    // Arrange — owned, no existing sets (max is null)
    selectQueue = [[{ id: 'ex1' }], [{ value: null }]]

    // Act
    const result = await addSet(USER, WID, 0, { reps: null, weight: null }, CTX)

    // Assert
    expect(result).toEqual({ setNumber: 1 })
    expect(records[0]).toMatchObject({ op: 'insert', values: { setNumber: 1 } })
  })

  it('preserves an existing completedAt via coalesce (stamp is not a plain overwrite)', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [{ value: 1 }]]

    // Act
    await addSet(USER, WID, 0, { reps: 5, weight: 100 }, CTX)

    // Assert — the stamp must be a SQL coalesce expression, not a raw Date
    const stamp = (records[1].values as { completedAt: unknown }).completedAt
    expect(stamp).not.toBeInstanceOf(Date)
    expect(stamp).toBeTruthy()
  })

  it('returns null and inserts nothing when not owned', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    const result = await addSet(USER, WID, 9, { reps: 5, weight: null }, CTX)

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('removeSet (user-scoped)', () => {
  /** The doomed-set facts read (notes fallback + not-found gate). */
  const targetSetRow = { id: 's7', weight: 100, reps: 5, durationSec: null, exerciseName: 'Squat' }

  it('re-anchors the set notes to the workout BEFORE deleting, then renumbers and stamps', async () => {
    // Arrange — owned, the target set exists
    selectQueue = [[{ id: 'ex1' }], [targetSetRow]]

    // Act
    const result = await removeSet(USER, WID, 0, 2, CTX)

    // Assert — the notes fallback update runs FIRST (the cascade would eat
    // set notes otherwise), then delete, renumber, completion stamp.
    expect(records.map((r) => r.op)).toEqual([
      'update:notes',
      'delete',
      'update:sets',
      'update:workouts',
      'insert',
    ])
    const fallback = records[0].values as Record<string, unknown>
    expect(fallback).toMatchObject({ workoutId: WID, setId: null })
    // The snapshot is written at fallback time when absent (coalesce keeps an
    // existing one) — a SQL expression, never a plain overwrite.
    expect(fallback.anchorSnapshot).toBeTruthy()
    expect(result).toEqual({ removed: true })
  })

  it('returns null and mutates nothing when no such set exists', async () => {
    // Arrange — owned, but the target read finds nothing
    selectQueue = [[{ id: 'ex1' }], []]
    deletedSetRows = []

    // Act
    const result = await removeSet(USER, WID, 0, 9, CTX)

    // Assert — the not-found gate fires before any write
    expect(records).toEqual([])
    expect(result).toBeNull()
  })

  it('returns null and deletes nothing when not owned', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    const result = await removeSet(USER, WID, 0, 1, CTX)

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('updateWorkoutMeta (user-scoped)', () => {
  it('updates name and startedAt when owned', async () => {
    // Arrange
    ownedWorkoutRows = [{ id: WID }]
    const when = new Date('2026-01-02T00:00:00.000Z')

    // Act
    const result = await updateWorkoutMeta(USER, WID, { name: 'Leg Day', startedAt: when })

    // Assert
    expect(records).toEqual([{ op: 'update:workouts', values: { name: 'Leg Day', startedAt: when } }])
    expect(result).toEqual({ id: WID })
  })

  it('returns null when the patch is empty, without querying', async () => {
    // Act
    const result = await updateWorkoutMeta(USER, WID, {})

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null when the user does not own the workout', async () => {
    // Arrange
    ownedWorkoutRows = []

    // Act
    const result = await updateWorkoutMeta(USER, WID, { name: 'X' })

    // Assert
    expect(result).toBeNull()
  })

  it('sets the session note as a notes-table row (legacy column dead)', async () => {
    // Arrange — a notes-only patch: ownership select, then an empty
    // canonical-note lookup (no existing session note).
    selectQueue = [[{ id: WID }], []]

    // Act
    const result = await updateWorkoutMeta(USER, WID, { notes: 'felt strong' })

    // Assert — no workouts-column write; one notes insert instead.
    expect(records).toEqual([
      {
        op: 'insert',
        values: { userId: USER, author: 'user', body: 'felt strong', workoutId: WID },
      },
    ])
    expect(result).toEqual({ id: WID })
  })

  it('clears the session note by deleting the canonical notes row', async () => {
    // Arrange — ownership select, then the canonical row to clear.
    selectQueue = [[{ id: WID }], [{ id: 'n1', body: 'felt strong' }]]

    // Act
    await updateWorkoutMeta(USER, WID, { notes: null })

    // Assert — a delete, never a column write.
    expect(records).toEqual([{ op: 'delete' }])
  })
})

describe('updateExerciseMeta (user-scoped)', () => {
  it('updates notes and skipped on the owned exercise, with no completion stamp', async () => {
    // Arrange — ownership lookup, then an empty canonical-note lookup; the
    // skipped update returns the row with its name (the snapshot source).
    selectQueue = [[{ id: 'ex1' }], []]
    updatedSetRows = [{ id: 'ex1', name: 'Squat' } as unknown as { id: string }]

    // Act
    const result = await updateExerciseMeta(USER, WID, 0, { notes: 'knee pain', skipped: true })

    // Assert — the skipped flag writes the column; the note lands in the
    // notes table with the standard exercise snapshot. Workouts untouched.
    expect(records).toEqual([
      { op: 'update:workout_exercises', values: { skipped: true } },
      {
        op: 'insert',
        values: {
          userId: USER,
          author: 'user',
          body: 'knee pain',
          workoutExerciseId: 'ex1',
          anchorSnapshot: { exerciseName: 'Squat' },
        },
      },
    ])
    expect(result).toEqual({ id: 'ex1' })
  })

  it('clears notes by deleting the canonical notes row', async () => {
    // Arrange — ownership lookup, the id+name read (notes-only patch), then
    // the canonical row to clear.
    selectQueue = [[{ id: 'ex1' }], [{ id: 'ex1', name: 'Squat' }], [{ id: 'n1', body: 'knee pain' }]]

    // Act
    await updateExerciseMeta(USER, WID, 0, { notes: null })

    // Assert
    expect(records).toEqual([{ op: 'delete' }])
  })

  it('returns null for an empty patch without querying', async () => {
    // Act
    const result = await updateExerciseMeta(USER, WID, 0, {})

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null and writes nothing when the workout is not owned', async () => {
    // Arrange — ownership lookup finds nothing
    selectQueue = [[]]

    // Act
    const result = await updateExerciseMeta(USER, WID, 0, { skipped: true })

    // Assert — security-critical: no update issued
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('patchCanBreakCompletion zero-duration guard (review follow-up)', () => {
  it('a bare durationSec: 0 patch on a completed cardio set is refused, not fast-pathed', async () => {
    // Arrange — stored: completed duration set; patch blanks via zero with no
    // completed/metricMode field, which previously skipped the pre-write read.
    selectQueue = [
      [{ id: 'we1' }],
      [{ completed: true, metricMode: 'duration', weight: null, durationSec: 600 }],
    ]

    // Act + Assert
    await expect(
      updateSet(USER, WID, 0, 1, { durationSec: 0 }, CTX),
    ).rejects.toThrow(/duration/)
  })
})

/**
 * The set-level paths' changelog rows. The kind is the CALLER's declaration —
 * these tests pin that the db layer records it verbatim and never re-derives
 * it, and that a patch which changes nothing writes no history.
 */
describe('set-level change log', () => {
  /** The changelog insert — identified by shape, since the mock's insert
   *  recorder is table-blind and addSet also inserts a `sets` row. */
  function event(): Record<string, unknown> | undefined {
    return records.find((r) => r.op === 'insert' && (r.values as { kind?: string })?.kind)
      ?.values as Record<string, unknown> | undefined
  }

  it('records an updateSet correction with its before/after and changed fields', async () => {
    // Arrange — the stored set is 5 reps at 100 kg on a Squat
    selectQueue = [
      [{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }],
      [rowRead({ weight: 100 })],
    ]

    // Act
    await updateSet(USER, WID, 0, 3, { weight: 102.5 }, CTX)

    // Assert
    expect(event()).toMatchObject({
      workoutId: WID,
      userId: USER,
      kind: 'amendment',
      actor: 'mcp',
      action: 'update_set',
      changed: ['weight'],
      summary: 'Set 3 of Squat — weight 100 → 102.5',
    })
    expect((event()!.before as Record<string, unknown>).weight).toBe(100)
    expect((event()!.after as Record<string, unknown>).weight).toBe(102.5)
  })

  // A caller that cannot see the before-image declares BOTH words; the write
  // path picks between them from the row it already read. This is what makes a
  // program day logged entirely through MCP produce originals instead of a log
  // of pure corrections.
  const FILL_CTX = { actor: 'mcp', kind: 'amendment', blankSubjectKind: 'original' } as const

  it("records the first fill of a blank prescribed set as that set's original", async () => {
    // Arrange — the shape instantiate_program_day writes: nothing performed
    selectQueue = [[{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }], [rowRead()]]

    // Act
    await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 }, FILL_CTX)

    // Assert
    expect(event()).toMatchObject({ kind: 'original', action: 'update_set' })
  })

  it('still calls a write over a logged value an amendment', async () => {
    // Arrange — same caller, same two declared words; this set holds a value
    selectQueue = [
      [{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }],
      [rowRead({ reps: 5, weight: 100 })],
    ]

    // Act
    await updateSet(USER, WID, 0, 3, { weight: 102.5 }, FILL_CTX)

    // Assert
    expect(event()).toMatchObject({ kind: 'amendment' })
  })

  it('leaves a single-word caller alone: no blankSubjectKind, no substitution', async () => {
    // Arrange — blank row, but the caller declared one intent only
    selectQueue = [[{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }], [rowRead()]]

    // Act
    await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 }, CTX)

    // Assert
    expect(event()).toMatchObject({ kind: 'amendment' })
  })

  it('writes NO event when the patch re-asserts the stored values', async () => {
    // A no-op write is not a correction; manufacturing a row would put an
    // amendment in the record that never contradicted anything.
    // Arrange
    selectQueue = [[{ id: 'ex1', name: 'Squat' }], [rowRead({ weight: 100 })]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { weight: 100 }, CTX)

    // Assert — the row was still written (idempotent), the log was not
    expect(result).toEqual({ id: 's9' })
    expect(event()).toBeUndefined()
  })

  it('records addSet as the caller-declared late entry, with no before-image', async () => {
    // Arrange
    selectQueue = [
      [{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }],
      [{ value: 3 }],
    ]

    // Act
    await addSet(USER, WID, 0, { reps: 8, weight: 60 }, { actor: 'mcp', kind: 'late_entry' })

    // Assert
    expect(event()).toMatchObject({
      kind: 'late_entry',
      action: 'add_set',
      changed: [],
      before: null,
      summary: 'Set 4 of Squat added',
    })
  })

  it('records removeSet with a before-image only — the sole record it existed', async () => {
    // Arrange
    selectQueue = [
      [{ id: 'ex1', name: 'Squat', source: 'wger', wgerExerciseId: 73 }],
      [{ id: 's7', weight: 100, reps: 5, completed: true, durationSec: null, exerciseName: 'Squat' }],
    ]

    // Act
    await removeSet(USER, WID, 0, 2, CTX)

    // Assert
    expect(event()).toMatchObject({ action: 'remove_set', changed: [], after: null })
    expect((event()!.before as Record<string, unknown>).weight).toBe(100)
  })
})
