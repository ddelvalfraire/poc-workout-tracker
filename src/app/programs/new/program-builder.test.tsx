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
    // Each option is a name plus the sentence that makes it mean something.
    // `ChoiceList` renders those two on their OWN lines (the hint is a second
    // line inside the label, so it is part of the announced name) rather than
    // gluing them together with an em dash, so they are asserted as the
    // separate strings they now are. Either way an option must never read as
    // a bare enum: the name is always accompanied by its sentence.
    for (const [label, hint] of [
      ['None', 'Every week is a working week.'],
      ['Reactive', 'Only backs off when stalls suggest one.'],
      ['Scheduled', 'Backs off on the deload week, every block.'],
      ['Cutting', 'Stalls are expected; hold the load instead of auto-backing-off.'],
      ['Maintaining', 'Normal progression.'],
      ['Bulking', 'Normal progression.'],
    ]) {
      expect(html).toContain(`>${label}</span>`)
      expect(html).toContain(hint)
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
    // that the mode a user can SEE is never a wire identifier — the values
    // themselves still ride the control's hidden form input, which is markup
    // rather than copy, so this reads text nodes rather than the whole string.
    expect(html).not.toMatch(/>[^<]*reps_weight/)
    expect(html).not.toMatch(/>[^<]*duration_distance/)
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
    expect(html).toContain('Day 1')
    expect(html).toContain('Remove day 1')
    expect(html).toContain('Lower schedule')
    expectNoUnresolvedKeys(html)
  })

  test('edit mode says "Save changes", create mode says "Save program"', () => {
    const editing = renderStaticIntl(
      <ProgramBuilder programId="p1" unit="kg" initialDraft={draftWithOneSet()} />,
    )
    expect(editing).toContain('Save changes')
    expect(editing).not.toContain('Save program')
  })
})
