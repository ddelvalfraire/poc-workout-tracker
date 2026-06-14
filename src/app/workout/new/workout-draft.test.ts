import { describe, it, expect } from 'vitest'
import {
  workoutDraftReducer,
  draftToInput,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
  type WorkoutDraft,
} from './workout-draft'

const SQUAT = { wgerExerciseId: 73, name: 'Squat', category: 'Legs' }

/** A draft with one exercise and two sets, for nested-update assertions. */
const NESTED: WorkoutDraft = {
  exercises: [
    {
      id: 'ex1',
      ...SQUAT,
      sets: [
        { id: 's1', reps: '5', weight: '100' },
        { id: 's2', reps: '5', weight: '100' },
      ],
    },
  ],
}

describe('workoutDraftReducer', () => {
  it('ADD_EXERCISE appends the provided exercise verbatim', () => {
    // Arrange — the component builds the full exercise (with ids) before dispatch
    const exercise = { id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '', weight: '' }] }

    // Act
    const next = workoutDraftReducer(emptyDraft, { type: 'ADD_EXERCISE', exercise })

    // Assert
    expect(next.exercises).toEqual([exercise])
  })

  it('ADD_SET appends the provided set to the targeted exercise', () => {
    // Arrange
    const set = { id: 's3', reps: '', weight: '' }

    // Act
    const next = workoutDraftReducer(NESTED, { type: 'ADD_SET', exerciseIndex: 0, set })

    // Assert
    expect(next.exercises[0].sets).toHaveLength(3)
    expect(next.exercises[0].sets[2]).toEqual(set)
  })

  it('UPDATE_SET changes only the targeted field and does not mutate prev', () => {
    // Act
    const next = workoutDraftReducer(NESTED, {
      type: 'UPDATE_SET',
      exerciseIndex: 0,
      setIndex: 1,
      field: 'reps',
      value: '8',
    })

    // Assert — target updated, sibling untouched
    expect(next.exercises[0].sets[1]).toEqual({ id: 's2', reps: '8', weight: '100' })
    expect(next.exercises[0].sets[0]).toEqual({ id: 's1', reps: '5', weight: '100' })

    // Assert — immutability by reference
    expect(next).not.toBe(NESTED)
    expect(NESTED.exercises[0].sets[1].reps).toBe('5')
  })

  it('REMOVE_SET drops the targeted set, keeping the rest', () => {
    // Act
    const next = workoutDraftReducer(NESTED, { type: 'REMOVE_SET', exerciseIndex: 0, setIndex: 0 })

    // Assert
    expect(next.exercises[0].sets).toHaveLength(1)
    expect(next.exercises[0].sets[0]).toEqual({ id: 's2', reps: '5', weight: '100' })
  })

  it('REMOVE_EXERCISE drops the targeted exercise', () => {
    // Arrange
    const two: WorkoutDraft = {
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [] },
        { id: 'ex2', wgerExerciseId: 1, name: 'Bench', category: 'Chest', sets: [] },
      ],
    }

    // Act
    const next = workoutDraftReducer(two, { type: 'REMOVE_EXERCISE', index: 0 })

    // Assert
    expect(next.exercises).toHaveLength(1)
    expect(next.exercises[0].name).toBe('Bench')
  })
})

describe('draftToInput', () => {
  it('coerces set strings: blank → null, integers and decimals → numbers', () => {
    // Arrange
    const draft: WorkoutDraft = {
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: [
            { id: 's1', reps: '', weight: '' },
            { id: 's2', reps: '5', weight: '2.5' },
          ],
        },
      ],
    }

    // Act
    const input = draftToInput(draft)

    // Assert — client-only ids are dropped from the server contract
    expect(input.exercises[0].sets).toEqual([
      { reps: null, weight: null },
      { reps: 5, weight: 2.5 },
    ])
  })

  it('keeps a trimmed name and drops a blank one', () => {
    // Act
    const named = draftToInput(emptyDraft, '  Leg Day  ')
    const blank = draftToInput(emptyDraft, '   ')

    // Assert
    expect(named.name).toBe('Leg Day')
    expect(blank).not.toHaveProperty('name')
  })
})

describe('id factories', () => {
  it('newDraftExercise seeds one empty set with distinct stable ids', () => {
    // Act
    const exercise = newDraftExercise(SQUAT)

    // Assert — picked fields preserved, one empty set, ids present and unique
    expect(exercise).toMatchObject({ ...SQUAT, sets: [{ reps: '', weight: '' }] })
    expect(exercise.id).toBeTruthy()
    expect(exercise.sets[0].id).toBeTruthy()
    expect(exercise.sets[0].id).not.toBe(exercise.id)
  })

  it('newDraftSet returns a unique id per call', () => {
    // Assert
    expect(newDraftSet().id).not.toBe(newDraftSet().id)
  })
})
