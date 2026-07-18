import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseProgramInput } from '@/lib/program-input'

/**
 * Recording stub for the Drizzle insert builder (mirrors save-workout.test.ts).
 * `db.transaction(cb)` runs `cb(tx)`; `tx.insert(table).values(v).returning()`
 * records `v` and resolves a deterministic id row, so the test asserts WHAT got
 * written and in WHAT order without a real database. The sets insert has no
 * `.returning()`, so only program/day/exercise inserts advance the id counter.
 *
 * Returned ids by call order: program → p1, day → d1, exercise → e1, e2, ...
 */
const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['p1', 'd1', 'e1', 'e2', 'd2', 'e3']

function makeTx() {
  return {
    insert: () => ({
      values: (v: unknown) => {
        records.push({ values: v })
        return {
          returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]),
        }
      },
    }),
    // updateProgram's ownership-gated metadata update + child wipe.
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 'p1' }]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

// The wger catalog backs author-time muscle tagging; default = empty catalog
// (no tag inserts) so the pre-Phase-5 write-order assertions stay untouched.
const { getAllExercises } = vi.hoisted(() => ({ getAllExercises: vi.fn() }))
vi.mock('@/lib/wger', () => ({ getAllExercises }))

// The user's customs feed the merged catalog's 'custom:' side.
const { listCustomExercises } = vi.hoisted(() => ({ listCustomExercises: vi.fn() }))
vi.mock('./custom-exercises', () => ({ listCustomExercises }))

import { saveProgram, updateProgram } from './programs'

const USER = 'user_123'

beforeEach(() => {
  records.length = 0
  idCounter = 0
  getAllExercises.mockResolvedValue([])
  listCustomExercises.mockResolvedValue([])
})

describe('saveProgram (transactional, user-scoped)', () => {
  it('writes program → day → exercise → sets in order with correct linkage', async () => {
    // Arrange — one day, one exercise, two sets
    const input = parseProgramInput({
      name: 'PPL',
      days: [
        {
          name: 'Push',
          exercises: [
            {
              wgerExerciseId: 73,
              name: 'Bench',
              sets: [
                { repMin: 8, repMax: 12 },
                { repMin: 8, repMax: 12 },
              ],
            },
          ],
        },
      ],
    })

    // Act
    const result = await saveProgram(USER, input, 'ui')

    // Assert — recorded inserts in call order
    expect(records[0].values).toMatchObject({
      userId: USER,
      name: 'PPL',
      status: 'draft',
      mesocycleWeeks: 1,
    })
    expect(records[1].values).toMatchObject({ programId: 'p1', name: 'Push', position: 0 })
    expect(records[2].values).toMatchObject({
      programDayId: 'd1',
      wgerExerciseId: 73,
      name: 'Bench',
      position: 0,
    })
    expect(records[3].values).toEqual([
      expect.objectContaining({
        programExerciseId: 'e1',
        setNumber: 1,
        setType: 'working',
        metricMode: 'reps_weight',
        repMin: 8,
        repMax: 12,
      }),
      expect.objectContaining({ programExerciseId: 'e1', setNumber: 2 }),
    ])

    // Assert — resolves to the new program id
    expect(result).toEqual({ id: 'p1' })
  })

  it('stamps each exercise with its 0-based position', async () => {
    // Arrange — two exercises in one day
    const input = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Push',
          exercises: [
            { wgerExerciseId: 1, name: 'Bench', sets: [{}] },
            { wgerExerciseId: 2, name: 'Fly', sets: [{}] },
          ],
        },
      ],
    })

    // Act
    await saveProgram(USER, input, 'ui')

    // Assert — records: program(0), day(1), ex1(2), sets1(3), ex2(4), sets2(5)
    expect(records[2].values).toMatchObject({ position: 0, wgerExerciseId: 1 })
    expect(records[4].values).toMatchObject({ position: 1, wgerExerciseId: 2 })
  })

  it('passes typed targets, progression, and technique through to the insert', async () => {
    // Arrange
    const input = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Arms',
          exercises: [
            {
              wgerExerciseId: 1,
              name: 'Curl',
              progression: { scheme: 'linear', incrementKg: 2.5 },
              sets: [
                {
                  suggestedLoadKg: 30,
                  restSec: 45,
                  technique: { kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] },
                },
              ],
            },
          ],
        },
      ],
    })

    // Act
    await saveProgram(USER, input, 'ui')

    // Assert — progression on the exercise, typed target + technique on the set
    expect(records[2].values).toMatchObject({ progression: { scheme: 'linear', incrementKg: 2.5 } })
    expect((records[3].values as unknown[])[0]).toMatchObject({
      suggestedLoadKg: 30,
      restSec: 45, // between-set rest persists as its own column, not JSONB
      technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] },
    })
  })

  it('persists source and supersetGroup on each exercise (full replace must not wipe them)', async () => {
    // Arrange — a custom slot supersetted with a wger slot
    const input = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Upper',
          exercises: [
            { wgerExerciseId: 9, source: 'custom', name: 'Cable Face Pull', supersetGroup: 1, sets: [{}] },
            { wgerExerciseId: 2, name: 'Row', supersetGroup: 1, sets: [{}] },
          ],
        },
      ],
    })

    // Act
    await saveProgram(USER, input, 'ui')

    // Assert — identity + grouping land on the insert; absent source defaults to wger
    expect(records[2].values).toMatchObject({
      wgerExerciseId: 9,
      source: 'custom',
      supersetGroup: 1,
    })
    expect(records[4].values).toMatchObject({
      wgerExerciseId: 2,
      source: 'wger',
      supersetGroup: 1,
    })
  })

  it('updateProgram (full replace) re-inserts children with source and supersetGroup intact', async () => {
    // Arrange — the id-present replace branch shares insertProgramChildren,
    // but pin it directly: a replace must never reset customs or ungroup.
    const input = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Upper',
          exercises: [
            { wgerExerciseId: 9, source: 'custom', name: 'Cable Face Pull', supersetGroup: 1, sets: [{}] },
          ],
        },
      ],
    })

    // Act
    const result = await updateProgram(USER, 'p1', input, 'ui')

    // Assert — day insert first, then the exercise carrying both fields
    expect(result).toEqual({ id: 'p1' })
    const exerciseInsert = records.find(
      (r) => (r.values as { wgerExerciseId?: number }).wgerExerciseId !== undefined,
    )
    expect(exerciseInsert?.values).toMatchObject({
      wgerExerciseId: 9,
      source: 'custom',
      supersetGroup: 1,
    })
  })
})

describe('saveProgram muscle tagging (Phase 5)', () => {
  const INPUT = parseProgramInput({
    name: 'PPL',
    days: [
      { name: 'Push', exercises: [{ wgerExerciseId: 73, name: 'Bench', sets: [{}] }] },
    ],
  })

  it('tags each exercise from the wger catalog (primary + secondary roles)', async () => {
    // Arrange
    getAllExercises.mockResolvedValue([
      {
        id: 73,
        name: 'Bench Press',
        category: 'Chest',
        muscles: ['Chest'],
        musclesSecondary: ['Shoulders', 'Chest'], // duplicate collapses into primary
      },
    ])

    // Act
    await saveProgram(USER, INPUT, 'ui')

    // Assert — muscle rows recorded after the exercise's sets
    expect(records[4].values).toEqual([
      { programExerciseId: 'e1', muscle: 'Chest', role: 'primary' },
      { programExerciseId: 'e1', muscle: 'Shoulders', role: 'secondary' },
    ])
  })

  it('saves untagged when the exercise is not in the catalog', async () => {
    // Arrange — catalog loaded but this id is unknown
    getAllExercises.mockResolvedValue([{ id: 999, name: 'Other', category: 'Legs' }])

    // Act
    await saveProgram(USER, INPUT, 'ui')

    // Assert — program, day, exercise, sets, change-log event: no muscle insert
    expect(records).toHaveLength(5)
  })

  it('saves untagged (not failing) when the catalog fetch throws', async () => {
    // Arrange
    getAllExercises.mockRejectedValue(new Error('wger down'))
    listCustomExercises.mockRejectedValue(new Error('db down'))

    // Act
    const result = await saveProgram(USER, INPUT, 'ui')

    // Assert
    expect(result).toEqual({ id: 'p1' })
    expect(records).toHaveLength(5)
  })

  const CUSTOM_INPUT = parseProgramInput({
    name: 'P',
    days: [
      {
        name: 'Upper',
        exercises: [{ wgerExerciseId: 73, source: 'custom', name: 'Face Pull', sets: [{}] }],
      },
    ],
  })

  it('tags a custom slot from the custom exercise muscle arrays', async () => {
    // Arrange — a wger exercise shares the integer id; the custom entry must win
    getAllExercises.mockResolvedValue([{ id: 73, name: 'Bench', category: 'Chest', muscles: ['Chest'] }])
    listCustomExercises.mockResolvedValue([
      {
        id: 73,
        name: 'Face Pull',
        category: 'Shoulders',
        muscles: ['Shoulders'],
        musclesSecondary: ['Upper Back'],
        equipment: null,
      },
    ])

    // Act
    await saveProgram(USER, CUSTOM_INPUT, 'ui')

    // Assert — composite lookup resolves the custom, not the colliding wger row
    expect(records[4].values).toEqual([
      { programExerciseId: 'e1', muscle: 'Shoulders', role: 'primary' },
      { programExerciseId: 'e1', muscle: 'Upper Back', role: 'secondary' },
    ])
  })

  it('still tags custom slots when the wger fetch fails (per-source degrade)', async () => {
    // Arrange
    getAllExercises.mockRejectedValue(new Error('wger down'))
    listCustomExercises.mockResolvedValue([
      { id: 73, name: 'Face Pull', category: 'Shoulders', muscles: ['Shoulders'], musclesSecondary: null, equipment: null },
    ])

    // Act
    const result = await saveProgram(USER, CUSTOM_INPUT, 'ui')

    // Assert
    expect(result).toEqual({ id: 'p1' })
    expect(records[4].values).toEqual([
      { programExerciseId: 'e1', muscle: 'Shoulders', role: 'primary' },
    ])
  })
})
