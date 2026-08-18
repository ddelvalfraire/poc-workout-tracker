import { describe, it, expect } from 'vitest'
import type { NoteWithContext } from '@/db/notes'
import {
  buildNoteView,
  collectTags,
  filterNoteViews,
  groupNotesByThread,
  isOutdatedNote,
  matchesNoteSearch,
  noteBreadcrumb,
  noteTimeLabel,
  notesHref,
  parseNotesFilterParams,
  snapshotLine,
  tokenizeNoteBody,
} from './note-view'

const NOW = new Date('2026-08-17T12:00:00Z')

/** A complete listNotes row with overridable fields — synthetic throughout. */
function row(overrides: Partial<NoteWithContext> = {}): NoteWithContext {
  return {
    id: 'n1',
    author: 'user',
    body: 'felt heavy',
    anchorKind: 'workout',
    programId: null,
    workoutId: 'w1',
    workoutExerciseId: null,
    setId: null,
    anchorSnapshot: null,
    createdAt: new Date('2026-08-17T11:00:00Z'),
    updatedAt: new Date('2026-08-17T11:00:00Z'),
    workoutName: 'Push',
    workoutStartedAt: new Date('2026-08-17T10:00:00Z'),
    exerciseName: null,
    setNumber: null,
    programName: null,
    ...overrides,
  }
}

describe('tokenizeNoteBody', () => {
  it('splits words starting with # into tag tokens — and nothing else', () => {
    expect(tokenizeNoteBody('dropped the bar path in #form today')).toEqual([
      { kind: 'text', text: 'dropped the bar path in ' },
      { kind: 'tag', text: '#form' },
      { kind: 'text', text: ' today' },
    ])
  })

  it('tags at the start and end of the body', () => {
    expect(tokenizeNoteBody('#pain left shoulder #form')).toEqual([
      { kind: 'tag', text: '#pain' },
      { kind: 'text', text: ' left shoulder ' },
      { kind: 'tag', text: '#form' },
    ])
  })

  it('ignores mid-word hashes and a bare hash', () => {
    expect(tokenizeNoteBody('c# and issue#4 and # alone')).toEqual([
      { kind: 'text', text: 'c# and issue#4 and # alone' },
    ])
  })

  it('a tagless body is one text token; an empty body is no tokens', () => {
    expect(tokenizeNoteBody('plain words')).toEqual([{ kind: 'text', text: 'plain words' }])
    expect(tokenizeNoteBody('')).toEqual([])
  })
})

describe('collectTags', () => {
  it('collects distinct tags first-seen order, case-insensitive dedupe', () => {
    expect(collectTags(['#Form is off', 'check #pain and #form', '#pain again'])).toEqual([
      '#Form',
      '#pain',
    ])
  })
})

describe('isOutdatedNote (the PR #247 fallback invariant)', () => {
  it('workout-anchored WITH a snapshot = fallback re-anchor = outdated', () => {
    expect(
      isOutdatedNote({ anchorKind: 'workout', anchorSnapshot: { exerciseName: 'Bench' } }),
    ).toBe(true)
  })

  it('a true session note (no snapshot) and live set/exercise anchors are not', () => {
    expect(isOutdatedNote({ anchorKind: 'workout', anchorSnapshot: null })).toBe(false)
    expect(isOutdatedNote({ anchorKind: 'set', anchorSnapshot: { exerciseName: 'Bench' } })).toBe(
      false,
    )
  })
})

describe('snapshotLine', () => {
  it('quantizes load into the display unit', () => {
    // 84 kg ≈ 185.2 lb raw; the quantized display shows the plate-honest 185.
    expect(snapshotLine({ loadKg: 84, reps: 6 }, 'lb')).toBe('185 lb × 6')
    expect(snapshotLine({ loadKg: 100, reps: 8 }, 'kg')).toBe('100 kg × 8')
  })

  it('duration and rep-only fallbacks', () => {
    expect(snapshotLine({ durationSec: 90 }, 'kg')).toBe('1:30')
    expect(snapshotLine({ reps: 12, loadKg: null }, 'kg')).toBe('12 reps')
  })

  it('null for exercise-name-only snapshots and missing snapshots', () => {
    expect(snapshotLine({ exerciseName: 'Squat' }, 'kg')).toBeNull()
    expect(snapshotLine(null, 'kg')).toBeNull()
  })
})

describe('noteBreadcrumb', () => {
  it('set anchor: exercise · set N (live names)', () => {
    expect(
      noteBreadcrumb({
        anchorKind: 'set',
        anchorSnapshot: null,
        exerciseName: 'Bench Press',
        setNumber: 3,
      }),
    ).toBe('Bench Press · Set 3')
  })

  it('exercise anchor and the plain tiers', () => {
    expect(
      noteBreadcrumb({
        anchorKind: 'workout_exercise',
        anchorSnapshot: null,
        exerciseName: 'Calf Raise',
        setNumber: null,
      }),
    ).toBe('Calf Raise · exercise')
    expect(
      noteBreadcrumb({
        anchorKind: 'workout',
        anchorSnapshot: null,
        exerciseName: null,
        setNumber: null,
      }),
    ).toBe('Workout')
    expect(
      noteBreadcrumb({
        anchorKind: 'program',
        anchorSnapshot: null,
        exerciseName: null,
        setNumber: null,
      }),
    ).toBe('Program note')
  })

  it('outdated fallback reads the frozen snapshot (the live anchor is gone)', () => {
    expect(
      noteBreadcrumb({
        anchorKind: 'workout',
        anchorSnapshot: { exerciseName: 'Smith Lunge', setNumber: 2, loadKg: 15.9, reps: 8 },
        exerciseName: null,
        setNumber: null,
      }),
    ).toBe('Smith Lunge · Set 2')
  })

  it('omitExercise drops the redundant segment on the reverse index', () => {
    expect(
      noteBreadcrumb(
        { anchorKind: 'set', anchorSnapshot: null, exerciseName: 'Bench Press', setNumber: 3 },
        { omitExercise: true },
      ),
    ).toBe('Set 3')
    expect(
      noteBreadcrumb(
        {
          anchorKind: 'workout_exercise',
          anchorSnapshot: null,
          exerciseName: 'Bench Press',
          setNumber: null,
        },
        { omitExercise: true },
      ),
    ).toBe('Exercise')
  })
})

describe('noteTimeLabel', () => {
  it('minutes, hours, then the shared day vocabulary', () => {
    expect(noteTimeLabel(NOW.getTime() - 30_000, NOW)).toBe('now')
    expect(noteTimeLabel(NOW.getTime() - 35 * 60_000, NOW)).toBe('35m ago')
    expect(noteTimeLabel(NOW.getTime() - 3 * 3_600_000, NOW)).toBe('3h ago')
    expect(noteTimeLabel(new Date('2026-08-10T12:00:00Z').getTime(), NOW)).toBe('Aug 10')
  })
})

describe('buildNoteView + groupNotesByThread', () => {
  it('groups under session threads, newest thread first, program notes apart', () => {
    const views = [
      row({ id: 'a', workoutId: 'w2', workoutName: 'Legs' }),
      row({ id: 'b', workoutId: 'w1' }),
      row({
        id: 'c',
        anchorKind: 'program',
        workoutId: null,
        workoutName: null,
        workoutStartedAt: null,
        programId: 'p1',
        programName: 'PPL Hybrid',
      }),
      row({ id: 'd', workoutId: 'w2', workoutName: 'Legs' }),
    ].map((r) => buildNoteView(r, 'kg', NOW))

    const threads = groupNotesByThread(views)
    expect(threads.map((t) => t.key)).toEqual(['w:w2', 'w:w1', 'p:p1'])
    expect(threads[0].notes.map((n) => n.id)).toEqual(['a', 'd'])
    expect(threads[0].title).toBe('Legs')
    expect(threads[2].title).toBe('Program · PPL Hybrid')
  })

  it('the session header wears the relative day and the row its write time', () => {
    const view = buildNoteView(row(), 'kg', NOW)
    expect(view.threadDateLabel).toBe('Today')
    expect(view.timeLabel).toBe('1h ago')
  })

  it('an outdated fallback keeps its snapshot line and exercise filter fact', () => {
    const view = buildNoteView(
      row({
        anchorSnapshot: { exerciseName: 'Smith Lunge', setNumber: 2, loadKg: 15.9, reps: 8 },
      }),
      'lb',
      NOW,
    )
    expect(view.outdated).toBe(true)
    expect(view.breadcrumb).toBe('Smith Lunge · Set 2')
    expect(view.snapshotLine).toBe('35 lb × 8')
    expect(view.exerciseName).toBe('Smith Lunge')
  })
})

describe('filterNoteViews (chip filters compose, AND)', () => {
  const views = [
    buildNoteView(
      row({
        id: 'mine-set',
        anchorKind: 'set',
        setId: 's1',
        workoutId: 'w1',
        exerciseName: 'Bench Press',
        setNumber: 3,
        body: 'clicked #pain',
      }),
      'kg',
      NOW,
    ),
    buildNoteView(row({ id: 'coach', author: 'coach', body: 'own the eccentric' }), 'kg', NOW),
    buildNoteView(
      row({
        id: 'prog',
        anchorKind: 'program',
        workoutId: null,
        programId: 'p1',
        programName: 'PPL Hybrid',
        workoutName: null,
        workoutStartedAt: null,
      }),
      'kg',
      NOW,
    ),
  ]
  const all = { author: 'all' as const, tag: null, exercise: null, program: null }

  it('author chips', () => {
    expect(filterNoteViews(views, { ...all, author: 'mine' }).map((v) => v.id)).toEqual([
      'mine-set',
      'prog',
    ])
    expect(filterNoteViews(views, { ...all, author: 'coach' }).map((v) => v.id)).toEqual(['coach'])
  })

  it('tag chip (case-insensitive) composes with author', () => {
    expect(
      filterNoteViews(views, { ...all, author: 'mine', tag: '#Pain' }).map((v) => v.id),
    ).toEqual(['mine-set'])
  })

  it('exercise and program chips', () => {
    expect(filterNoteViews(views, { ...all, exercise: 'Bench Press' }).map((v) => v.id)).toEqual([
      'mine-set',
    ])
    expect(filterNoteViews(views, { ...all, program: 'PPL Hybrid' }).map((v) => v.id)).toEqual([
      'prog',
    ])
  })
})

describe('parseNotesFilterParams + notesHref (URL as state)', () => {
  it('parses valid params and defaults unknown values quietly', () => {
    expect(
      parseNotesFilterParams({ author: 'coach', tag: '#pain', exercise: 'Bench Press' }),
    ).toEqual({ author: 'coach', tag: '#pain', exercise: 'Bench Press', program: null })
    expect(parseNotesFilterParams({ author: 'bogus', tag: ['#a', '#b'] })).toEqual({
      author: 'all',
      tag: '#a', // repeated keys: first one wins (house rule)
      exercise: null,
      program: null,
    })
  })

  it('round-trips through notesHref, defaults dropping out', () => {
    expect(notesHref({ author: 'all', tag: null, exercise: null, program: null })).toBe('/notes')
    const href = notesHref({ author: 'mine', tag: '#form', exercise: null, program: null })
    expect(href).toBe('/notes?author=mine&tag=%23form')
    const parsed = parseNotesFilterParams(
      Object.fromEntries(new URLSearchParams(href.split('?')[1])),
    )
    expect(parsed).toEqual({ author: 'mine', tag: '#form', exercise: null, program: null })
  })
})

describe('matchesNoteSearch', () => {
  const view = buildNoteView(
    row({
      anchorKind: 'set',
      setId: 's1',
      exerciseName: 'Bench Press',
      setNumber: 3,
      body: 'left shoulder clicked',
    }),
    'kg',
    NOW,
  )

  it('matches body, breadcrumb, and thread title; blank matches everything', () => {
    expect(matchesNoteSearch(view, 'shoulder')).toBe(true)
    expect(matchesNoteSearch(view, 'bench')).toBe(true)
    expect(matchesNoteSearch(view, 'push')).toBe(true) // thread title
    expect(matchesNoteSearch(view, '  ')).toBe(true)
    expect(matchesNoteSearch(view, 'deadlift')).toBe(false)
  })
})
