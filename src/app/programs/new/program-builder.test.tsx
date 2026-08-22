import { describe, expect, test, vi } from 'vitest'

import { renderStaticIntl } from '../../../../vitest.intl'
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
    // Those are separate message keys now (`.label` / `.hint`) so the new
    // choice list can set them on their own lines; this surface joins them
    // with an em dash. Either way an option must never read as a bare enum.
    for (const label of [
      'None — Every week is a working week.',
      'Reactive — Only backs off when stalls suggest one.',
      'Scheduled — Backs off on the deload week, every block.',
      'Cutting — Stalls are expected; hold the load instead of auto-backing-off.',
      'Maintaining',
      'Bulking',
    ]) {
      expect(html).toContain(label)
    }
    // The values behind those labels must never surface as copy.
    expect(html).not.toContain('reps_weight')
    expect(html).not.toContain('duration_distance')
  })

  test('the metric-mode select shows worded modes', () => {
    const html = renderStaticIntl(<ProgramBuilder unit="kg" initialDraft={draftWithOneSet()} />)
    expect(html).toContain('Reps × weight')
    expect(html).toContain('Duration + distance')
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
