import { describe, it, expect } from 'vitest'
import type { AutoregAdjustment } from '@/lib/autoregulate'
import {
  programStatusLine,
  parseExpandParam,
  withExpanded,
  withoutExpanded,
  shouldDeriveDay,
  collectAutoregNotes,
  collectTmResetProposals,
  proposedTrainingMaxKg,
  groupEventsByDay,
  progressionLine,
} from './detail-view'

describe('programStatusLine', () => {
  const base = {
    currentWeek: 3,
    mesocycleWeeks: 7,
    deloadWeek: null,
    daysDoneThisWeek: 2,
    dayCountTotal: 4,
    blockComplete: false,
  }

  it('digests week position and remaining days', () => {
    expect(programStatusLine(base)).toBe('Week 3 of 7 · 2 days to go.')
  })

  it('singularizes one remaining day', () => {
    expect(programStatusLine({ ...base, daysDoneThisWeek: 3 })).toBe('Week 3 of 7 · 1 day to go.')
  })

  it('reads "week trained" when every day is done (and never goes negative)', () => {
    expect(programStatusLine({ ...base, daysDoneThisWeek: 4 })).toBe('Week 3 of 7 · week trained.')
    expect(programStatusLine({ ...base, daysDoneThisWeek: 9 })).toBe('Week 3 of 7 · week trained.')
  })

  it('announces a deload landing next week', () => {
    expect(programStatusLine({ ...base, deloadWeek: 4 })).toBe(
      'Week 3 of 7 · 2 days to go · deload next week.',
    )
  })

  it('names the current week as the deload when it is one', () => {
    expect(programStatusLine({ ...base, deloadWeek: 3 })).toBe(
      'Week 3 of 7 · deload week · 2 days to go.',
    )
  })

  it('collapses to the completion sentence when the block is complete', () => {
    expect(programStatusLine({ ...base, blockComplete: true })).toBe('Block complete.')
  })

  it('omits the day count for a dayless program', () => {
    expect(programStatusLine({ ...base, dayCountTotal: 0, daysDoneThisWeek: 0 })).toBe(
      'Week 3 of 7.',
    )
  })
})

describe('parseExpandParam', () => {
  it('returns an empty set when absent', () => {
    expect(parseExpandParam(undefined).size).toBe(0)
  })

  it('splits comma-separated ids and merges repeated params', () => {
    expect([...parseExpandParam('a,b')]).toEqual(['a', 'b'])
    expect([...parseExpandParam(['a', 'b,c'])]).toEqual(['a', 'b', 'c'])
  })

  it('drops blanks and trims whitespace', () => {
    expect([...parseExpandParam(' a , ,b,')]).toEqual(['a', 'b'])
    expect(parseExpandParam('').size).toBe(0)
  })

  it('dedupes repeated ids', () => {
    expect([...parseExpandParam('a,a')]).toEqual(['a'])
  })
})

describe('withExpanded / withoutExpanded', () => {
  it('adds a day id without duplicating', () => {
    expect(withExpanded(new Set(['a']), 'b')).toBe('a,b')
    expect(withExpanded(new Set(['a']), 'a')).toBe('a')
    expect(withExpanded(new Set(), 'a')).toBe('a')
  })

  it('removes a day id and signals param drop when empty', () => {
    expect(withoutExpanded(new Set(['a', 'b']), 'a')).toBe('b')
    expect(withoutExpanded(new Set(['a']), 'a')).toBeNull()
    expect(withoutExpanded(new Set(['a']), 'x')).toBe('a')
  })
})

describe('shouldDeriveDay', () => {
  it('derives the next-up day and expanded untouched days only', () => {
    expect(shouldDeriveDay(false, true, false)).toBe(true)
    expect(shouldDeriveDay(false, false, true)).toBe(true)
    expect(shouldDeriveDay(false, true, true)).toBe(true)
  })

  it('never derives resolved (done/in-progress) days', () => {
    expect(shouldDeriveDay(true, true, true)).toBe(false)
    expect(shouldDeriveDay(true, false, false)).toBe(false)
  })

  it('skips collapsed untouched days — the perf win', () => {
    expect(shouldDeriveDay(false, false, false)).toBe(false)
  })
})

const adjustment = (action: AutoregAdjustment['action']): AutoregAdjustment => ({
  action,
  deltaKg: action === 'decrement' ? -10 : 0,
  suggestEarlyDeload: false,
  stalledLoads: [100],
  evidence: { missedSets: 2, scorableSets: 3, repFloor: 8, loadKg: 100 },
})

describe('collectAutoregNotes', () => {
  const days = [
    { exercises: [{ name: 'Bench' }, { name: 'Row' }] },
    { exercises: [{ name: 'Bench' }, { name: 'Squat' }] },
  ]

  it('collects repeat and decrement verdicts with their exercise names', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
      [{ autoreg: null }, { autoreg: adjustment('decrement') }],
    ])
    expect(notes.map((n) => n.exerciseName)).toEqual(['Bench', 'Squat'])
    expect(notes[1].adjustment.action).toBe('decrement')
  })

  it('ignores progress verdicts (step/anchor)', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('step') }, { autoreg: adjustment('anchor') }],
      [],
    ])
    expect(notes).toEqual([])
  })

  it('dedupes an exercise repeated across days', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
    ])
    expect(notes).toHaveLength(1)
  })

  it('tolerates collapsed days with empty prescription arrays', () => {
    expect(collectAutoregNotes(days, [[], []])).toEqual([])
  })

  it('excludes flag verdicts — those surface as TM proposals, not notes', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('flag') }, { autoreg: null }],
      [],
    ])
    expect(notes).toEqual([])
  })
})

describe('proposedTrainingMaxKg', () => {
  it('reduces ~10% snapped to 2.5 kg increments (backoffKg semantics)', () => {
    // Arrange + Act + Assert — 140 × 0.1 = 14 → snaps to 15 → 125.
    expect(proposedTrainingMaxKg(140)).toBe(125)
    // 100 × 0.1 = 10 (already loadable) → 90.
    expect(proposedTrainingMaxKg(100)).toBe(90)
  })

  it('caps the reduction on tiny TMs and refuses a zero TM', () => {
    // The 25% cap beats the one-increment floor: 5 → −1.25, never −2.5.
    expect(proposedTrainingMaxKg(5)).toBe(5 - 1.25)
    expect(proposedTrainingMaxKg(0)).toBeNull()
  })
})

describe('collectTmResetProposals', () => {
  const tmDays = [
    {
      exercises: [
        {
          name: 'Squat',
          progression: {
            scheme: 'amrap-cycle',
            trainingMaxKg: 140,
            incrementKg: 2.5,
            wave: [[0.85]],
          },
        },
        { name: 'Row', progression: { scheme: 'linear', incrementKg: 2.5 } },
      ],
    },
    {
      exercises: [
        {
          name: 'Squat',
          progression: {
            scheme: 'amrap-cycle',
            trainingMaxKg: 140,
            incrementKg: 2.5,
            wave: [[0.85]],
          },
        },
      ],
    },
  ] as never

  it('proposes a ~10% reduction for flagged TM-bearing exercises, with addresses', () => {
    // Arrange
    const prescriptions = [
      [{ autoreg: adjustment('flag') }, { autoreg: null }],
      [{ autoreg: null }],
    ]

    // Act
    const proposals = collectTmResetProposals(tmDays, prescriptions)

    // Assert — 140 → 125 (10% snapped to 2.5 via backoffKg), addressed for the setter.
    expect(proposals).toEqual([
      {
        exerciseName: 'Squat',
        dayPosition: 0,
        exercisePosition: 0,
        currentTmKg: 140,
        proposedTmKg: 125,
      },
    ])
  })

  it('never proposes for non-TM schemes, even on a mismatched flag verdict', () => {
    // Arrange — a flag against the linear exercise (should be impossible).
    const prescriptions = [[{ autoreg: null }, { autoreg: adjustment('flag') }], [{ autoreg: null }]]

    // Act + Assert
    expect(collectTmResetProposals(tmDays, prescriptions)).toEqual([])
  })

  it('ignores non-flag verdicts and dedupes a lift repeated across days', () => {
    // Arrange — Squat flagged on both days, decrement elsewhere.
    const prescriptions = [
      [{ autoreg: adjustment('flag') }, { autoreg: adjustment('decrement') }],
      [{ autoreg: adjustment('flag') }],
    ]

    // Act
    const proposals = collectTmResetProposals(tmDays, prescriptions)

    // Assert
    expect(proposals).toHaveLength(1)
    expect(proposals[0].exerciseName).toBe('Squat')
  })
})

describe('groupEventsByDay', () => {
  const day = (iso: string) => new Date(iso)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  it('buckets consecutive same-day events under one label, preserving order', () => {
    const events = [
      { id: 1, occurredAt: day('2026-07-02T18:00:00Z') },
      { id: 2, occurredAt: day('2026-07-02T09:00:00Z') },
      { id: 3, occurredAt: day('2026-07-01T12:00:00Z') },
    ]
    const groups = groupEventsByDay(events, fmt)
    expect(groups.map((g) => g.label)).toEqual(['2026-07-02', '2026-07-01'])
    expect(groups[0].events.map((e) => e.id)).toEqual([1, 2])
    expect(groups[1].events.map((e) => e.id)).toEqual([3])
  })

  it('handles an empty list', () => {
    expect(groupEventsByDay([], fmt)).toEqual([])
  })
})

describe('progressionLine (#228 — the "how this progresses" row line)', () => {
  it('returns null when the exercise has no progression', () => {
    expect(progressionLine(null, [], 'lb')).toBeNull()
  })

  it('speaks the double-progression sentence with the heaviest working load', () => {
    const progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 12,
      incrementKg: 2.27,
    } as const
    const sets = [
      { loadKg: 20, setType: 'warmup' }, // warm-ups never anchor the clause
      { loadKg: 29.48, setType: 'working' }, // 65.0 lb
      { loadKg: 27, setType: 'working' },
    ]
    expect(progressionLine(progression, sets, 'lb')).toEqual({
      key: 'sentence.doubleProgressionAtLoad',
      values: { reps: 12, load: 65, increment: 5, unit: 'lb' },
    })
  })

  it('anchors no load clause when the sets carry no load', () => {
    const progression = { scheme: 'rpe-target', targetRpe: 8 } as const
    expect(progressionLine(progression, [{ loadKg: null, setType: 'working' }], 'lb')).toEqual({
      key: 'sentence.rpeTarget',
      values: { rpe: 8 },
    })
  })
})
