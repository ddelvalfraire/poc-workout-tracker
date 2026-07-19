import { describe, it, expect } from 'vitest'
import {
  DRAFT_PAYLOAD_VERSION,
  DRAFT_TTL_MS,
  draftKey,
  buildDraftPayload,
  isDraftPayload,
  parseDraftPayload,
  resolveDraftSeed,
} from './draft-payload'
import type { WorkoutDraft } from './workout-draft'

const OPENED = new Date('2026-07-05T11:40:00.000Z')
const NOW = new Date('2026-07-05T12:00:00.000Z')

/** A draft mid-session: one checked set, one still blank. */
const DRAFT: WorkoutDraft = { notes: '',
  exercises: [
    {
      id: 'ex1',
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Squat',
      category: 'Legs',
      loggingType: 'weight_reps',
      notes: '',
      skipped: false,
      sets: [
        { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' as const },
        { id: 's2', reps: '', weight: '', completed: false, tag: 'working' as const },
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
    const restored = parseDraftPayload(stored, { unit: 'kg', now: NOW })

    // Assert
    expect(restored).not.toBeNull()
    expect(restored!.draft).toEqual(DRAFT)
    expect(restored!.name).toBe('Leg Day')
    expect(restored!.openedAt).toEqual(OPENED)
  })

  it('accepts a legacy payload without loggingType and defaults it to weight_reps', () => {
    // Arrange — a payload persisted before logging types existed
    const legacyExercise = { ...DRAFT.exercises[0] } as Record<string, unknown>
    delete legacyExercise.loggingType
    const legacy = payload({ draft: { exercises: [legacyExercise] } })

    // Act
    const restored = parseDraftPayload(JSON.parse(JSON.stringify(legacy)), {
      unit: 'kg',
      now: NOW,
    })

    // Assert — restorable, and fully controlled state gets the default
    expect(restored).not.toBeNull()
    expect(restored!.draft.exercises[0].loggingType).toBe('weight_reps')
  })

  it('round-trips the warm-up tag and defaults it on pre-tag payloads', () => {
    // Arrange — a payload whose first set is tagged, plus a legacy set without
    // a tag. Cloned: payload() shares the module DRAFT by reference.
    const raw = structuredClone(payload())
    const draft = raw.draft as { exercises: { sets: Record<string, unknown>[] }[] }
    draft.exercises[0].sets[0].tag = 'warmup'
    delete draft.exercises[0].sets[1].tag

    // Act
    const restored = parseDraftPayload(raw, { unit: 'kg', now: NOW })

    // Assert
    expect(restored?.draft.exercises[0].sets.map((s) => s.tag)).toEqual(['warmup', 'working'])
  })

  it('rejects a payload whose set tag is not on the whitelist', () => {
    // Arrange — cloned for the same shared-reference reason as above
    const raw = structuredClone(payload())
    const draft = raw.draft as { exercises: { sets: Record<string, unknown>[] }[] }
    draft.exercises[0].sets[0].tag = 'backoff'

    // Assert
    expect(isDraftPayload(raw)).toBe(false)
  })

  it('accepts a pre-discriminator payload without source and defaults it to wger', () => {
    // Arrange — a payload persisted before custom exercises existed
    const legacyExercise = { ...DRAFT.exercises[0] } as Record<string, unknown>
    delete legacyExercise.source
    const legacy = payload({ draft: { exercises: [legacyExercise] } })

    // Act
    const restored = parseDraftPayload(JSON.parse(JSON.stringify(legacy)), {
      unit: 'kg',
      now: NOW,
    })

    // Assert — restorable, and the identity default is explicit
    expect(restored).not.toBeNull()
    expect(restored!.draft.exercises[0].source).toBe('wger')
  })

  it('rejects a payload whose source is not on the whitelist', () => {
    const forged = { ...DRAFT.exercises[0], source: 'homemade' }
    const bad = payload({ draft: { exercises: [forged] } })

    expect(parseDraftPayload(JSON.parse(JSON.stringify(bad)), { unit: 'kg', now: NOW })).toBeNull()
  })

  it('round-trips notes and skip state intact (offline resume keeps both)', () => {
    // Arrange — a noted workout with a skipped, noted exercise
    const raw = structuredClone(payload())
    const draft = raw.draft as {
      notes: string
      exercises: Record<string, unknown>[]
    }
    draft.notes = 'cut short'
    draft.exercises[0].notes = 'machine busy'
    draft.exercises[0].skipped = true

    // Act
    const restored = parseDraftPayload(JSON.parse(JSON.stringify(raw)), { unit: 'kg', now: NOW })

    // Assert
    expect(restored?.draft.notes).toBe('cut short')
    expect(restored?.draft.exercises[0]).toMatchObject({ notes: 'machine busy', skipped: true })
  })

  it('accepts a pre-notes payload and defaults notes/skipped on restore', () => {
    // Arrange — a payload persisted before notes/skip existed
    const raw = structuredClone(payload()) as Record<string, unknown>
    const draft = raw.draft as { notes?: string; exercises: Record<string, unknown>[] }
    delete draft.notes
    delete draft.exercises[0].notes
    delete draft.exercises[0].skipped

    // Act
    const restored = parseDraftPayload(JSON.parse(JSON.stringify(raw)), { unit: 'kg', now: NOW })

    // Assert — restorable, controlled state gets the defaults
    expect(restored).not.toBeNull()
    expect(restored!.draft.notes).toBe('')
    expect(restored!.draft.exercises[0]).toMatchObject({ notes: '', skipped: false })
  })

  it('rejects wrong-typed notes and skipped (payload is untrusted)', () => {
    const badWorkoutNotes = structuredClone(payload()) as Record<string, unknown>
    ;(badWorkoutNotes.draft as Record<string, unknown>).notes = 42
    expect(isDraftPayload(badWorkoutNotes)).toBe(false)

    const badExercise = structuredClone(payload())
    const draft = badExercise.draft as { exercises: Record<string, unknown>[] }
    draft.exercises[0].skipped = 'yes'
    expect(isDraftPayload(badExercise)).toBe(false)
  })

  it('clamps a future openedAt to now (cross-device clock skew)', () => {
    // Arrange — a draft written by a device whose clock runs 5 min fast
    const skewed = payload({ openedAt: new Date(NOW.getTime() + 5 * 60_000).toISOString() })

    // Act
    const restored = parseDraftPayload(skewed, { unit: 'kg', now: NOW })

    // Assert — a future session start would make the eventual save's
    // startedAt fail parseWorkoutInput's no-future-dates rule
    expect(restored).not.toBeNull()
    expect(restored!.openedAt).toEqual(NOW)
  })
})

describe('isDraftPayload / parseDraftPayload rejection', () => {
  it('rejects non-objects', () => {
    expect(isDraftPayload(null)).toBe(false)
    expect(isDraftPayload('a string')).toBe(false)
    expect(parseDraftPayload(undefined, { unit: 'kg', now: NOW })).toBeNull()
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
    expect(parseDraftPayload(lb, { unit: 'kg', now: NOW })).toBeNull()
  })

  it('rejects an unrecognized loggingType (present but not whitelisted)', () => {
    const badType = {
      exercises: [{ ...DRAFT.exercises[0], loggingType: 'machine' }],
    }
    expect(isDraftPayload(payload({ draft: badType }))).toBe(false)
  })

  it('rejects an invalid openedAt', () => {
    expect(isDraftPayload(payload({ openedAt: 'not-a-date' }))).toBe(false)
  })

  it('rejects an empty draft — nothing worth storing or restoring', () => {
    expect(isDraftPayload(payload({ draft: { exercises: [] } }))).toBe(false)
  })

  it('rejects malformed exercises and sets (payload is untrusted)', () => {
    const badSet = {
      exercises: [{ ...DRAFT.exercises[0], sets: [{ id: 's1', reps: 5, weight: '100', completed: false, tag: 'working' as const }] }],
    }
    const badExercise = { exercises: [{ id: 'ex1', name: 'Squat' }] }

    expect(isDraftPayload(payload({ draft: badSet }))).toBe(false)
    expect(isDraftPayload(payload({ draft: badExercise }))).toBe(false)
    expect(isDraftPayload(payload({ draft: null }))).toBe(false)
  })
})

describe('resolveDraftSeed', () => {
  const row = (ageMs: number, p: unknown = payload()) => ({
    payload: p,
    updatedAt: new Date(NOW.getTime() - ageMs),
  })

  it('parses a fresh row', () => {
    const seed = resolveDraftSeed(row(60_000), { unit: 'kg', now: NOW })

    expect(seed?.name).toBe('Leg Day')
    expect(seed?.openedAt).toEqual(OPENED)
  })

  it('keeps a row exactly at the TTL boundary (<= is inclusive)', () => {
    expect(resolveDraftSeed(row(DRAFT_TTL_MS), { unit: 'kg', now: NOW })).not.toBeNull()
  })

  it('skips a row just past the TTL', () => {
    expect(resolveDraftSeed(row(DRAFT_TTL_MS + 1), { unit: 'kg', now: NOW })).toBeNull()
  })

  it('returns null for a missing row', () => {
    expect(resolveDraftSeed(undefined, { unit: 'kg', now: NOW })).toBeNull()
  })

  it('returns null for a malformed payload (storage is untrusted)', () => {
    expect(resolveDraftSeed(row(60_000, { junk: true }), { unit: 'kg', now: NOW })).toBeNull()
  })
})
