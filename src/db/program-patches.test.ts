import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording mock for the program patch ops — the program twin of
 * `patch-sets.test.ts`. `selectQueue` feeds each op's reads in call order (the
 * expected order is documented per test); `records` captures every write as
 * `insert:<table>` / `update:<table>` / `delete:<table>` so a test can assert
 * WHICH table a renumber or bump hit; the *Rows vars toggle the returning
 * outcomes to drive the owned/found gates without a database.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
let updatedRows: { id: string }[] = [{ id: 'row1' }]
let deletedRows: { id: string }[] = [{ id: 'ps1' }]
let insertedRows: { id: string }[] = [{ id: 'pe-new' }]

type Resolve = (value: unknown) => unknown

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    limit: () => obj,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

// Derive the real table name from the arg so a test asserts WHICH table a write
// targeted (e.g. the set renumber must hit `program_sets`, the bump `programs`).
function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(updatedRows).then(resolve) }),
    // The renumber/bump paths await .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain(table: unknown) {
  const name = getTableName(table as Table)
  records.push({ op: `delete:${name}` })
  const obj = {
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(deletedRows).then(resolve) }),
    // Day/exercise deletes await .where() directly (no .returning()).
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
          then: (resolve: Resolve) => Promise.resolve(insertedRows).then(resolve),
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

// The catalog fetch backs muscle tagging; stub it so no test can hit the
// network. `muscleRowsFor` stays real (pure) so tag rows are asserted as
// production would write them.
const { catalogMock } = vi.hoisted(() => ({ catalogMock: vi.fn() }))
vi.mock('./programs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./programs')>()),
  loadExerciseCatalog: catalogMock,
}))

// The autoreg paid gate rides setProgramAutoregulation itself; entitled by
// default (the mock resolves) so the existing toggle tests stay untouched.
// importOriginal keeps FeatureRequiredError's real identity for the refusal.
const { requireFeature } = vi.hoisted(() => ({ requireFeature: vi.fn() }))
vi.mock('./entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entitlements')>()),
  requireFeature,
}))

import { FeatureRequiredError } from './entitlements'
import {
  ProgramPatchError,
  setProgramAutoregulation,
  setProgramDeloadPolicy,
  setProgramDietPhase,
  addProgramDay,
  updateProgramDay,
  removeProgramDay,
  moveProgramDay,
  addProgramExercise,
  updateProgramExercise,
  substituteProgramExercise,
  removeProgramExercise,
  moveProgramExercise,
  addProgramSet,
  updateProgramSet,
  removeProgramSet,
  moveProgramSet,
  syncProgramExerciseLoads,
  setProgramSetOverride,
  removeProgramSetOverride,
  setTrainingMax,
} from './program-patches'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'
const OWNED_DAY = [{ id: 'pd1' }]
const OWNED_EXERCISE = [{ exerciseId: 'pe1', dayId: 'pd1', wgerExerciseId: 73, source: 'wger', name: 'Bench' }]
/** A stored reps_weight set row, as updateProgramSet's current-row read returns it. */
const CURRENT_SET = {
  setType: 'working',
  metricMode: 'reps_weight',
  repMin: 5,
  repMax: 12,
  rir: null,
  rpe: null,
  suggestedLoadKg: 100,
  tempo: null,
  durationSec: null,
  distanceM: null,
  technique: null,
}

beforeEach(() => {
  catalogMock.mockReset()
  catalogMock.mockResolvedValue(null)
  // Reset calls AND implementation: default = entitled (resolves undefined).
  requireFeature.mockReset()
  records.length = 0
  selectQueue = []
  updatedRows = [{ id: 'row1' }]
  deletedRows = [{ id: 'ps1' }]
  insertedRows = [{ id: 'pe-new' }]
})

describe('setTrainingMax (TM lifecycle §1)', () => {
  const eventInsert = () =>
    records.find((r) => r.op === 'insert:program_events')?.values as Record<string, unknown>
  const exerciseUpdate = () =>
    records.find((r) => r.op === 'update:program_exercises')?.values as {
      progression: Record<string, unknown>
    }

  const AMRAP = {
    scheme: 'amrap-cycle',
    trainingMaxKg: 140,
    incrementKg: 2.5,
    // A stored row post-migration-0037 carries an explicit timing; the
    // re-parse in setTrainingMax preserves it (absent would be materialized
    // to 'after-deload' — the new-config zod default).
    tmBumpTiming: 'before-deload',
    wave: [
      [0.65, 0.75, 0.85],
      [0.7, 0.8, 0.9],
    ],
    waveReps: [
      [5, 5, 5],
      [3, 3, 3],
    ],
  }

  it('updates ONLY the training max and logs the {before, after, reason} event', async () => {
    // Arrange — reads: owned-exercise → current progression
    selectQueue = [OWNED_EXERCISE, [{ progression: AMRAP }]]

    // Act
    const result = await setTrainingMax(USER, PID, 0, 1, 145, 'cycle-end', 'ui')

    // Assert — the merged progression keeps every wave/rep field verbatim
    expect(result).toEqual({ id: 'pe1', trainingMaxKg: 145 })
    expect(exerciseUpdate().progression).toEqual({ ...AMRAP, trainingMaxKg: 145 })
    expect(eventInsert()).toMatchObject({
      programId: PID,
      userId: USER,
      actor: 'ui',
      action: 'adjust_training_max',
      summary: 'Bench TM 140 → 145 kg (cycle-end)',
      payload: {
        dayPosition: 0,
        exercisePosition: 1,
        before: { trainingMaxKg: 140 },
        after: { trainingMaxKg: 145 },
        reason: 'cycle-end',
      },
    })
    // Exactly one event, plus the updatedAt bump on programs.
    expect(records.filter((r) => r.op === 'insert:program_events')).toHaveLength(1)
    expect(records.some((r) => r.op === 'update:programs')).toBe(true)
  })

  it('stamps bankedWaves on an amrap-cycle when the wave persist passes it', async () => {
    // Arrange
    selectQueue = [OWNED_EXERCISE, [{ progression: AMRAP }]]

    // Act
    await setTrainingMax(USER, PID, 0, 0, 142.5, 'cycle-end', 'ui', { bankedWaves: 1 })

    // Assert
    expect(exerciseUpdate().progression).toEqual({ ...AMRAP, trainingMaxKg: 142.5, bankedWaves: 1 })
  })

  it('works for percent-1rm and preserves the week percents', async () => {
    // Arrange
    const percent = { scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.7, 0.8, 0.9] }
    selectQueue = [OWNED_EXERCISE, [{ progression: percent }]]

    // Act
    await setTrainingMax(USER, PID, 0, 0, 90, 'reset', 'ui')

    // Assert
    expect(exerciseUpdate().progression).toEqual({ ...percent, trainingMaxKg: 90 })
    expect((eventInsert().payload as Record<string, unknown>).reason).toBe('reset')
  })

  it('rejects schemes without a training max with a clear error and writes nothing', async () => {
    // Arrange — a linear exercise has no TM
    selectQueue = [OWNED_EXERCISE, [{ progression: { scheme: 'linear', incrementKg: 2.5 } }]]

    // Act + Assert
    await expect(setTrainingMax(USER, PID, 0, 0, 100, 'manual', 'ui')).rejects.toThrow(
      /linear progression — a training max applies only to percent-1rm or amrap-cycle/,
    )
    expect(records.some((r) => r.op.startsWith('update:'))).toBe(false)
    expect(records.some((r) => r.op === 'insert:program_events')).toBe(false)
  })

  it('rejects a negative or non-finite training max before any read', async () => {
    // Act + Assert
    await expect(setTrainingMax(USER, PID, 0, 0, -5, 'manual', 'ui')).rejects.toThrow(
      ProgramPatchError,
    )
    await expect(setTrainingMax(USER, PID, 0, 0, Number.NaN, 'manual', 'ui')).rejects.toThrow(
      ProgramPatchError,
    )
  })

  it('returns null when the exercise is not owned/found', async () => {
    // Arrange — the ownership join finds nothing
    selectQueue = [[]]

    // Act
    const result = await setTrainingMax(USER, PID, 0, 0, 100, 'manual', 'ui')

    // Assert
    expect(result).toBeNull()
    expect(records.some((r) => r.op === 'insert:program_events')).toBe(false)
  })
})

describe('setProgramAutoregulation stall policy', () => {
  const eventInsert = () =>
    records.find((r) => r.op === 'insert:program_events')?.values as Record<string, unknown>
  const programsUpdate = () =>
    records.find((r) => r.op === 'update:programs')?.values as Record<string, unknown>

  it('writes a changed policy and records it in the event summary/payload', async () => {
    // Arrange — stored policy is the default; the call flips it
    selectQueue = [[{ id: PID, autoregStallPolicy: 'all-sets' }]]

    // Act
    await setProgramAutoregulation(USER, PID, true, 'mcp', 'first-set')

    // Assert
    expect(programsUpdate()).toMatchObject({
      autoregulation: true,
      autoregStallPolicy: 'first-set',
    })
    expect(eventInsert()).toMatchObject({
      action: 'set_program_autoregulation',
      summary: 'Auto-regulation on · stall policy: top set decides',
      payload: { after: { autoregulation: true, autoregStallPolicy: 'first-set' } },
    })
  })

  it('an unchanged policy pass-through keeps the plain toggle line', async () => {
    // Arrange — the stored policy already matches the arg
    selectQueue = [[{ id: PID, autoregStallPolicy: 'first-set' }]]

    // Act
    await setProgramAutoregulation(USER, PID, false, 'mcp', 'first-set')

    // Assert — the column is (re)written but the event stays the toggle line
    expect(programsUpdate()).toMatchObject({ autoregStallPolicy: 'first-set' })
    expect(eventInsert()).toMatchObject({
      summary: 'Auto-regulation off',
      payload: { after: { autoregulation: false } },
    })
    expect(
      'autoregStallPolicy' in ((eventInsert().payload as { after: object }).after ?? {}),
    ).toBe(false)
  })

  it('an omitted policy never touches the column (preserve-on-omit)', async () => {
    // Arrange
    selectQueue = [[{ id: PID, autoregStallPolicy: 'first-set' }]]

    // Act
    await setProgramAutoregulation(USER, PID, false, 'mcp')

    // Assert
    expect('autoregStallPolicy' in programsUpdate()).toBe(false)
    expect(eventInsert()).toMatchObject({ summary: 'Auto-regulation off' })
  })

  it('refuses turning autoregulation ON for an unentitled user before ANY write', async () => {
    // Arrange — the paid gate says no: set_program_policy must not hand back
    // the bypass the upsert_program gate closes.
    requireFeature.mockRejectedValueOnce(new FeatureRequiredError('autoreg', 'pro'))
    selectQueue = [[{ id: PID, autoregStallPolicy: 'all-sets' }]]

    // Act + Assert — no column write, no change-log event
    await expect(setProgramAutoregulation(USER, PID, true, 'mcp')).rejects.toThrow(
      FeatureRequiredError,
    )
    expect(requireFeature).toHaveBeenCalledWith(USER, 'autoreg')
    expect(records).toHaveLength(0)
  })

  it('never consults the gate when turning autoregulation OFF', async () => {
    // Arrange
    selectQueue = [[{ id: PID, autoregStallPolicy: 'all-sets' }]]

    // Act — opting out is always allowed, entitled or not
    await setProgramAutoregulation(USER, PID, false, 'mcp')

    // Assert
    expect(requireFeature).not.toHaveBeenCalled()
    expect(programsUpdate()).toMatchObject({ autoregulation: false })
  })
})

describe('setProgramDeloadPolicy', () => {
  const eventInsert = () =>
    records.find((r) => r.op === 'insert:program_events')?.values as Record<string, unknown>
  const programsUpdate = () =>
    records.find((r) => r.op === 'update:programs')?.values as Record<string, unknown>

  it('writes a parsed policy (shape defaults applied) and logs the event', async () => {
    // Reads: owned-program
    selectQueue = [[{ id: PID }]]

    const result = await setProgramDeloadPolicy(
      USER,
      PID,
      { mode: 'scheduled', shape: { rpeCap: 7 } } as never,
      'mcp',
    )

    expect(result).toEqual({ id: PID })
    expect(programsUpdate()).toMatchObject({
      deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.85, setFactor: 0.5, rpeCap: 7 } },
    })
    expect(eventInsert()).toMatchObject({
      action: 'set_program_deload_policy',
      summary: 'Deload policy: scheduled (load ×0.85, sets ×0.5, RPE cap 7)',
      payload: {
        after: {
          deloadPolicy: {
            mode: 'scheduled',
            shape: { loadFactor: 0.85, setFactor: 0.5, rpeCap: 7 },
          },
        },
      },
    })
  })

  it('clears with null and says so in the summary', async () => {
    selectQueue = [[{ id: PID }]]

    await setProgramDeloadPolicy(USER, PID, null, 'ui')

    expect(programsUpdate()).toMatchObject({ deloadPolicy: null })
    expect(eventInsert()).toMatchObject({
      summary: 'Deload policy cleared (legacy behavior)',
      payload: { after: { deloadPolicy: null } },
    })
  })

  it('rejects an invalid policy with ProgramPatchError before any write', async () => {
    await expect(
      setProgramDeloadPolicy(USER, PID, { mode: 'weird' } as never, 'mcp'),
    ).rejects.toBeInstanceOf(ProgramPatchError)
    expect(records).toHaveLength(0)
  })

  it('returns null when the program is not owned', async () => {
    selectQueue = [[]]
    expect(await setProgramDeloadPolicy(USER, PID, { mode: 'none' }, 'mcp')).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('setProgramDietPhase', () => {
  const eventInsert = () =>
    records.find((r) => r.op === 'insert:program_events')?.values as Record<string, unknown>
  const programsUpdate = () =>
    records.find((r) => r.op === 'update:programs')?.values as Record<string, unknown>

  it('writes the phase, stamps set_at, and logs the event', async () => {
    // Reads: owned-program
    selectQueue = [[{ id: PID }]]

    const result = await setProgramDietPhase(USER, PID, 'cutting', 'coach')

    expect(result).toEqual({ id: PID })
    expect(programsUpdate()).toMatchObject({ dietPhase: 'cutting' })
    expect(programsUpdate().dietPhaseSetAt).toBeInstanceOf(Date)
    expect(eventInsert()).toMatchObject({
      actor: 'coach',
      action: 'set_program_diet_phase',
      summary: 'Diet phase: cutting',
      payload: { after: { dietPhase: 'cutting' } },
    })
  })

  it('clears with null — and the clear STILL stamps set_at (a clear is a statement too)', async () => {
    selectQueue = [[{ id: PID }]]

    await setProgramDietPhase(USER, PID, null, 'ui')

    expect(programsUpdate().dietPhase).toBeNull()
    expect(programsUpdate().dietPhaseSetAt).toBeInstanceOf(Date)
    expect(eventInsert()).toMatchObject({
      action: 'set_program_diet_phase',
      summary: 'Diet phase cleared',
      payload: { after: { dietPhase: null } },
    })
  })

  it('rejects anything outside the union before touching the db', async () => {
    await expect(setProgramDietPhase(USER, PID, 'shredding' as never, 'mcp')).rejects.toThrow(
      ProgramPatchError,
    )
    expect(records).toHaveLength(0)
  })

  it('returns null (no write, no event) when the program is not owned', async () => {
    selectQueue = [[]]
    expect(await setProgramDietPhase(USER, PID, 'bulking', 'mcp')).toBeNull()
    expect(records.find((r) => r.op === 'insert:program_events')).toBeUndefined()
  })
})

describe('day ops (user-scoped)', () => {
  it('addProgramDay appends at max(position)+1 and bumps updatedAt', async () => {
    // Reads: owned-program → max(position)
    selectQueue = [[{ id: PID }], [{ value: 1 }]]

    const result = await addProgramDay(USER, PID, { name: 'Pull', notes: null }, 'mcp')

    expect(records.map((r) => r.op)).toEqual(['insert:program_days', 'update:programs', 'insert:program_events'])
    expect(records[0]!.values).toMatchObject({ programId: PID, name: 'Pull', position: 2 })
    expect(result).toEqual({ position: 2 })
  })

  it('addProgramDay starts at position 0 when the program has no days', async () => {
    // Reads: owned-program → max(position) (null = empty)
    selectQueue = [[{ id: PID }], [{ value: null }]]

    const result = await addProgramDay(USER, PID, { name: 'Push' }, 'mcp')

    expect(result).toEqual({ position: 0 })
    expect(records[0]).toMatchObject({ op: 'insert:program_days', values: { position: 0 } })
  })

  it('addProgramDay returns null and writes nothing when the program is not owned', async () => {
    selectQueue = [[]]

    const result = await addProgramDay(USER, PID, { name: 'Push' }, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramDay patches only the named fields and bumps updatedAt', async () => {
    // Reads: owned-day
    selectQueue = [OWNED_DAY]

    const result = await updateProgramDay(USER, PID, 0, { name: 'Legs' }, 'mcp')

    expect(records.map((r) => r.op)).toEqual(['update:program_days', 'update:programs', 'insert:program_events'])
    expect(records[0]!.values).toEqual({ name: 'Legs' })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramDay returns null for an empty patch without querying', async () => {
    const result = await updateProgramDay(USER, PID, 0, {}, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramDay returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramDay(USER, PID, 0, { name: 'Legs' }, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramDay deletes the day then closes the position gap', async () => {
    // Reads: owned-day
    selectQueue = [OWNED_DAY]

    const result = await removeProgramDay(USER, PID, 1, 'mcp')

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_days',
      'update:program_days',
      'update:programs',
      'insert:program_events',
    ])
    expect(result).toEqual({ removed: true })
  })

  it('moveProgramDay splices the block and re-positions the moved day (from > to)', async () => {
    // Reads: owned-day-at-from → day-exists-at-to
    selectQueue = [[{ id: 'pd3' }], [{ id: 'pd1' }]]

    const result = await moveProgramDay(USER, PID, 2, 0, 'mcp')

    // Shift [0,2) up by one, then drop the moved day at 0, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_days',
      'update:program_days',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[1]!.values).toEqual({ position: 0 })
    expect(result).toEqual({ moved: true })
  })

  it('moveProgramDay is a no-op success when from === to', async () => {
    // Reads: owned-day-at-from only
    selectQueue = [OWNED_DAY]

    const result = await moveProgramDay(USER, PID, 1, 1, 'mcp')

    expect(result).toEqual({ moved: true })
    expect(records).toEqual([])
  })

  it('moveProgramDay returns null when no day sits at the target position', async () => {
    // Reads: owned-day-at-from → (empty) day-exists-at-to
    selectQueue = [OWNED_DAY, []]

    const result = await moveProgramDay(USER, PID, 0, 9, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('exercise ops (user-scoped)', () => {
  it('addProgramExercise appends the exercise and seeds one default set', async () => {
    // Reads: owned-day → max(position)
    selectQueue = [OWNED_DAY, [{ value: null }]]

    const result = await addProgramExercise(USER, PID, 0, {
      wgerExerciseId: 73,
      name: 'Flat Bench',
    }, 'mcp')

    expect(records.map((r) => r.op)).toEqual([
      'insert:program_exercises',
      'insert:program_sets',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[0]!.values).toMatchObject({
      programDayId: 'pd1',
      name: 'Flat Bench',
      position: 0,
    })
    expect(records[1]!.values).toMatchObject({
      programExerciseId: 'pe-new',
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
    })
    expect(result).toEqual({ position: 0 })
  })

  it('addProgramExercise rejects a malformed progression before any read', async () => {
    await expect(
      addProgramExercise(USER, PID, 0, {
        wgerExerciseId: 73,
        name: 'Bench',
        // @ts-expect-error — deliberately malformed scheme
        progression: { scheme: 'bogus' },
      }, 'mcp'),
    ).rejects.toBeInstanceOf(ProgramPatchError)
    expect(records).toEqual([])
  })

  it('addProgramExercise returns null and writes nothing when the day is not owned', async () => {
    selectQueue = [[]]

    const result = await addProgramExercise(USER, PID, 0, { wgerExerciseId: 73, name: 'Bench' }, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramExercise patches the named fields and bumps updatedAt', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    const result = await updateProgramExercise(USER, PID, 1, 0, {
      wgerExerciseId: 99,
      name: 'Incline Press',
    }, 'mcp')

    // The movement swap clears the old muscle tags (no catalog here → no re-insert).
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'delete:program_exercise_muscles',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[0]!.values).toEqual({ wgerExerciseId: 99, name: 'Incline Press' })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramExercise clears progression with an explicit null', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    await updateProgramExercise(USER, PID, 0, 0, { progression: null }, 'mcp')

    expect(records[0]!.values).toEqual({ progression: null })
  })

  it('updateProgramExercise threads overshootPolicy through to the row and the event', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    const result = await updateProgramExercise(
      USER,
      PID,
      0,
      1,
      { overshootPolicy: 'any-metric' },
      'mcp',
    )

    // No identity change → no retag; the named field lands on the row…
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[0]!.values).toEqual({ overshootPolicy: 'any-metric' })
    // …and the event summary names the touched field.
    const event = records[2]!.values as { summary: string; payload: { after: unknown } }
    expect(event.summary).toContain('overshootPolicy')
    expect(event.payload.after).toEqual({ overshootPolicy: 'any-metric' })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramExercise clears overshootPolicy with an explicit null', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    await updateProgramExercise(USER, PID, 0, 1, { overshootPolicy: null }, 'mcp')

    expect(records[0]!.values).toEqual({ overshootPolicy: null })
  })

  it('updateProgramExercise rejects a value outside the overshoot enum before any read or write', async () => {
    await expect(
      updateProgramExercise(
        USER,
        PID,
        0,
        1,
        { overshootPolicy: 'lenient' as unknown as 'any-metric' },
        'mcp',
      ),
    ).rejects.toThrow(/expected one of "strict-load"/)
    expect(records).toEqual([])
  })

  it('updateProgramExercise returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramExercise(USER, PID, 0, 0, { name: 'X' }, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('substituteProgramExercise swaps identity and strips template + override loads', async () => {
    // Reads: owned-exercise, current-progression (non-TM), set-ids
    selectQueue = [
      OWNED_EXERCISE,
      [{ progression: { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 } }],
      [{ id: 'ps1' }, { id: 'ps2' }],
    ]

    const result = await substituteProgramExercise(
      USER,
      PID,
      1,
      0,
      { wgerExerciseId: 4, source: 'custom', name: 'Elevated Lunge' },
      'ui',
    )

    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'delete:program_exercise_muscles',
      'update:program_sets',
      'update:program_set_overrides',
      'update:programs',
      'insert:program_events',
    ])
    // Identity swapped; a non-TM progression survives (it re-anchors on the
    // substitute's own history once the absolute loads are gone).
    expect(records[0]!.values).toEqual({
      wgerExerciseId: 4,
      source: 'custom',
      name: 'Elevated Lunge',
    })
    expect(records[2]!.values).toEqual({ suggestedLoadKg: null })
    expect(records[3]!.values).toEqual({ suggestedLoadKg: null })
    expect(result).toEqual({ id: 'row1' })
  })

  it('substituteProgramExercise drops a TM-based progression with the swap', async () => {
    // Reads: owned-exercise, current-progression (TM-anchored), set-ids
    selectQueue = [
      OWNED_EXERCISE,
      [{ progression: { scheme: 'percent-1rm', trainingMaxKg: 140, weekPercents: [0.7] } }],
      [{ id: 'ps1' }],
    ]

    await substituteProgramExercise(
      USER,
      PID,
      0,
      0,
      { wgerExerciseId: 4, source: 'custom', name: 'X' },
      'ui',
    )

    // The old lift's training max must not price the substitute's sets.
    expect(records[0]!.values).toEqual({
      wgerExerciseId: 4,
      source: 'custom',
      name: 'X',
      progression: null,
    })
  })

  it('substituteProgramExercise skips the override write when the slot has no sets', async () => {
    selectQueue = [OWNED_EXERCISE, [{ progression: null }], []]

    await substituteProgramExercise(
      USER,
      PID,
      0,
      0,
      { wgerExerciseId: 4, source: 'custom', name: 'X' },
      'ui',
    )

    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'delete:program_exercise_muscles',
      'update:program_sets',
      'update:programs',
      'insert:program_events',
    ])
  })

  it('substituteProgramExercise returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await substituteProgramExercise(
      USER,
      PID,
      0,
      0,
      { wgerExerciseId: 4, source: 'custom', name: 'X' },
      'ui',
    )

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramExercise deletes then renumbers within its day', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    const result = await removeProgramExercise(USER, PID, 0, 1, 'mcp')

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_exercises',
      'update:program_exercises',
      'update:programs',
      'insert:program_events',
    ])
    expect(result).toEqual({ removed: true })
  })

  it('moveProgramExercise splices within the day (from < to)', async () => {
    // Reads: owned-exercise-at-from → exercise-exists-at-to
    selectQueue = [OWNED_EXERCISE, [{ id: 'pe2' }]]

    const result = await moveProgramExercise(USER, PID, 0, 0, 2, 'mcp')

    // Shift (0,2] down by one, then drop the moved exercise at 2, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'update:program_exercises',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[1]!.values).toEqual({ position: 2 })
    expect(result).toEqual({ moved: true })
  })
})

describe('set ops (user-scoped)', () => {
  it('addProgramSet appends at max(setNumber)+1', async () => {
    // Reads: owned-exercise → max(setNumber)
    selectQueue = [OWNED_EXERCISE, [{ value: 3 }]]

    const result = await addProgramSet(USER, PID, 0, 0, { repMin: 8, repMax: 10 }, 'mcp')

    expect(records.map((r) => r.op)).toEqual(['insert:program_sets', 'update:programs', 'insert:program_events'])
    expect(records[0]!.values).toMatchObject({
      programExerciseId: 'pe1',
      setNumber: 4,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: 10,
    })
    expect(result).toEqual({ setNumber: 4 })
  })

  it('addProgramSet rejects a timed set without durationSec before any read', async () => {
    await expect(addProgramSet(USER, PID, 0, 0, { metricMode: 'duration' }, 'mcp')).rejects.toThrow(
      /durationSec/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet merges the patch over the stored row and updates', async () => {
    // Reads: owned-exercise → current set row
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    const result = await updateProgramSet(USER, PID, 0, 0, 3, { repMin: 8 }, 'mcp')

    expect(records.map((r) => r.op)).toEqual(['update:program_sets', 'update:programs', 'insert:program_events'])
    expect(records[0]!.values).toEqual({ repMin: 8 })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramSet rejects metricMode duration when the merged row has no durationSec', async () => {
    // Reads: owned-exercise → current set row (a reps_weight row, durationSec null)
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    await expect(updateProgramSet(USER, PID, 0, 0, 1, { metricMode: 'duration' }, 'mcp')).rejects.toThrow(
      /durationSec is required/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet rejects repMin > repMax after the merge', async () => {
    // Reads: owned-exercise → current set row (repMax 12)
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    await expect(updateProgramSet(USER, PID, 0, 0, 1, { repMin: 15 }, 'mcp')).rejects.toThrow(
      /repMin must be less than or equal to repMax/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet re-parses a technique on a partial edit and rejects a bad kind', async () => {
    await expect(
      updateProgramSet(USER, PID, 0, 0, 1, {
        // @ts-expect-error — deliberately malformed kind
        technique: { kind: 'bogus', stages: [{ reps: 5 }] },
      }, 'mcp'),
    ).rejects.toBeInstanceOf(ProgramPatchError)
    expect(records).toEqual([])
  })

  it('updateProgramSet returns null for an empty patch without querying', async () => {
    const result = await updateProgramSet(USER, PID, 0, 0, 1, {}, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramSet returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramSet(USER, PID, 0, 0, 1, { repMin: 8 }, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramSet deletes then renumbers the higher program_sets down', async () => {
    // Reads: owned-exercise → count(sets) (4 sets, removing #2)
    selectQueue = [OWNED_EXERCISE, [{ value: 4 }]]

    const result = await removeProgramSet(USER, PID, 0, 0, 2, 'mcp')

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_sets',
      'update:program_sets',
      'update:programs',
      'insert:program_events',
    ])
    expect(result).toEqual({ removed: true })
  })

  it("removeProgramSet refuses to delete an exercise's last set", async () => {
    // Reads: owned-exercise → count(sets) (only one set)
    selectQueue = [OWNED_EXERCISE, [{ value: 1 }]]

    await expect(removeProgramSet(USER, PID, 0, 0, 1, 'mcp')).rejects.toThrow(/at least one set/)
    expect(records).toEqual([])
  })

  it('removeProgramSet returns null for a set number past the count', async () => {
    // Reads: owned-exercise → count(sets)
    selectQueue = [OWNED_EXERCISE, [{ value: 2 }]]

    const result = await removeProgramSet(USER, PID, 0, 0, 9, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('moveProgramSet splices the block and renumbers the moved set (from < to)', async () => {
    // Reads: owned-exercise → set-id-at-from → set-exists-at-to
    selectQueue = [OWNED_EXERCISE, [{ id: 'ps1' }], [{ id: 'ps3' }]]

    const result = await moveProgramSet(USER, PID, 0, 0, 1, 3, 'mcp')

    // Shift (1,3] down by one, then drop the moved set at 3, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_sets',
      'update:program_sets',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[1]!.values).toEqual({ setNumber: 3 })
    expect(result).toEqual({ moved: true })
  })

  it('moveProgramSet returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await moveProgramSet(USER, PID, 0, 0, 1, 2, 'mcp')

    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('supersetGroup + muscle retagging (Phase 5)', () => {
  it('passes supersetGroup through updateProgramExercise (null ungroups)', async () => {
    // Arrange
    selectQueue = [OWNED_EXERCISE]

    // Act
    const result = await updateProgramExercise(USER, PID, 0, 1, { supersetGroup: 2 }, 'mcp')

    // Assert — no wgerExerciseId change → no catalog fetch, no retag writes
    expect(result).toEqual({ id: 'row1' })
    expect(catalogMock).not.toHaveBeenCalled()
    expect(records.map((r) => r.op)).toEqual(['update:program_exercises', 'update:programs', 'insert:program_events'])
    expect(records[0].values).toEqual({ supersetGroup: 2 })
  })

  it('re-derives muscle tags when wgerExerciseId changes', async () => {
    // Arrange — catalog knows the new movement
    catalogMock.mockResolvedValue(
      new Map([['wger:42', { id: 42, name: 'Fly', category: 'Chest', muscles: ['Chest'] }]]),
    )
    selectQueue = [OWNED_EXERCISE]

    // Act
    await updateProgramExercise(USER, PID, 0, 1, { wgerExerciseId: 42 }, 'mcp')

    // Assert — old tags deleted, new tags inserted, then the bump
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'delete:program_exercise_muscles',
      'insert:program_exercise_muscles',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[2].values).toEqual([
      { programExerciseId: 'pe1', muscle: 'Chest', role: 'primary' },
    ])
  })

  it('tags a newly added exercise from the catalog', async () => {
    // Arrange
    catalogMock.mockResolvedValue(
      new Map([['wger:42', { id: 42, name: 'Fly', category: 'Chest', muscles: ['Chest'] }]]),
    )
    selectQueue = [OWNED_DAY, [{ value: null }]]

    // Act
    const result = await addProgramExercise(USER, PID, 0, { wgerExerciseId: 42, name: 'Fly' }, 'mcp')

    // Assert
    expect(result).toEqual({ position: 0 })
    expect(records.map((r) => r.op)).toContain('insert:program_exercise_muscles')
  })

  it('adds a custom exercise with source persisted and tags from the custom catalog side', async () => {
    // Arrange — the merged catalog carries the custom under its composite key
    catalogMock.mockResolvedValue(
      new Map([['custom:42', { id: 42, name: 'Cable Y-Raise', category: 'Shoulders', muscles: ['Shoulders'] }]]),
    )
    selectQueue = [OWNED_DAY, [{ value: null }]]

    // Act
    const result = await addProgramExercise(USER, PID, 0, {
      wgerExerciseId: 42,
      source: 'custom',
      name: 'Cable Y-Raise',
    }, 'mcp')

    // Assert — insert carries source; tags come from the custom entry
    expect(result).toEqual({ position: 0 })
    const exerciseInsert = records.find((r) => r.op === 'insert:program_exercises')
    expect(exerciseInsert?.values).toMatchObject({ wgerExerciseId: 42, source: 'custom' })
    const muscleInsert = records.find((r) => r.op === 'insert:program_exercise_muscles')
    expect(muscleInsert?.values).toEqual([
      { programExerciseId: 'pe-new', muscle: 'Shoulders', role: 'primary' },
    ])
  })

  it('re-derives muscle tags when only source changes (identity is composite)', async () => {
    // Arrange — same integer id on both sides; only the custom entry matches
    catalogMock.mockResolvedValue(
      new Map([['custom:73', { id: 73, name: 'My Bench', category: 'Chest', muscles: ['Chest'] }]]),
    )
    selectQueue = [OWNED_EXERCISE]

    // Act
    await updateProgramExercise(USER, PID, 0, 1, { source: 'custom' }, 'mcp')

    // Assert — a source-only flip is an identity change: retag fires and the
    // effective (custom, stored 73) resolves the custom catalog entry
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'delete:program_exercise_muscles',
      'insert:program_exercise_muscles',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[2].values).toEqual([
      { programExerciseId: 'pe1', muscle: 'Chest', role: 'primary' },
    ])
  })
})

describe('setProgramSetOverride', () => {
  const SET_ROW = [{ id: 'ps1', metricMode: 'reps_weight', repMin: 5, repMax: 12, durationSec: null }]
  const NO_EXISTING: unknown[] = []
  const EXISTING = [
    {
      id: 'ov1',
      repMin: null,
      repMax: null,
      rir: null,
      rpe: null,
      suggestedLoadKg: 90,
      tempo: null,
      durationSec: null,
      distanceM: null,
      technique: null,
    },
  ]

  it('inserts a new override row for the (set, week)', async () => {
    // Arrange — reads: owned-exercise → set row → existing override (none)
    selectQueue = [OWNED_EXERCISE, SET_ROW, NO_EXISTING]

    // Act
    const result = await setProgramSetOverride(USER, PID, 0, 1, 2, 3, { suggestedLoadKg: 95 }, 'mcp')

    // Assert
    expect(result).toEqual({ week: 3, cleared: false })
    expect(records.map((r) => r.op)).toEqual(['insert:program_set_overrides', 'update:programs', 'insert:program_events'])
    expect(records[0].values).toMatchObject({ programSetId: 'ps1', week: 3, suggestedLoadKg: 95 })
  })

  it('merges the patch over an existing override row', async () => {
    // Arrange — existing pins 90; patch adds a rep range, load survives
    selectQueue = [OWNED_EXERCISE, SET_ROW, EXISTING]

    // Act
    const result = await setProgramSetOverride(USER, PID, 0, 1, 2, 3, { repMin: 3, repMax: 5 }, 'mcp')

    // Assert
    expect(result).toEqual({ week: 3, cleared: false })
    expect(records.map((r) => r.op)).toEqual(['update:program_set_overrides', 'update:programs', 'insert:program_events'])
    expect(records[0].values).toMatchObject({ repMin: 3, repMax: 5, suggestedLoadKg: 90 })
  })

  it('deletes the row when the merge clears every field', async () => {
    // Arrange
    selectQueue = [OWNED_EXERCISE, SET_ROW, EXISTING]

    // Act
    const result = await setProgramSetOverride(USER, PID, 0, 1, 2, 3, { suggestedLoadKg: null }, 'mcp')

    // Assert
    expect(result).toEqual({ week: 3, cleared: true })
    expect(records.map((r) => r.op)).toEqual(['delete:program_set_overrides', 'update:programs', 'insert:program_events'])
  })

  it('rejects a merge whose effective row breaks the cross-field rules', async () => {
    // Arrange — base 5-12; overriding repMin above the base repMax inverts the range
    selectQueue = [OWNED_EXERCISE, SET_ROW, NO_EXISTING]

    // Act + Assert
    await expect(
      setProgramSetOverride(USER, PID, 0, 1, 2, 3, { repMin: 20 }, 'mcp'),
    ).rejects.toBeInstanceOf(ProgramPatchError)
  })

  it('returns null for an empty patch without opening reads', async () => {
    expect(await setProgramSetOverride(USER, PID, 0, 1, 2, 3, {}, 'mcp')).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('returns null when the set does not exist at that number', async () => {
    selectQueue = [OWNED_EXERCISE, []]
    expect(await setProgramSetOverride(USER, PID, 0, 1, 9, 3, { rir: 1 }, 'mcp')).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('syncProgramExerciseLoads', () => {
  it('writes each changed load, bumps the program, and logs ONE event for the exercise', async () => {
    // Reads: owned-exercise → current loads for the addressed setNumbers
    selectQueue = [
      OWNED_EXERCISE,
      [
        { setNumber: 1, suggestedLoadKg: 80 },
        { setNumber: 2, suggestedLoadKg: 80 },
      ],
    ]

    const result = await syncProgramExerciseLoads(
      USER,
      PID,
      0,
      1,
      [
        { setNumber: 1, suggestedLoadKg: 120 },
        { setNumber: 2, suggestedLoadKg: 118.5 },
      ],
      'ui',
      'Bench: 80 → 120 kg (synced to performance)',
    )

    expect(result).toEqual({ updated: 2 })
    expect(records.map((r) => r.op)).toEqual([
      'update:program_sets',
      'update:program_sets',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[0]!.values).toEqual({ suggestedLoadKg: 120 })
    expect(records[1]!.values).toEqual({ suggestedLoadKg: 118.5 })
    // The one event carries the per-set before/after audit and the actor.
    expect(records[3]!.values).toMatchObject({
      actor: 'ui',
      action: 'sync_plan_to_performance',
      summary: 'Bench: 80 → 120 kg (synced to performance)',
      payload: {
        dayPosition: 0,
        exercisePosition: 1,
        sets: [
          { setNumber: 1, before: 80, after: 120 },
          { setNumber: 2, before: 80, after: 118.5 },
        ],
      },
    })
  })

  it('returns null and writes nothing when the exercise is not owned', async () => {
    selectQueue = [[]]

    const result = await syncProgramExerciseLoads(
      USER,
      PID,
      0,
      1,
      [{ setNumber: 1, suggestedLoadKg: 120 }],
      'ui',
      'x',
    )

    expect(result).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('skips already-equal values and vanished setNumbers; nothing changed → no bump, no event', async () => {
    // Set 1 already synced, set 3 no longer exists — idempotent no-op.
    selectQueue = [OWNED_EXERCISE, [{ setNumber: 1, suggestedLoadKg: 120 }]]

    const result = await syncProgramExerciseLoads(
      USER,
      PID,
      0,
      1,
      [
        { setNumber: 1, suggestedLoadKg: 120 },
        { setNumber: 3, suggestedLoadKg: 100 },
      ],
      'ui',
      'x',
    )

    expect(result).toEqual({ updated: 0 })
    expect(records).toHaveLength(0)
  })

  it('applies only the sets that actually change alongside equal ones', async () => {
    selectQueue = [
      OWNED_EXERCISE,
      [
        { setNumber: 1, suggestedLoadKg: 120 },
        { setNumber: 2, suggestedLoadKg: 80 },
      ],
    ]

    const result = await syncProgramExerciseLoads(
      USER,
      PID,
      0,
      1,
      [
        { setNumber: 1, suggestedLoadKg: 120 },
        { setNumber: 2, suggestedLoadKg: 120 },
      ],
      'ui',
      'x',
    )

    expect(result).toEqual({ updated: 1 })
    expect(records.map((r) => r.op)).toEqual([
      'update:program_sets',
      'update:programs',
      'insert:program_events',
    ])
  })

  it('returns {updated: 0} for an empty load list without opening reads', async () => {
    expect(await syncProgramExerciseLoads(USER, PID, 0, 1, [], 'ui', 'x')).toEqual({ updated: 0 })
    expect(records).toHaveLength(0)
  })
})

describe('removeProgramSetOverride', () => {
  it('deletes the (set, week) override and bumps the program', async () => {
    // Arrange — reads: owned-exercise → set id; deletedRows feeds returning()
    selectQueue = [OWNED_EXERCISE, [{ id: 'ps1' }]]

    // Act
    const result = await removeProgramSetOverride(USER, PID, 0, 1, 2, 3, 'mcp')

    // Assert
    expect(result).toEqual({ removed: true })
    expect(records.map((r) => r.op)).toEqual(['delete:program_set_overrides', 'update:programs', 'insert:program_events'])
  })

  it('returns null when no override exists for that week', async () => {
    // Arrange
    selectQueue = [OWNED_EXERCISE, [{ id: 'ps1' }]]
    deletedRows = []

    // Act + Assert
    expect(await removeProgramSetOverride(USER, PID, 0, 1, 2, 3, 'mcp')).toBeNull()
  })
})
