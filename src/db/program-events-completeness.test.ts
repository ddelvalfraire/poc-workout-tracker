import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * The PRD's coverage metric, executable: EVERY mutating export of
 * program-patches.ts writes exactly one `program_events` row inside its
 * transaction. Two halves keep it honest:
 *  1. the invocation map below must cover the module's full mutating export
 *     list (a new export without a registered happy path fails the test), and
 *  2. each invocation must record exactly one event insert.
 * The chain-recording stub is the program-patches.test.ts idiom, trimmed to
 * what the happy paths need.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []

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

function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve([{ id: 'row1' }]).then(resolve) }),
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain(table: unknown) {
  const name = getTableName(table as Table)
  records.push({ op: `delete:${name}` })
  const obj = {
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve([{ id: 'del1' }]).then(resolve) }),
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
        returning: () => ({ then: (resolve: Resolve) => Promise.resolve([{ id: 'new1' }]).then(resolve) }),
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

// No network in tests: the catalog fetch behind muscle tagging resolves empty.
const { catalogMock } = vi.hoisted(() => ({ catalogMock: vi.fn() }))
vi.mock('./programs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./programs')>()),
  loadExerciseCatalog: catalogMock,
}))

import * as patches from './program-patches'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'
const OWNED_PROGRAM = [{ id: PID }]
const OWNED_DAY = [{ id: 'pd1' }]
const OWNED_EXERCISE = [
  { exerciseId: 'pe1', dayId: 'pd1', wgerExerciseId: 73, source: 'wger', name: 'Bench' },
]
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
  restSec: null,
  technique: null,
}
const OVERRIDE_SET_ROW = [
  { id: 'ps1', metricMode: 'reps_weight', repMin: 5, repMax: 12, durationSec: null },
]

/** One committing happy path per mutating export: the read queue it needs
 *  plus the call itself. Keys are asserted against the module's exports. */
const INVOCATIONS: Record<string, { selects: unknown[][]; run: () => Promise<unknown> }> = {
  setProgramAutoregulation: {
    selects: [OWNED_PROGRAM],
    run: () => patches.setProgramAutoregulation(USER, PID, false, 'mcp'),
  },
  addProgramDay: {
    selects: [OWNED_PROGRAM, [{ value: 0 }]],
    run: () => patches.addProgramDay(USER, PID, { name: 'Pull' }, 'mcp'),
  },
  updateProgramDay: {
    selects: [OWNED_DAY],
    run: () => patches.updateProgramDay(USER, PID, 0, { name: 'Legs' }, 'mcp'),
  },
  removeProgramDay: {
    selects: [OWNED_DAY],
    run: () => patches.removeProgramDay(USER, PID, 0, 'mcp'),
  },
  moveProgramDay: {
    selects: [OWNED_DAY, [{ id: 'pd2' }]],
    run: () => patches.moveProgramDay(USER, PID, 0, 1, 'mcp'),
  },
  addProgramExercise: {
    selects: [OWNED_DAY, [{ value: null }]],
    run: () => patches.addProgramExercise(USER, PID, 0, { wgerExerciseId: 73, name: 'Bench' }, 'mcp'),
  },
  updateProgramExercise: {
    selects: [OWNED_EXERCISE],
    run: () => patches.updateProgramExercise(USER, PID, 0, 0, { name: 'Larsen Press' }, 'mcp'),
  },
  removeProgramExercise: {
    selects: [OWNED_EXERCISE],
    run: () => patches.removeProgramExercise(USER, PID, 0, 0, 'mcp'),
  },
  moveProgramExercise: {
    selects: [OWNED_EXERCISE, [{ id: 'pe2' }]],
    run: () => patches.moveProgramExercise(USER, PID, 0, 0, 1, 'mcp'),
  },
  addProgramSet: {
    selects: [OWNED_EXERCISE, [{ value: 1 }]],
    run: () => patches.addProgramSet(USER, PID, 0, 0, { repMin: 5 }, 'mcp'),
  },
  updateProgramSet: {
    selects: [OWNED_EXERCISE, [CURRENT_SET]],
    run: () => patches.updateProgramSet(USER, PID, 0, 0, 1, { repMin: 6 }, 'mcp'),
  },
  removeProgramSet: {
    selects: [OWNED_EXERCISE, [{ value: 2 }]],
    run: () => patches.removeProgramSet(USER, PID, 0, 0, 1, 'mcp'),
  },
  moveProgramSet: {
    selects: [OWNED_EXERCISE, [{ id: 'ps1' }], [{ id: 'ps2' }]],
    run: () => patches.moveProgramSet(USER, PID, 0, 0, 1, 2, 'mcp'),
  },
  setProgramSetOverride: {
    selects: [OWNED_EXERCISE, OVERRIDE_SET_ROW, []],
    run: () => patches.setProgramSetOverride(USER, PID, 0, 0, 1, 2, { rir: 1 }, 'mcp'),
  },
  removeProgramSetOverride: {
    selects: [OWNED_EXERCISE, [{ id: 'ps1' }]],
    run: () => patches.removeProgramSetOverride(USER, PID, 0, 0, 1, 2, 'mcp'),
  },
}

beforeEach(() => {
  catalogMock.mockReset()
  catalogMock.mockResolvedValue(null)
  records.length = 0
  selectQueue = []
})

describe('program change log completeness (program-patches.ts)', () => {
  it('the invocation map covers every mutating export — a new op must be registered here', () => {
    // Arrange — every exported function except the error class is a mutator.
    const mutatingExports = Object.entries(patches)
      .filter(([name, value]) => typeof value === 'function' && name !== 'ProgramPatchError')
      .map(([name]) => name)
      .sort()

    // Assert
    expect(Object.keys(INVOCATIONS).sort()).toEqual(mutatingExports)
  })

  it.each(Object.entries(INVOCATIONS))(
    '%s writes exactly one actor-stamped event inside its transaction',
    async (_name, { selects, run }) => {
      // Arrange
      selectQueue = selects.map((rows) => [...rows])

      // Act
      const result = await run()

      // Assert — the op committed and logged once, with the threaded actor.
      expect(result).not.toBeNull()
      const events = records.filter((r) => r.op === 'insert:program_events')
      expect(events).toHaveLength(1)
      const values = events[0]!.values as {
        programId: string
        userId: string
        actor: string
        action: string
        summary: string
      }
      expect(values).toMatchObject({ programId: PID, userId: USER, actor: 'mcp' })
      expect(values.action.length).toBeGreaterThan(0)
      expect(values.summary.length).toBeGreaterThan(0)
    },
  )
})
