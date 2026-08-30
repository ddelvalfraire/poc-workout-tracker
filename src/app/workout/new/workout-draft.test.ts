import { describe, it, expect } from 'vitest'
import {
  workoutDraftReducer,
  completeFilledSets,
  draftToInput,
  detailToDraft,
  emptyDraft,
  isMissingRequiredMetric,
  isMissingRequiredWeight,
  newDraftExercise,
  newDraftSet,
  replacementDraftExercise,
  resolveTargetSetIndex,
  setDisplayNumber,
  type DraftSet,
  type WorkoutDraft,
} from './workout-draft'
import type { WorkoutDetail } from '@/db/workouts'
import { parseWorkoutInput } from '@/lib/workout-input'

const SQUAT = {
  wgerExerciseId: 73,
  source: 'wger' as const,
  name: 'Squat',
  category: 'Legs',
  loggingType: 'weight_reps' as const,
  notes: '',
  skipped: false,
}

/** A draft with one exercise and two sets, for nested-update assertions. */
const NESTED: WorkoutDraft = { notes: '',
  exercises: [
    {
      id: 'ex1',
      ...SQUAT,
      sets: [
        { id: 's1', reps: '5', weight: '100', completed: false, tag: 'working' as const },
        { id: 's2', reps: '5', weight: '100', completed: false, tag: 'working' as const },
      ],
    },
  ],
}

describe('workoutDraftReducer', () => {
  it('ADD_EXERCISE appends the provided exercise verbatim', () => {
    // Arrange — the component builds the full exercise (with ids) before dispatch
    const exercise = { id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '', weight: '', completed: false, tag: 'working' as const }] }

    // Act
    const next = workoutDraftReducer(emptyDraft, { type: 'ADD_EXERCISE', exercise })

    // Assert
    expect(next.exercises).toEqual([exercise])
  })

  it('ADD_SET appends the provided set to the targeted exercise', () => {
    // Arrange
    const set = { id: 's3', reps: '', weight: '', completed: false, tag: 'working' as const }

    // Act
    const next = workoutDraftReducer(NESTED, { type: 'ADD_SET', exerciseIndex: 0, set })

    // Assert
    expect(next.exercises[0].sets).toHaveLength(3)
    expect(next.exercises[0].sets[2]).toEqual(set)
  })

  it('REPLACE_EXERCISE replaces the exercise at index verbatim, keeping siblings', () => {
    // Arrange — two exercises; the component builds the replacement (with ids)
    const two: WorkoutDraft = { notes: '',
      exercises: [
        NESTED.exercises[0],
        {
          id: 'ex2',
          wgerExerciseId: 9,
          source: 'wger',
          name: 'Bench',
          category: 'Chest',
          loggingType: 'weight_reps',
          notes: '',
          skipped: false,
          sets: [{ id: 's3', reps: '', weight: '', completed: false, tag: 'working' as const }],
        },
      ],
    }
    const replacement = {
      id: 'ex-new',
      wgerExerciseId: 42,
      source: 'wger' as const,
      name: 'Leg Press',
      category: 'Legs',
      loggingType: 'weight_reps' as const,
      notes: '',
      skipped: false,
      sets: [{ id: 's-new', reps: '', weight: '', completed: false, tag: 'working' as const }],
    }

    // Act
    const next = workoutDraftReducer(two, { type: 'REPLACE_EXERCISE', index: 0, exercise: replacement })

    // Assert — swapped in place, sibling untouched, prev unmutated
    expect(next.exercises[0]).toEqual(replacement)
    expect(next.exercises[1]).toEqual(two.exercises[1])
    expect(next).not.toBe(two)
    expect(two.exercises[0].name).toBe('Squat')
  })

  it('REPLACE_EXERCISE past the end is a no-op', () => {
    // Act — stale index (list shifted before the dispatch landed)
    const next = workoutDraftReducer(NESTED, {
      type: 'REPLACE_EXERCISE',
      index: 5,
      exercise: newDraftExercise({ wgerExerciseId: 42, name: 'Leg Press', category: 'Legs' }),
    })

    // Assert — same state reference back
    expect(next).toBe(NESTED)
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
    expect(next.exercises[0].sets[1]).toEqual({ id: 's2', reps: '8', weight: '100', completed: false, tag: 'working' as const })
    expect(next.exercises[0].sets[0]).toEqual({ id: 's1', reps: '5', weight: '100', completed: false, tag: 'working' as const })

    // Assert — immutability by reference
    expect(next).not.toBe(NESTED)
    expect(NESTED.exercises[0].sets[1].reps).toBe('5')
  })

  it('REMOVE_SET drops the targeted set, keeping the rest', () => {
    // Act
    const next = workoutDraftReducer(NESTED, { type: 'REMOVE_SET', exerciseIndex: 0, setIndex: 0 })

    // Assert
    expect(next.exercises[0].sets).toHaveLength(1)
    expect(next.exercises[0].sets[0]).toEqual({ id: 's2', reps: '5', weight: '100', completed: false, tag: 'working' as const })
  })

  it('TAG_SET retags only the targeted set and does not mutate prev', () => {
    // Act — tag set 2 as a warm-up
    const next = workoutDraftReducer(NESTED, { type: 'TAG_SET', exerciseIndex: 0, setIndex: 1, tag: 'warmup' })

    // Assert — values and completion survive; only the tag changes
    expect(next.exercises[0].sets[0].tag).toBe('working')
    expect(next.exercises[0].sets[1]).toEqual({ id: 's2', reps: '5', weight: '100', completed: false, tag: 'warmup' })
    expect(NESTED.exercises[0].sets[1].tag).toBe('working')
  })

  it('TAG_SET back to working undoes the warm-up tag', () => {
    // Arrange
    const tagged = workoutDraftReducer(NESTED, { type: 'TAG_SET', exerciseIndex: 0, setIndex: 0, tag: 'warmup' })

    // Act
    const next = workoutDraftReducer(tagged, { type: 'TAG_SET', exerciseIndex: 0, setIndex: 0, tag: 'working' })

    // Assert
    expect(next.exercises[0].sets[0].tag).toBe('working')
  })

  it('TOGGLE_SET_COMPLETED flips only the targeted set and does not mutate prev', () => {
    // Act — check off set 2
    const next = workoutDraftReducer(NESTED, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 1,
    })

    // Assert — target flipped, sibling untouched, prev unmutated
    expect(next.exercises[0].sets[1].completed).toBe(true)
    expect(next.exercises[0].sets[0].completed).toBe(false)
    expect(NESTED.exercises[0].sets[1].completed).toBe(false)

    // Act — toggling again unchecks
    const back = workoutDraftReducer(next, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 1,
    })

    // Assert
    expect(back.exercises[0].sets[1].completed).toBe(false)
  })

  it('SET_LOGGING_TYPE switches the targeted exercise and clears its typed weights', () => {
    // Act
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_LOGGING_TYPE',
      exerciseIndex: 0,
      loggingType: 'weighted_bodyweight',
    })

    // Assert — type switched; weights cleared (a number typed as total load
    // must not be silently re-read as added/assisted load); reps and
    // completion kept; prev unmutated
    expect(next.exercises[0].loggingType).toBe('weighted_bodyweight')
    for (const [i, set] of next.exercises[0].sets.entries()) {
      expect(set.weight).toBe('')
      expect(set.reps).toBe(NESTED.exercises[0].sets[i].reps)
      expect(set.completed).toBe(NESTED.exercises[0].sets[i].completed)
    }
    expect(NESTED.exercises[0].loggingType).toBe('weight_reps')
  })

  it('SET_LOGGING_TYPE leaves other exercises untouched', () => {
    // Act
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_LOGGING_TYPE',
      exerciseIndex: 0,
      loggingType: 'bodyweight_reps',
    })

    // Assert
    expect(next.exercises.slice(1)).toEqual(NESTED.exercises.slice(1))
  })

  it('RESTORE_DRAFT replaces the whole state with the provided draft', () => {
    // Act
    const next = workoutDraftReducer(emptyDraft, { type: 'RESTORE_DRAFT', draft: NESTED })

    // Assert
    expect(next).toBe(NESTED)
  })

  it('REMOVE_EXERCISE drops the targeted exercise', () => {
    // Arrange
    const two: WorkoutDraft = { notes: '',
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [] },
        { id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', notes: '', skipped: false, sets: [] },
      ],
    }

    // Act
    const next = workoutDraftReducer(two, { type: 'REMOVE_EXERCISE', index: 0 })

    // Assert
    expect(next.exercises).toHaveLength(1)
    expect(next.exercises[0].name).toBe('Bench')
  })

  it('INSERT_EXERCISE restores an exercise at its original position (undo)', () => {
    // Arrange — ex1 was just removed from position 0
    const removed = { id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' as const }] }
    const after: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', notes: '', skipped: false, sets: [] }],
    }

    // Act
    const next = workoutDraftReducer(after, { type: 'INSERT_EXERCISE', index: 0, exercise: removed })

    // Assert — back at position 0, sets intact, prev unmutated
    expect(next.exercises.map((e) => e.name)).toEqual(['Squat', 'Bench'])
    expect(next.exercises[0].sets[0].completed).toBe(true)
    expect(after.exercises).toHaveLength(1)
  })

  it('INSERT_EXERCISE keeps the numeric index when the list grew meanwhile', () => {
    // Arrange — removed from position 0, then two exercises were added
    const removed = { id: 'ex1', ...SQUAT, sets: [] }
    const grown: WorkoutDraft = { notes: '',
      exercises: [
        { id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', notes: '', skipped: false, sets: [] },
        { id: 'ex3', wgerExerciseId: 2, source: 'wger', name: 'Row', category: 'Back', loggingType: 'weight_reps', notes: '', skipped: false, sets: [] },
      ],
    }

    // Act
    const next = workoutDraftReducer(grown, { type: 'INSERT_EXERCISE', index: 0, exercise: removed })

    // Assert — original numeric position, later arrivals shift down (documented tradeoff)
    expect(next.exercises.map((e) => e.name)).toEqual(['Squat', 'Bench', 'Row'])
  })

  it('INSERT_EXERCISE clamps an out-of-range index to the end', () => {
    // Arrange — the list shrank below the original index while the undo was pending
    const removed = { id: 'ex1', ...SQUAT, sets: [] }

    // Act
    const next = workoutDraftReducer(emptyDraft, { type: 'INSERT_EXERCISE', index: 3, exercise: removed })

    // Assert
    expect(next.exercises).toEqual([removed])
  })

  it('INSERT_SET restores a set at its original position (undo)', () => {
    // Arrange — s1 was just removed from position 0
    const removedSet = { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' as const }
    const after: WorkoutDraft = { notes: '',
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [{ id: 's2', reps: '5', weight: '100', completed: false, tag: 'working' as const }] },
      ],
    }

    // Act
    const next = workoutDraftReducer(after, {
      type: 'INSERT_SET',
      exerciseIndex: 0,
      setIndex: 0,
      set: removedSet,
    })

    // Assert — back at position 0, sibling intact, prev unmutated
    expect(next.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(next.exercises[0].sets[0].completed).toBe(true)
    expect(after.exercises[0].sets).toHaveLength(1)
  })

  it('INSERT_SET clamps an out-of-range set index to the end', () => {
    // Arrange — the exercise's set list shrank below the original index
    const removedSet = { id: 's9', reps: '8', weight: '60', completed: false, tag: 'working' as const }

    // Act
    const next = workoutDraftReducer(NESTED, {
      type: 'INSERT_SET',
      exerciseIndex: 0,
      setIndex: 7,
      set: removedSet,
    })

    // Assert
    expect(next.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2', 's9'])
  })

  it('INSERT_SET is a no-op when the exercise is gone', () => {
    // Arrange — the whole exercise was removed while the set undo was pending
    const removedSet = { id: 's9', reps: '8', weight: '60', completed: false, tag: 'working' as const }

    // Act
    const next = workoutDraftReducer(emptyDraft, {
      type: 'INSERT_SET',
      exerciseIndex: 0,
      setIndex: 0,
      set: removedSet,
    })

    // Assert — nothing to restore into; state unchanged
    expect(next).toEqual(emptyDraft)
  })

  it('TOGGLE_SET_COMPLETED adopts fill values for empty fields when checking off', () => {
    // Arrange — an untouched set with ghost values available
    const blank: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '', weight: '', completed: false, tag: 'working' as const }] }],
    }

    // Act — tap-to-accept: complete the set with the ghost's values
    const next = workoutDraftReducer(blank, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8', weight: '100' },
    })

    // Assert
    expect(next.exercises[0].sets[0]).toEqual({ id: 's1', reps: '8', weight: '100', completed: true, tag: 'working' as const })
  })

  it('TOGGLE_SET_COMPLETED fill never overwrites typed values', () => {
    // Arrange — reps typed, weight empty
    const partial: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '6', weight: '', completed: false, tag: 'working' as const }] }],
    }

    // Act
    const next = workoutDraftReducer(partial, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8', weight: '100' },
    })

    // Assert — typed reps kept, empty weight adopted
    expect(next.exercises[0].sets[0]).toEqual({ id: 's1', reps: '6', weight: '100', completed: true, tag: 'working' as const })
  })

  it('TOGGLE_SET_COMPLETED ignores fill when unchecking', () => {
    // Arrange — a completed set being unchecked must not have values injected
    const done: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '', weight: '', completed: true, tag: 'working' as const }] }],
    }

    // Act
    const next = workoutDraftReducer(done, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8', weight: '100' },
    })

    // Assert
    expect(next.exercises[0].sets[0]).toEqual({ id: 's1', reps: '', weight: '', completed: false, tag: 'working' as const })
  })

  it('TOGGLE_SET_COMPLETED refuses to check off a weight_reps set with no weight', () => {
    // Arrange — reps typed but no weight, and no ghost weight to adopt
    const partial: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '6', weight: '', completed: false, tag: 'working' as const }] }],
    }

    // Act — fill offers reps only (no history for this movement)
    const next = workoutDraftReducer(partial, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8' },
    })

    // Assert — untouched: no completion, no partial fill
    expect(next.exercises[0].sets[0]).toEqual(partial.exercises[0].sets[0])
  })

  it('TOGGLE_SET_COMPLETED checks off a bodyweight set without weight', () => {
    // Arrange — blank weight is the normal reading for bodyweight_reps
    const bw: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, loggingType: 'bodyweight_reps' as const, sets: [{ id: 's1', reps: '12', weight: '', completed: false, tag: 'working' as const }] }],
    }

    // Act
    const next = workoutDraftReducer(bw, { type: 'TOGGLE_SET_COMPLETED', exerciseIndex: 0, setIndex: 0 })

    // Assert
    expect(next.exercises[0].sets[0].completed).toBe(true)
  })

  it('TOGGLE_SET_COMPLETED still unchecks a weight_reps set that has no weight', () => {
    // Arrange — a legacy/bad row (completed, no weight) must stay correctable
    const done: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '12', weight: '', completed: true, tag: 'working' as const }] }],
    }

    // Act
    const next = workoutDraftReducer(done, { type: 'TOGGLE_SET_COMPLETED', exerciseIndex: 0, setIndex: 0 })

    // Assert
    expect(next.exercises[0].sets[0].completed).toBe(false)
  })
})

describe('isMissingRequiredWeight', () => {
  const exerciseWith = (weight: string, loggingType = 'weight_reps' as const) => ({
    id: 'ex1',
    ...SQUAT,
    loggingType,
    sets: [{ id: 's1', reps: '5', weight, completed: false, tag: 'working' as const }],
  })

  it('flags a weight_reps set with blank weight and no adoptable fill', () => {
    expect(isMissingRequiredWeight(exerciseWith(''), 0)).toBe(true)
    expect(isMissingRequiredWeight(exerciseWith(''), 0, { reps: '8' })).toBe(true)
  })

  it('passes when weight is typed, adoptable from fill, or an explicit 0 (empty bar)', () => {
    expect(isMissingRequiredWeight(exerciseWith('100'), 0)).toBe(false)
    expect(isMissingRequiredWeight(exerciseWith(''), 0, { weight: '100' })).toBe(false)
    expect(isMissingRequiredWeight(exerciseWith('0'), 0)).toBe(false)
  })

  it('flags unparseable weight but never bodyweight modes or missing sets', () => {
    expect(isMissingRequiredWeight(exerciseWith('abc'), 0)).toBe(true)
    expect(isMissingRequiredWeight(exerciseWith('', 'bodyweight_reps' as never), 0)).toBe(false)
    expect(isMissingRequiredWeight(exerciseWith(''), 5)).toBe(false)
  })
})

describe('notes and skip actions', () => {
  it('SET_WORKOUT_NOTES replaces the workout note and does not mutate prev', () => {
    // Act
    const next = workoutDraftReducer(NESTED, { type: 'SET_WORKOUT_NOTES', value: 'cut short' })

    // Assert — exercises untouched, prev unmutated
    expect(next.notes).toBe('cut short')
    expect(next.exercises).toBe(NESTED.exercises)
    expect(NESTED.notes).toBe('')
  })

  it('SET_EXERCISE_NOTES targets one exercise and does not mutate prev', () => {
    // Act
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_EXERCISE_NOTES',
      exerciseIndex: 0,
      value: 'belt on top set',
    })

    // Assert — sets untouched, prev unmutated
    expect(next.exercises[0].notes).toBe('belt on top set')
    expect(next.exercises[0].sets).toBe(NESTED.exercises[0].sets)
    expect(NESTED.exercises[0].notes).toBe('')
  })

  it('TOGGLE_SKIP_EXERCISE flips the flag without touching sets, and back', () => {
    // Act — skip
    const skipped = workoutDraftReducer(NESTED, { type: 'TOGGLE_SKIP_EXERCISE', exerciseIndex: 0 })

    // Assert — sets stay exactly as logged (uncompleted); prev unmutated
    expect(skipped.exercises[0].skipped).toBe(true)
    expect(skipped.exercises[0].sets).toEqual(NESTED.exercises[0].sets)
    expect(NESTED.exercises[0].skipped).toBe(false)

    // Act — unskip
    const back = workoutDraftReducer(skipped, { type: 'TOGGLE_SKIP_EXERCISE', exerciseIndex: 0 })

    // Assert
    expect(back.exercises[0].skipped).toBe(false)
  })

  it('other actions preserve the workout note (state spread, not rebuild)', () => {
    // Arrange
    const noted = workoutDraftReducer(NESTED, { type: 'SET_WORKOUT_NOTES', value: 'keep me' })

    // Act — a set-level edit must not drop the top-level note
    const next = workoutDraftReducer(noted, {
      type: 'UPDATE_SET',
      exerciseIndex: 0,
      setIndex: 0,
      field: 'reps',
      value: '8',
    })

    // Assert
    expect(next.notes).toBe('keep me')
  })
})

describe('replacementDraftExercise', () => {
  const PICKED = { wgerExerciseId: 42, name: 'Leg Press', category: 'Legs' }

  it('keeps the set count with fresh empty sets and unique ids', () => {
    // Act
    const result = replacementDraftExercise(PICKED, 3)

    // Assert — the scheme survives, the values don't
    expect(result.sets).toHaveLength(3)
    for (const set of result.sets) {
      expect(set).toMatchObject({ reps: '', weight: '', completed: false, tag: 'working' as const })
    }
    expect(new Set(result.sets.map((s) => s.id)).size).toBe(3)
  })

  it('floors at one set (same seeded-with-one invariant as newDraftExercise)', () => {
    expect(replacementDraftExercise(PICKED, 0).sets).toHaveLength(1)
  })

  it('carries the picked identity with the default loggingType and a new id', () => {
    // Act
    const result = replacementDraftExercise(PICKED, 2)

    // Assert — old movement's BW/assist reading must not stick to the substitute
    expect(result).toMatchObject({ ...PICKED, loggingType: 'weight_reps' })
    expect(typeof result.id).toBe('string')
    expect(result.id.length).toBeGreaterThan(0)
  })
})

describe('draftToInput', () => {
  it('coerces set strings: blank → null, integers and decimals → numbers', () => {
    // Arrange
    const draft: WorkoutDraft = { notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: [
            { id: 's1', reps: '', weight: '', completed: false, tag: 'working' as const },
            { id: 's2', reps: '5', weight: '2.5', completed: false, tag: 'working' as const },
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

  it('includes completed: true only for checked-off sets', () => {
    // Arrange — one checked, one unchecked
    const draft: WorkoutDraft = { notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: [
            { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' as const },
            { id: 's2', reps: '5', weight: '100', completed: false, tag: 'working' as const },
          ],
        },
      ],
    }

    // Act
    const input = draftToInput(draft)

    // Assert — unchecked sets omit the key entirely (minimal wire shape)
    expect(input.exercises[0].sets[0]).toEqual({ reps: 5, weight: 100, completed: true })
    expect(input.exercises[0].sets[1]).toEqual({ reps: 5, weight: 100 })
  })

  it('emits each exercise\'s loggingType on the wire', () => {
    // Arrange — a bodyweight exercise alongside the default
    const draft: WorkoutDraft = { notes: '',
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [] },
        {
          id: 'ex2',
          wgerExerciseId: 1,
          source: 'wger',
          name: 'Pull-up',
          category: 'Back',
          loggingType: 'bodyweight_reps',
          notes: '',
          skipped: false,
          sets: [],
        },
      ],
    }

    // Act
    const input = draftToInput(draft)

    // Assert
    expect(input.exercises[0].loggingType).toBe('weight_reps')
    expect(input.exercises[1].loggingType).toBe('bodyweight_reps')
  })

  it('emits setType only for warm-up sets (working is the column default)', () => {
    // Arrange
    const draft: WorkoutDraft = { notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: [
            { id: 's1', reps: '5', weight: '60', completed: true, tag: 'warmup' },
            { id: 's2', reps: '5', weight: '100', completed: true, tag: 'working' },
          ],
        },
      ],
    }

    // Act
    const input = draftToInput(draft)

    // Assert — minimal wire shape, same rule as completed
    expect(input.exercises[0].sets[0]).toEqual({ reps: 5, weight: 60, completed: true, setType: 'warmup' })
    expect(input.exercises[0].sets[1]).not.toHaveProperty('setType')
  })

  it('keeps a trimmed name and drops a blank one', () => {
    // Act
    const named = draftToInput(emptyDraft, '  Leg Day  ')
    const blank = draftToInput(emptyDraft, '   ')

    // Assert
    expect(named.name).toBe('Leg Day')
    expect(blank).not.toHaveProperty('name')
  })

  it('emits trimmed notes and skipped, omitting empty notes and false skipped', () => {
    // Arrange — one noted+skipped exercise, one untouched
    const draft: WorkoutDraft = {
      notes: '  cut short  ',
      exercises: [
        { id: 'ex1', ...SQUAT, notes: '  machine busy  ', skipped: true, sets: [] },
        { id: 'ex2', ...SQUAT, sets: [] },
      ],
    }

    // Act
    const input = draftToInput(draft)

    // Assert — empty notes/false skipped stay off the wire (minimal shape)
    expect(input.notes).toBe('cut short')
    expect(input.exercises[0].notes).toBe('machine busy')
    expect(input.exercises[0].skipped).toBe(true)
    expect(input.exercises[1]).not.toHaveProperty('notes')
    expect(input.exercises[1]).not.toHaveProperty('skipped')
  })

  it('omits an empty workout note', () => {
    expect(draftToInput(emptyDraft)).not.toHaveProperty('notes')
  })

  it('converts entered lb weights back to canonical kg', () => {
    // Arrange — a single 100 lb set
    const draft: WorkoutDraft = { notes: '',
      exercises: [{ id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '5', weight: '100', completed: false, tag: 'working' as const }] }],
    }

    // Act
    const input = draftToInput(draft, undefined, 'lb')

    // Assert — 100 lb × 0.45359237 = 45.359… → 45.36 kg at column precision
    expect(input.exercises[0].sets[0].weight).toBeCloseTo(45.36, 2)
  })
})

describe('detailToDraft', () => {
  it('maps a saved workout to an editable draft (numbers→strings, null→"", ids reused)', () => {
    // Arrange — a minimal persisted workout with a fractional and a blank set
    const workout: WorkoutDetail = {
      id: 'w1',
      userId: 'user_123',
      name: 'Leg Day',
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 2.5, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
            { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: null, weight: null, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    }

    // Act
    const { draft, name } = detailToDraft(workout)

    // Assert
    expect(name).toBe('Leg Day')
    // The persisted logging type rides along so edit mode renders the right inputs.
    expect(draft.exercises[0]).toMatchObject({
      id: 'ex1',
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Squat',
      category: '',
      loggingType: 'weight_reps',
      notes: '',
      skipped: false,
    })
    expect(draft.exercises[0].sets).toEqual([
      { id: 's1', reps: '5', weight: '2.5', completed: false, tag: 'working' as const, rir: '', rpe: '' },
      { id: 's2', reps: '', weight: '', completed: false, tag: 'working' as const, rir: '', rpe: '' },
    ])
  })

  it('maps a persisted warm-up setType into the draft tag (round-trip with draftToInput)', () => {
    // Arrange — one warm-up, one working set
    const workout = {
      id: 'w1',
      userId: 'user_123',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 60, completed: true, setType: 'warmup', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
            { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: 5, weight: 100, completed: true, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    } satisfies WorkoutDetail

    // Act
    const { draft } = detailToDraft(workout)

    // Assert — the tag survives the edit round-trip back to the wire
    expect(draft.exercises[0].sets.map((s) => s.tag)).toEqual(['warmup', 'working'])
    const sets = draftToInput(draft).exercises[0].sets
    expect(sets[0].setType).toBe('warmup')
    expect(sets[1]).not.toHaveProperty('setType')
  })

  it('round-trips notes and skipped back to the wire (null → "" / false → omitted)', () => {
    // Arrange — a noted workout with one skipped+noted exercise
    const workout = {
      id: 'w1',
      userId: 'user_123',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: 'cut short',
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: 'machine busy',
          skipped: true,
          sets: [],
        },
        {
          id: 'ex2',
          workoutId: 'w1',
          wgerExerciseId: 9,
          source: 'wger',
          name: 'Bench',
          position: 1,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [],
        },
      ],
    } satisfies WorkoutDetail

    // Act
    const { draft } = detailToDraft(workout)

    // Assert — DB nulls become controlled-input defaults
    expect(draft.notes).toBe('cut short')
    expect(draft.exercises[0]).toMatchObject({ notes: 'machine busy', skipped: true })
    expect(draft.exercises[1]).toMatchObject({ notes: '', skipped: false })

    // Assert — and survive the edit round-trip back to the wire
    const input = draftToInput(draft)
    expect(input.notes).toBe('cut short')
    expect(input.exercises[0]).toMatchObject({ notes: 'machine busy', skipped: true })
    expect(input.exercises[1]).not.toHaveProperty('notes')
    expect(input.exercises[1]).not.toHaveProperty('skipped')
  })

  it('keeps persisted completed flags by default and clears them with resetCompleted', () => {
    // Arrange — a persisted workout with one checked-off set
    const workout: WorkoutDetail = {
      id: 'w1',
      userId: 'user_123',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 100, completed: true, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    }

    // Act + Assert — edit mode keeps the check; repeat mode starts fresh
    expect(detailToDraft(workout).draft.exercises[0].sets[0].completed).toBe(true)
    expect(
      detailToDraft(workout, 'kg', { resetCompleted: true }).draft.exercises[0].sets[0].completed,
    ).toBe(false)
  })

  it('converts stored kg weights to the display unit (lb)', () => {
    // Arrange — a 100 kg set
    const workout: WorkoutDetail = {
      id: 'w1',
      userId: 'user_123',
      name: 'Leg Day',
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 100, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    }

    // Act — 100 kg → 220.46… → "220.5"
    const { draft } = detailToDraft(workout, 'lb')

    // Assert
    expect(draft.exercises[0].sets[0].weight).toBe('220.5')
  })

  it('falls back to an empty name when the workout has none', () => {
    // Arrange
    const workout: WorkoutDetail = {
      id: 'w2',
      userId: 'user_123',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [],
    }

    // Act + Assert
    expect(detailToDraft(workout).name).toBe('')
  })
})

describe('id factories', () => {
  it('newDraftExercise seeds one empty set with distinct stable ids', () => {
    // Act
    const exercise = newDraftExercise(SQUAT)

    // Assert — picked fields preserved, weight_reps default, one empty set,
    // ids present and unique
    expect(exercise.loggingType).toBe('weight_reps')
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

describe('completeFilledSets', () => {
  function draftWith(
    sets: { reps: string; weight?: string; completed?: boolean }[],
  ): WorkoutDraft {
    return {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: sets.map((s, i) => ({
            id: `s${i + 1}`,
            reps: s.reps,
            weight: s.weight ?? '',
            completed: s.completed ?? false,
            tag: 'working' as const,
          })),
        },
      ],
    }
  }

  it('checks off unchecked sets that have reps and weight logged', () => {
    const result = completeFilledSets(
      draftWith([
        { reps: '5', weight: '100' },
        { reps: '8', weight: '80' },
      ]),
    )

    expect(result.autoCompleted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.draft.exercises[0].sets.every((s) => s.completed)).toBe(true)
  })

  it('leaves already-completed sets alone and does not count them', () => {
    const result = completeFilledSets(draftWith([{ reps: '5', completed: true }]))

    expect(result.autoCompleted).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('counts unchecked sets without usable reps as skipped, unflipped', () => {
    const result = completeFilledSets(
      draftWith([
        { reps: '', weight: '100' }, // untouched seeded set
        { reps: '0', weight: '100' }, // zero reps is not a performed set
        { reps: '5.9', weight: '100' }, // fractional — ambiguous, save truncates; not claimed
        { reps: 'abc', weight: '100' },
        { reps: '5', weight: '100' }, // the one real set
      ]),
    )

    expect(result.autoCompleted).toBe(1)
    expect(result.skipped).toBe(4)
    const completed = result.draft.exercises[0].sets.map((s) => s.completed)
    expect(completed).toEqual([false, false, false, false, true])
  })

  it('refuses weight_reps sets with reps but no weight — counted as skipped', () => {
    const result = completeFilledSets(draftWith([{ reps: '12', weight: '' }]))

    expect(result.autoCompleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.draft.exercises[0].sets[0].completed).toBe(false)
  })

  it('bodyweight-mode sets still complete on reps alone — blank weight is their normal reading', () => {
    const base = draftWith([{ reps: '12', weight: '' }])
    const draft: WorkoutDraft = {
      ...base,
      exercises: [{ ...base.exercises[0], loggingType: 'bodyweight_reps' as const }],
    }

    const result = completeFilledSets(draft)

    expect(result.autoCompleted).toBe(1)
    expect(result.draft.exercises[0].sets[0].completed).toBe(true)
  })

  it('ignores skipped exercises entirely — no auto-complete, no warning count', () => {
    // Arrange — a skipped exercise with reps typed AND an empty set: neither
    // may be claimed or warned about; the sibling still runs the pass.
    const base = draftWith([{ reps: '5', weight: '100' }, { reps: '' }])
    const draft: WorkoutDraft = {
      ...base,
      exercises: [
        { ...base.exercises[0], skipped: true },
        { ...base.exercises[0], id: 'ex2', skipped: false },
      ],
    }

    // Act
    const result = completeFilledSets(draft)

    // Assert — skipped exercise untouched; only the live sibling counts
    expect(result.draft.exercises[0]).toBe(draft.exercises[0])
    expect(result.autoCompleted).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('preserves the workout note on the transformed draft', () => {
    const input = { ...draftWith([{ reps: '5', weight: '100' }]), notes: 'keep me' }

    expect(completeFilledSets(input).draft.notes).toBe('keep me')
  })

  it('does not mutate its input draft', () => {
    const input = draftWith([{ reps: '5', weight: '100' }])
    const snapshot = structuredClone(input)

    completeFilledSets(input)

    expect(input).toEqual(snapshot)
  })
})

describe('FILL_SET', () => {
  it('adopts fill values into empty fields without completing', () => {
    // Arrange
    const draft: WorkoutDraft = { notes: '',
      exercises: [{ ...newDraftExercise({ wgerExerciseId: 1, name: 'Bench', category: 'Chest' }) }],
    }

    // Act
    const next = workoutDraftReducer(draft, {
      type: 'FILL_SET',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8', weight: '60' },
    })

    // Assert
    expect(next.exercises[0].sets[0]).toMatchObject({ reps: '8', weight: '60', completed: false, tag: 'working' as const })
  })

  it('never overwrites typed input', () => {
    const base: WorkoutDraft = { notes: '',
      exercises: [{ ...newDraftExercise({ wgerExerciseId: 1, name: 'Bench', category: 'Chest' }) }],
    }
    const typed = workoutDraftReducer(base, {
      type: 'UPDATE_SET',
      exerciseIndex: 0,
      setIndex: 0,
      field: 'weight',
      value: '62.5',
    })

    const next = workoutDraftReducer(typed, {
      type: 'FILL_SET',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { reps: '8', weight: '60' },
    })

    expect(next.exercises[0].sets[0]).toMatchObject({ reps: '8', weight: '62.5' })
  })
})

describe('resolveTargetSetIndex', () => {
  const set = (completed: boolean): DraftSet => ({ ...newDraftSet(), completed })

  it('picks the first incomplete set', () => {
    expect(resolveTargetSetIndex([set(true), set(false), set(false)])).toBe(1)
  })

  it('falls back to the last set when everything is complete', () => {
    expect(resolveTargetSetIndex([set(true), set(true), set(true)])).toBe(2)
  })

  it('returns -1 for no sets so callers can no-op', () => {
    expect(resolveTargetSetIndex([])).toBe(-1)
  })
})

describe('setDisplayNumber', () => {
  const tags = (...values: ('working' | 'warmup')[]) => values.map((tag) => ({ tag }))

  it('numbers working sets past a leading warm-up without a gap (W, 1, 2)', () => {
    const sets = tags('warmup', 'working', 'working')

    expect(setDisplayNumber(sets, 1)).toBe(1)
    expect(setDisplayNumber(sets, 2)).toBe(2)
  })

  it('numbers warm-ups among warm-ups and working among working, interleaved', () => {
    const sets = tags('warmup', 'working', 'warmup', 'working')

    expect(setDisplayNumber(sets, 0)).toBe(1) // warm-up 1
    expect(setDisplayNumber(sets, 1)).toBe(1) // working 1
    expect(setDisplayNumber(sets, 2)).toBe(2) // warm-up 2
    expect(setDisplayNumber(sets, 3)).toBe(2) // working 2
  })

  it('matches the raw position when no warm-ups exist', () => {
    const sets = tags('working', 'working', 'working')

    expect(setDisplayNumber(sets, 0)).toBe(1)
    expect(setDisplayNumber(sets, 2)).toBe(3)
  })

  it('yields 0 (an impossible display number) for an index with no set behind it', () => {
    const sets = tags('warmup', 'working')

    expect(setDisplayNumber(sets, 2)).toBe(0)
    expect(setDisplayNumber([], 0)).toBe(0)
  })
})

describe('SET_EFFORT', () => {
  it('sets rir on the targeted set only', () => {
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_EFFORT',
      exerciseIndex: 0,
      setIndex: 1,
      rir: '2',
    })

    expect(next.exercises[0].sets[1].rir).toBe('2')
    expect(next.exercises[0].sets[0].rir).toBeUndefined()
  })

  it('sets rpe independently and leaves an omitted field untouched', () => {
    const withRir = workoutDraftReducer(NESTED, {
      type: 'SET_EFFORT',
      exerciseIndex: 0,
      setIndex: 0,
      rir: '1',
    })

    const next = workoutDraftReducer(withRir, {
      type: 'SET_EFFORT',
      exerciseIndex: 0,
      setIndex: 0,
      rpe: '8.5',
    })

    expect(next.exercises[0].sets[0]).toMatchObject({ rir: '1', rpe: '8.5' })
  })

  it("clears with '' (re-tapping the selected chip)", () => {
    const withRir = workoutDraftReducer(NESTED, {
      type: 'SET_EFFORT',
      exerciseIndex: 0,
      setIndex: 0,
      rir: '3',
    })

    const next = workoutDraftReducer(withRir, {
      type: 'SET_EFFORT',
      exerciseIndex: 0,
      setIndex: 0,
      rir: '',
    })

    expect(next.exercises[0].sets[0].rir).toBe('')
  })
})

describe('draftToInput effort fields', () => {
  function draftWithEffort(rir: string, rpe: string): WorkoutDraft {
    return {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: [{ id: 's1', reps: '5', weight: '100', completed: true, tag: 'working', rir, rpe }],
        },
      ],
    }
  }

  it('emits on-grid effort as numbers', () => {
    const input = draftToInput(draftWithEffort('2', '8.5'))
    expect(input.exercises[0].sets[0]).toMatchObject({ rir: 2, rpe: 8.5 })
  })

  it('omits blank effort entirely (minimal wire shape)', () => {
    const input = draftToInput(draftWithEffort('', ''))
    expect(input.exercises[0].sets[0]).not.toHaveProperty('rir')
    expect(input.exercises[0].sets[0]).not.toHaveProperty('rpe')
  })

  it('omits off-grid values so a corrupt draft cannot fail the save', () => {
    const input = draftToInput(draftWithEffort('11', '8.25'))
    expect(input.exercises[0].sets[0]).not.toHaveProperty('rir')
    expect(input.exercises[0].sets[0]).not.toHaveProperty('rpe')
  })

  it('handles pre-effort sets with no rir/rpe fields at all', () => {
    const input = draftToInput(NESTED)
    expect(input.exercises[0].sets[0]).not.toHaveProperty('rir')
  })
})

describe('detailToDraft effort round-trip', () => {
  it('maps stored rir/rpe to strings and null to empty strings', () => {
    const workout = {
      id: 'w1', userId: 'u1', name: null, startedAt: new Date(), completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(), programDayId: null, programWeek: null, importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1', workoutId: 'w1', wgerExerciseId: 73, source: 'wger' as const,
          name: 'Squat', position: 0, loggingType: 'weight_reps' as const,
          notes: null, skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 100, completed: true, setType: 'working' as const, metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: 2, rpe: 8.5, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
            { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: 5, weight: 100, completed: true, setType: 'working' as const, metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    } satisfies WorkoutDetail

    const { draft } = detailToDraft(workout)

    expect(draft.exercises[0].sets[0]).toMatchObject({ rir: '2', rpe: '8.5' })
    expect(draft.exercises[0].sets[1]).toMatchObject({ rir: '', rpe: '' })
  })
})

describe('cardio metric modes (slice 1)', () => {
  const RUN = {
    wgerExerciseId: 201,
    source: 'wger' as const,
    name: 'Running',
    category: 'Cardio',
    loggingType: 'weight_reps' as const,
    notes: '',
    skipped: false,
  }

  const cardioSet = (overrides: Partial<DraftSet> = {}): DraftSet => ({
    id: 's1',
    reps: '',
    weight: '',
    completed: false,
    tag: 'working' as const,
    metricMode: 'duration_distance' as const,
    duration: '',
    distance: '',
    ...overrides,
  })

  const cardioDraft = (set: DraftSet): WorkoutDraft => ({
    notes: '',
    exercises: [{ id: 'ex1', ...RUN, sets: [set] }],
  })

  it('newDraftExercise defaults a Cardio-category pick to duration_distance sets', () => {
    const exercise = newDraftExercise({ wgerExerciseId: 201, name: 'Running', category: 'Cardio' })
    expect(exercise.sets[0].metricMode).toBe('duration_distance')
    // Non-cardio picks keep the minimal shape: no metricMode key at all.
    const squat = newDraftExercise({ wgerExerciseId: 73, name: 'Squat', category: 'Legs' })
    expect('metricMode' in squat.sets[0]).toBe(false)
  })

  it('replacementDraftExercise seeds the SUBSTITUTE category mode', () => {
    const replacement = replacementDraftExercise(
      { wgerExerciseId: 201, name: 'Running', category: 'Cardio' },
      3,
    )
    expect(replacement.sets).toHaveLength(3)
    expect(replacement.sets.every((s) => s.metricMode === 'duration_distance')).toBe(true)
  })

  it('isMissingRequiredMetric requires a duration > 0 on cardio sets (no phantom facts)', () => {
    const draft = cardioDraft(cardioSet())
    expect(isMissingRequiredMetric(draft.exercises[0], 0)).toBe(true)
    // An adoptable ghost duration satisfies the gate, like fill.weight does.
    expect(isMissingRequiredMetric(draft.exercises[0], 0, { duration: '12:30' })).toBe(false)
    const typed = cardioDraft(cardioSet({ duration: '20:00' }))
    expect(isMissingRequiredMetric(typed.exercises[0], 0)).toBe(false)
    // Distance alone never completes a set — duration is the required metric.
    const distanceOnly = cardioDraft(cardioSet({ distance: '5' }))
    expect(isMissingRequiredMetric(distanceOnly.exercises[0], 0)).toBe(true)
  })

  it('isMissingRequiredMetric keeps the weight rule for reps_weight sets', () => {
    const draft: WorkoutDraft = {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          ...RUN,
          category: 'Legs',
          sets: [{ id: 's1', reps: '5', weight: '', completed: false, tag: 'working' as const }],
        },
      ],
    }
    expect(isMissingRequiredMetric(draft.exercises[0], 0)).toBe(true)
    expect(isMissingRequiredMetric(draft.exercises[0], 0, { weight: '100' })).toBe(false)
  })

  it('TOGGLE_SET_COMPLETED refuses a duration-less cardio check-off, whole', () => {
    const draft = cardioDraft(cardioSet({ distance: '5' }))
    const next = workoutDraftReducer(draft, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
    })
    expect(next.exercises[0].sets[0].completed).toBe(false)
  })

  it('TOGGLE_SET_COMPLETED adopts ghost duration/distance into empty fields on check-off', () => {
    const draft = cardioDraft(cardioSet())
    const next = workoutDraftReducer(draft, {
      type: 'TOGGLE_SET_COMPLETED',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { duration: '12:30', distance: '2.5' },
    })
    expect(next.exercises[0].sets[0]).toMatchObject({
      completed: true,
      duration: '12:30',
      distance: '2.5',
    })
  })

  it('FILL_SET fills cardio fields into EMPTY fields only (typed input wins)', () => {
    const draft = cardioDraft(cardioSet({ duration: '10:00' }))
    const next = workoutDraftReducer(draft, {
      type: 'FILL_SET',
      exerciseIndex: 0,
      setIndex: 0,
      fill: { duration: '12:30', distance: '2.5' },
    })
    expect(next.exercises[0].sets[0]).toMatchObject({ duration: '10:00', distance: '2.5' })
  })

  it('completeFilledSets auto-completes cardio sets on duration alone', () => {
    const draft: WorkoutDraft = {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          ...RUN,
          sets: [
            cardioSet({ id: 's1', duration: '20:00' }),
            cardioSet({ id: 's2' }), // no duration → stays unchecked
          ],
        },
      ],
    }
    const result = completeFilledSets(draft)
    expect(result.autoCompleted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.draft.exercises[0].sets[0].completed).toBe(true)
    expect(result.draft.exercises[0].sets[1].completed).toBe(false)
  })

  it('draftToInput emits metricMode + canonical durationSec/distanceM, reps/weight null', () => {
    const draft = cardioDraft(
      cardioSet({ reps: '5', weight: '100', duration: '12:30', distance: '2.5', completed: true }),
    )
    const input = draftToInput(draft)
    expect(input.exercises[0].sets[0]).toEqual({
      reps: null, // stray typed reps must not leak into scoring
      weight: null,
      metricMode: 'duration_distance',
      durationSec: 750,
      distanceM: 2500,
      completed: true,
    })
  })

  it('draftToInput keeps reps_weight sets byte-identical (no cardio keys)', () => {
    const input = draftToInput(NESTED)
    expect('metricMode' in input.exercises[0].sets[0]).toBe(false)
    expect('durationSec' in input.exercises[0].sets[0]).toBe(false)
  })

  it('detailToDraft round-trips cardio rows to input strings and back', () => {
    const workout = {
      id: 'w1',
      userId: 'user_123',
      name: 'Cardio Day',
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 201,
          source: 'wger',
          name: 'Running',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: null, weight: null, completed: true, setType: 'working', metricMode: 'duration_distance', durationSec: 750, distanceM: 2500, prescribedLoadKg: null, prescribedRepMin: null, rir: null, rpe: null, prescribedRir: null, prescribedRpe: null, techniqueKind: null, techniqueGroup: null, stageIndex: null },
          ],
        },
      ],
    } as WorkoutDetail

    const { draft } = detailToDraft(workout)
    expect(draft.exercises[0].sets[0]).toMatchObject({
      metricMode: 'duration_distance',
      duration: '12:30',
      distance: '2.5',
    })

    // And back out: the wire re-asserts what the row held.
    const input = draftToInput(draft)
    expect(input.exercises[0].sets[0]).toMatchObject({
      metricMode: 'duration_distance',
      durationSec: 750,
      distanceM: 2500,
    })
  })
})

describe('SET_SET_NOTE (notes v2 capture)', () => {
  const KEY = '01234567-89ab-cdef-0123-456789abcdef'

  it('sets the note and stamps the clientKey on exactly one set', () => {
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_SET_NOTE',
      exerciseIndex: 0,
      setIndex: 1,
      note: 'left shoulder clicked #form',
      clientKey: KEY,
    })
    expect(next.exercises[0].sets[1]).toMatchObject({
      note: 'left shoulder clicked #form',
      noteClientKey: KEY,
    })
    expect(next.exercises[0].sets[0]).not.toHaveProperty('note')
    // Immutability: fresh objects on the changed path, originals untouched.
    expect(NESTED.exercises[0].sets[1]).not.toHaveProperty('note')
    expect(next.exercises[0]).not.toBe(NESTED.exercises[0])
  })

  it('replaces an existing note while KEEPING its clientKey stable (idempotency)', () => {
    const withNote = workoutDraftReducer(NESTED, {
      type: 'SET_SET_NOTE',
      exerciseIndex: 0,
      setIndex: 0,
      note: 'first words',
      clientKey: KEY,
    })
    const edited = workoutDraftReducer(withNote, {
      type: 'SET_SET_NOTE',
      exerciseIndex: 0,
      setIndex: 0,
      note: 'second thoughts',
      clientKey: withNote.exercises[0].sets[0].noteClientKey!,
    })
    expect(edited.exercises[0].sets[0]).toMatchObject({
      note: 'second thoughts',
      noteClientKey: KEY,
    })
  })

  it('the note does not leak onto the wire (draftToInput ignores it)', () => {
    const next = workoutDraftReducer(NESTED, {
      type: 'SET_SET_NOTE',
      exerciseIndex: 0,
      setIndex: 0,
      note: 'quiet',
      clientKey: KEY,
    })
    const input = draftToInput(next)
    expect(JSON.stringify(input)).not.toContain('quiet')
  })
})

describe('SET_SET_TECHNIQUE (the set-type picker\'s technique arm)', () => {
  const GROUP = 'g1'

  /** A draft with one exercise and `count` working sets. */
  function drafted(count: number): WorkoutDraft {
    return {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          ...SQUAT,
          sets: Array.from({ length: count }, (_, i) => ({
            id: `s${i + 1}`,
            reps: '8',
            weight: '100',
            completed: false,
            tag: 'working' as const,
          })),
        },
      ],
    }
  }

  function tag(draft: WorkoutDraft, setIndex: number, kind: 'drop-set' | 'rest-pause' | null, group = GROUP) {
    return workoutDraftReducer(draft, {
      type: 'SET_SET_TECHNIQUE',
      exerciseIndex: 0,
      setIndex,
      kind,
      group,
    })
  }

  it('pulls the set ABOVE into the group — a drop continues the set it drops from', () => {
    const next = tag(drafted(3), 1, 'drop-set')

    expect(next.exercises[0].sets.map((s) => s.technique)).toEqual([
      { kind: 'drop-set', group: GROUP, stageIndex: 0 },
      { kind: 'drop-set', group: GROUP, stageIndex: 1 },
      undefined,
    ])
    // Immutability: the source draft never changes.
    expect(drafted(3).exercises[0].sets[0]).not.toHaveProperty('technique')
  })

  it('is a no-op on the first set — nothing to continue', () => {
    const draft = drafted(2)
    expect(tag(draft, 0, 'drop-set')).toEqual(draft)
  })

  it('extends the group when the set above already carries the same kind', () => {
    const next = tag(tag(drafted(3), 1, 'drop-set'), 2, 'drop-set', 'g2')

    expect(next.exercises[0].sets.map((s) => s.technique?.stageIndex)).toEqual([0, 1, 2])
    expect(new Set(next.exercises[0].sets.map((s) => s.technique?.group))).toEqual(new Set([GROUP]))
  })

  it('starts a NEW group when the kind differs from the set above', () => {
    const next = tag(tag(drafted(4), 1, 'drop-set'), 3, 'rest-pause', 'g2')

    const techniques = next.exercises[0].sets.map((s) => s.technique)
    expect(techniques[0]?.group).toBe(GROUP)
    expect(techniques[2]).toEqual({ kind: 'rest-pause', group: 'g2', stageIndex: 0 })
    expect(techniques[3]).toEqual({ kind: 'rest-pause', group: 'g2', stageIndex: 1 })
  })

  it('untagging ends the group there and dissolves a leftover top set', () => {
    const grouped = tag(drafted(3), 1, 'drop-set')

    const next = tag(grouped, 1, null)

    // A group of one isn't a technique — the top set loses the tag too.
    expect(next.exercises[0].sets.every((s) => s.technique === undefined)).toBe(true)
  })

  it('untagging a middle stage drops the stages after it, keeping the group well-formed', () => {
    const three = tag(tag(drafted(4), 1, 'drop-set'), 2, 'drop-set')

    const next = tag(three, 2, null)

    expect(next.exercises[0].sets.map((s) => s.technique?.stageIndex)).toEqual([
      0,
      1,
      undefined,
      undefined,
    ])
  })

  it('removing a stage renumbers the group instead of leaving a gap', () => {
    const grouped = tag(tag(drafted(3), 1, 'drop-set'), 2, 'drop-set')

    const next = workoutDraftReducer(grouped, { type: 'REMOVE_SET', exerciseIndex: 0, setIndex: 1 })

    expect(next.exercises[0].sets.map((s) => s.technique?.stageIndex)).toEqual([0, 1])
    // The surviving group still saves — the wire's contiguity rule holds.
    expect(() => parseWorkoutInput(draftToInput(next))).not.toThrow()
  })

  it('inserting an ordinary set into a group splits it and dissolves the orphan', () => {
    const grouped = tag(drafted(2), 1, 'drop-set')

    const next = workoutDraftReducer(grouped, {
      type: 'INSERT_SET',
      exerciseIndex: 0,
      setIndex: 1,
      set: { id: 'new', reps: '', weight: '', completed: false, tag: 'working' },
    })

    expect(next.exercises[0].sets.every((s) => s.technique === undefined)).toBe(true)
  })

  it('rides the wire and round-trips back through a persisted workout', () => {
    const input = draftToInput(tag(drafted(2), 1, 'drop-set'))

    expect(input.exercises[0].sets.map((s) => s.technique)).toEqual([
      { kind: 'drop-set', group: GROUP, stageIndex: 0 },
      { kind: 'drop-set', group: GROUP, stageIndex: 1 },
    ])
    // The saved rows read back as the same grouping (edit mode must not shed it).
    const { draft } = detailToDraft({
      id: 'w1',
      userId: 'u1',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      originalRecordedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            persistedSet({ setNumber: 1, techniqueKind: 'drop-set', techniqueGroup: GROUP, stageIndex: 0 }),
            persistedSet({ setNumber: 2, techniqueKind: 'drop-set', techniqueGroup: GROUP, stageIndex: 1 }),
          ],
        },
      ],
    } as unknown as WorkoutDetail)

    expect(draft.exercises[0].sets.map((s) => s.technique)).toEqual([
      { kind: 'drop-set', group: GROUP, stageIndex: 0 },
      { kind: 'drop-set', group: GROUP, stageIndex: 1 },
    ])
  })

  it('degrades a stored group that lost its top set, rather than blocking the save', () => {
    // A stage row whose stage 0 is gone can't be saved as-is (the wire refuses
    // a group that doesn't open at stage 0), and an unsaveable session is a
    // worse failure than a lost grouping.
    const { draft } = detailToDraft({
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [
            persistedSet({ setNumber: 1, techniqueKind: 'drop-set', techniqueGroup: GROUP, stageIndex: 1 }),
            persistedSet({ setNumber: 2, techniqueKind: 'drop-set', techniqueGroup: GROUP, stageIndex: 2 }),
          ],
        },
      ],
    } as unknown as WorkoutDetail)

    expect(draft.exercises[0].sets.map((s) => s.technique?.stageIndex)).toEqual([0, 1])
    expect(() => parseWorkoutInput(draftToInput(draft))).not.toThrow()
  })

  it('degrades a half-written grouping to an ordinary set (stored rows are data)', () => {
    const { draft } = detailToDraft({
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [persistedSet({ setNumber: 1, techniqueKind: 'giant-set', techniqueGroup: 'g', stageIndex: 0 })],
        },
      ],
    } as unknown as WorkoutDetail)

    expect(draft.exercises[0].sets[0]).not.toHaveProperty('technique')
  })
})

describe('detailToDraft category lookup', () => {
  /** A two-exercise persisted workout: one wger movement, one custom. */
  function workoutWithTwoExercises(): WorkoutDetail {
    return {
      id: 'w1',
      userId: 'user_123',
      name: 'Push',
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      importBatchId: null,
      notes: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Bench Press',
          position: 0,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [persistedSet({ setNumber: 1 })],
        },
        {
          id: 'ex2',
          workoutId: 'w1',
          wgerExerciseId: 1,
          source: 'custom',
          name: 'Cable Face Pull',
          position: 1,
          loggingType: 'weight_reps',
          notes: null,
          skipped: false,
          sets: [persistedSet({ setNumber: 1 })],
        },
      ],
    } as unknown as WorkoutDetail
  }

  it('fills each exercise category from the catalog, keyed by (source, id)', () => {
    // Arrange — the same composite keying db/programs.ts writes; a wger id and
    // a custom id that collide must not read each other's category.
    const catalog = new Map([
      ['wger:73', { id: 73, name: 'Bench Press', category: 'Chest' }],
      ['custom:1', { id: 1, name: 'Cable Face Pull', category: 'Shoulders' }],
      ['wger:1', { id: 1, name: 'Decoy', category: 'Legs' }],
    ])

    // Act
    const { draft } = detailToDraft(workoutWithTwoExercises(), 'kg', { catalog })

    // Assert
    expect(draft.exercises.map((e) => e.category)).toEqual(['Chest', 'Shoulders'])
  })

  it('leaves the category empty when the catalog is missing or lacks the exercise', () => {
    // A catalog outage is enrichment lost, never a broken seed.
    expect(
      detailToDraft(workoutWithTwoExercises(), 'kg', { catalog: null }).draft.exercises.map(
        (e) => e.category,
      ),
    ).toEqual(['', ''])
    expect(
      detailToDraft(workoutWithTwoExercises(), 'kg', {
        catalog: new Map([['wger:73', { id: 73, name: 'Bench Press', category: 'Chest' }]]),
      }).draft.exercises.map((e) => e.category),
    ).toEqual(['Chest', ''])
  })
})

/** A persisted set row with every optional column nulled, for overriding. */
function persistedSet(overrides: Record<string, unknown>) {
  return {
    id: `s${overrides.setNumber ?? 1}`,
    workoutExerciseId: 'ex1',
    setNumber: 1,
    reps: 8,
    weight: 100,
    completed: false,
    setType: 'working',
    metricMode: 'reps_weight',
    durationSec: null,
    distanceM: null,
    prescribedLoadKg: null,
    prescribedRepMin: null,
    rir: null,
    rpe: null,
    prescribedRir: null,
    prescribedRpe: null,
    techniqueKind: null,
    techniqueGroup: null,
    stageIndex: null,
    ...overrides,
  }
}
