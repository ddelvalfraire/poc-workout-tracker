import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording mock for the bulk program ops — the same harness shape as
 * `program-patches.test.ts` (its sibling module), extended with `orderBy` and a
 * per-call `returning` queue, because the copy paths zip inserted set ids back
 * against their source rows.
 *
 * `selectQueue` feeds each op's reads IN CALL ORDER (documented per test);
 * `records` captures every write as `insert:<table>` / `update:<table>` /
 * `delete:<table>` so a test can assert WHICH table a copy or renumber hit.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
let returningQueue: { id: string }[][] = []

type Resolve = (value: unknown) => unknown

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain(table: unknown) {
  const name = getTableName(table as Table)
  records.push({ op: `delete:${name}` })
  const obj = {
    where: () => obj,
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function insertChain(table: unknown) {
  const name = getTableName(table as Table)
  return {
    values: (values: unknown) => {
      records.push({ op: `insert:${name}`, values })
      return {
        returning: () => ({
          then: (resolve: Resolve) =>
            Promise.resolve(returningQueue.shift() ?? [{ id: 'new-row' }]).then(resolve),
        }),
        then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
      }
    },
  }
}

function makeTx() {
  return {
    select: () => selectChain(),
    update: (table: unknown) => updateChain(table),
    delete: (table: unknown) => deleteChain(table),
    insert: (table: unknown) => insertChain(table),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import { ProgramPatchError } from './program-patches'
import {
  duplicateProgramDay,
  duplicateProgramWeek,
  fillProgramSetsDown,
  fillProgramWeeksRight,
  applyProgramSetScheme,
  applyProgressionToScope,
} from './program-bulk'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'
const OWNED_PROGRAM = [{ id: PID }]
const OWNED_DAY = [{ id: 'pd1' }]
const OWNED_EXERCISE = [
  { exerciseId: 'pe1', dayId: 'pd1', wgerExerciseId: 73, source: 'wger', name: 'Bench' },
]
const NOT_OWNED: unknown[] = []

const writes = (op: string) => records.filter((r) => r.op === op)
const event = () =>
  records.find((r) => r.op === 'insert:program_events')?.values as
    | Record<string, unknown>
    | undefined

/** A stored set row as the fill/scheme reads return it. */
const storedSet = (setNumber: number, overrides: Record<string, unknown> = {}) => ({
  id: `ps${setNumber}`,
  programExerciseId: 'pe1',
  setNumber,
  setType: 'working',
  metricMode: 'reps_weight',
  repMin: 5,
  repMax: 5,
  rir: null,
  rpe: null,
  suggestedLoadKg: null,
  tempo: null,
  durationSec: null,
  distanceM: null,
  restSec: null,
  technique: null,
  ...overrides,
})

/** A stored per-week override row as `selectOverrides` returns it. */
const storedOverride = (id: string, programSetId: string, week: number, repMin = 3) => ({
  id,
  programSetId,
  week,
  repMin,
  repMax: repMin,
  rir: null,
  rpe: null,
  suggestedLoadKg: 100,
  tempo: null,
  durationSec: null,
  distanceM: null,
  restSec: null,
  technique: null,
})

beforeEach(() => {
  records.length = 0
  selectQueue = []
  returningQueue = []
})

describe('duplicateProgramDay', () => {
  /** Reads: owned-day → day row → exercises → sets → overrides → muscles. */
  function arrangeDay(options?: { overrides?: unknown[]; muscles?: unknown[] }) {
    selectQueue = [
      OWNED_DAY,
      [{ name: 'Push', notes: 'heavy', weekdays: [1, 4] }],
      [
        {
          id: 'pe1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Bench',
          position: 0,
          supersetGroup: 2,
          progression: { scheme: 'linear', incrementKg: 2.5 },
          overshootPolicy: 'strict',
        },
      ],
      [storedSet(1), storedSet(2)],
      options?.overrides ?? [],
      options?.muscles ?? [],
    ]
    returningQueue = [[{ id: 'pd-new' }], [{ id: 'pe-new' }], [{ id: 'ps-new1' }, { id: 'ps-new2' }]]
  }

  it('lands the copy immediately after the source and shifts the later days down', async () => {
    // Arrange
    arrangeDay()

    // Act
    const result = await duplicateProgramDay(USER, PID, 1, 'ui')

    // Assert — the copy takes position 2, and the shift ran on program_days
    expect(result).toEqual({ position: 2, overridesCopied: 0 })
    expect(writes('update:program_days')[0]).toBeDefined()
    const dayInsert = writes('insert:program_days')[0].values as Record<string, unknown>
    expect(dayInsert.position).toBe(2)
    expect(dayInsert.name).toBe('Push (copy)')
  })

  it('carries the day notes and weekday schedule onto the copy', async () => {
    arrangeDay()
    await duplicateProgramDay(USER, PID, 1, 'ui')
    const dayInsert = writes('insert:program_days')[0].values as Record<string, unknown>
    expect(dayInsert.notes).toBe('heavy')
    expect(dayInsert.weekdays).toEqual([1, 4])
  })

  it('copies the exercise verbatim, including superset group, progression and overshoot policy', async () => {
    arrangeDay()
    await duplicateProgramDay(USER, PID, 1, 'ui')
    const exercise = writes('insert:program_exercises')[0].values as Record<string, unknown>
    expect(exercise).toMatchObject({
      programDayId: 'pd-new',
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Bench',
      position: 0,
      supersetGroup: 2,
      progression: { scheme: 'linear', incrementKg: 2.5 },
      overshootPolicy: 'strict',
    })
  })

  it('copies every set onto the new exercise, keeping set numbers', async () => {
    arrangeDay()
    await duplicateProgramDay(USER, PID, 1, 'ui')
    const setRows = writes('insert:program_sets')[0].values as Record<string, unknown>[]
    expect(setRows).toHaveLength(2)
    expect(setRows.map((r) => r.setNumber)).toEqual([1, 2])
    expect(setRows.every((r) => r.programExerciseId === 'pe-new')).toBe(true)
  })

  it('COPIES per-week overrides onto the duplicated sets, re-keyed to the new set ids', async () => {
    // Arrange — set 1 carries a week-3 override, set 2 carries none.
    arrangeDay({ overrides: [storedOverride('o1', 'ps1', 3)] })

    // Act
    const result = await duplicateProgramDay(USER, PID, 1, 'ui')

    // Assert — the override follows set 1 to its NEW id, week unchanged.
    expect(result?.overridesCopied).toBe(1)
    const overrideRows = writes('insert:program_set_overrides')[0].values as Record<
      string,
      unknown
    >[]
    expect(overrideRows).toEqual([
      expect.objectContaining({ programSetId: 'ps-new1', week: 3, repMin: 3, suggestedLoadKg: 100 }),
    ])
  })

  it('copies muscle tags as stored, without a catalog fetch', async () => {
    arrangeDay({ muscles: [{ programExerciseId: 'pe1', muscle: 'Chest', role: 'primary' }] })
    await duplicateProgramDay(USER, PID, 1, 'ui')
    expect(writes('insert:program_exercise_muscles')[0].values).toEqual([
      { programExerciseId: 'pe-new', muscle: 'Chest', role: 'primary' },
    ])
  })

  it('bumps updatedAt and logs ONE actor-attributed event naming the copy', async () => {
    arrangeDay({ overrides: [storedOverride('o1', 'ps1', 3)] })
    await duplicateProgramDay(USER, PID, 1, 'coach')
    expect(writes('update:programs')).toHaveLength(1)
    expect(writes('insert:program_events')).toHaveLength(1)
    expect(event()).toMatchObject({
      userId: USER,
      actor: 'coach',
      action: 'duplicate_program_day',
      summary: 'Duplicate Day 2 ("Push") → Day 3',
      payload: { from: 1, to: 2, exercises: 1, sets: 2, overridesCopied: 1 },
    })
  })

  it('accepts an explicit name for the copy', async () => {
    arrangeDay()
    await duplicateProgramDay(USER, PID, 1, 'ui', { name: 'Push B' })
    expect((writes('insert:program_days')[0].values as Record<string, unknown>).name).toBe('Push B')
  })

  it('returns null and writes nothing when the day is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await duplicateProgramDay(USER, PID, 1, 'ui')).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('fillProgramSetsDown', () => {
  /** Reads: owned-exercise → the exercise's set rows. */
  const arrange = (rows: unknown[]) => {
    selectQueue = [OWNED_EXERCISE, rows]
  }

  it("copies the source set's targets onto the sets BELOW it by default", async () => {
    // Arrange — set 1 is the loaded top set; 2 and 3 are blank.
    arrange([
      storedSet(1, { repMin: 3, repMax: 5, rpe: 8, suggestedLoadKg: 100 }),
      storedSet(2, { repMin: null, repMax: null }),
      storedSet(3, { repMin: null, repMax: null }),
    ])

    // Act
    const result = await fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui')

    // Assert
    expect(result).toEqual({ updated: 2 })
    expect(writes('update:program_sets')[0].values).toMatchObject({
      repMin: 3,
      repMax: 5,
      rpe: 8,
      suggestedLoadKg: 100,
    })
  })

  it('never copies set SHAPE — setType and metricMode are untouched', async () => {
    arrange([storedSet(1, { setType: 'warmup' }), storedSet(2)])
    await fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui')
    const values = writes('update:program_sets')[0].values as Record<string, unknown>
    expect(values).not.toHaveProperty('setType')
    expect(values).not.toHaveProperty('metricMode')
  })

  it("scope 'all' reaches the sets above the source too, but never the source", async () => {
    arrange([storedSet(1), storedSet(2, { repMin: 9, repMax: 9 }), storedSet(3)])
    const result = await fillProgramSetsDown(USER, PID, 0, 1, 2, 'ui', { scope: 'all' })
    expect(result).toEqual({ updated: 2 })
    expect(event()?.payload).toMatchObject({ setNumbers: [1, 3], scope: 'all' })
  })

  it('can fill a named subset of fields only', async () => {
    arrange([storedSet(1, { rpe: 8, suggestedLoadKg: 100 }), storedSet(2)])
    await fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui', { fields: ['rpe'] })
    expect(writes('update:program_sets')[0].values).toEqual({ rpe: 8 })
  })

  it('refuses an unknown field name rather than ignoring it', async () => {
    await expect(
      fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui', { fields: ['bogus' as never] }),
    ).rejects.toThrow(ProgramPatchError)
  })

  it('refuses a fill that would break a target row, writing nothing', async () => {
    // Arrange — the source would clear durationSec onto a timed set, which the
    // cross-field rules forbid.
    arrange([
      storedSet(1, { durationSec: null }),
      storedSet(2, { metricMode: 'duration', durationSec: 60 }),
    ])

    // Act / Assert — the whole op fails; a partial fill is a wrong plan.
    await expect(fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui')).rejects.toThrow(ProgramPatchError)
    expect(writes('update:program_sets')).toHaveLength(0)
  })

  it('is a silent no-op when the source is the last set', async () => {
    arrange([storedSet(1), storedSet(2)])
    const result = await fillProgramSetsDown(USER, PID, 0, 1, 2, 'ui')
    expect(result).toEqual({ updated: 0 })
    expect(writes('insert:program_events')).toHaveLength(0)
  })

  it('logs ONE event attributed to the actor', async () => {
    arrange([storedSet(1), storedSet(2)])
    await fillProgramSetsDown(USER, PID, 0, 1, 1, 'mcp')
    expect(writes('insert:program_events')).toHaveLength(1)
    expect(event()).toMatchObject({
      actor: 'mcp',
      action: 'fill_program_sets',
      summary: 'Fill set 1 down to 1 set of Bench (Day 1)',
    })
  })

  it('returns null when the exercise is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await fillProgramSetsDown(USER, PID, 0, 1, 1, 'ui')).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('returns null when the addressed set number does not exist', async () => {
    arrange([storedSet(1)])
    expect(await fillProgramSetsDown(USER, PID, 0, 1, 9, 'ui')).toBeNull()
  })
})

describe('duplicateProgramWeek', () => {
  /** Reads: owned-program → mesocycle length → the program's set ids → overrides. */
  const arrange = (overrides: unknown[], mesocycleWeeks = 6) => {
    selectQueue = [OWNED_PROGRAM, [{ mesocycleWeeks }], [{ id: 'ps1' }, { id: 'ps2' }], overrides]
  }

  it('copies week N override rows onto week M for every set in the program', async () => {
    // Arrange — two week-2 overrides, nothing at week 5 yet.
    arrange([storedOverride('o1', 'ps1', 2), storedOverride('o2', 'ps2', 2, 8)])

    // Act
    const result = await duplicateProgramWeek(USER, PID, 2, 5, 'ui')

    // Assert — both rows re-inserted at week 5, same set ids, same values.
    expect(result).toEqual({ copied: 2, cleared: 0 })
    const rows = writes('insert:program_set_overrides')[0].values as Record<string, unknown>[]
    expect(rows).toEqual([
      expect.objectContaining({ programSetId: 'ps1', week: 5, repMin: 3 }),
      expect.objectContaining({ programSetId: 'ps2', week: 5, repMin: 8 }),
    ])
  })

  it('REPLACES the target week rather than merging into it', async () => {
    // Arrange — week 5 already holds a stale override the copy must not leave behind.
    arrange([storedOverride('o1', 'ps1', 2), storedOverride('stale', 'ps2', 5, 12)])

    // Act
    const result = await duplicateProgramWeek(USER, PID, 2, 5, 'ui')

    // Assert — the stale row is deleted, only the week-2 copy survives.
    expect(result).toEqual({ copied: 1, cleared: 1 })
    expect(writes('delete:program_set_overrides')).toHaveLength(1)
  })

  it('copies only DEVIATIONS — a set with no week-N override gets none at week M', async () => {
    // Arrange — ps2 has nothing at week 2, so nothing is pinned for it at week 5.
    arrange([storedOverride('o1', 'ps1', 2)])

    const result = await duplicateProgramWeek(USER, PID, 2, 5, 'ui')

    expect(result).toEqual({ copied: 1, cleared: 0 })
    const rows = writes('insert:program_set_overrides')[0].values as Record<string, unknown>[]
    expect(rows.map((r) => r.programSetId)).toEqual(['ps1'])
  })

  it('logs ONE event naming both weeks', async () => {
    arrange([storedOverride('o1', 'ps1', 2)])
    await duplicateProgramWeek(USER, PID, 2, 5, 'coach')
    expect(writes('insert:program_events')).toHaveLength(1)
    expect(event()).toMatchObject({
      actor: 'coach',
      action: 'duplicate_program_week',
      summary: 'Copy week 2 targets onto week 5',
      payload: { fromWeek: 2, toWeek: 5, copied: 1, cleared: 0 },
    })
  })

  it('refuses a week outside the mesocycle', async () => {
    arrange([], 6)
    await expect(duplicateProgramWeek(USER, PID, 2, 9, 'ui')).rejects.toThrow(
      /outside this program's 6-week mesocycle/,
    )
  })

  it('refuses duplicating a week onto itself', async () => {
    arrange([], 6)
    await expect(duplicateProgramWeek(USER, PID, 2, 2, 'ui')).rejects.toThrow(
      /cannot be duplicated onto itself/,
    )
  })

  it('returns null when the program is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await duplicateProgramWeek(USER, PID, 1, 2, 'ui')).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('fillProgramWeeksRight', () => {
  /** Reads: owned-exercise → mesocycle length → the exercise's set ids → overrides. */
  const arrange = (overrides: unknown[], mesocycleWeeks = 6) => {
    selectQueue = [OWNED_EXERCISE, [{ mesocycleWeeks }], [{ id: 'ps1' }], overrides]
  }

  it('copies the source week onto every later week through the target', async () => {
    // Arrange
    arrange([storedOverride('o1', 'ps1', 2)])

    // Act — weeks 3, 4 and 5 all become copies of week 2.
    const result = await fillProgramWeeksRight(USER, PID, 0, 1, 2, 5, 'ui')

    // Assert
    expect(result).toMatchObject({ copied: 3, cleared: 0, weeks: [3, 4, 5] })
    const rows = writes('insert:program_set_overrides')[0].values as Record<string, unknown>[]
    expect(rows.map((r) => r.week)).toEqual([3, 4, 5])
  })

  it('clears whatever those later weeks held before copying', async () => {
    arrange([storedOverride('o1', 'ps1', 2), storedOverride('stale', 'ps1', 4, 20)])
    const result = await fillProgramWeeksRight(USER, PID, 0, 1, 2, 5, 'ui')
    expect(result).toMatchObject({ copied: 3, cleared: 1 })
  })

  it('refuses a target week that is not later than the source', async () => {
    arrange([])
    await expect(fillProgramWeeksRight(USER, PID, 0, 1, 4, 4, 'ui')).rejects.toThrow(
      /needs a later week than 4/,
    )
  })

  it('refuses a target week past the end of the mesocycle', async () => {
    arrange([], 4)
    await expect(fillProgramWeeksRight(USER, PID, 0, 1, 2, 7, 'ui')).rejects.toThrow(
      /outside this program's 4-week mesocycle/,
    )
  })

  it('logs ONE event naming the exercise and range', async () => {
    arrange([storedOverride('o1', 'ps1', 2)])
    await fillProgramWeeksRight(USER, PID, 0, 1, 2, 4, 'ui')
    expect(writes('insert:program_events')).toHaveLength(1)
    expect(event()).toMatchObject({
      action: 'fill_program_weeks',
      summary: 'Fill week 2 of Bench right through week 4 (Day 1)',
    })
  })

  it('returns null when the exercise is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await fillProgramWeeksRight(USER, PID, 0, 1, 1, 2, 'ui')).toBeNull()
  })
})

describe('applyProgramSetScheme', () => {
  /** Reads: owned-exercise → current set rows. */
  const arrange = (rows: unknown[]) => {
    selectQueue = [OWNED_EXERCISE, rows]
  }

  const scheme = (repMin: number, repMax = repMin) => ({
    repMin,
    repMax,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
  })

  it('updates in place, appends the surplus and removes the tail — in ONE op', async () => {
    // Arrange — the exercise has 2 sets; the scheme asks for 3.
    arrange([storedSet(1), storedSet(2)])

    // Act
    const result = await applyProgramSetScheme(
      USER,
      PID,
      0,
      1,
      [scheme(5), scheme(5), scheme(3)],
      'ui',
    )

    // Assert
    expect(result).toEqual({ added: 1, updated: 2, removed: 0 })
    expect(writes('update:program_sets')).toHaveLength(2)
    expect(writes('insert:program_sets')).toHaveLength(1)
    expect(writes('delete:program_sets')).toHaveLength(0)
  })

  it('removes the tail when the scheme is shorter than the exercise', async () => {
    arrange([storedSet(1), storedSet(2), storedSet(3)])
    const result = await applyProgramSetScheme(USER, PID, 0, 1, [scheme(8)], 'ui')
    expect(result).toEqual({ added: 0, updated: 1, removed: 2 })
    expect(writes('delete:program_sets')).toHaveLength(1)
  })

  it('writes the effort and load the scheme carried, including nulls that clear a stale target', async () => {
    arrange([storedSet(1, { rpe: 9, suggestedLoadKg: 140 })])
    await applyProgramSetScheme(
      USER,
      PID,
      0,
      1,
      [{ repMin: 8, repMax: 12, rir: 2, rpe: null, suggestedLoadKg: 100 }],
      'ui',
    )
    expect(writes('update:program_sets')[0].values).toEqual({
      repMin: 8,
      repMax: 12,
      rir: 2,
      rpe: null,
      suggestedLoadKg: 100,
    })
  })

  it('appends new sets as working / reps_weight — a scheme prescribes targets, not shape', async () => {
    arrange([storedSet(1)])
    await applyProgramSetScheme(USER, PID, 0, 1, [scheme(5), scheme(5)], 'ui')
    expect(writes('insert:program_sets')[0].values).toMatchObject({
      setNumber: 2,
      setType: 'working',
      metricMode: 'reps_weight',
    })
  })

  it('refuses an empty scheme instead of deleting every set', async () => {
    await expect(applyProgramSetScheme(USER, PID, 0, 1, [], 'ui')).rejects.toThrow(
      /at least one set/,
    )
    expect(records).toHaveLength(0)
  })

  it('refuses a scheme that would leave a timed set without a duration, writing nothing', async () => {
    arrange([storedSet(1, { metricMode: 'duration', durationSec: null })])
    await expect(applyProgramSetScheme(USER, PID, 0, 1, [scheme(5)], 'ui')).rejects.toThrow(
      ProgramPatchError,
    )
    expect(writes('update:program_sets')).toHaveLength(0)
  })

  it('logs ONE event carrying the whole batch', async () => {
    arrange([storedSet(1)])
    await applyProgramSetScheme(USER, PID, 0, 1, [scheme(5), scheme(3)], 'coach')
    expect(writes('insert:program_events')).toHaveLength(1)
    expect(event()).toMatchObject({
      actor: 'coach',
      action: 'apply_set_scheme',
      summary: 'Set scheme on Bench: 2 sets (Day 1)',
      payload: { added: 1, updated: 1, removed: 0 },
    })
  })

  it('returns null when the exercise is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await applyProgramSetScheme(USER, PID, 0, 1, [scheme(5)], 'ui')).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('applyProgressionToScope', () => {
  const LINEAR = { scheme: 'linear', incrementKg: 2.5 }
  /** Reads: owned-exercise → source progression → in-scope exercise ids. */
  const arrange = (progression: unknown, targets: unknown[]) => {
    selectQueue = [OWNED_EXERCISE, [{ progression }], targets]
  }

  it("copies the source's progression onto the other exercises in the day", async () => {
    // Arrange
    arrange(LINEAR, [{ id: 'pe1' }, { id: 'pe2' }, { id: 'pe3' }])

    // Act
    const result = await applyProgressionToScope(USER, PID, 0, 1, 'day', 'ui')

    // Assert — the source itself is excluded from the write.
    expect(result).toEqual({ updated: 2 })
    expect(writes('update:program_exercises')[0].values).toEqual({ progression: LINEAR })
  })

  it('reaches the whole program under the program scope', async () => {
    arrange(LINEAR, [{ id: 'pe1' }, { id: 'pe2' }, { id: 'pe9' }])
    await applyProgressionToScope(USER, PID, 0, 1, 'program', 'ui')
    expect(event()).toMatchObject({
      action: 'apply_progression_scope',
      summary: "Apply Bench's linear progression to 2 other exercises (whole program)",
      payload: { scope: 'program', updated: 2 },
    })
  })

  it('REFUSES to broadcast a TM-anchored scheme — a training max belongs to one lift', async () => {
    // Arrange
    arrange({ scheme: 'percent-1rm', trainingMaxKg: 140 }, [{ id: 'pe1' }, { id: 'pe2' }])

    // Act / Assert — the refusal names the scheme and the honest alternative.
    await expect(applyProgressionToScope(USER, PID, 0, 1, 'program', 'ui')).rejects.toThrow(
      /percent-1rm[\s\S]*training max/,
    )
    expect(writes('update:program_exercises')).toHaveLength(0)
  })

  it('refuses amrap-cycle for the same reason', async () => {
    arrange({ scheme: 'amrap-cycle', trainingMaxKg: 140 }, [{ id: 'pe2' }])
    await expect(applyProgressionToScope(USER, PID, 0, 1, 'day', 'ui')).rejects.toThrow(
      ProgramPatchError,
    )
  })

  it('broadcasts a cleared (null) progression, which is a legitimate rule', async () => {
    arrange(null, [{ id: 'pe1' }, { id: 'pe2' }])
    const result = await applyProgressionToScope(USER, PID, 0, 1, 'day', 'ui')
    expect(result).toEqual({ updated: 1 })
    expect(writes('update:program_exercises')[0].values).toEqual({ progression: null })
  })

  it('is a no-op when the source is the only exercise in scope', async () => {
    arrange(LINEAR, [{ id: 'pe1' }])
    expect(await applyProgressionToScope(USER, PID, 0, 1, 'day', 'ui')).toEqual({ updated: 0 })
    expect(writes('insert:program_events')).toHaveLength(0)
  })

  it('returns null when the exercise is not owned', async () => {
    selectQueue = [NOT_OWNED]
    expect(await applyProgressionToScope(USER, PID, 0, 1, 'day', 'ui')).toBeNull()
    expect(records).toHaveLength(0)
  })
})
