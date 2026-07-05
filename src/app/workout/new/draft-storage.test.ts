import { describe, it, expect } from 'vitest'
import {
  DRAFT_STORAGE_VERSION,
  DRAFT_TTL_MS,
  draftStorageKey,
  serializeDraft,
  deserializeDraft,
} from './draft-storage'
import type { WorkoutDraft } from './workout-draft'

const NOW = new Date('2026-07-05T12:00:00.000Z')
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

function snapshot(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...JSON.parse(serializeDraft({ draft: DRAFT, name: 'Leg Day', unit: 'kg', openedAt: OPENED, now: NOW })),
    ...overrides,
  })
}

describe('draftStorageKey', () => {
  it('separates the new-workout surface from per-workout edit surfaces', () => {
    expect(draftStorageKey()).toBe('workout-draft:new')
    expect(draftStorageKey('w1')).toBe('workout-draft:w1')
    expect(draftStorageKey()).not.toBe(draftStorageKey('w1'))
  })
})

describe('serializeDraft → deserializeDraft round-trip', () => {
  it('restores the draft, name, and session start intact', () => {
    // Arrange
    const raw = serializeDraft({ draft: DRAFT, name: 'Leg Day', unit: 'kg', openedAt: OPENED, now: NOW })

    // Act — read back a minute later
    const restored = deserializeDraft(raw, { unit: 'kg', now: new Date(NOW.getTime() + 60_000) })

    // Assert
    expect(restored).not.toBeNull()
    expect(restored!.draft).toEqual(DRAFT)
    expect(restored!.name).toBe('Leg Day')
    expect(restored!.openedAt).toEqual(OPENED)
  })
})

describe('deserializeDraft rejection (returns null, never throws)', () => {
  it('rejects null and unparseable JSON', () => {
    expect(deserializeDraft(null, { unit: 'kg', now: NOW })).toBeNull()
    expect(deserializeDraft('{truncated', { unit: 'kg', now: NOW })).toBeNull()
    expect(deserializeDraft('"a string"', { unit: 'kg', now: NOW })).toBeNull()
  })

  it('rejects a snapshot older than the TTL', () => {
    // Arrange — saved 12h+1s before now
    const later = new Date(NOW.getTime() + DRAFT_TTL_MS + 1_000)

    // Act + Assert
    expect(deserializeDraft(snapshot(), { unit: 'kg', now: later })).toBeNull()
  })

  it('rejects a snapshot saved in the future (clock skew)', () => {
    const earlier = new Date(NOW.getTime() - 1_000)
    expect(deserializeDraft(snapshot(), { unit: 'kg', now: earlier })).toBeNull()
  })

  it('rejects a different storage version', () => {
    expect(
      deserializeDraft(snapshot({ v: DRAFT_STORAGE_VERSION + 1 }), { unit: 'kg', now: NOW }),
    ).toBeNull()
  })

  it('rejects a unit mismatch instead of lossily converting weight strings', () => {
    expect(deserializeDraft(snapshot(), { unit: 'lb', now: NOW })).toBeNull()
  })

  it('rejects invalid dates', () => {
    expect(deserializeDraft(snapshot({ savedAt: 'not-a-date' }), { unit: 'kg', now: NOW })).toBeNull()
    expect(deserializeDraft(snapshot({ openedAt: 'not-a-date' }), { unit: 'kg', now: NOW })).toBeNull()
  })

  it('rejects an empty draft — nothing worth restoring', () => {
    expect(
      deserializeDraft(snapshot({ draft: { exercises: [] } }), { unit: 'kg', now: NOW }),
    ).toBeNull()
  })

  it('rejects malformed exercises and sets (storage is untrusted)', () => {
    const badSet = {
      exercises: [{ ...DRAFT.exercises[0], sets: [{ id: 's1', reps: 5, weight: '100', completed: false }] }],
    }
    const badExercise = { exercises: [{ id: 'ex1', name: 'Squat' }] }

    expect(deserializeDraft(snapshot({ draft: badSet }), { unit: 'kg', now: NOW })).toBeNull()
    expect(deserializeDraft(snapshot({ draft: badExercise }), { unit: 'kg', now: NOW })).toBeNull()
    expect(deserializeDraft(snapshot({ draft: null }), { unit: 'kg', now: NOW })).toBeNull()
  })
})
