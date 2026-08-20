import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Notes-v2 render contracts (slice 2), in the workout-logger.test.tsx
 * static-markup convention (no DOM, queries disabled): the volt dot renders
 * for a noted set and ONLY for a noted set; the exercise header rolls that
 * count into its note button (which on the untouched fast path is a bare pen,
 * no count); the
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

import { NotebookPen } from 'lucide-react'

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
  /**
   * Occurrences of the NotebookPen glyph in the rendered markup. The probe is
   * taken FROM lucide at test time (its longest path, the shape no sibling
   * icon repeats) rather than hardcoding a class name: if the icon library
   * renames its classes the signature moves with it, so this counts pens for
   * as long as pens are what the rail draws.
   */
  const PEN = (() => {
    const paths = Array.from(renderStaticIntl(<NotebookPen />).matchAll(/ d="([^"]+)"/g)).map(
      (m) => m[1],
    )
    if (paths.length === 0) throw new Error('NotebookPen rendered no path to probe')
    return paths.reduce((longest, d) => (d.length > longest.length ? d : longest))
  })()

  /**
   * Pens in the logger BELOW its app bar. The workout-level note entry lives
   * up there and draws the same pen at a different scope (#283), deliberately
   * — one note vocabulary — so the bar is sliced off before counting.
   *
   * Anchored on `<main`, not on `</header>`: <header> is a general sectioning
   * element in this codebase (the ops panels use it), so the first one is the
   * app bar only by luck of render order. A card that grew a <header> of its
   * own would move the cut past the rail and silently swallow the very pen
   * this counts — failing as "0 pens in the roll-up", which blames the wrong
   * code.
   *
   * The one-pen invariant is enforced HERE rather than in a test beside the
   * callers, so EVERY count is guarded rather than the single draft state
   * that test happens to render.
   */
  /** Everything above the logger's content root — the app bar and nothing
   *  else. One definition, so the counter below and the test that names what
   *  gets hidden can never drift onto two different anchors. */
  function appBarRegion(html: string): string {
    const body = html.indexOf('<main')
    if (body === -1) throw new Error('the logger rendered no <main> to slice to')
    return html.slice(0, body)
  }

  /** `appBarPens` is the number the CALLER expects to be hidden, not a
   *  constant: the workout-note entry is gated on !isEmpty, so an
   *  exercise-less draft legitimately hides none, and a hardcoded 1 would
   *  throw at a draft shape while claiming the app bar had regressed. */
  function pensBelowAppBar(html: string, appBarPens = 1): number {
    const bar = appBarRegion(html)
    const hidden = bar.split(PEN).length - 1
    if (hidden !== appBarPens) {
      throw new Error(`the app bar slice hid ${hidden} pens, not the ${appBarPens} expected`)
    }
    return html.slice(bar.length).split(PEN).length - 1
  }

  it('counts the instance note plus noted sets', () => {
    const html = render(baseDraft({ note: 'pin 4', exerciseNotes: 'felt heavy' }))
    expect(html).toContain('Edit note for Squat, 2 notes')
  })

  it('speaks singular for one note', () => {
    expect(render(baseDraft({ note: 'pin 4' }))).toContain('Add note for Squat, 1 note')
  })

  it('names the ACTION first, and only then the count', () => {
    // The label has to say what pressing does. A name that is pure state ("1
    // note on Squat") strands a screen-reader user twice over: nothing says
    // the control opens anything, and because the count rolls up SET notes,
    // the promised note is one the editor it opens will not show. The action
    // word leads; the count rides behind it. `Edit` only when there is an
    // exercise note to edit — a lone set note still opens an empty field.
    expect(render(baseDraft({ note: 'pin 4' }))).toMatch(/Add note for Squat, 1 note/)
    expect(render(baseDraft({ exerciseNotes: 'felt heavy' }))).toMatch(
      /Edit note for Squat, 1 note/,
    )
  })

  it('renders no count when nothing is noted — the bare entry pen remains', () => {
    const html = render(baseDraft({}))
    expect(html).not.toMatch(/for Squat, \d+ notes?/)
    expect(html).toContain('Add note for Squat')
    expect(pensBelowAppBar(html)).toBe(1)
  })

  it('holds the count in a fixed-width slot, so the rail settles once', () => {
    // The box grows when the first note appears — that follows a deliberate
    // act by the user. What it must NOT do is creep again at the second, or
    // at ten: the rail's other controls sit under a thumb already reaching
    // for them. A fixed slot plus tabular numerals means one digit and two
    // occupy the same width.
    const slot = /class="[^"]*w-3[^"]*tnum[^"]*"/
    expect(render(baseDraft({ note: 'pin 4' }))).toMatch(slot)
  })

  it('excludes exactly one pen, and that pen is the workout-note entry', () => {
    // A count alone would not know WHAT it excluded. Naming the control pins
    // that the hidden region is the app bar and not, say, a card that grew a
    // <header> of its own.
    // Through the helper's OWN slicer, not a second copy of the anchor: a
    // hand-rolled `slice(0, indexOf('<main'))` returns the whole document
    // minus its last character when the anchor is missing, which is the very
    // count-mismatch-blaming-the-wrong-code failure the anchor change exists
    // to end. The pen count is the helper's job (it guards on every call);
    // what this test adds is WHICH control is being hidden.
    expect(appBarRegion(render(baseDraft({})))).toContain('Add workout note')
  })

  it('lets an exercise-less draft say it draws no pens at all', () => {
    // The workout-note entry is gated on !isEmpty, so "the app bar hides
    // exactly one pen" is false BY DESIGN here. A helper that hardcoded 1
    // would throw and blame the app bar for what is really a draft shape.
    expect(pensBelowAppBar(render({ notes: '', exercises: [] }), 0)).toBe(0)
  })

  it('refuses to count when the hidden region holds more than that one pen', () => {
    // The invariant lives INSIDE the slicer, so every count is guarded — not
    // just the draft state a sibling test happens to render. A second app-bar
    // pen (a "this workout has a note" glyph beside the entry, say) would
    // otherwise widen the blind spot in silence while both counts stayed 1.
    const twoPens = `<header><svg><path d="${PEN}"/><path d="${PEN}"/></svg></header><main></main>`
    expect(() => pensBelowAppBar(twoPens)).toThrow(/hid 2 pens, not the 1 expected/)
  })

  it('refuses to count when there is no app bar to slice to', () => {
    expect(() => pensBelowAppBar('<div>no main here</div>')).toThrow(/no <main>/)
  })

  it('shows ONE pen when a set is noted but the exercise is not', () => {
    // The regression this merge exists for, and a common state: the count
    // rolls up noted SETS as well as the exercise's own note, so a single
    // noted set lit the roll-up while the exercise note was still empty —
    // which also rendered the entry button. Two identical pens, one of them
    // inert, with nothing to say which was pressable.
    const html = render(baseDraft({ note: 'left shoulder clicked' }))
    expect(pensBelowAppBar(html)).toBe(1)
    expect(html).toContain('Add note for Squat, 1 note')
  })

  it('the roll-up IS the control — a count is never inert metadata', () => {
    // Chips mean pressable (DESIGN.md): the count wears the rail's ghost
    // button skin and opens this session's note editor, rather than sitting
    // as a quiet span that says notes exist but refuses to show them.
    const html = render(baseDraft({ note: 'left shoulder clicked' }))
    const at = html.indexOf('Add note for Squat, 1 note')
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at))
    expect(tag).toContain('<button')
    expect(tag).toContain('hit-44-y')
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
        techniqueKind={null}
        canTagTechnique
        onNote={() => {}}
        onTagTechnique={() => {}}
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

  it('offers every intensity technique as a radio item', () => {
    const html = renderMenu()

    expect(html).toContain('Drop set')
    expect(html).toContain('Rest-pause')
    expect(html).toContain('Myo-reps')
    expect(html).toContain('Cluster')
    expect(html).toContain('role="menuitemradio"')
    expect(html).not.toMatch(/SetRowMenu\.[a-zA-Z.]+/)
  })

  it('marks the row\'s current technique checked (the toggle back)', () => {
    const html = renderMenu({ techniqueKind: 'drop-set' })

    expect(html).toMatch(/aria-checked="true"[^>]*>[\s\S]{0,200}Drop set/)
  })

  it('hides the technique items on the first set — nothing to continue', () => {
    const html = renderMenu({ canTagTechnique: false })

    expect(html).not.toContain('Drop set')
    expect(html).toContain('Tag warm-up')
  })
})

describe('NoteSheet markup (the capture sheet)', () => {
  function renderSheet(props: Partial<Parameters<typeof NoteSheet>[0]> = {}): string {
    return renderStaticIntl(
      <NoteSheet
        anchor={{ exerciseName: 'Bench Press', setNumber: 3, snapshot: '185 lb × 6 · RPE 9' }}
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

  it('drops the scope chips when there is no anchor to narrow down to', () => {
    // Opened from the app bar: no set under the finger, so "Set 3"/"Exercise"
    // would address nothing. A chip means pressable — a lone un-switchable
    // one would be a lie, so the row goes and the breadcrumb carries scope.
    const html = renderSheet({ anchor: null, initialScope: 'workout' })
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('Bench Press')
    expect(html).not.toContain('185 lb × 6 · RPE 9')
    expect(html).toContain('Workout')
    // Still the same capture surface, tags and volt Save included.
    expect(html).toContain('Insert #form tag')
    expect(html).toContain('Save')
  })

  it('ignores a set initialScope without an anchor — workout is the only scope left', () => {
    expect(renderSheet({ anchor: null, initialScope: 'set' })).toContain('Note for Workout')
  })
})
