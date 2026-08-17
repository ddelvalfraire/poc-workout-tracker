import { describe, it, expect } from 'vitest'
import {
  insertToken,
  noteBreadcrumb,
  setSnapshotLabel,
  setHasNote,
  exerciseNoteCount,
  collectSetNotes,
  fallbackPendingNotes,
} from './note-capture'
import { isPendingNote } from './pending-notes'
import type { DraftExercise, DraftSet, WorkoutDraft } from './workout-draft'

const KEY_A = '01234567-89ab-cdef-0123-456789abcdef'
const KEY_B = '11234567-89ab-cdef-0123-456789abcdef'
const WORKOUT_ID = 'aaaa4567-89ab-cdef-0123-456789abcdef'

function draftSet(overrides: Partial<DraftSet> = {}): DraftSet {
  return { id: 's1', reps: '', weight: '', completed: false, tag: 'working', ...overrides }
}

function draftExercise(overrides: Partial<DraftExercise> = {}): DraftExercise {
  return {
    id: 'ex1',
    wgerExerciseId: 73,
    source: 'wger',
    name: 'Bench Press',
    category: 'Chest',
    loggingType: 'weight_reps',
    notes: '',
    skipped: false,
    sets: [draftSet()],
    ...overrides,
  }
}

describe('insertToken', () => {
  it('inserts at the caret with a trailing space', () => {
    expect(insertToken('', 0, 0, '#form')).toEqual({ text: '#form ', caret: 6 })
  })

  it('pads a missing leading space and lands the caret after the token', () => {
    const result = insertToken('left shoulder', 13, 13, '#form')
    expect(result.text).toBe('left shoulder #form ')
    expect(result.caret).toBe(result.text.length)
  })

  it('does not double a space already there', () => {
    expect(insertToken('bar path ', 9, 9, '#form').text).toBe('bar path #form ')
  })

  it('replaces a selection', () => {
    const result = insertToken('was #pain here', 4, 9, '#form')
    expect(result.text).toBe('was #form here')
  })

  it('clamps out-of-range caret positions instead of throwing', () => {
    expect(insertToken('ab', 99, 120, '#pr').text).toBe('ab #pr ')
    expect(insertToken('ab', -5, -1, '#pr').text).toBe('#pr ab')
  })
})

describe('noteBreadcrumb', () => {
  it('speaks each scope', () => {
    expect(noteBreadcrumb('set', 'Bench Press', 3)).toBe('Bench Press · Set 3')
    expect(noteBreadcrumb('exercise', 'Bench Press', 3)).toBe('Bench Press')
    expect(noteBreadcrumb('workout', 'Bench Press', 3)).toBe('Workout')
  })
})

describe('setSnapshotLabel', () => {
  it('reads load × reps with the effort rider', () => {
    expect(
      setSnapshotLabel(draftSet({ weight: '185', reps: '6', rpe: '9' }), 'weight_reps', 'lb'),
    ).toBe('185 lb × 6 · RPE 9')
  })

  it('prefers RPE over RIR when both are logged, falls back to RIR', () => {
    expect(
      setSnapshotLabel(
        draftSet({ weight: '100', reps: '8', rpe: '8', rir: '2' }),
        'weight_reps',
        'kg',
      ),
    ).toBe('100 kg × 8 · RPE 8')
    expect(
      setSnapshotLabel(draftSet({ weight: '100', reps: '8', rir: '2' }), 'weight_reps', 'kg'),
    ).toBe('100 kg × 8 · RIR 2')
  })

  it('bodyweight rows read BW, not a phantom load', () => {
    expect(setSnapshotLabel(draftSet({ reps: '12' }), 'bodyweight_reps', 'kg')).toBe('BW × 12')
  })

  it('cardio rows speak their duration and distance', () => {
    expect(
      setSnapshotLabel(
        draftSet({ metricMode: 'duration_distance', duration: '12:30', distance: '2.5' }),
        'weight_reps',
        'kg',
      ),
    ).toBe('12:30 · 2.5 km')
  })

  it('returns null for an untyped row — no subtitle beats dashes', () => {
    expect(setSnapshotLabel(draftSet(), 'weight_reps', 'kg')).toBeNull()
  })
})

describe('setHasNote / exerciseNoteCount', () => {
  it('a whitespace-only note is not a note (no dot)', () => {
    expect(setHasNote(draftSet({ note: '   ' }))).toBe(false)
    expect(setHasNote(draftSet({ note: 'pin 4' }))).toBe(true)
    expect(setHasNote(draftSet())).toBe(false)
  })

  it('rolls up the instance note plus every noted set', () => {
    const exercise = draftExercise({
      notes: 'felt heavy',
      sets: [draftSet({ note: 'a' }), draftSet({ id: 's2' }), draftSet({ id: 's3', note: 'b' })],
    })
    expect(exerciseNoteCount(exercise)).toBe(3)
  })

  it('is 0 on the untouched fast path', () => {
    expect(exerciseNoteCount(draftExercise())).toBe(0)
  })
})

describe('collectSetNotes', () => {
  function draft(): WorkoutDraft {
    return {
      notes: '',
      exercises: [
        draftExercise({
          sets: [
            draftSet({ note: ' left shoulder clicked ', noteClientKey: KEY_A }),
            draftSet({ id: 's2' }),
          ],
        }),
        draftExercise({
          id: 'ex2',
          name: 'Squat',
          skipped: true,
          sets: [
            draftSet({ id: 's3' }),
            draftSet({ id: 's4', note: 'depth', noteClientKey: KEY_B }),
          ],
        }),
      ],
    }
  }

  it('collects trimmed bodies with positional addresses (0-based exercise, 1-based set)', () => {
    expect(collectSetNotes(draft())).toEqual([
      {
        exercisePosition: 0,
        setNumber: 1,
        body: 'left shoulder clicked',
        clientKey: KEY_A,
        exerciseName: 'Bench Press',
      },
      // A skipped exercise still collects — the note is a fact either way.
      {
        exercisePosition: 1,
        setNumber: 2,
        body: 'depth',
        clientKey: KEY_B,
        exerciseName: 'Squat',
      },
    ])
  })

  it('skips blank notes and notes without a clientKey (no idempotency handle, no send)', () => {
    const d: WorkoutDraft = {
      notes: '',
      exercises: [
        draftExercise({
          sets: [
            draftSet({ note: '   ', noteClientKey: KEY_A }),
            draftSet({ id: 's2', note: 'orphan' }),
          ],
        }),
      ],
    }
    expect(collectSetNotes(d)).toEqual([])
  })
})

describe('fallbackPendingNotes (the queue-consumer downgrade)', () => {
  it('re-anchors entries to the workout with the clientKey as the queue id', () => {
    const now = new Date('2026-08-17T10:00:00Z')
    const pending = fallbackPendingNotes(
      WORKOUT_ID,
      [
        {
          exercisePosition: 0,
          setNumber: 3,
          body: 'left shoulder clicked',
          clientKey: KEY_A,
          exerciseName: 'Bench Press',
        },
      ],
      now,
    )
    expect(pending).toEqual([
      {
        id: KEY_A,
        anchor: { kind: 'workout', id: WORKOUT_ID },
        body: 'left shoulder clicked',
        createdAt: now.toISOString(),
      },
    ])
    // The downgraded shape must pass the queue's own trust boundary, or the
    // codec would silently drop the words it exists to protect.
    expect(pending.every(isPendingNote)).toBe(true)
  })
})
