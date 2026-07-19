import { describe, it, expect } from 'vitest'
import { deriveTemplateFromWorkout, templateToDraft } from './workout-template'
import type { WorkoutDetail } from '@/db/workouts'
import type { WorkoutTemplateDetail } from '@/db/workout-templates'

/** Minimal persisted set row; overrides tweak the fields under test. */
function makeSet(
  overrides: Partial<WorkoutDetail['exercises'][number]['sets'][number]> = {},
): WorkoutDetail['exercises'][number]['sets'][number] {
  return {
    id: 's1',
    workoutExerciseId: 'ex1',
    setNumber: 1,
    reps: 8,
    weight: 100,
    completed: true,
    setType: 'working',
    metricMode: 'reps_weight',
    durationSec: null,
    distanceM: null,
    prescribedLoadKg: null,
    prescribedRepMin: null,
    ...overrides,
  }
}

function makeExercise(
  overrides: Partial<WorkoutDetail['exercises'][number]> = {},
): WorkoutDetail['exercises'][number] {
  return {
    id: 'ex1',
    workoutId: 'w1',
    wgerExerciseId: 73,
    source: 'wger',
    name: 'Squat',
    position: 0,
    loggingType: 'weight_reps',
    notes: null,
    skipped: false,
    sets: [makeSet()],
    ...overrides,
  }
}

function makeWorkout(overrides: Partial<WorkoutDetail> = {}): WorkoutDetail {
  return {
    id: 'w1',
    userId: 'user_123',
    name: 'Leg Day',
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    programDayId: null,
    programWeek: null,
    notes: null,
    exercises: [makeExercise()],
    ...overrides,
  }
}

describe('deriveTemplateFromWorkout', () => {
  it('derives name, order, loggingType, notes, and the set plan from the workout', () => {
    // Arrange — two exercises with 3 and 2 working sets
    const workout = makeWorkout({
      exercises: [
        makeExercise({
          id: 'ex1',
          notes: 'pause at the bottom',
          sets: [
            makeSet({ id: 's1', setNumber: 1, reps: 8 }),
            makeSet({ id: 's2', setNumber: 2, reps: 8 }),
            makeSet({ id: 's3', setNumber: 3, reps: 6 }),
          ],
        }),
        makeExercise({
          id: 'ex2',
          wgerExerciseId: 9,
          source: 'custom',
          name: 'Nordic Curl',
          position: 1,
          loggingType: 'bodyweight_reps',
          sets: [makeSet({ id: 's4', reps: 12 }), makeSet({ id: 's5', setNumber: 2, reps: 12 })],
        }),
      ],
    })

    // Act
    const template = deriveTemplateFromWorkout(workout)

    // Assert
    expect(template).not.toBeNull()
    expect(template?.name).toBe('Leg Day')
    expect(template?.exercises).toEqual([
      {
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Squat',
        loggingType: 'weight_reps',
        notes: 'pause at the bottom',
        plannedSets: 3,
        // 8 appears twice, 6 once — the mode wins.
        repMin: 8,
        repMax: 8,
      },
      {
        wgerExerciseId: 9,
        source: 'custom',
        name: 'Nordic Curl',
        loggingType: 'bodyweight_reps',
        plannedSets: 2,
        repMin: 12,
        repMax: 12,
      },
    ])
  })

  it('excludes warm-up sets from both the set count and the rep mode', () => {
    // Arrange — 2 warm-ups at 15 reps around 2 working sets at 5
    const workout = makeWorkout({
      exercises: [
        makeExercise({
          sets: [
            makeSet({ id: 's1', setNumber: 1, reps: 15, setType: 'warmup' }),
            makeSet({ id: 's2', setNumber: 2, reps: 15, setType: 'warmup' }),
            makeSet({ id: 's3', setNumber: 3, reps: 5 }),
            makeSet({ id: 's4', setNumber: 4, reps: 5 }),
          ],
        }),
      ],
    })

    // Act
    const template = deriveTemplateFromWorkout(workout)

    // Assert — warm-ups shaped nothing: 2 planned sets, mode 5 (not 15)
    expect(template?.exercises[0]).toMatchObject({ plannedSets: 2, repMin: 5, repMax: 5 })
  })

  it('drops skipped exercises, and returns null when every exercise was skipped', () => {
    // Arrange
    const mixed = makeWorkout({
      exercises: [
        makeExercise({ id: 'ex1', skipped: true }),
        makeExercise({ id: 'ex2', wgerExerciseId: 9, name: 'Bench', position: 1 }),
      ],
    })
    const allSkipped = makeWorkout({ exercises: [makeExercise({ skipped: true })] })

    // Act + Assert
    expect(deriveTemplateFromWorkout(mixed)?.exercises.map((e) => e.name)).toEqual(['Bench'])
    expect(deriveTemplateFromWorkout(allSkipped)).toBeNull()
  })

  it('breaks rep-mode ties toward the count seen first in set order', () => {
    // Arrange — 10 and 8 both appear twice; 10 comes first
    const workout = makeWorkout({
      exercises: [
        makeExercise({
          sets: [
            makeSet({ id: 's1', setNumber: 1, reps: 10 }),
            makeSet({ id: 's2', setNumber: 2, reps: 8 }),
            makeSet({ id: 's3', setNumber: 3, reps: 10 }),
            makeSet({ id: 's4', setNumber: 4, reps: 8 }),
          ],
        }),
      ],
    })

    // Act + Assert
    expect(deriveTemplateFromWorkout(workout)?.exercises[0]).toMatchObject({
      repMin: 10,
      repMax: 10,
    })
  })

  it('omits the rep range when no working set has usable reps, and clamps plannedSets', () => {
    // Arrange — 12 rep-less sets (null and 0 are unusable)
    const workout = makeWorkout({
      exercises: [
        makeExercise({
          sets: Array.from({ length: 12 }, (_, i) =>
            makeSet({ id: `s${i}`, setNumber: i + 1, reps: i === 0 ? 0 : null }),
          ),
        }),
      ],
    })

    // Act
    const exercise = deriveTemplateFromWorkout(workout)?.exercises[0]

    // Assert — clamped to the 10-set cap; no repMin/repMax keys at all
    expect(exercise?.plannedSets).toBe(10)
    expect(exercise).not.toHaveProperty('repMin')
    expect(exercise).not.toHaveProperty('repMax')
  })

  it('floors plannedSets at 1 for an exercise with only warm-ups', () => {
    // Arrange
    const workout = makeWorkout({
      exercises: [makeExercise({ sets: [makeSet({ setType: 'warmup' })] })],
    })

    // Act + Assert — the exercise still earns a slot in the sketch
    expect(deriveTemplateFromWorkout(workout)?.exercises[0].plannedSets).toBe(1)
  })

  it('falls back to an exercise-based name when the workout is unnamed', () => {
    // Arrange
    const single = makeWorkout({ name: null })
    const multi = makeWorkout({
      name: '  ',
      exercises: [
        makeExercise({ id: 'ex1' }),
        makeExercise({ id: 'ex2', wgerExerciseId: 9, name: 'Bench', position: 1 }),
        makeExercise({ id: 'ex3', wgerExerciseId: 10, name: 'Row', position: 2 }),
      ],
    })

    // Act + Assert
    expect(deriveTemplateFromWorkout(single)?.name).toBe('Squat')
    expect(deriveTemplateFromWorkout(multi)?.name).toBe('Squat + 2 more')
  })
})

/** A persisted template detail row for the seeding direction. */
function makeTemplate(
  exercises: Partial<WorkoutTemplateDetail['exercises'][number]>[],
): WorkoutTemplateDetail {
  return {
    id: 't1',
    userId: 'user_123',
    name: 'Push Day',
    description: null,
    icon: null,
    authorActor: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    exercises: exercises.map((overrides, i) => ({
      id: `te${i + 1}`,
      templateId: 't1',
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Squat',
      position: i,
      loggingType: 'weight_reps',
      notes: null,
      plannedSets: 3,
      repMin: null,
      repMax: null,
      restSec: null,
      ...overrides,
    })),
  }
}

describe('templateToDraft', () => {
  it('seeds plannedSets empty working sets per exercise, carrying identity and notes', () => {
    // Arrange
    const template = makeTemplate([
      { plannedSets: 2, notes: 'slow eccentric', loggingType: 'weighted_bodyweight' },
    ])

    // Act
    const { draft, name } = templateToDraft(template)

    // Assert
    expect(name).toBe('Push Day')
    expect(draft.notes).toBe('')
    expect(draft.exercises[0]).toMatchObject({
      id: 'te1',
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Squat',
      category: '',
      loggingType: 'weighted_bodyweight',
      notes: 'slow eccentric',
      skipped: false,
    })
    // Empty sets only: values (and ghosts) come from history at log time.
    expect(draft.exercises[0].sets).toEqual([
      { id: 'te1:set:1', reps: '', weight: '', completed: false, tag: 'working' },
      { id: 'te1:set:2', reps: '', weight: '', completed: false, tag: 'working' },
    ])
  })

  it('is pure and deterministic (same input → same ids), so the server can call it', () => {
    // Arrange
    const template = makeTemplate([{}])

    // Act + Assert
    expect(templateToDraft(template)).toEqual(templateToDraft(template))
  })

  it('re-clamps a corrupt stored plannedSets on read (never 0, never 500 rows)', () => {
    // Arrange
    const zero = makeTemplate([{ plannedSets: 0 }])
    const huge = makeTemplate([{ plannedSets: 500 }])

    // Act + Assert
    expect(templateToDraft(zero).draft.exercises[0].sets).toHaveLength(1)
    expect(templateToDraft(huge).draft.exercises[0].sets).toHaveLength(10)
  })
})
