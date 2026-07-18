import { describe, it, expect } from 'vitest'
import {
  workoutDraftReducer,
  completeFilledSets,
  draftToInput,
  detailToDraft,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
  replacementDraftExercise,
  resolveTargetSetIndex,
  type DraftSet,
  type WorkoutDraft,
} from './workout-draft'
import type { WorkoutDetail } from '@/db/workouts'

const SQUAT = {
  wgerExerciseId: 73,
  source: 'wger' as const,
  name: 'Squat',
  category: 'Legs',
  loggingType: 'weight_reps' as const,
}

/** A draft with one exercise and two sets, for nested-update assertions. */
const NESTED: WorkoutDraft = {
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
    const two: WorkoutDraft = {
      exercises: [
        NESTED.exercises[0],
        {
          id: 'ex2',
          wgerExerciseId: 9,
          source: 'wger',
          name: 'Bench',
          category: 'Chest',
          loggingType: 'weight_reps',
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
    const two: WorkoutDraft = {
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [] },
        { id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', sets: [] },
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
    const after: WorkoutDraft = {
      exercises: [{ id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', sets: [] }],
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
    const grown: WorkoutDraft = {
      exercises: [
        { id: 'ex2', wgerExerciseId: 1, source: 'wger', name: 'Bench', category: 'Chest', loggingType: 'weight_reps', sets: [] },
        { id: 'ex3', wgerExerciseId: 2, source: 'wger', name: 'Row', category: 'Back', loggingType: 'weight_reps', sets: [] },
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
    const after: WorkoutDraft = {
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
    const blank: WorkoutDraft = {
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
    const partial: WorkoutDraft = {
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
    const done: WorkoutDraft = {
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
    const draft: WorkoutDraft = {
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
    const draft: WorkoutDraft = {
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
    const draft: WorkoutDraft = {
      exercises: [
        { id: 'ex1', ...SQUAT, sets: [] },
        {
          id: 'ex2',
          wgerExerciseId: 1,
          source: 'wger',
          name: 'Pull-up',
          category: 'Back',
          loggingType: 'bodyweight_reps',
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
    const draft: WorkoutDraft = {
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

  it('converts entered lb weights back to canonical kg', () => {
    // Arrange — a single 100 lb set
    const draft: WorkoutDraft = {
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
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 2.5, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
            { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: null, weight: null, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
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
    })
    expect(draft.exercises[0].sets).toEqual([
      { id: 's1', reps: '5', weight: '2.5', completed: false, tag: 'working' as const },
      { id: 's2', reps: '', weight: '', completed: false, tag: 'working' as const },
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
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 60, completed: true, setType: 'warmup', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
            { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: 5, weight: 100, completed: true, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
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

  it('keeps persisted completed flags by default and clears them with resetCompleted', () => {
    // Arrange — a persisted workout with one checked-off set
    const workout: WorkoutDetail = {
      id: 'w1',
      userId: 'user_123',
      name: null,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 100, completed: true, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
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
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
      exercises: [
        {
          id: 'ex1',
          workoutId: 'w1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Squat',
          position: 0,
          loggingType: 'weight_reps',
          sets: [
            { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 100, completed: false, setType: 'working', metricMode: 'reps_weight', durationSec: null, distanceM: null, prescribedLoadKg: null, prescribedRepMin: null },
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
      createdAt: new Date(),
      programDayId: null,
      programWeek: null,
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

  it('checks off unchecked sets that have reps logged', () => {
    const result = completeFilledSets(draftWith([{ reps: '5', weight: '100' }, { reps: '8' }]))

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
        { reps: '' }, // untouched seeded set
        { reps: '0' }, // zero reps is not a performed set
        { reps: '5.9' }, // fractional — ambiguous, save truncates; not claimed
        { reps: 'abc' },
        { reps: '5' }, // the one real set
      ]),
    )

    expect(result.autoCompleted).toBe(1)
    expect(result.skipped).toBe(4)
    const completed = result.draft.exercises[0].sets.map((s) => s.completed)
    expect(completed).toEqual([false, false, false, false, true])
  })

  it('needs no weight — null-load machine and bodyweight sets complete on reps alone', () => {
    const result = completeFilledSets(draftWith([{ reps: '12', weight: '' }]))

    expect(result.autoCompleted).toBe(1)
    expect(result.draft.exercises[0].sets[0].completed).toBe(true)
  })

  it('does not mutate its input draft', () => {
    const input = draftWith([{ reps: '5' }])
    const snapshot = structuredClone(input)

    completeFilledSets(input)

    expect(input).toEqual(snapshot)
  })
})

describe('FILL_SET', () => {
  it('adopts fill values into empty fields without completing', () => {
    // Arrange
    const draft: WorkoutDraft = {
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
    const base: WorkoutDraft = {
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
