import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs in the save-workout.test.ts style: `db.transaction(cb)`
 * runs `cb(tx)`; `tx.insert(...).values(v)` records `v` and resolves to a
 * deterministic id, so the test asserts WHAT got written without a database.
 * The top-level `db.update/delete` chains record their `set`/where payloads
 * and resolve to a configurable returning row (ownership-gate simulation).
 */
const inserted: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['t1', 'te-batch']

let updateRecord: { set: unknown } | null = null
let returningRows: { id: string }[] = [{ id: 't1' }]

function makeTx() {
  return {
    insert: () => ({
      values: (v: unknown) => {
        inserted.push({ values: v })
        const id = ID_SEQUENCE[idCounter++]
        return {
          returning: () => Promise.resolve([{ id }]),
          // Child batch inserts are awaited without .returning()
          then: (resolve: (value: unknown) => unknown) => resolve([{ id }]),
        }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
    update: () => ({
      set: (s: unknown) => {
        updateRecord = { set: s }
        return { where: () => ({ returning: () => Promise.resolve(returningRows) }) }
      },
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve(returningRows) }),
    }),
  },
}))

import {
  createWorkoutTemplate,
  updateWorkoutTemplateMeta,
  deleteWorkoutTemplate,
} from './workout-templates'

const USER = 'user_123'

beforeEach(() => {
  inserted.length = 0
  idCounter = 0
  updateRecord = null
  returningRows = [{ id: 't1' }]
})

describe('createWorkoutTemplate (transactional, user-scoped)', () => {
  it('writes the template row and its exercises in order with correct linkage', async () => {
    // Act
    const result = await createWorkoutTemplate(USER, {
      name: 'Push Day',
      description: 'Chest focus',
      icon: '💪',
      exercises: [
        {
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Bench Press',
          loggingType: 'weight_reps',
          notes: 'touch and go',
          plannedSets: 3,
          repMin: 8,
          repMax: 12,
          restSec: 90,
        },
        { wgerExerciseId: 9, name: 'Row', plannedSets: 2 },
      ],
    })

    // Assert — root row first, then the child batch keyed to its id
    expect(inserted[0].values).toEqual({
      userId: USER,
      name: 'Push Day',
      description: 'Chest focus',
      icon: '💪',
    })
    expect(inserted[1].values).toEqual([
      {
        templateId: 't1',
        wgerExerciseId: 73,
        name: 'Bench Press',
        position: 0,
        source: 'wger',
        loggingType: 'weight_reps',
        notes: 'touch and go',
        plannedSets: 3,
        repMin: 8,
        repMax: 12,
        restSec: 90,
      },
      // Absent optionals omitted so the column defaults apply.
      { templateId: 't1', wgerExerciseId: 9, name: 'Row', position: 1, plannedSets: 2 },
    ])
    expect(result).toEqual({ id: 't1' })
  })

  it('stores null description/icon when the parsed input omitted them', async () => {
    // Act
    await createWorkoutTemplate(USER, {
      name: 'Minimal',
      exercises: [{ wgerExerciseId: 1, name: 'Squat', plannedSets: 1 }],
    })

    // Assert
    expect(inserted[0].values).toEqual({
      userId: USER,
      name: 'Minimal',
      description: null,
      icon: null,
    })
  })
})

describe('updateWorkoutTemplateMeta (ownership-gated)', () => {
  it('full-replaces the metadata, clearing absent optionals to null', async () => {
    // Act
    const result = await updateWorkoutTemplateMeta(USER, 't1', { name: 'Renamed' })

    // Assert
    expect(updateRecord?.set).toEqual({
      name: 'Renamed',
      description: null,
      icon: null,
      updatedAt: expect.any(Date),
    })
    expect(result).toEqual({ id: 't1' })
  })

  it('returns null when the user does not own the template', async () => {
    // Arrange — the update matched no row
    returningRows = []

    // Act + Assert
    expect(await updateWorkoutTemplateMeta(USER, 't1', { name: 'Renamed' })).toBeNull()
  })
})

describe('deleteWorkoutTemplate (ownership-gated)', () => {
  it('resolves the deleted id when owned, and an empty array when not', async () => {
    // Act + Assert — owned
    expect(await deleteWorkoutTemplate(USER, 't1')).toEqual([{ id: 't1' }])

    // Arrange + Act + Assert — not owned
    returningRows = []
    expect(await deleteWorkoutTemplate(USER, 't1')).toEqual([])
  })
})
