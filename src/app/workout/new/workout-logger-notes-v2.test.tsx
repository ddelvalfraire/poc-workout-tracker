import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Notes-v2 render contracts (slice 2), in the workout-logger.test.tsx
 * static-markup convention (no DOM, queries disabled): the volt dot renders
 * for a noted set and ONLY for a noted set; the exercise header rolls up its
 * count (and renders zero note markup on the untouched fast path); the
 * context menu and capture sheet speak the drafts' grammar. The gesture flows
 * themselves (long-press timers, drag-down) are pointer-event territory —
 * their pure logic is covered in note-capture.test.ts and the reducer tests.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/workout/actions', () => ({
  saveWorkoutAction: vi.fn(),
  updateWorkoutAction: vi.fn(),
  deleteWorkoutAction: vi.fn(),
  getLastPerformanceAction: vi.fn(),
  getExerciseBestAction: vi.fn(),
  substitutePlanTargetsAction: vi.fn(),
  rememberSwapAction: vi.fn(),
  getWorkoutDraftAction: vi.fn(),
  putWorkoutDraftAction: vi.fn(),
  deleteWorkoutDraftAction: vi.fn(),
}))

// The notes actions are only reached from interaction/effects; a static
// render needs them importable, never callable.
vi.mock('@/app/notes/actions', () => ({
  createNoteAction: vi.fn(),
  createFallbackSetNoteAction: vi.fn(),
  createSetNotesForWorkoutAction: vi.fn(),
}))

import { WorkoutLogger } from './workout-logger'
import { SetRowMenu } from './set-row-menu'
import { NoteSheet } from './note-sheet'
import type { WorkoutDraft } from './workout-draft'

const KEY = '01234567-89ab-cdef-0123-456789abcdef'

function baseDraft(overrides: { note?: string; exerciseNotes?: string }): WorkoutDraft {
  return {
    notes: '',
    exercises: [
      {
        id: 'ex1',
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Squat',
        category: 'Legs',
        loggingType: 'weight_reps',
        notes: overrides.exerciseNotes ?? '',
        skipped: false,
        sets: [
          {
            id: 's1',
            reps: '5',
            weight: '100',
            completed: true,
            tag: 'working',
            ...(overrides.note !== undefined ? { note: overrides.note, noteClientKey: KEY } : {}),
          },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function render(draft: WorkoutDraft): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderStaticIntl(
    <QueryClientProvider client={client}>
      <WorkoutLogger title="New Workout" closeHref="/" initialDraft={draft} />
    </QueryClientProvider>,
  )
}

describe('the volt dot (a noted set’s whole in-logger footprint)', () => {
  it('renders beside the noted set’s number and nowhere else', () => {
    const html = render(baseDraft({ note: 'left shoulder clicked' }))
    expect(html).toContain('size-1 rounded-full bg-primary')
    // Exactly one dot for exactly one noted set.
    expect(html.match(/size-1 rounded-full bg-primary/g)).toHaveLength(1)
  })

  it('the note body never renders inline in the logger', () => {
    const html = render(baseDraft({ note: 'left shoulder clicked' }))
    expect(html).not.toContain('left shoulder clicked')
  })

  it('no note → no dot markup (the fast path)', () => {
    expect(render(baseDraft({}))).not.toContain('size-1 rounded-full bg-primary')
  })

  it('a whitespace-only note is not a note — no dot', () => {
    expect(render(baseDraft({ note: '   ' }))).not.toContain('size-1 rounded-full bg-primary')
  })
})

describe('the exercise header roll-up', () => {
  it('counts the instance note plus noted sets', () => {
    const html = render(baseDraft({ note: 'pin 4', exerciseNotes: 'felt heavy' }))
    expect(html).toContain('2 notes on Squat')
  })

  it('speaks singular for one note', () => {
    expect(render(baseDraft({ note: 'pin 4' }))).toContain('1 note on Squat')
  })

  it('renders zero roll-up markup when nothing is noted', () => {
    expect(render(baseDraft({}))).not.toContain('note on Squat')
  })
})

describe('SetRowMenu markup', () => {
  function renderMenu(props: Partial<Parameters<typeof SetRowMenu>[0]> = {}): string {
    return renderStaticIntl(
      <SetRowMenu
        x={100}
        y={200}
        setLabel="set 2 of Squat"
        hasNote={false}
        isWarmup={false}
        onNote={() => {}}
        onTagWarmup={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
        {...props}
      />,
    )
  }

  it('offers the three actions with the note item first', () => {
    const html = renderMenu()
    expect(html).toContain('role="menu"')
    expect(html).toContain('Add note')
    expect(html).toContain('Tag warm-up')
    expect(html).toContain('Remove set')
  })

  it('an existing note flips the label to the view affordance', () => {
    expect(renderMenu({ hasNote: true })).toContain('Note · view')
  })

  it('a warm-up set gets the way back', () => {
    expect(renderMenu({ isWarmup: true })).toContain('Untag warm-up')
  })
})

describe('NoteSheet markup (the capture sheet)', () => {
  function renderSheet(props: Partial<Parameters<typeof NoteSheet>[0]> = {}): string {
    return renderStaticIntl(
      <NoteSheet
        exerciseName="Bench Press"
        setNumber={3}
        snapshot="185 lb × 6 · RPE 9"
        initialScope="set"
        onSave={() => {}}
        onClose={() => {}}
        {...props}
      />,
    )
  }

  it('is non-modal with the anchored breadcrumb and set snapshot subtitle', () => {
    const html = renderSheet()
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain('Bench Press · Set 3')
    expect(html).toContain('185 lb × 6 · RPE 9')
  })

  it('renders the scope chips with the pressed anchor selected', () => {
    const html = renderSheet()
    expect(html).toContain('Set 3')
    expect(html).toContain('Exercise')
    expect(html).toContain('Workout')
    // The set chip (default = where you pressed) is the pressed one.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('renders the tag accessory row and the volt Save chip', () => {
    const html = renderSheet()
    for (const token of ['#pain', '#form', '#pr', '#equipment']) {
      expect(html).toContain(`Insert ${token} tag`)
    }
    expect(html).toContain('bg-primary')
    expect(html).toContain('Save')
  })

  it('seeds an existing note body for viewing/editing', () => {
    expect(renderSheet({ initialBody: 'left shoulder clicked' })).toContain(
      'left shoulder clicked',
    )
  })
})
