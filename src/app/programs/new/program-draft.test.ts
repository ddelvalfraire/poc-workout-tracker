import { describe, it, expect } from 'vitest'
import {
  programDraftReducer,
  draftToProgramInput,
  detailToProgramDraft,
  emptyProgramDraft,
  newDraftProgramDay,
  newDraftProgramExercise,
  newDraftProgramSet,
  buildStoredProgramDraft,
  parseStoredProgramDraft,
  toggleWeekday,
  STORED_PROGRAM_DRAFT_TTL_MS,
  type DraftProgramSet,
  type ProgramDraft,
} from './program-draft'
import type { ProgramDetail } from '@/db/programs'
import type { Progression } from '@/lib/program-input'

/** A minimal editable set: targets only, all pass-through fields at defaults. */
function draftSet(id: string, overrides: Partial<DraftProgramSet> = {}): DraftProgramSet {
  return {
    id,
    repMin: '5',
    repMax: '5',
    load: '100',
    rpe: '',
    restSec: '',
    setType: 'working',
    metricMode: 'reps_weight',
    rir: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    technique: null,
    ...overrides,
  }
}

const BENCH = { wgerExerciseId: 1, source: 'wger' as const, name: 'Bench Press', category: 'Chest' }

/** A draft with two days (one exercise, two sets on day 0) for nested updates. */
const NESTED: ProgramDraft = {
  name: 'PPL',
  mesocycleWeeks: '6',
  deloadWeek: '6',
  autoregulation: true,
  autoregStallPolicy: 'all-sets',
  deloadPolicy: null,
  planSync: true,
  checkInEveryDays: '',
  status: 'draft',
  notes: null,
  description: null,
  icon: null,
  heroImageUrl: null,
  sourceUrl: null,
  days: [
    {
      id: 'd1',
      name: 'Push',
      notes: null,
      weekdays: [1, 3, 5],
      exercises: [
        { id: 'ex1', ...BENCH, progression: null, trainingMax: '', trainingMaxFromE1rm: false, supersetGroup: null, sets: [draftSet('s1'), draftSet('s2')] },
      ],
    },
    { id: 'd2', name: 'Pull', notes: null, weekdays: [], exercises: [] },
  ],
}

describe('programDraftReducer', () => {
  it('ADD_DAY appends and REMOVE_DAY drops the targeted day, preserving order', () => {
    // Arrange
    const day = { id: 'd3', name: 'Legs', notes: null, weekdays: [], exercises: [] }

    // Act
    const added = programDraftReducer(NESTED, { type: 'ADD_DAY', day })
    const removed = programDraftReducer(added, { type: 'REMOVE_DAY', index: 0 })

    // Assert — order preserved, fresh arrays
    expect(added.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs'])
    expect(removed.days.map((d) => d.name)).toEqual(['Pull', 'Legs'])
    expect(NESTED.days).toHaveLength(2)
  })

  it('RENAME_DAY changes only the targeted day', () => {
    // Act
    const next = programDraftReducer(NESTED, { type: 'RENAME_DAY', index: 1, name: 'Upper' })

    // Assert
    expect(next.days[1].name).toBe('Upper')
    expect(next.days[0]).toBe(NESTED.days[0]) // untouched sibling by reference
  })

  it('SET_DAY_WEEKDAYS replaces only the targeted day schedule', () => {
    // Act
    const next = programDraftReducer(NESTED, {
      type: 'SET_DAY_WEEKDAYS',
      index: 1,
      weekdays: [0, 6],
    })

    // Assert
    expect(next.days[1].weekdays).toEqual([0, 6])
    expect(next.days[0]).toBe(NESTED.days[0]) // untouched sibling by reference
    expect(NESTED.days[1].weekdays).toEqual([]) // no mutation
  })

  it('toggleWeekday adds sorted and removes without mutating', () => {
    const base = [1, 5]

    expect(toggleWeekday(base, 3)).toEqual([1, 3, 5]) // insert keeps ascending order
    expect(toggleWeekday(base, 5)).toEqual([1]) // second tap removes
    expect(base).toEqual([1, 5]) // input untouched
  })

  it('ADD_EXERCISE and REMOVE_EXERCISE are day-scoped', () => {
    // Arrange
    const exercise = { id: 'ex2', ...BENCH, progression: null, trainingMax: '', trainingMaxFromE1rm: false, supersetGroup: null, sets: [] }

    // Act
    const added = programDraftReducer(NESTED, { type: 'ADD_EXERCISE', dayIndex: 1, exercise })
    const removed = programDraftReducer(added, { type: 'REMOVE_EXERCISE', dayIndex: 1, index: 0 })

    // Assert
    expect(added.days[1].exercises).toHaveLength(1)
    expect(added.days[0].exercises).toHaveLength(1) // other day untouched
    expect(removed.days[1].exercises).toHaveLength(0)
  })

  it('UPDATE_SET changes only the targeted field, siblings referentially identical', () => {
    // Act
    const next = programDraftReducer(NESTED, {
      type: 'UPDATE_SET',
      dayIndex: 0,
      exerciseIndex: 0,
      setIndex: 1,
      field: 'repMax',
      value: '8',
    })

    // Assert — target updated, untouched sibling is the same object
    expect(next.days[0].exercises[0].sets[1].repMax).toBe('8')
    expect(next.days[0].exercises[0].sets[0]).toBe(NESTED.days[0].exercises[0].sets[0])
    expect(next.days[1]).toBe(NESTED.days[1])

    // Assert — no mutation of prev state
    expect(next).not.toBe(NESTED)
    expect(NESTED.days[0].exercises[0].sets[1].repMax).toBe('5')
  })

  it('ADD_SET and REMOVE_SET target the addressed exercise', () => {
    // Arrange
    const set = draftSet('s3', { repMin: '', repMax: '', load: '' })

    // Act
    const added = programDraftReducer(NESTED, {
      type: 'ADD_SET',
      dayIndex: 0,
      exerciseIndex: 0,
      set,
    })
    const removed = programDraftReducer(added, {
      type: 'REMOVE_SET',
      dayIndex: 0,
      exerciseIndex: 0,
      setIndex: 0,
    })

    // Assert
    expect(added.days[0].exercises[0].sets).toHaveLength(3)
    expect(removed.days[0].exercises[0].sets.map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('SET_META patches the targeted meta field only', () => {
    // Act
    const next = programDraftReducer(NESTED, { type: 'SET_META', field: 'deloadWeek', value: '' })

    // Assert
    expect(next.deloadWeek).toBe('')
    expect(next.name).toBe('PPL')
    expect(next.days).toBe(NESTED.days)
  })
})

describe('programDraftReducer RESTORE_DRAFT', () => {
  it('replaces the whole state with the provided draft', () => {
    const next = programDraftReducer(emptyProgramDraft, { type: 'RESTORE_DRAFT', draft: NESTED })
    expect(next).toBe(NESTED)
  })
})

describe('stored program draft (localStorage persistence)', () => {
  const NOW = new Date('2026-07-08T10:00:00Z')

  it('SET_AUTOREGULATION flips the switch without touching other meta', () => {
    // Act
    const next = programDraftReducer(NESTED, { type: 'SET_AUTOREGULATION', value: false })

    // Assert
    expect(next.autoregulation).toBe(false)
    expect(next.name).toBe(NESTED.name)
    expect(NESTED.autoregulation).toBe(true) // input untouched
  })

  it('SET_PLAN_SYNC flips the switch without touching other meta', () => {
    // Act
    const next = programDraftReducer(NESTED, { type: 'SET_PLAN_SYNC', value: false })

    // Assert
    expect(next.planSync).toBe(false)
    expect(next.autoregulation).toBe(NESTED.autoregulation)
    expect(NESTED.planSync).toBe(true) // input untouched
  })

  it('SET_DELOAD_POLICY stores the picked policy and rides the save mapping', () => {
    // Act — pick reactive, then map to the server payload
    const next = programDraftReducer(NESTED, {
      type: 'SET_DELOAD_POLICY',
      value: { mode: 'reactive' },
    })

    // Assert — stored, emitted, and the input untouched (null = pass-through)
    expect(next.deloadPolicy).toEqual({ mode: 'reactive' })
    expect(draftToProgramInput(next).deloadPolicy).toEqual({ mode: 'reactive' })
    expect(NESTED.deloadPolicy).toBeNull()
    expect(draftToProgramInput(NESTED).deloadPolicy).toBeNull()
  })

  it('round-trips a draft through build → parse', () => {
    // Act
    const raw = buildStoredProgramDraft(NESTED, NOW)
    const restored = parseStoredProgramDraft(raw, NOW)

    // Assert — full fidelity, pass-through fields included
    expect(restored).toEqual(NESTED)
  })

  it('rejects an expired draft', () => {
    // Arrange — saved just past the TTL
    const raw = buildStoredProgramDraft(NESTED, NOW)
    const later = new Date(NOW.getTime() + STORED_PROGRAM_DRAFT_TTL_MS + 1)

    // Act / Assert
    expect(parseStoredProgramDraft(raw, later)).toBeNull()
  })

  it('rejects malformed JSON and wrong shapes', () => {
    expect(parseStoredProgramDraft('not json', NOW)).toBeNull()
    expect(parseStoredProgramDraft('{}', NOW)).toBeNull()
    expect(parseStoredProgramDraft(JSON.stringify({ v: 99, savedAt: NOW.toISOString(), draft: NESTED }), NOW)).toBeNull()
    expect(
      parseStoredProgramDraft(
        JSON.stringify({ v: 1, savedAt: NOW.toISOString(), draft: { name: 5, days: 'nope' } }),
        NOW,
      ),
    ).toBeNull()
  })

  it('round-trips a set restSec through build → parse', () => {
    // Arrange
    const withRest = {
      ...NESTED,
      days: [
        {
          ...NESTED.days[0],
          exercises: [
            {
              ...NESTED.days[0].exercises[0],
              sets: [draftSet('s1', { restSec: '90' })],
            },
          ],
        },
      ],
    }

    // Act
    const restored = parseStoredProgramDraft(buildStoredProgramDraft(withRest, NOW), NOW)

    // Assert
    expect(restored?.days[0].exercises[0].sets[0].restSec).toBe('90')
  })

  it("restores a LEGACY draft (stored before restSec existed) with restSec defaulted to ''", () => {
    // Arrange — strip restSec from every set, as a pre-feature envelope stored it
    const legacySet: Record<string, unknown> = { ...draftSet('s1') }
    delete legacySet.restSec
    const legacy = {
      ...NESTED,
      days: [
        {
          ...NESTED.days[0],
          exercises: [{ ...NESTED.days[0].exercises[0], sets: [legacySet] }],
        },
      ],
    }
    const raw = JSON.stringify({ v: 1, savedAt: NOW.toISOString(), draft: legacy })

    // Act
    const restored = parseStoredProgramDraft(raw, NOW)

    // Assert — the day-old 30-set build survives, rest simply unset
    expect(restored).not.toBeNull()
    expect(restored?.days[0].exercises[0].sets[0].restSec).toBe('')
  })

  it('rejects a draft whose nested rows are malformed', () => {
    // Arrange — a set with a numeric repMin (must be an input string)
    const bad = {
      ...NESTED,
      days: [
        {
          ...NESTED.days[0],
          exercises: [
            {
              ...NESTED.days[0].exercises[0],
              sets: [{ ...draftSet('s1'), repMin: 5 }],
            },
          ],
        },
      ],
    }

    // Act / Assert
    expect(
      parseStoredProgramDraft(
        JSON.stringify({ v: 1, savedAt: NOW.toISOString(), draft: bad }),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('legacy stored drafts (pre-composite-identity)', () => {
  const NOW = new Date('2026-07-08T10:00:00Z')

  it("restores a draft stored before source/supersetGroup existed with 'wger'/null defaults", () => {
    // Arrange — strip the identity fields, as a pre-4b envelope stored them
    const legacyExercise: Record<string, unknown> = {
      ...NESTED.days[0].exercises[0],
    }
    delete legacyExercise.source
    delete legacyExercise.supersetGroup
    const legacyDraft = {
      ...NESTED,
      days: [{ ...NESTED.days[0], exercises: [legacyExercise] }],
    }
    const raw = JSON.stringify({ v: 1, savedAt: NOW.toISOString(), draft: legacyDraft })

    // Act
    const restored = parseStoredProgramDraft(raw, NOW)

    // Assert — restores (not discarded) with backfilled identity defaults
    expect(restored?.days[0].exercises[0]).toMatchObject({
      source: 'wger',
      supersetGroup: null,
    })
  })

  it('restores a pre-schedule draft (no day weekdays) as unscheduled', () => {
    // Arrange — a day stored before the weekdays field existed
    const legacyDay: Record<string, unknown> = { ...NESTED.days[1] }
    delete legacyDay.weekdays
    const legacyDraft = { ...NESTED, days: [legacyDay] }
    const raw = JSON.stringify({ v: 1, savedAt: NOW.toISOString(), draft: legacyDraft })

    // Act
    const restored = parseStoredProgramDraft(raw, NOW)

    // Assert — restored (not discarded), backfilled to unscheduled
    expect(restored?.days[0].weekdays).toEqual([])
  })
})

describe('draftToProgramInput', () => {
  it('converts entered lb loads back to canonical kg', () => {
    // Arrange — a single 220.5 lb set
    const draft: ProgramDraft = {
      ...NESTED,
      days: [
        {
          id: 'd1',
          name: 'Push',
          notes: null,
          weekdays: [],
          exercises: [
            { id: 'ex1', ...BENCH, progression: null, trainingMax: '', trainingMaxFromE1rm: false, supersetGroup: null, sets: [draftSet('s1', { load: '220.5' })] },
          ],
        },
      ],
    }

    // Act
    const input = draftToProgramInput(draft, 'lb')

    // Assert — 220.5 lb × 0.45359237 ≈ 100.02 kg at column precision
    expect(input.days[0].exercises[0].sets[0].suggestedLoadKg).toBeCloseTo(100, 1)
  })

  it('maps blanks to null, blank deload to null, and drops a blank name', () => {
    // Arrange
    const draft: ProgramDraft = {
      name: '   ',
      mesocycleWeeks: '',
      deloadWeek: '',
      autoregulation: true,
      autoregStallPolicy: 'all-sets',
      deloadPolicy: null,
      planSync: true,
      checkInEveryDays: '',
      status: 'draft',
      notes: null,
      description: null,
      icon: null,
      heroImageUrl: null,
      sourceUrl: null,
      days: [
        {
          id: 'd1',
          name: 'Push',
          notes: null,
          weekdays: [],
          exercises: [
            {
              id: 'ex1',
              ...BENCH,
              progression: null,
              trainingMax: '',
              trainingMaxFromE1rm: false,
              supersetGroup: null,
              sets: [draftSet('s1', { repMin: '', repMax: '', load: '', rpe: '', restSec: '' })],
            },
          ],
        },
      ],
    }

    // Act
    const input = draftToProgramInput(draft)

    // Assert
    expect(input).not.toHaveProperty('name')
    expect(input.mesocycleWeeks).toBe(1) // blank → schema default
    expect(input.deloadWeek).toBeNull()
    expect(input.days[0].exercises[0].sets[0]).toMatchObject({
      repMin: null,
      repMax: null,
      suggestedLoadKg: null,
      rpe: null,
      restSec: null,
    })
  })

  it('emits restSec as a plain number — seconds are unit-less, never converted', () => {
    // Arrange
    const draft: ProgramDraft = {
      ...NESTED,
      days: [
        {
          ...NESTED.days[0],
          exercises: [
            {
              ...NESTED.days[0].exercises[0],
              sets: [draftSet('s1', { restSec: '150' })],
            },
          ],
        },
      ],
    }

    // Act — lb unit converts loads; restSec must be untouched by it
    const input = draftToProgramInput(draft, 'lb')

    // Assert
    expect(input.days[0].exercises[0].sets[0].restSec).toBe(150)
  })

  it('emits each day schedule verbatim (edit round-trip must not wipe it)', () => {
    // Act — NESTED's day 0 is scheduled Mon/Wed/Fri, day 1 unscheduled
    const input = draftToProgramInput(NESTED)

    // Assert
    expect(input.days[0].weekdays).toEqual([1, 3, 5])
    expect(input.days[1].weekdays).toEqual([])
  })

  it('parses targets and keeps a trimmed name', () => {
    // Arrange
    const draft: ProgramDraft = { ...NESTED, name: '  PPL Hypertrophy  ' }

    // Act
    const input = draftToProgramInput(draft)

    // Assert
    expect(input.name).toBe('PPL Hypertrophy')
    expect(input.mesocycleWeeks).toBe(6)
    expect(input.deloadWeek).toBe(6)
    expect(input.days[0].exercises[0].sets[0]).toMatchObject({
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 5,
      repMax: 5,
      suggestedLoadKg: 100,
    })
  })

  it('re-emits agent-authored JSONB pass-through verbatim (data-loss guard)', () => {
    // Arrange — a progression scheme and a technique the builder never displays
    const progression: Progression = { scheme: 'linear', incrementKg: 2.5 }
    const technique = {
      version: 1 as const,
      kind: 'drop-set' as const,
      stages: [{ loadKg: 80, reps: 8 }],
    }
    const draft: ProgramDraft = {
      ...NESTED,
      notes: 'agent notes',
      days: [
        {
          id: 'd1',
          name: 'Push',
          notes: 'day notes',
          weekdays: [],
          exercises: [
            {
              id: 'ex1',
              ...BENCH,
              progression,
              trainingMax: '',
              trainingMaxFromE1rm: false,
              supersetGroup: null,
              sets: [
                draftSet('s1', {
                  setType: 'amrap',
                  metricMode: 'duration',
                  rir: 2,
                  tempo: '3-1-1',
                  durationSec: 60,
                  distanceM: 400,
                  technique,
                }),
              ],
            },
          ],
        },
      ],
    }

    // Act
    const input = draftToProgramInput(draft)

    // Assert — everything the UI doesn't edit survives the round-trip
    expect(input.notes).toBe('agent notes')
    expect(input.days[0].notes).toBe('day notes')
    expect(input.days[0].exercises[0].progression).toEqual(progression)
    expect(input.days[0].exercises[0].sets[0]).toMatchObject({
      setType: 'amrap',
      metricMode: 'duration',
      rir: 2,
      tempo: '3-1-1',
      durationSec: 60,
      distanceM: 400,
      technique,
    })
  })
})

describe('detailToProgramDraft', () => {
  /** A minimal persisted program with one day/exercise/set + JSONB tails. */
  const DETAIL: ProgramDetail = {
    id: 'p1',
    userId: 'user_123',
    name: 'PPL',
    status: 'active',
    authorActor: 'coach',
    autoregulation: true,
    autoregStallPolicy: 'first-set',
    deloadPolicy: null,
    planSync: false,
    checkInEveryDays: 14,
    visibility: 'private',
    mesocycleWeeks: 6,
    deloadWeek: 6,
    notes: 'agent notes',
    description: 'A push/pull/legs block for intermediates.',
    icon: '🏋️',
    heroImageUrl: 'https://example.com/hero.jpg',
    sourceUrl: 'https://example.com/source',
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [
      {
        id: 'd1',
        programId: 'p1',
        name: 'Push',
        position: 0,
        notes: 'day notes',
        weekdays: [1, 3, 5],
        exercises: [
          {
            id: 'ex1',
            programDayId: 'd1',
            wgerExerciseId: 1,
            source: 'wger',
            name: 'Bench Press',
            position: 0,
            supersetGroup: null,
            progression: { scheme: 'linear', incrementKg: 2.5 },
            muscles: [],
            sets: [
              {
                id: 's1',
                programExerciseId: 'ex1',
                setNumber: 1,
                setType: 'working',
                metricMode: 'reps_weight',
                repMin: 5,
                repMax: 8,
                rir: 2,
                rpe: 8,
                suggestedLoadKg: 100,
                tempo: '3-1-1',
                durationSec: null,
                distanceM: null,
                restSec: 90,
                technique: null,
                overrides: [],
              },
            ],
          },
        ],
      },
    ],
  }

  it('round-trips a ProgramDetail: row ids reused, numbers → strings, pass-through kept', () => {
    // Act
    const draft = detailToProgramDraft(DETAIL)

    // Assert — meta
    expect(draft).toMatchObject({
      name: 'PPL',
      mesocycleWeeks: '6',
      deloadWeek: '6',
      status: 'active',
      notes: 'agent notes',
      // A stored OFF must seed the editor OFF — not the emptyProgramDraft
      // default — or saving the edit would flip the switch back ON.
      planSync: false,
      // A stored cadence must seed the input, or saving the edit clears it.
      checkInEveryDays: '14',
    })

    // Article metadata is pass-through: a UI edit is a full replace, so the
    // draft must carry all four fields verbatim AND re-emit them server-bound
    // — otherwise editing a coach/import-authored program wipes its article.
    expect(draft).toMatchObject({
      description: 'A push/pull/legs block for intermediates.',
      icon: '🏋️',
      heroImageUrl: 'https://example.com/hero.jpg',
      sourceUrl: 'https://example.com/source',
    })
    expect(draftToProgramInput(draft)).toMatchObject({
      description: 'A push/pull/legs block for intermediates.',
      icon: '🏋️',
      heroImageUrl: 'https://example.com/hero.jpg',
      sourceUrl: 'https://example.com/source',
    })

    // The day schedule must survive the same edit round-trip: detail → draft
    // carries it, draft → input re-emits it (a save is a full replace).
    expect(draft.days[0].weekdays).toEqual([1, 3, 5])
    expect(draftToProgramInput(draft).days[0].weekdays).toEqual([1, 3, 5])

    // Assert — row UUIDs reused as client ids; category not persisted → ''
    expect(draft.days[0].id).toBe('d1')
    expect(draft.days[0].exercises[0]).toMatchObject({
      id: 'ex1',
      wgerExerciseId: 1,
      name: 'Bench Press',
      category: '',
      progression: { scheme: 'linear', incrementKg: 2.5 },
    })
    expect(draft.days[0].exercises[0].sets[0]).toMatchObject({
      id: 's1',
      repMin: '5',
      repMax: '8',
      load: '100',
      rpe: '8',
      rir: 2,
      tempo: '3-1-1',
      restSec: '90', // stored seconds → input string, like the other targets
    })
  })

  it('converts stored kg loads to the display unit (lb)', () => {
    // Act — 100 kg → 220.46… → "220.5"
    const draft = detailToProgramDraft(DETAIL, 'lb')

    // Assert
    expect(draft.days[0].exercises[0].sets[0].load).toBe('220.5')
  })

  it('survives a full edit round-trip without losing JSONB (draft → input)', () => {
    // Act — the exact path the edit page takes: detail → draft → server payload
    const input = draftToProgramInput(detailToProgramDraft(DETAIL))

    // Assert — status, progression, targets, and the plan-sync opt-out all intact
    expect(input).toMatchObject({
      name: 'PPL',
      status: 'active',
      mesocycleWeeks: 6,
      deloadWeek: 6,
      planSync: false,
      checkInEveryDays: 14,
    })
    expect(input.days[0].exercises[0].progression).toEqual({ scheme: 'linear', incrementKg: 2.5 })
    expect(input.days[0].exercises[0].sets[0]).toMatchObject({
      repMin: 5,
      repMax: 8,
      suggestedLoadKg: 100,
      rpe: 8,
      rir: 2,
      tempo: '3-1-1',
    })
  })

  /** DETAIL with the one exercise's progression swapped (immutably). */
  function withProgression(progression: Progression): ProgramDetail {
    return {
      ...DETAIL,
      days: [
        {
          ...DETAIL.days[0],
          exercises: [{ ...DETAIL.days[0].exercises[0], progression }],
        },
      ],
    }
  }

  const AMRAP: Progression = {
    scheme: 'amrap-cycle',
    trainingMaxKg: 0,
    incrementKg: 2.5,
    wave: [[0.65, 0.75, 0.85]],
  }

  it('seeds the TM input from a stored training max (display unit, no e1RM caption)', () => {
    // Act
    const draft = detailToProgramDraft(
      withProgression({ scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.8] }),
      'lb',
    )

    // Assert — 100 kg → 220.5 lb; a real stored TM never claims e1RM provenance.
    expect(draft.days[0].exercises[0].trainingMax).toBe('220.5')
    expect(draft.days[0].exercises[0].trainingMaxFromE1rm).toBe(false)
  })

  it('prefills e1rm × 0.85 (display-unit rounded) for a TM-0 sketch with history', () => {
    // Arrange — e1RM 120 kg → TM suggestion 102 kg.
    const e1rms = new Map([['wger:1', 120]])

    // Act
    const draft = detailToProgramDraft(withProgression(AMRAP), 'kg', e1rms)

    // Assert — prefilled AND flagged for the "from your e1RM" caption.
    expect(draft.days[0].exercises[0].trainingMax).toBe('102')
    expect(draft.days[0].exercises[0].trainingMaxFromE1rm).toBe(true)
  })

  it('leaves the TM blank when a sketch has no e1RM history', () => {
    // Act
    const draft = detailToProgramDraft(withProgression(AMRAP), 'kg', new Map())

    // Assert
    expect(draft.days[0].exercises[0].trainingMax).toBe('')
    expect(draft.days[0].exercises[0].trainingMaxFromE1rm).toBe(false)
  })

  it('merges an edited TM back into the progression at save time (unit-converted)', () => {
    // Arrange — seed, then the user types 230 (lb).
    const draft = detailToProgramDraft(
      withProgression({ scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.8] }),
      'lb',
    )
    const edited = programDraftReducer(draft, {
      type: 'UPDATE_EXERCISE_TM',
      dayIndex: 0,
      index: 0,
      value: '230',
    })

    // Act
    const input = draftToProgramInput(edited, 'lb')

    // Assert — 230 lb → 104.33 kg (column precision), percents untouched.
    expect(input.days[0].exercises[0].progression).toEqual({
      scheme: 'percent-1rm',
      trainingMaxKg: 104.33,
      weekPercents: [0.8],
    })
  })

  it('a blank TM input leaves the stored progression verbatim at save time', () => {
    // Arrange — sketch (TM 0), no prefill, user typed nothing.
    const draft = detailToProgramDraft(withProgression(AMRAP), 'kg')

    // Act
    const input = draftToProgramInput(draft, 'kg')

    // Assert — the sketch's TM 0 survives untouched (no invented value).
    expect(input.days[0].exercises[0].progression).toEqual(AMRAP)
  })

  it('UPDATE_EXERCISE_TM clears the e1RM-provenance flag on the first edit', () => {
    // Arrange
    const draft = detailToProgramDraft(withProgression(AMRAP), 'kg', new Map([['wger:1', 120]]))

    // Act
    const edited = programDraftReducer(draft, {
      type: 'UPDATE_EXERCISE_TM',
      dayIndex: 0,
      index: 0,
      value: '105',
    })

    // Assert
    expect(edited.days[0].exercises[0].trainingMax).toBe('105')
    expect(edited.days[0].exercises[0].trainingMaxFromE1rm).toBe(false)
  })
})

describe('composite identity round-trip (detail → draft → input)', () => {
  it('preserves source and supersetGroup through an edit round-trip', () => {
    // Arrange — a persisted custom slot in a superset
    const detail = {
      id: 'p1',
      userId: 'user_123',
      name: 'P',
      status: 'active',
      mesocycleWeeks: 4,
      deloadWeek: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      days: [
        {
          id: 'd1',
          programId: 'p1',
          name: 'Upper',
          position: 0,
          notes: null,
          exercises: [
            {
              id: 'ex1',
              programDayId: 'd1',
              wgerExerciseId: 9,
              source: 'custom',
              name: 'Cable Face Pull',
              position: 0,
              supersetGroup: 1,
              progression: null,
              muscles: [],
              sets: [
                {
                  id: 's1',
                  programExerciseId: 'ex1',
                  setNumber: 1,
                  setType: 'working',
                  metricMode: 'reps_weight',
                  repMin: 12,
                  repMax: 15,
                  rir: null,
                  rpe: null,
                  suggestedLoadKg: 25,
                  tempo: null,
                  durationSec: null,
                  distanceM: null,
                  restSec: null,
                  technique: null,
                  overrides: [],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ProgramDetail

    // Act — hydrate for edit, then map back to the save payload
    const draft = detailToProgramDraft(detail)
    const payload = draftToProgramInput(draft)

    // Assert — the full-replace save re-emits the composite identity intact
    expect(draft.days[0].exercises[0]).toMatchObject({ source: 'custom', supersetGroup: 1 })
    expect(payload.days[0].exercises[0]).toMatchObject({
      wgerExerciseId: 9,
      source: 'custom',
      supersetGroup: 1,
    })
  })
})

describe('id factories', () => {
  it('newDraftProgramExercise seeds one empty set with distinct stable ids', () => {
    // Act
    const exercise = newDraftProgramExercise(BENCH)

    // Assert
    expect(exercise).toMatchObject({ ...BENCH, progression: null })
    expect(exercise.sets).toHaveLength(1)
    expect(exercise.sets[0]).toMatchObject({ repMin: '', repMax: '', load: '', rpe: '' })
    expect(exercise.id).not.toBe(exercise.sets[0].id)
  })

  it('newDraftProgramDay builds an empty named day; newDraftProgramSet ids are unique', () => {
    // Act + Assert
    expect(newDraftProgramDay('Push')).toMatchObject({ name: 'Push', notes: null, exercises: [] })
    expect(newDraftProgramSet().id).not.toBe(newDraftProgramSet().id)
  })
})

describe('emptyProgramDraft', () => {
  it('starts with no days and draft status', () => {
    expect(emptyProgramDraft).toMatchObject({ name: '', days: [], status: 'draft' })
  })
})
