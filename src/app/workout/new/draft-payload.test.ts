import { describe, it, expect } from 'vitest'
import {
  DRAFT_PAYLOAD_VERSION,
  draftKey,
  buildDraftPayload,
  isDraftPayload,
  parseDraftPayload,
} from './draft-payload'
import type { WorkoutDraft } from './workout-draft'

const OPENED = new Date('2026-07-05T11:40:00.000Z')

/** A draft mid-session: one checked set, one still blank. */
const DRAFT: WorkoutDraft = {
  exercises: [
    {
      id: 'ex1',
      wgerExerciseId: 73,
      name: 'Squat',
      category: 'Legs',
      sets: [
        { id: 's1', reps: '5', weight: '100', completed: true },
        { id: 's2', reps: '', weight: '', completed: false },
      ],
    },
  ],
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...buildDraftPayload({ draft: DRAFT, name: 'Leg Day', unit: 'kg', openedAt: OPENED }), ...overrides }
}

describe('draftKey', () => {
  it('separates the new-workout surface from per-workout edit surfaces', () => {
    expect(draftKey()).toBe('new')
    expect(draftKey('w1')).toBe('w1')
  })
})

describe('build → parse round-trip', () => {
  it('restores the draft, name, and session start intact', () => {
    // Arrange — simulate the JSON round-trip through jsonb storage
    const stored = JSON.parse(JSON.stringify(payload()))

    // Act
    const restored = parseDraftPayload(stored, { unit: 'kg' })

    // Assert
    expect(restored).not.toBeNull()
    expect(restored!.draft).toEqual(DRAFT)
    expect(restored!.name).toBe('Leg Day')
    expect(restored!.openedAt).toEqual(OPENED)
  })
})

describe('isDraftPayload / parseDraftPayload rejection', () => {
  it('rejects non-objects', () => {
    expect(isDraftPayload(null)).toBe(false)
    expect(isDraftPayload('a string')).toBe(false)
    expect(parseDraftPayload(undefined, { unit: 'kg' })).toBeNull()
  })

  it('rejects a different payload version', () => {
    expect(isDraftPayload(payload({ v: DRAFT_PAYLOAD_VERSION + 1 }))).toBe(false)
  })

  it('rejects an unrecognized unit', () => {
    expect(isDraftPayload(payload({ unit: 'stone' }))).toBe(false)
  })

  it('parse rejects a unit mismatch instead of lossily converting weight strings', () => {
    // Arrange — structurally valid lb payload
    const lb = payload({ unit: 'lb' })

    // Assert — valid shape, but not restorable under kg
    expect(isDraftPayload(lb)).toBe(true)
    expect(parseDraftPayload(lb, { unit: 'kg' })).toBeNull()
  })

  it('rejects an invalid openedAt', () => {
    expect(isDraftPayload(payload({ openedAt: 'not-a-date' }))).toBe(false)
  })

  it('rejects an empty draft — nothing worth storing or restoring', () => {
    expect(isDraftPayload(payload({ draft: { exercises: [] } }))).toBe(false)
  })

  it('rejects malformed exercises and sets (payload is untrusted)', () => {
    const badSet = {
      exercises: [{ ...DRAFT.exercises[0], sets: [{ id: 's1', reps: 5, weight: '100', completed: false }] }],
    }
    const badExercise = { exercises: [{ id: 'ex1', name: 'Squat' }] }

    expect(isDraftPayload(payload({ draft: badSet }))).toBe(false)
    expect(isDraftPayload(payload({ draft: badExercise }))).toBe(false)
    expect(isDraftPayload(payload({ draft: null }))).toBe(false)
  })
})
