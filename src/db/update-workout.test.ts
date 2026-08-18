import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for updateWorkout's transaction. Extends the save-workout
 * idiom with `update` and `delete` recorders so the test can assert the control
 * flow (ownership gate → clear children → re-insert) and the written values
 * without a real database. `ownedRow` toggles the "owned" vs "not owned" gate.
 */
const records: { op: string; values?: unknown }[] = []
let ownedRow: { id: string }[] = [{ id: 'w1' }] // toggle to [] for not-owned
let idCounter = 0
const ID_SEQUENCE = ['e1', 's1', 'e2'] // exercise/set ids handed back on re-insert
// Prior set rows the pre-delete facts read returns (snapshot preservation).
// A read, so it is NOT pushed onto `records` — that stays the mutation log.
let priorFactRows: unknown[] = []
// Child-anchored note rows the notes-capture read returns (note re-anchoring).
let capturedNoteRows: unknown[] = []

function makeTx() {
  // Reads run in a fixed order inside the tx: (1) prior set facts,
  // (2) note-anchor capture, then the canonical-note reconcile lookups
  // (empty unless a test seeds them). Each tx.select() consumes the next.
  const selectQueue: unknown[][] = [priorFactRows as unknown[], capturedNoteRows as unknown[]]
  return {
    select: () => {
      const rows = selectQueue.shift() ?? []
      const chain: Record<string, unknown> = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      }
      return chain
    },
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          let recorded = false
          const record = () => {
            if (!recorded) records.push({ op: 'update', values })
            recorded = true
          }
          return {
            returning: () => {
              record()
              return Promise.resolve(ownedRow)
            },
            // Park/re-attach updates are awaited without .returning().
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
              record()
              return Promise.resolve(undefined).then(resolve, reject)
            },
          }
        },
      }),
    }),
    delete: () => ({
      where: () => {
        records.push({ op: 'delete' })
        return Promise.resolve()
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        records.push({ op: 'insert', values })
        return {
          returning: () =>
            Promise.resolve(
              Array.isArray(values)
                ? (values as Record<string, unknown>[]).map((v) => ({
                    id: ID_SEQUENCE[idCounter++] ?? `x${idCounter}`,
                    setNumber: v.setNumber,
                    weight: v.weight ?? null,
                    reps: v.reps ?? null,
                    durationSec: v.durationSec ?? null,
                  }))
                : [{ id: ID_SEQUENCE[idCounter++] ?? `x${idCounter}` }],
            ),
        }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: { transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()) },
}))

import { updateWorkout } from './workouts'

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  records.length = 0
  idCounter = 0
  ownedRow = [{ id: 'w1' }]
  priorFactRows = []
  capturedNoteRows = []
})

describe('updateWorkout (transactional, user-scoped)', () => {
  it('updates the name, clears children, then re-inserts in order', async () => {
    // Act
    const result = await updateWorkout(USER, ID, {
      name: 'New name',
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }] }],
    })

    // Assert — ownership gate runs first, then delete, then ordered re-insert.
    // completedAt is a coalesce-to-now() SQL expression (first edit completes
    // an instantiated workout); assert presence, not its opaque shape.
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: 'New name' })
    expect((records[0].values as Record<string, unknown>).completedAt).toBeDefined()
    expect(records[1].op).toBe('delete')
    expect(records[2]).toMatchObject({
      op: 'insert',
      values: { workoutId: ID, wgerExerciseId: 73, name: 'Squat', position: 0 },
    })
    expect(records[3]).toEqual({
      op: 'insert',
      values: [{ workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: false }],
    })
    expect(result).toEqual({ id: ID })
  })

  it('round-trips a checked-off set through the re-insert path', async () => {
    // Act — edit mode replaces children; the check-off must survive
    await updateWorkout(USER, ID, {
      exercises: [
        { wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100, completed: true }] },
      ],
    })

    // Assert — the re-inserted set keeps completed: true
    expect(records[3]).toEqual({
      op: 'insert',
      values: [{ workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: true }],
    })
  })

  it('never embeds a raw Date in the completedAt SQL fragment (driver rejects it)', async () => {
    // Regression: params inside a raw sql`` fragment bypass the column's
    // Date→string mapping, and postgres.js throws ERR_INVALID_ARG_TYPE on a
    // Date instance — every backdated edit failed in prod. The explicit
    // date must be serialized before interpolation.
    const containsDate = (value: unknown, seen = new Set<object>()): boolean => {
      if (value instanceof Date) return true
      if (!value || typeof value !== 'object') return false
      if (seen.has(value)) return false
      seen.add(value)
      return Object.values(value).some((v) => containsDate(v, seen))
    }

    // Act — explicit startedAt takes the backdated-completion branch
    await updateWorkout(USER, ID, {
      startedAt: new Date('2026-07-04T20:43:20.856Z'),
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    })

    // Assert
    const completedAt = (records[0].values as Record<string, unknown>).completedAt
    expect(completedAt).toBeDefined()
    expect(containsDate(completedAt)).toBe(false)
  })

  it('clears the name to null when input has none', async () => {
    // Act
    await updateWorkout(USER, ID, { exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }] })

    // Assert
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: null })
  })

  it('re-stamps the prescribed_* snapshot onto re-inserted sets (immutable facts survive the replace)', async () => {
    // Arrange — the instantiated set carried a snapshot; the wire input
    // never does.
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act
    await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 102.5 }] }],
    })

    // Assert — the replaced row still carries the facts
    expect(records[3].values).toEqual([
      expect.objectContaining({
        setNumber: 1,
        weight: 102.5,
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      }),
    ])
  })

  it('preserves backoff/amrap typing the draft UI cannot express, but lets a warmup retag win', async () => {
    // Arrange — set 1 was a backoff (no wire representation), set 2 working.
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'backoff',
        prescribedLoadKg: 80,
        prescribedRepMin: null,
      },
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 2,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act — the input retags set 2 as warmup and says nothing about set 1
    await updateWorkout(USER, ID, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [{ reps: 8, weight: 80 }, { reps: 5, weight: 60, setType: 'warmup' }],
        },
      ],
    })

    // Assert — backoff survives; the explicit warmup wins over the prior type
    const values = records[3].values as Record<string, unknown>[]
    expect(values[0]).toMatchObject({ setType: 'backoff', prescribedLoadKg: 80 })
    expect(values[1]).toMatchObject({ setType: 'warmup', prescribedLoadKg: 100 })
  })

  it('drops ALL facts for an exercise whose set structure changed (silence over corruption)', async () => {
    // Arrange — three prior sets with snapshots; the save arrives with TWO
    // (a mid-session set delete). Positional matching would hand set 2's
    // facts to what used to be set 3 — so the gate must drop them all.
    priorFactRows = [
      { wgerExerciseId: 73, source: 'wger', setNumber: 1, setType: 'working', prescribedLoadKg: 100, prescribedRepMin: 5 },
      { wgerExerciseId: 73, source: 'wger', setNumber: 2, setType: 'backoff', prescribedLoadKg: 80, prescribedRepMin: 8 },
      { wgerExerciseId: 73, source: 'wger', setNumber: 3, setType: 'backoff', prescribedLoadKg: 80, prescribedRepMin: 8 },
    ]

    // Act — set 1 was deleted; former sets 2/3 shift up
    await updateWorkout(USER, ID, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
      ],
    })

    // Assert — no snapshot, no inherited backoff typing on either row
    const inserted = records[3].values as Record<string, unknown>[]
    expect(inserted).toHaveLength(2)
    for (const row of inserted) {
      expect(row).not.toHaveProperty('prescribedLoadKg')
      expect(row).not.toHaveProperty('setType')
    }
  })

  it('leaves brand-new sets fact-less (no snapshot invented for ad-hoc rows)', async () => {
    // Arrange — only set 1 existed before the replace
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act — the edit appends a second set
    await updateWorkout(USER, ID, {
      exercises: [
        { wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
      ],
    })

    // Assert — set 2 carries no snapshot keys at all
    const values = records[3].values as Record<string, unknown>[]
    expect(values[0]).toMatchObject({ prescribedLoadKg: 100 })
    expect('prescribedLoadKg' in values[1]).toBe(false)
    expect('prescribedRepMin' in values[1]).toBe(false)
  })

  it('never writes the legacy notes columns (notes v2 owns the words)', async () => {
    // Act — a wire input WITH notes at both tiers
    await updateWorkout(USER, ID, {
      notes: 'good session',
      exercises: [
        { wgerExerciseId: 73, name: 'Squat', notes: 'felt heavy', sets: [{ reps: 5, weight: 100 }] },
      ],
    })

    // Assert — neither the workouts update nor the exercise insert carries a
    // notes column; the words arrive as notes-table inserts instead.
    expect(records[0].op).toBe('update')
    expect(records[0].values).not.toHaveProperty('notes')
    const weInsert = records.find(
      (r) => r.op === 'insert' && !Array.isArray(r.values) && (r.values as Record<string, unknown>).wgerExerciseId === 73,
    )
    expect(weInsert?.values).not.toHaveProperty('notes')
    const noteInserts = records.filter(
      (r) => r.op === 'insert' && !Array.isArray(r.values) && (r.values as Record<string, unknown>).author === 'user',
    )
    expect(noteInserts.map((r) => r.values)).toEqual([
      expect.objectContaining({ body: 'good session', workoutId: ID }),
      expect.objectContaining({
        body: 'felt heavy',
        workoutExerciseId: 'e1',
        anchorSnapshot: { exerciseName: 'Squat' },
      }),
    ])
  })

  it('re-anchors set and exercise notes across the replace (edit preserves notes)', async () => {
    // Arrange — one prior set (aligned: incoming count >= 1), an exercise
    // note and a set note hanging on it.
    priorFactRows = [
      { wgerExerciseId: 73, source: 'wger', setNumber: 1, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
    ]
    capturedNoteRows = [
      { noteId: 'n-ex', source: 'wger', wgerExerciseId: 73, setNumber: null, anchorSnapshot: null },
      {
        noteId: 'n-set',
        source: 'wger',
        wgerExerciseId: 73,
        setNumber: 1,
        // Recorded facts agree with the re-inserted row — the affinity gate
        // must let the positional re-attach through.
        anchorSnapshot: { exerciseName: 'Squat', setNumber: 1, loadKg: 100, reps: 5 },
      },
    ]

    // Act
    await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }] }],
    })

    // Assert — park BEFORE the child delete (or the cascade eats the notes)…
    const parkIndex = records.findIndex(
      (r) =>
        r.op === 'update' &&
        (r.values as Record<string, unknown>).workoutId === ID &&
        (r.values as Record<string, unknown>).workoutExerciseId === null,
    )
    const deleteIndex = records.findIndex((r) => r.op === 'delete')
    expect(parkIndex).toBeGreaterThan(-1)
    expect(parkIndex).toBeLessThan(deleteIndex)
    // …then both notes re-attach to the NEW row ids.
    const updates = records.filter((r) => r.op === 'update').map((r) => r.values)
    expect(updates).toContainEqual({ workoutId: null, workoutExerciseId: 'e1' })
    expect(updates).toContainEqual({ workoutId: null, setId: 's1' })
  })

  it('leaves a set note on the workout anchor when its position vanished (fallback, snapshot untouched)', async () => {
    // Arrange — two prior sets; the edit removes one, so positions shifted
    // and the set note must NOT be positionally re-attached.
    priorFactRows = [
      { wgerExerciseId: 73, source: 'wger', setNumber: 1, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
      { wgerExerciseId: 73, source: 'wger', setNumber: 2, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
    ]
    capturedNoteRows = [
      { noteId: 'n-ex', source: 'wger', wgerExerciseId: 73, setNumber: null, anchorSnapshot: null },
      {
        noteId: 'n-set',
        source: 'wger',
        wgerExerciseId: 73,
        setNumber: 2,
        anchorSnapshot: { loadKg: 80, reps: 8 },
      },
    ]

    // Act — only one set comes back
    await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 8, weight: 80 }] }],
    })

    // Assert — the exercise note re-attaches; the set note stays parked on
    // the workout (no update carries a setId), and nothing ever touches
    // anchor_snapshot (the frozen context survives the fallback).
    const updates = records.filter((r) => r.op === 'update').map((r) => r.values as Record<string, unknown>)
    expect(updates).toContainEqual({ workoutId: null, workoutExerciseId: 'e1' })
    expect(updates.some((v) => typeof v.setId === 'string')).toBe(false)
    expect(updates.some((v) => 'anchorSnapshot' in v)).toBe(false)
  })

  it('keeps notes with their exercise identity when exercises are reordered', async () => {
    // Arrange — two exercises with one note each; the edit swaps their order.
    capturedNoteRows = [
      { noteId: 'n-squat', source: 'wger', wgerExerciseId: 73, setNumber: null, anchorSnapshot: null },
      { noteId: 'n-row', source: 'wger', wgerExerciseId: 99, setNumber: null, anchorSnapshot: null },
    ]

    // Act — 99 now comes first: new we ids are e1 (99) then s1 (73, next in
    // the id sequence).
    await updateWorkout(USER, ID, {
      exercises: [
        { wgerExerciseId: 99, name: 'Row', sets: [] },
        { wgerExerciseId: 73, name: 'Squat', sets: [] },
      ],
    })

    // Assert — each note followed its identity, not its old position.
    const updates = records.filter((r) => r.op === 'update').map((r) => r.values)
    expect(updates).toContainEqual({ workoutId: null, workoutExerciseId: 'e1' }) // 99's note
    expect(updates).toContainEqual({ workoutId: null, workoutExerciseId: 's1' }) // 73's note
  })

  it('parks a set note instead of misattributing it after a same-count set reorder', async () => {
    // Arrange — two prior sets; the note hangs on set 2 (100×5). The edit
    // swaps the two sets, so position 2 now holds 80×8: position alone would
    // hand the note to the wrong set — content affinity must refuse.
    priorFactRows = [
      { wgerExerciseId: 73, source: 'wger', setNumber: 1, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
      { wgerExerciseId: 73, source: 'wger', setNumber: 2, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
    ]
    capturedNoteRows = [
      {
        noteId: 'n-set',
        source: 'wger',
        wgerExerciseId: 73,
        setNumber: 2,
        anchorSnapshot: { loadKg: 100, reps: 5 },
      },
    ]

    // Act — same count, reordered content
    await updateWorkout(USER, ID, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 5, weight: 100 },
          ],
        },
      ],
    })

    // Wait — position 2 now holds 100×5 (the SAME content), so this attach
    // is correct; the misattribution case is the inverse: note on set 1.
    // Assert the gate on the real mismatch: re-run with the note on set 1.
    const updates = records.filter((r) => r.op === 'update').map((r) => r.values as Record<string, unknown>)
    expect(updates.filter((v) => typeof v.setId === 'string')).toHaveLength(1)

    // Re-arrange: note on set 1 (was 100×5), position 1 now holds 80×8.
    records.length = 0
    idCounter = 0
    priorFactRows = [
      { wgerExerciseId: 73, source: 'wger', setNumber: 1, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
      { wgerExerciseId: 73, source: 'wger', setNumber: 2, setType: 'working', prescribedLoadKg: null, prescribedRepMin: null },
    ]
    capturedNoteRows = [
      {
        noteId: 'n-set',
        source: 'wger',
        wgerExerciseId: 73,
        setNumber: 1,
        anchorSnapshot: { loadKg: 100, reps: 5 },
      },
    ]

    await updateWorkout(USER, ID, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 5, weight: 100 },
          ],
        },
      ],
    })

    // The note stays parked on the workout anchor — no setId update at all.
    const updates2 = records.filter((r) => r.op === 'update').map((r) => r.values as Record<string, unknown>)
    expect(updates2.some((v) => typeof v.setId === 'string')).toBe(false)
  })

  it('returns null and mutates nothing when the user does not own the workout', async () => {
    // Arrange
    ownedRow = []

    // Act
    const result = await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    })

    // Assert — early return before any delete/insert (security-critical)
    expect(result).toBeNull()
    expect(records).toHaveLength(1)
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: null })
  })
})
