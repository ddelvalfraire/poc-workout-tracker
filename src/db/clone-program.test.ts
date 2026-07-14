import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for the transactional cloneProgram (mirrors
 * save-program.test.ts). `db.query.programs.findFirst` returns the detail
 * fixture (ownership read); `tx.insert(...).values(v)` records `v` and its
 * `.returning()` resolves one deterministic id PER ROW (batch inserts get a
 * row-per-value array — the sets insert relies on VALUES-order returning for
 * override remapping). Overrides/muscles inserts are awaited without
 * `.returning()` and resolve via the thenable.
 *
 * Returned ids by returning-call order:
 * program → p2 · day Push → dA · Bench → eA · Bench sets → psA1, psA2 ·
 * Cable Fly → eB · its set → psB1 · day Legs → dB · Squat → eC · its set → psC1
 */
const { findFirst, getAllExercises } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getAllExercises: vi.fn(),
}))

const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['p2', 'dA', 'eA', 'psA1', 'psA2', 'eB', 'psB1', 'dB', 'eC', 'psC1']

type Resolve = (value: unknown) => unknown

function makeTx() {
  return {
    insert: () => ({
      values: (v: unknown) => {
        records.push({ values: v })
        return {
          returning: () => {
            const count = Array.isArray(v) ? v.length : 1
            return Promise.resolve(
              Array.from({ length: count }, () => ({ id: ID_SEQUENCE[idCounter++] })),
            )
          },
          // overrides + muscles inserts are awaited without .returning()
          then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
        }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: {
    query: { programs: { findFirst } },
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

vi.mock('@/lib/wger', () => ({ getAllExercises }))

import { cloneProgram } from './programs'

const USER = 'user_123'

/** A base program set row as getProgramDetail returns it (all columns). */
function setRow(over: Record<string, unknown> = {}) {
  return {
    id: 'src-s?',
    programExerciseId: 'src-e?',
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: null,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    overrides: [],
    ...over,
  }
}

/** An override row, all target columns null unless overridden. */
function overrideRow(over: Record<string, unknown> = {}) {
  return {
    id: 'src-o?',
    programSetId: 'src-s?',
    week: 1,
    repMin: null,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...over,
  }
}

/**
 * Maximal fixture: supersets (two exercises sharing group 1), a custom-source
 * exercise, progression + technique JSONB, per-week overrides, muscle tags,
 * and a second day — everything the ProgramInput path is known to drop.
 */
function maximalDetail() {
  return {
    id: 'src1',
    userId: USER,
    name: 'PPL',
    status: 'archived',
    mesocycleWeeks: 6,
    deloadWeek: 4,
    notes: 'block notes',
    days: [
      {
        id: 'src-d1',
        programId: 'src1',
        name: 'Push',
        position: 0,
        notes: null,
        exercises: [
          {
            id: 'src-e1',
            programDayId: 'src-d1',
            wgerExerciseId: 73,
            source: 'wger',
            name: 'Bench',
            position: 0,
            supersetGroup: 1,
            progression: { scheme: 'linear', incrementKg: 2.5 },
            muscles: [
              { id: 'm1', programExerciseId: 'src-e1', muscle: 'Chest', role: 'primary' },
              { id: 'm2', programExerciseId: 'src-e1', muscle: 'Shoulders', role: 'secondary' },
            ],
            sets: [
              setRow({
                id: 'src-s1',
                programExerciseId: 'src-e1',
                setNumber: 1,
                repMin: 8,
                repMax: 12,
                rir: 2,
                suggestedLoadKg: 100,
                tempo: '3-1-1',
                restSec: 120,
                technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 80, reps: 8 }] },
                overrides: [
                  overrideRow({ id: 'o1', programSetId: 'src-s1', week: 4, suggestedLoadKg: 60 }),
                  overrideRow({ id: 'o2', programSetId: 'src-s1', week: 6, rir: 0 }),
                ],
              }),
              setRow({ id: 'src-s2', programExerciseId: 'src-e1', setNumber: 2, repMin: 8, repMax: 12 }),
            ],
          },
          {
            id: 'src-e2',
            programDayId: 'src-d1',
            wgerExerciseId: 5,
            source: 'custom',
            name: 'Cable Fly Custom',
            position: 1,
            supersetGroup: 1,
            progression: null,
            muscles: [],
            sets: [setRow({ id: 'src-s3', programExerciseId: 'src-e2', setNumber: 1, repMin: 12, repMax: 15 })],
          },
        ],
      },
      {
        id: 'src-d2',
        programId: 'src1',
        name: 'Legs',
        position: 1,
        notes: 'legs note',
        exercises: [
          {
            id: 'src-e3',
            programDayId: 'src-d2',
            wgerExerciseId: 9,
            source: 'wger',
            name: 'Squat',
            position: 0,
            supersetGroup: null,
            progression: null,
            muscles: [],
            sets: [setRow({ id: 'src-s4', programExerciseId: 'src-e3', setNumber: 1, suggestedLoadKg: 140 })],
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  records.length = 0
  idCounter = 0
  findFirst.mockResolvedValue(maximalDetail())
  getAllExercises.mockResolvedValue([])
})

describe('cloneProgram (row-for-row fidelity)', () => {
  it('writes the clone as a fresh draft with the derived block name', async () => {
    // Act
    const result = await cloneProgram(USER, 'src1')

    // Assert — meso geometry and notes copied; status draft regardless of
    // the source's; timestamps left to column defaults
    expect(result).toEqual({ id: 'p2' })
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'PPL — Block 2',
      status: 'draft',
      mesocycleWeeks: 6,
      deloadWeek: 4,
      notes: 'block notes',
    })
  })

  it('copies what the ProgramInput path drops: supersets, custom source, overrides', async () => {
    // Act
    await cloneProgram(USER, 'src1')

    // Assert — record order: program(0) · Push(1) · Bench(2) · its sets(3) ·
    // overrides(4) · muscles(5) · Cable Fly(6) · its sets(7) · Legs(8) ·
    // Squat(9) · its sets(10)
    expect(records[2].values).toMatchObject({
      programDayId: 'dA',
      wgerExerciseId: 73,
      source: 'wger',
      supersetGroup: 1,
      progression: { scheme: 'linear', incrementKg: 2.5 },
    })
    expect(records[6].values).toMatchObject({
      programDayId: 'dA',
      source: 'custom',
      supersetGroup: 1,
      progression: null,
    })
    // Overrides remapped to the NEW set id (Bench set 1 → psA1), weeks intact,
    // and no source ids leak through
    expect(records[4].values).toEqual([
      expect.objectContaining({ programSetId: 'psA1', week: 4, suggestedLoadKg: 60 }),
      expect.objectContaining({ programSetId: 'psA1', week: 6, rir: 0 }),
    ])
    // Muscle rows copied verbatim onto the new exercise — no catalog rederive
    expect(records[5].values).toEqual([
      { programExerciseId: 'eA', muscle: 'Chest', role: 'primary' },
      { programExerciseId: 'eA', muscle: 'Shoulders', role: 'secondary' },
    ])
  })

  it('copies every set column and keeps stored setNumber/position values', async () => {
    // Act
    await cloneProgram(USER, 'src1')

    // Assert — Bench's batch carries the full column set, remapped parent id
    const benchSets = records[3].values as Record<string, unknown>[]
    expect(benchSets[0]).toEqual({
      programExerciseId: 'eA',
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: 12,
      rir: 2,
      rpe: null,
      suggestedLoadKg: 100,
      tempo: '3-1-1',
      durationSec: null,
      distanceM: null,
      restSec: 120,
      technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 80, reps: 8 }] },
    })
    expect(benchSets[1]).toMatchObject({ programExerciseId: 'eA', setNumber: 2 })
    // Day and exercise positions come from the SOURCE rows
    expect(records[1].values).toMatchObject({ programId: 'p2', name: 'Push', position: 0, notes: null })
    expect(records[8].values).toMatchObject({ programId: 'p2', name: 'Legs', position: 1, notes: 'legs note' })
    expect(records[9].values).toMatchObject({ programDayId: 'dB', name: 'Squat', position: 0 })
    expect(records[10].values).toEqual([
      expect.objectContaining({ programExerciseId: 'eC', setNumber: 1, suggestedLoadKg: 140 }),
    ])
    // Exactly the expected writes: no empty-array override/muscle inserts
    expect(records).toHaveLength(11)
  })

  it('returns null and inserts nothing when the source is not owned', async () => {
    // Arrange
    findFirst.mockResolvedValue(undefined)

    // Act
    const result = await cloneProgram(USER, 'src1')

    // Assert
    expect(result).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('never touches the wger catalog (offline-safe, tags copied not rederived)', async () => {
    // Act
    await cloneProgram(USER, 'src1')

    // Assert
    expect(getAllExercises).not.toHaveBeenCalled()
  })
})
