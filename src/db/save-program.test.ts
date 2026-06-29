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
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import { saveProgram } from './programs'

const USER = 'user_123'

beforeEach(() => {
  records.length = 0
  idCounter = 0
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
    const result = await saveProgram(USER, input)

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
    await saveProgram(USER, input)

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
                  technique: { kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] },
                },
              ],
            },
          ],
        },
      ],
    })

    // Act
    await saveProgram(USER, input)

    // Assert — progression on the exercise, typed target + technique on the set
    expect(records[2].values).toMatchObject({ progression: { scheme: 'linear', incrementKg: 2.5 } })
    expect((records[3].values as unknown[])[0]).toMatchObject({
      suggestedLoadKg: 30,
      technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] },
    })
  })
})
