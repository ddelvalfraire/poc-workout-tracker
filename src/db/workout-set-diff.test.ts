import { describe, it, expect } from 'vitest'
import {
  describeSetChange,
  describeSetSubject,
  diffSetSnapshots,
  isBlankSetSnapshot,
  setSnapshotKey,
  type WorkoutSetSnapshot,
} from './workout-set-diff'

function snapshot(overrides: Partial<WorkoutSetSnapshot> = {}): WorkoutSetSnapshot {
  return {
    source: 'wger',
    wgerExerciseId: 73,
    exerciseName: 'Squat',
    setNumber: 3,
    reps: 5,
    weight: 100,
    completed: true,
    rir: null,
    rpe: null,
    metricMode: 'reps_weight',
    durationSec: null,
    distanceM: null,
    ...overrides,
  }
}

describe('setSnapshotKey', () => {
  it('keys on the (source, exerciseId, setNumber) composite', () => {
    // Act + Assert
    expect(setSnapshotKey('custom', 4, 2)).toBe('custom:4:2')
  })

  it('separates a custom exercise from a wger exercise with the same id', () => {
    // The two id spaces collide; a shared key would diff one against the other.
    // Act + Assert
    expect(setSnapshotKey('custom', 73, 1)).not.toBe(setSnapshotKey('wger', 73, 1))
  })
})

describe('diffSetSnapshots', () => {
  it('returns an empty list when nothing performed changed', () => {
    // Act + Assert
    expect(diffSetSnapshots(snapshot(), snapshot())).toEqual([])
  })

  it('lists every differing performed field, in declaration order', () => {
    // Act
    const changed = diffSetSnapshots(snapshot(), snapshot({ weight: 102.5, reps: 6 }))

    // Assert — one intent, two fields
    expect(changed).toEqual(['reps', 'weight'])
  })

  it('ignores addressing: a different exercise name is not a changed field', () => {
    // A re-addressed subject is a different subject, not an edit.
    // Act + Assert
    expect(diffSetSnapshots(snapshot(), snapshot({ exerciseName: 'Back Squat' }))).toEqual([])
  })

  it('treats null and a value as a change in both directions', () => {
    // Act + Assert
    expect(diffSetSnapshots(snapshot({ rir: null }), snapshot({ rir: 2 }))).toEqual(['rir'])
    expect(diffSetSnapshots(snapshot({ rir: 2 }), snapshot({ rir: null }))).toEqual(['rir'])
  })

  it('sees the cardio fields too', () => {
    // Act
    const changed = diffSetSnapshots(
      snapshot({ metricMode: 'reps_weight' }),
      snapshot({ metricMode: 'duration', durationSec: 600 }),
    )

    // Assert
    expect(changed).toEqual(['metricMode', 'durationSec'])
  })
})

describe('describeSetChange', () => {
  it('renders one compact line naming the subject and each transition', () => {
    // Arrange
    const before = snapshot()
    const after = snapshot({ weight: 102.5, reps: 6 })

    // Act
    const summary = describeSetChange(before, after, diffSetSnapshots(before, after))

    // Assert
    expect(summary).toBe('Set 3 of Squat — reps 5 → 6, weight 100 → 102.5')
  })

  it('renders a cleared value as an em dash, not "null"', () => {
    // Arrange
    const before = snapshot({ rir: 2 })
    const after = snapshot({ rir: null })

    // Act
    const summary = describeSetChange(before, after, ['rir'])

    // Assert
    expect(summary).toBe('Set 3 of Squat — rir 2 → —')
  })

  it('renders booleans as yes/no', () => {
    // Act
    const summary = describeSetChange(snapshot({ completed: false }), snapshot(), ['completed'])

    // Assert
    expect(summary).toBe('Set 3 of Squat — completed no → yes')
  })
})

describe('describeSetSubject', () => {
  it('names the set by its number and exercise', () => {
    // Act + Assert
    expect(describeSetSubject(snapshot())).toBe('Set 3 of Squat')
  })
})

describe('isBlankSetSnapshot', () => {
  /** The shape `instantiate_program_day` writes: prescribed targets only. */
  const BLANK = {
    reps: null,
    weight: null,
    completed: false,
    rir: null,
    rpe: null,
    durationSec: null,
    distanceM: null,
  } as const

  it('calls a prescribed-only row blank', () => {
    expect(isBlankSetSnapshot(snapshot(BLANK))).toBe(true)
  })

  it('counts effort as something logged, even with no reps or weight', () => {
    expect(isBlankSetSnapshot(snapshot({ ...BLANK, rir: 2 }))).toBe(false)
  })

  it('counts a check-off as something logged', () => {
    expect(isBlankSetSnapshot(snapshot({ ...BLANK, completed: true }))).toBe(false)
  })

  it('ignores metricMode: how a set reads is not a performed value', () => {
    // Set at instantiation and NOT NULL, so it could never be blank — reading
    // it would make every cardio row look logged before anyone touched it.
    expect(isBlankSetSnapshot(snapshot({ ...BLANK, metricMode: 'duration' }))).toBe(true)
  })

  it('calls a logged row not blank', () => {
    expect(isBlankSetSnapshot(snapshot())).toBe(false)
  })
})
