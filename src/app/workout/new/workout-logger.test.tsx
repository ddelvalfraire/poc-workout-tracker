import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Render-level parity contract for the effort feature (the back-link.test.tsx
 * static-markup convention): with the show rule FALSE — no prescribed effort
 * target, preference off — the logger's markup must contain zero effort UI.
 * The interactive chip flow itself is a post-completion state change (jsdom
 * territory); what a static render CAN prove is the two things the spec makes
 * hard rules: opted-out sessions render no effort surface at all, and logged
 * values resurface as words.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

// The logger's server actions all live behind user interaction or effects;
// a static render only needs them importable, never callable.
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

import { WorkoutLogger } from './workout-logger'
import { SessionToast } from './session-toast'
import type { WorkoutDraft } from './workout-draft'
import type { LastPerformance } from '@/db/workouts'

/** One exercise, first set completed (the moment the chip row would appear). */
function draftWithCompletedSet(effort: { rir?: string; rpe?: string } = {}): WorkoutDraft {
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
        notes: '',
        skipped: false,
        sets: [
          { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working', ...effort },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function render(
  props: Partial<Parameters<typeof WorkoutLogger>[0]> = {},
  // Seeded straight into the cache (queries stay disabled) so the static
  // render can exercise the last-performance ride-alongs without a fetch.
  seedLastPerformance?: LastPerformance,
): string {
  // queries disabled: a static render must never kick off fetches.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  if (seedLastPerformance !== undefined) {
    client.setQueryData(['last-performance', 'wger', 73, null], seedLastPerformance)
  }
  return renderStaticIntl(
    <QueryClientProvider client={client}>
      <WorkoutLogger
        title="New Workout"
        closeHref="/"
        initialDraft={draftWithCompletedSet()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('WorkoutLogger effort-row parity', () => {
  it('renders NO effort UI when the show rule is false (no targets, pref off)', () => {
    const html = render()
    expect(html).not.toContain('RIR')
    expect(html).not.toContain('RPE')
  })

  it('renders NO effort UI by default even with a plan lacking effort targets', () => {
    const html = render({
      planTargets: {
        'wger:73': [
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: null, rpe: null },
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: null, rpe: null },
        ],
      },
    })
    expect(html).not.toContain('RIR')
    expect(html).not.toContain('RPE')
  })

  it('resurfaces a logged RIR as words on the completed set when opted in', () => {
    const html = render({
      rpeLoggingEnabled: true,
      initialDraft: draftWithCompletedSet({ rir: '2' }),
    })
    expect(html).toContain('RIR 2')
  })

  it('keeps logged effort words visible via the prescribed-target arm alone (pref off)', () => {
    const html = render({
      initialDraft: draftWithCompletedSet({ rpe: '8.5' }),
      planTargets: {
        'wger:73': [
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: 2, rpe: null },
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: 2, rpe: null },
        ],
      },
    })
    expect(html).toContain('RPE 8.5')
  })
})

describe('WorkoutLogger name block (#207)', () => {
  it('live session renders NO name block — no label, no input, no fallback line', () => {
    // Mid-session the name is a fact the app bar and summary already carry;
    // the logger spends none of the first viewport restating it.
    const html = render({ initialName: 'Legs', isLive: true })
    expect(html).not.toContain('Workout name')
    expect(html).not.toContain('Optional — e.g. Lower')
    expect(html).not.toContain('Unnamed workout')
  })

  it('live program session keeps the provenance stamp without the name block', () => {
    // The (day · week) stamp survives the de-duplication: provenance is the
    // one identity line that catches a wrong-day start mid-session.
    const html = render({ isLive: true, programContext: 'Pull A · Week 2' })
    expect(html).toContain('Pull A · Week 2')
    expect(html).not.toContain('Workout name')
  })

  it('edit mode (finished workout) keeps the labeled editable name input', () => {
    const html = render({ workoutId: 'w1', isLive: false, initialName: 'Legs' })
    expect(html).toContain('Workout name')
    expect(html).toContain('Optional — e.g. Lower')
    expect(html).not.toContain('Unnamed workout')
  })
})

describe('WorkoutLogger PREV column gate', () => {
  it('hides the whole PREV column when nothing in the session has history', () => {
    // No seeded last-performance: a first-ever session. The header cell and
    // every disabled em-dash chip disappear; the inputs take the width back.
    const html = render()
    expect(html).not.toContain('>Prev<')
    expect(html).not.toContain('No previous performance for')
  })

  it('renders the PREV column once any exercise has prior performance', () => {
    const html = render({}, lastPerformance({ sets: [{ reps: 12, weight: 100 }] }))
    expect(html).toContain('>Prev<')
    expect(html).toContain('100×12')
  })

  it('keeps the column hidden when history exists but yields no label', () => {
    // weight_reps requires BOTH fields for a chip (see previousChipLabel):
    // reps-less history would render only fragments, so the gate must agree
    // with the chips and keep the column down.
    const html = render({}, lastPerformance({ sets: [{ reps: null, weight: 100 }] }))
    expect(html).not.toContain('>Prev<')
  })
})

describe('sticky-bar Add Exercise demotion', () => {
  it('keeps the 44px target even though sm is 36px (the #236 discipline)', () => {
    // The sm demotion is visual only: hit-44-y buys the PRODUCT.md thumb-bar
    // floor back, and both vertical neighbours sit a full gap-2 away. Sliced
    // to this button's own opening tag so a neighbour's classes can never
    // satisfy the assert.
    const html = render()
    const at = html.indexOf('>+ Exercise<')
    expect(at).toBeGreaterThan(-1)
    expect(html.slice(html.lastIndexOf('<button', at), at)).toContain('hit-44-y')
  })
})

describe('SessionToast (#210)', () => {
  const countdown = { durationMs: 8000, resetKey: 0, onExpire: () => {} }

  it('undo mode renders role=status with the message and the countdown drain', () => {
    const html = renderStaticIntl(
      <SessionToast open countdown={countdown}>
        <p>
          Removed <span className="font-medium">Squat</span>
        </p>
      </SessionToast>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('Removed')
    expect(html).toContain('Squat')
    expect(html).toContain('toast-drain')
  })

  it('prompt mode renders both action labels and NO countdown element', () => {
    const html = renderStaticIntl(
      <SessionToast open>
        <p>Use Front Squat for the rest of the block?</p>
        <button type="button">Just today</button>
        <button type="button">Use for block</button>
      </SessionToast>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('Just today')
    expect(html).toContain('Use for block')
    expect(html).not.toContain('toast-drain')
  })

  it('stays a hairline strip — never a card shell', () => {
    const html = renderStaticIntl(
      <SessionToast open countdown={countdown}>
        <p>Removed set</p>
      </SessionToast>,
    )
    expect(html).not.toContain('bg-card')
    expect(html).not.toContain('rounded-xl')
  })

  it('renders nothing when closed', () => {
    const html = renderStaticIntl(<SessionToast open={false}>{null}</SessionToast>)
    expect(html).toBe('')
  })
})

describe('WorkoutLogger identity-note parity', () => {
  it('renders NO note chip when the exercise has no identity note', () => {
    // The sticky chip follows the effort-row discipline: with no pinned note
    // (here: no last-performance data at all, queries disabled) the logger's
    // markup contains zero note-chip UI — the fast path is byte-identical.
    const html = render()
    expect(html).not.toContain('Exercise note')
  })
})

/** A prior performance for wger #73, with per-field overrides. */
function lastPerformance(overrides: Partial<LastPerformance> = {}): LastPerformance {
  return {
    performedAt: new Date('2026-08-01T12:00:00Z'),
    sets: [],
    note: null,
    sessionNote: null,
    ...overrides,
  }
}

describe('WorkoutLogger notes three-tier IA (#211)', () => {
  it('renders ONE note affordance — a bare pen — while nothing is noted', () => {
    // The roll-up and the entry are the same button. With nothing noted it is
    // the entry: pen only, labelled as the add action, no count markup.
    const html = render()
    expect(html).toContain(`Add note for Squat`)
    // A regex, not a substring: the count is an ICU plural, so "2 notes on
    // Squat" would slip straight past `not.toContain('note on Squat')` and a
    // double-count regression would read as green.
    expect(html).not.toMatch(/for Squat, \d+ notes?/)
  })

  it('keeps the note affordance icon-only, in the header rail with its siblings', () => {
    // The rail is a cluster of ghost icon buttons (collapse, plates, replace,
    // skip, remove). A worded pill among them broke the rhythm and read
    // heavier than the destructive actions beside it, so the label lives in
    // aria-label only. The rail's hairline divider fences off skip/remove, so
    // the entry button must render BEFORE it — an everyday utility, not an
    // opt-out.
    const html = render()
    expect(html).not.toContain('>Note<')
    expect(html.indexOf('Add note for Squat')).toBeLessThan(html.indexOf('Skip Squat'))
  })

  it('keeps the 44px target (#236) even though icon-sm is 36px', () => {
    // The worded chip carried hit-44-y; neither dropping to an icon button nor
    // absorbing the roll-up may quietly shrink the target. hit-44-y extends
    // vertically only, so it buys the 44px back without bleeding into the
    // neighbours on either side.
    const html = render()
    // Just this button's own attributes: from its aria-label to the end of
    // its opening tag, so a neighbour's classes can never satisfy the assert.
    const at = html.indexOf('Add note for Squat')
    expect(html.slice(at, html.indexOf('>', at))).toContain('hit-44-y')
  })

  it('renders the note words as the tap target once a session note exists', () => {
    // Open-OR-has-notes invariant, new grammar: a non-empty note is never
    // hidden — it renders as muted words that reopen the editor. The header
    // button stays put and flips from the add label to the roll-up count, so
    // the rail never gains or loses a control mid-session.
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'felt heavy today'
    const html = render({ initialDraft: draft })
    expect(html).toContain('felt heavy today')
    expect(html).toContain('Edit note for Squat')
    expect(html).not.toContain('Add note for Squat')
    expect(html).toContain('Edit note for Squat, 1 note')
  })

  it('a session note carries the pin-as-promotion affordance', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'felt heavy today'
    const html = render({ initialDraft: draft })
    expect(html).toContain('Pin note for Squat')
  })

  it('the workout-level note entry is an app-bar icon button, not a pill in the scroll', () => {
    const html = render()
    // Icon-only, labelled for screen readers — the same grammar as the
    // exercise-level entry, and reachable without scrolling past every card.
    expect(html).toContain('Add workout note')
    // The old worded pill is gone: one door in, and it is not at the bottom.
    expect(html).not.toContain('>Workout note<')
  })

  it('a non-empty workout note still shows and edits inline at the bottom', () => {
    // The entry moved; the note did not. A hidden note is a lost note, so the
    // textarea stays the place the words live once there are any.
    const draft = draftWithCompletedSet()
    draft.notes = 'cut short — gym closing'
    const html = render({ initialDraft: draft })
    expect(html).toContain('cut short — gym closing')
    expect(html).toContain('Workout notes')
    // …and the app-bar entry stays live beside it: the sheet appends.
    expect(html).toContain('Add workout note')
  })

  it('an exercise-less draft gets no workout-note entry at all', () => {
    // Nowhere for the note to show means nowhere for it to be found again.
    const html = render({ initialDraft: { ...draftWithCompletedSet(), exercises: [] } })
    expect(html).not.toContain('Add workout note')
  })

  it("echoes last session's note when this session has none", () => {
    const html = render({}, lastPerformance({ sessionNote: 'Felt strong, add 2.5' }))
    expect(html).toContain('Last time:')
    expect(html).toContain('Felt strong, add 2.5')
  })

  it('retires the echo once a session note exists', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'new note this session'
    const html = render(
      { initialDraft: draft },
      lastPerformance({ sessionNote: 'Felt strong, add 2.5' }),
    )
    expect(html).not.toContain('Last time:')
    expect(html).not.toContain('Felt strong, add 2.5')
  })

  it('suppresses the echo when the pinned chip already shows the same text', () => {
    const html = render(
      {},
      lastPerformance({
        sessionNote: 'Seat pin 4',
        note: { body: 'Seat pin 4', pinned: true },
      }),
    )
    // The pinned chip owns the text; the echo must not duplicate it.
    expect(html).toContain('Exercise note for Squat')
    expect(html).not.toContain('Last time:')
  })

  it('the skipped fold still echoes the session note', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].skipped = true
    draft.exercises[0].notes = 'shoulder tweak'
    const html = render({ initialDraft: draft })
    expect(html).toContain('shoulder tweak')
    expect(html).toContain('Skipped')
  })
})

describe('technique stage rows', () => {
  /** One exercise logged as a 2-stage drop set (top set + one drop). */
  const DROPPED: WorkoutDraft = {
    notes: '',
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
          {
            id: 's1',
            reps: '8',
            weight: '100',
            completed: false,
            tag: 'working',
            technique: { kind: 'drop-set', group: 'g1', stageIndex: 0 },
          },
          {
            id: 's2',
            reps: '6',
            weight: '80',
            completed: false,
            tag: 'working',
            technique: { kind: 'drop-set', group: 'g1', stageIndex: 1 },
          },
        ],
      },
    ],
  }

  it('marks the stage row with the technique glyph instead of a set number', () => {
    const html = render({ initialDraft: DROPPED })

    // The top set keeps its number; the drop wears 'D'.
    expect(html).toContain('drop set stage 2 of set 2')
    expect(html).not.toMatch(/WorkoutLogger\.setLabelStage/)
  })

  it('rules the group together so three rows do not read as three straight sets', () => {
    const html = render({ initialDraft: DROPPED })

    expect(html).toContain('before:bg-muted-foreground/40')
  })

  it('leaves an ordinary draft free of any group rule', () => {
    const html = render()

    expect(html).not.toContain('before:bg-muted-foreground/40')
  })
})
