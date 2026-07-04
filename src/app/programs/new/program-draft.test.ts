import { describe, it, expect } from 'vitest'
import {
  programDraftReducer,
  draftToProgramInput,
  detailToProgramDraft,
  emptyProgramDraft,
  newDraftProgramDay,
  newDraftProgramExercise,
  newDraftProgramSet,
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

const BENCH = { wgerExerciseId: 1, name: 'Bench Press', category: 'Chest' }

/** A draft with two days (one exercise, two sets on day 0) for nested updates. */
const NESTED: ProgramDraft = {
  name: 'PPL',
  mesocycleWeeks: '6',
  deloadWeek: '6',
  status: 'draft',
  notes: null,
  days: [
    {
      id: 'd1',
      name: 'Push',
      notes: null,
      exercises: [
        { id: 'ex1', ...BENCH, progression: null, sets: [draftSet('s1'), draftSet('s2')] },
      ],
    },
    { id: 'd2', name: 'Pull', notes: null, exercises: [] },
  ],
}

describe('programDraftReducer', () => {
  it('ADD_DAY appends and REMOVE_DAY drops the targeted day, preserving order', () => {
    // Arrange
    const day = { id: 'd3', name: 'Legs', notes: null, exercises: [] }

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

  it('ADD_EXERCISE and REMOVE_EXERCISE are day-scoped', () => {
    // Arrange
    const exercise = { id: 'ex2', ...BENCH, progression: null, sets: [] }

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
          exercises: [
            { id: 'ex1', ...BENCH, progression: null, sets: [draftSet('s1', { load: '220.5' })] },
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
      status: 'draft',
      notes: null,
      days: [
        {
          id: 'd1',
          name: 'Push',
          notes: null,
          exercises: [
            {
              id: 'ex1',
              ...BENCH,
              progression: null,
              sets: [draftSet('s1', { repMin: '', repMax: '', load: '', rpe: '' })],
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
    })
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
          exercises: [
            {
              id: 'ex1',
              ...BENCH,
              progression,
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
    mesocycleWeeks: 6,
    deloadWeek: 6,
    notes: 'agent notes',
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [
      {
        id: 'd1',
        programId: 'p1',
        name: 'Push',
        position: 0,
        notes: 'day notes',
        exercises: [
          {
            id: 'ex1',
            programDayId: 'd1',
            wgerExerciseId: 1,
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
    })

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

    // Assert — status, progression, and targets all intact
    expect(input).toMatchObject({ name: 'PPL', status: 'active', mesocycleWeeks: 6, deloadWeek: 6 })
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
