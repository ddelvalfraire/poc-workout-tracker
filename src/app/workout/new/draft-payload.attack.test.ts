/**
 * Adversarial regression tests for draft-payload codec compatibility across
 * the cardio slice. Payload shapes are reconstructed from git history:
 * 6c8837e (pre-cardio, post-effort) and c74dec5-era (pre-tag/notes/source) —
 * real old-client payloads, not guesses. Adopted from the adversarial
 * verification round.
 */
import { describe, it, expect } from 'vitest'
import {
  DRAFT_PAYLOAD_VERSION,
  DRAFT_TTL_MS,
  buildDraftPayload,
  isDraftPayload,
  parseDraftPayload,
  resolveDraftSeed,
} from './draft-payload'
import { isLoggingType, isWorkoutSetType } from '@/lib/workout/workout-input'

const NOW = new Date('2026-08-15T12:00:00.000Z')

/** Byte-for-byte the shape a 6c8837e-era (pre-cardio) client persisted. */
function preCardioPayload(): Record<string, unknown> {
  return {
    v: 1,
    unit: 'kg',
    name: 'Push Day',
    openedAt: '2026-08-15T09:00:00.000Z',
    draft: {
      notes: 'felt good',
      exercises: [
        {
          id: 'ex1',
          wgerExerciseId: 73,
          source: 'wger',
          name: 'Bench Press',
          category: 'Chest',
          loggingType: 'weight_reps',
          notes: '',
          skipped: false,
          sets: [
            { id: 's1', reps: '5', weight: '80', completed: true, tag: 'working', rir: '2', rpe: '' },
            { id: 's2', reps: '', weight: '', completed: false, tag: 'warmup' },
          ],
        },
      ],
    },
  }
}

/** The oldest wire shape (c74dec5 era): no tag/rir/rpe/loggingType/source/notes/skipped. */
function ancientPayload(): Record<string, unknown> {
  return {
    v: 1,
    unit: 'lb',
    name: '',
    openedAt: '2026-08-15T09:00:00.000Z',
    draft: {
      exercises: [
        {
          id: 'ex1',
          wgerExerciseId: 73,
          name: 'Bench Press',
          category: 'Chest',
          sets: [{ id: 's1', reps: '5', weight: '175', completed: false }],
        },
      ],
    },
  }
}

/** A today-shape cardio draft payload. */
function cardioPayload(): Record<string, unknown> {
  return {
    v: 1,
    unit: 'kg',
    name: 'Run',
    openedAt: '2026-08-15T09:00:00.000Z',
    draft: {
      notes: '',
      exercises: [
        {
          id: 'ex1',
          wgerExerciseId: 500,
          source: 'wger',
          name: 'Running',
          category: 'Cardio',
          loggingType: 'weight_reps',
          notes: '',
          skipped: false,
          sets: [
            {
              id: 's1',
              reps: '',
              weight: '',
              completed: false,
              tag: 'working',
              metricMode: 'duration_distance',
              duration: '30:00',
              distance: '5',
            },
          ],
        },
      ],
    },
  }
}

/**
 * The 6c8837e isDraftSet, inlined verbatim (it had no cardio lines) — proves
 * an OLD client's validator accepts a NEW cardio payload, i.e. forward
 * compatibility during a mixed-version cross-device session.
 */
function oldIsDraftSet(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const set = value as Record<string, unknown>
  return (
    typeof set.id === 'string' &&
    typeof set.reps === 'string' &&
    typeof set.weight === 'string' &&
    typeof set.completed === 'boolean' &&
    (set.tag === undefined || isWorkoutSetType(set.tag)) &&
    (set.rir === undefined || typeof set.rir === 'string') &&
    (set.rpe === undefined || typeof set.rpe === 'string')
  )
}

function oldIsDraftExercise(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const exercise = value as Record<string, unknown>
  return (
    typeof exercise.id === 'string' &&
    typeof exercise.wgerExerciseId === 'number' &&
    typeof exercise.name === 'string' &&
    typeof exercise.category === 'string' &&
    (exercise.loggingType === undefined || isLoggingType(exercise.loggingType)) &&
    (exercise.source === undefined || exercise.source === 'wger' || exercise.source === 'custom') &&
    (exercise.notes === undefined || typeof exercise.notes === 'string') &&
    (exercise.skipped === undefined || typeof exercise.skipped === 'boolean') &&
    Array.isArray(exercise.sets) &&
    exercise.sets.every(oldIsDraftSet)
  )
}

describe('backward compatibility — old payloads through TODAY’s codec', () => {
  it('the version was not bumped for cardio', () => {
    expect(DRAFT_PAYLOAD_VERSION).toBe(1)
  })

  it('a real pre-cardio (6c8837e-era) payload parses and restores intact', () => {
    const parsed = parseDraftPayload(preCardioPayload(), { unit: 'kg', now: NOW })
    expect(parsed).not.toBeNull()
    expect(parsed!.draft.exercises[0]!.sets[0]).toMatchObject({ reps: '5', weight: '80', rir: '2' })
    // No cardio fields materialize out of nowhere.
    expect(parsed!.draft.exercises[0]!.sets[0]!.metricMode).toBeUndefined()
  })

  it('the oldest (c74dec5-era) payload still parses, with every later field defaulted', () => {
    const parsed = parseDraftPayload(ancientPayload(), { unit: 'lb', now: NOW })
    expect(parsed).not.toBeNull()
    expect(parsed!.draft.exercises[0]).toMatchObject({
      loggingType: 'weight_reps',
      source: 'wger',
      notes: '',
      skipped: false,
    })
    expect(parsed!.draft.exercises[0]!.sets[0]!.tag).toBe('working')
    expect(parsed!.draft.notes).toBe('')
  })
})

describe('forward compatibility — a cardio payload through the OLD validator', () => {
  it('a 6c8837e-era client structurally accepts a cardio draft (extra fields pass through)', () => {
    const payload = cardioPayload()
    const draft = payload.draft as { exercises: unknown[] }
    expect(draft.exercises.every(oldIsDraftExercise)).toBe(true)
  })
})

describe('hostile payloads', () => {
  it('rejects an off-whitelist metricMode and mis-typed cardio fields', () => {
    const bad = cardioPayload()
    const s = (bad.draft as { exercises: { sets: Record<string, unknown>[] }[] }).exercises[0]!
      .sets[0]!
    s.metricMode = 'swim'
    expect(isDraftPayload(bad)).toBe(false)

    const numericDuration = cardioPayload()
    const s2 = (numericDuration.draft as { exercises: { sets: Record<string, unknown>[] }[] })
      .exercises[0]!.sets[0]!
    s2.duration = 1800
    expect(isDraftPayload(numericDuration)).toBe(false)
  })

  it('rejects a wrong version, unknown unit, junk openedAt, and an empty draft', () => {
    expect(isDraftPayload({ ...preCardioPayload(), v: 2 })).toBe(false)
    expect(isDraftPayload({ ...preCardioPayload(), unit: 'stone' })).toBe(false)
    expect(isDraftPayload({ ...preCardioPayload(), openedAt: 'not-a-date' })).toBe(false)
    expect(isDraftPayload({ ...preCardioPayload(), draft: { notes: '', exercises: [] } })).toBe(false)
  })

  it('a unit-mismatched payload is discarded, never lossily converted', () => {
    expect(parseDraftPayload(preCardioPayload(), { unit: 'lb', now: NOW })).toBeNull()
  })

  it('a future openedAt (fast device clock) is clamped to now', () => {
    const skewed = { ...preCardioPayload(), openedAt: '2026-08-16T09:00:00.000Z' }
    const parsed = parseDraftPayload(skewed, { unit: 'kg', now: NOW })
    expect(parsed!.openedAt.getTime()).toBe(NOW.getTime())
  })
})

describe('TTL boundary (resolveDraftSeed)', () => {
  it('keeps a row exactly DRAFT_TTL_MS old (inclusive), drops one 1ms older', () => {
    const row = { payload: preCardioPayload(), updatedAt: new Date(NOW.getTime() - DRAFT_TTL_MS) }
    expect(resolveDraftSeed(row, { unit: 'kg', now: NOW })).not.toBeNull()
    const stale = {
      payload: preCardioPayload(),
      updatedAt: new Date(NOW.getTime() - DRAFT_TTL_MS - 1),
    }
    expect(resolveDraftSeed(stale, { unit: 'kg', now: NOW })).toBeNull()
  })
})

describe('round-trip', () => {
  it('buildDraftPayload output always re-parses (cardio draft included)', () => {
    const parsed = parseDraftPayload(cardioPayload(), { unit: 'kg', now: NOW })
    expect(parsed).not.toBeNull()
    const rebuilt = buildDraftPayload({
      draft: parsed!.draft,
      name: parsed!.name,
      unit: 'kg',
      openedAt: parsed!.openedAt,
    })
    expect(isDraftPayload(rebuilt)).toBe(true)
    expect(parseDraftPayload(rebuilt, { unit: 'kg', now: NOW })!.draft).toEqual(parsed!.draft)
  })
})
