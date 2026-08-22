import { describe, expect, test, vi } from 'vitest'

import { catalogTranslator, renderStaticIntl } from '../../../../vitest.intl'
import {
  emptyProgramDraft,
  newDraftProgramDay,
  newDraftProgramExercise,
  newDraftProgramSet,
  type ProgramDraft,
} from './program-draft'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/app/programs/actions', () => ({
  saveProgramAction: vi.fn(),
  updateProgramAction: vi.fn(),
}))
// The picker owns a TanStack query and its own catalog fetch — neither has
// anything to do with the builder's copy.
vi.mock('@/app/workout/new/exercise-picker', () => ({
  ExercisePicker: () => null,
}))

import { ProgramBuilder } from './program-builder'

function expectNoUnresolvedKeys(html: string): void {
  expect(html).not.toMatch(/ProgramBuilder\.[a-zA-Z.]+/)
}

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many times `needle` appears in `haystack`. */
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

/**
 * Asserts a `Choice` renders its OWN hint, not merely that both strings exist
 * somewhere in the document.
 *
 * `Choice` puts the two on their own lines inside one label — the hint is a
 * second line of the announced name — so the pairing is an adjacency in the
 * markup. Two independent `toContain`s cannot see it: swap Reactive's hint
 * onto Scheduled and both strings are still present, which is precisely the
 * failure mode the {label, hint} restructure introduced.
 */
function expectChoiceWorded(html: string, label: string, hint: string): void {
  expect(html, `${label} / ${hint}`).toMatch(
    new RegExp(`>${escapeForRegExp(label)}</span><span[^>]*>${escapeForRegExp(hint)}</span>`),
  )
}

/** A draft with one day, one exercise and one reps × weight set. */
function draftWithOneSet(): ProgramDraft {
  const set = newDraftProgramSet('reps_weight')
  const exercise = {
    ...newDraftProgramExercise({
      wgerExerciseId: 1,
      source: 'wger',
      name: 'Back Squat',
      category: 'Legs',
    }),
    sets: [set],
  }
  const day = { ...newDraftProgramDay('Lower'), exercises: [exercise] }
  return { ...emptyProgramDraft, days: [day] }
}

describe('ProgramBuilder form copy', () => {
  test('the empty builder teaches from the catalog', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" />)
    expect(html).toContain('Program name')
    expect(html).toContain('Weeks (default 1)')
    expect(html).toContain('Deload week (optional)')
    expect(html).toContain('Add a training day to start building your program.')
    expect(html).toContain('Save program')
    expectNoUnresolvedKeys(html)
  })

  test('every deload-policy and diet-phase option is worded, not enum-named', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" />)
    // Each option is a name plus the sentence that makes it mean something,
    // and the sentence has to be ITS OWN — asserted as an adjacency, because
    // "both strings appear" passes just as happily when the hints are
    // swapped. Either way an option must never read as a bare enum: the name
    // is always accompanied by its sentence.
    //
    // "Normal progression." belongs to two phases, so only the pairing tells
    // the two assertions apart.
    for (const [label, hint] of [
      ['None', 'Every week is a working week.'],
      ['Reactive', 'Only backs off when stalls suggest one.'],
      ['Scheduled', 'Backs off on the deload week, every block.'],
      ['None', 'No phase — the engine behaves exactly as it always has.'],
      ['Cutting', 'Stalls are expected; hold the load instead of auto-backing-off.'],
      ['Maintaining', 'Normal progression.'],
      ['Bulking', 'Normal progression.'],
    ]) {
      expectChoiceWorded(html, label, hint)
    }
    // The values behind those labels must never surface as copy.
    expect(html).not.toContain('reps_weight')
    expect(html).not.toContain('duration_distance')
  })

  test('the metric-mode select shows worded modes', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" initialDraft={draftWithOneSet()} />)
    // The trigger shows the SELECTED mode worded — the reason `items` is
    // passed to `Select` at all; without it the trigger renders the wire
    // value (`reps_weight`) straight at the user.
    expect(html).toContain('Reps × weight')
    // The unselected modes live in the popup, which Base UI portals only once
    // mounted, so a static render cannot contain them. What matters here is
    // that the mode a user can SEE is never a wire identifier.
    //
    // COUNTED, not pattern-matched. The one legitimate `reps_weight` in the
    // document is the value of Base UI's visually-hidden, `aria-hidden` form
    // input — markup, not copy. A regex that only reads TEXT NODES exempts
    // that input but also exempts every attribute, so a wire value leaking
    // into an accessible name (`aria-label="reps_weight"`) or a placeholder
    // would pass silently — and an accessible name is copy. Exactly one
    // occurrence keeps the hidden input's exemption without the hole.
    expect(occurrences(html, 'reps_weight')).toBe(1)
    expect(occurrences(html, 'duration_distance')).toBe(0)
    // Every mode is worded in the catalog, selected or not.
    const t = catalogTranslator('ProgramBuilder')
    expect(t('metricMode.duration')).toBe('Duration')
    expect(t('metricMode.durationDistance')).toBe('Duration + distance')
    expectNoUnresolvedKeys(html)
  })

  test('set inputs get one accessible sentence per field, in the display unit', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="lb" initialDraft={draftWithOneSet()} />)
    expect(html).toContain('Back Squat set 1 rep min')
    expect(html).toContain('Back Squat set 1 load in lb')
    expect(html).toContain('Back Squat set 1 rest in seconds')
    expect(html).toContain('Remove Back Squat set 1')
  })

  test('day chrome is numbered through the catalog', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" initialDraft={draftWithOneSet()} />)
    // A NAMED day takes `day.titleNamed`. Asserting the bare "Day 1" here
    // would pass either way — "Day 1 · Lower" contains it — which left the
    // named branch untested.
    expect(html).toContain('Day 1 · Lower')
    expect(html).toContain('Remove day 1')
    expect(html).toContain('Lower schedule')
    expectNoUnresolvedKeys(html)
  })

  test('an unnamed day takes the plain numbered title and the empty count', () => {
    const day = newDraftProgramDay('')
    const html = renderStaticIntl(
      <ProgramBuilder unit="kg" initialDraft={{ ...emptyProgramDraft, days: [day] }} />,
    )
    // The other branch of the same pair: no name, no separator.
    expect(html).toContain('>Day 1</span>')
    expect(html).not.toContain('Day 1 ·')
    // `day.exerciseCount`'s =0 arm as RENDERED copy, not just as a formatter
    // sweep — an empty day says what it is rather than counting to zero.
    expect(html).toContain('Nothing in it yet')
    expect(html).not.toContain('0 movements')
    // An unnamed day still names its schedule group after the numbered title.
    expect(html).toContain('Day 1 schedule')
    expectNoUnresolvedKeys(html)
  })

  test('an unnamed program shows the untitled placeholder, not a blank heading', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" />)
    expect(html).toContain('Untitled block')
    // A named one replaces it outright.
    const named = renderStaticIntl(
      <ProgramBuilder unit="kg" initialDraft={{ ...emptyProgramDraft, name: 'Volume Cut' }} />,
    )
    expect(named).toContain('Volume Cut')
    expect(named).not.toContain('Untitled block')
  })

  test('edit mode says "Save changes", create mode says "Save program"', () => {
    const editing = renderStaticIntl(
      <ProgramBuilder programId="p1" unit="kg" initialDraft={draftWithOneSet()} />,
    )
    expect(editing).toContain('Save changes')
    expect(editing).not.toContain('Save program')
  })
})
