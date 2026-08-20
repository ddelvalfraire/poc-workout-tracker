import { describe, expect, test, vi } from 'vitest'

import { renderStaticIntl } from '../../../../vitest.intl'

// Every island below navigates on success; none of that runs in a static
// render, but the hook must exist for the component to mount at all.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
// Server actions cannot be imported into a node test (they pull the db and
// Clerk); the islands only reference them inside handlers.
vi.mock('@/app/programs/actions', () => ({
  adjustTrainingMaxAction: vi.fn(),
  adoptProgramAction: vi.fn(),
  confirmPatchProposalAction: vi.fn(),
  declinePatchProposalAction: vi.fn(),
  declineProgramAction: vi.fn(),
  deleteProgramAction: vi.fn(),
  restartPreviewAction: vi.fn(),
  restartProgramAction: vi.fn(),
  rotateProgramShareAction: vi.fn(),
  setDietPhaseAction: vi.fn(),
  setExerciseOvershootPolicyAction: vi.fn(),
  setOvershootPolicyAction: vi.fn(),
  setProgramStatusAction: vi.fn(),
  setProgramVisibilityAction: vi.fn(),
  startProgramDayAction: vi.fn(),
  updateProgramDescriptionAction: vi.fn(),
}))

import { DescriptionEdit } from './description-edit'
import { DietPhaseCard } from './diet-phase-card'
import { ExerciseOvershootControl } from './exercise-overshoot-control'
import { OvershootPolicyControl } from './overshoot-policy-control'
import { PatchProposalCard } from './patch-proposal-card'
import { ProgramActions } from './program-actions'
import { ProposalActions } from './proposal-actions'
import { RestartProgramButton } from './restart-program-button'
import { SharingSection } from './sharing-section'
import { StartDayButton } from './start-day-button'
import { TmResetButton } from './tm-reset-button'

/**
 * A key path that reached the DOM means next-intl could not resolve it — the
 * component asked for `Namespace.something` the catalog never got. These
 * tests render against the REAL en.json (see vitest.intl.tsx), so this is the
 * check that turns a missing message into a failure instead of a shipped
 * string of dots.
 */
function expectNoUnresolvedKeys(html: string, namespace: string): void {
  expect(html).not.toMatch(new RegExp(`${namespace}\\.[a-zA-Z.]+`))
}

describe('DietPhaseCard copy', () => {
  test('asks the question and offers both answers from the catalog', () => {
    const html = renderStaticIntl(<DietPhaseCard programId="p1" weeks={6} />)
    expect(html).toContain('Still cutting?')
    expect(html).toContain('End cut')
    expect(html).toContain('Diet phase check')
    expectNoUnresolvedKeys(html, 'DietPhaseCard')
  })

  // Both plural branches, separately: a single-branch assertion passes at one
  // count and lies at every other.
  test('staleness note reads singular at one week', () => {
    const html = renderStaticIntl(<DietPhaseCard programId="p1" weeks={1} />)
    expect(html).toContain('This cut was set 1 week ago')
    expect(html).not.toContain('1 weeks')
  })

  test('staleness note reads plural past one week', () => {
    const html = renderStaticIntl(<DietPhaseCard programId="p1" weeks={6} />)
    expect(html).toContain('This cut was set 6 weeks ago')
  })
})

describe('overshoot controls copy', () => {
  test('per-exercise control names every option and the exercise it governs', () => {
    const html = renderStaticIntl(
      <ExerciseOvershootControl
        programId="p1"
        dayPosition={1}
        exercisePosition={1}
        exerciseName="Back Squat"
        policy={null}
      />,
    )
    expect(html).toContain('Overshoot:')
    expect(html).toContain('Overshoot policy for Back Squat')
    for (const option of ['default', 'strict', 'e1RM-equivalent', 'any metric']) {
      expect(html).toContain(option)
    }
    expectNoUnresolvedKeys(html, 'ExerciseOvershootControl')
  })

  test('program-level control shows the selected option’s hint', () => {
    const html = renderStaticIntl(<OvershootPolicyControl programId="p1" policy="any-metric" />)
    expect(html).toContain('Beating a target counts when…')
    expect(html).toContain('Any metric')
    expect(html).toContain('Reps, load, or e1RM — beating any one of them counts.')
    expectNoUnresolvedKeys(html, 'OvershootPolicyControl')
  })

  test('an unset policy falls back to the scheme-default hint', () => {
    const html = renderStaticIntl(<OvershootPolicyControl programId="p1" policy={null} />)
    expect(html).toContain('Strict for load-anchored schemes; e1RM-equivalent for RPE targets.')
  })
})

describe('proposal and patch controls copy', () => {
  test('patch card labels both decisions', () => {
    const html = renderStaticIntl(
      <PatchProposalCard
        id="pp1"
        eyebrow="Proposed changes"
        summary="Two load bumps"
        ageLine="drafted yesterday"
        sentences={['Squat 100 kg → 105 kg']}
      />,
    )
    expect(html).toContain('Apply all')
    expect(html).toContain('Decline')
    expectNoUnresolvedKeys(html, 'PatchProposalCard')
  })

  test('proposal actions offer both adopt paths and decline', () => {
    const html = renderStaticIntl(<ProposalActions id="p1" />)
    expect(html).toContain('Adopt &amp; activate')
    expect(html).toContain('Adopt as draft')
    expect(html).toContain('Decline')
    expectNoUnresolvedKeys(html, 'ProposalActions')
  })
})

describe('program action row copy', () => {
  test('an active program offers Leave, never Activate', () => {
    const html = renderStaticIntl(
      <ProgramActions id="p1" status="active" currentWeek={2} mesocycleWeeks={8} />,
    )
    expect(html).toContain('Edit')
    expect(html).toContain('Leave program')
    expect(html).not.toContain('Activate')
    expect(html).toContain('Delete')
    expectNoUnresolvedKeys(html, 'ProgramActions')
  })

  test('a draft offers Activate and no Restart', () => {
    const html = renderStaticIntl(
      <ProgramActions id="p1" status="draft" currentWeek={1} mesocycleWeeks={4} />,
    )
    expect(html).toContain('Activate')
    expect(html).not.toContain('Restart block')
  })

  test('restart button carries its own label', () => {
    const html = renderStaticIntl(<RestartProgramButton id="p1" />)
    expect(html).toContain('Restart block')
    expectNoUnresolvedKeys(html, 'RestartProgramButton')
  })

  test('TM reset button reads as the quiet confirm it is', () => {
    const html = renderStaticIntl(
      <TmResetButton
        programId="p1"
        dayPosition={1}
        exercisePosition={1}
        exerciseName="Back Squat"
        currentTm={140}
        proposedTm={126}
        proposedTmKg={126}
        unit="kg"
      />,
    )
    expect(html).toContain('Reduce')
    expectNoUnresolvedKeys(html, 'TmResetButton')
  })
})

describe('start and authoring controls copy', () => {
  test('the start button names itself when the caller supplies no label', () => {
    const html = renderStaticIntl(<StartDayButton programDayId="d1" week={1} />)
    expect(html).toContain('Start this day')
    expectNoUnresolvedKeys(html, 'StartDayButton')
  })

  test('a caller-supplied label still wins', () => {
    const html = renderStaticIntl(<StartDayButton programDayId="d1" label="Start Legs" />)
    expect(html).toContain('Start Legs')
    expect(html).not.toContain('Start this day')
  })

  test('description control switches verb on whether an article exists', () => {
    const empty = renderStaticIntl(
      <DescriptionEdit programId="p1" programName="Block A" description={null} />,
    )
    expect(empty).toContain('Add description')
    expectNoUnresolvedKeys(empty, 'DescriptionEdit')

    const written = renderStaticIntl(
      <DescriptionEdit programId="p1" programName="Block A" description="Heavy singles." />,
    )
    expect(written).toContain('Edit description')
  })
})

describe('SharingSection copy', () => {
  test('every visibility mode and the current mode’s blurb come from the catalog', () => {
    const html = renderStaticIntl(
      <SharingSection programId="p1" visibility="link" shareToken="tok" />,
    )
    expect(html).toContain('Sharing')
    expect(html).toContain('Program visibility')
    for (const option of ['Private', 'Shared via link', 'Public']) {
      expect(html).toContain(option)
    }
    expect(html).toContain(
      'Anyone with the link can read the plan. Your history and stats stay private.',
    )
    expectNoUnresolvedKeys(html, 'SharingSection')
  })

  test('a private program reads the private blurb', () => {
    const html = renderStaticIntl(
      <SharingSection programId="p1" visibility="private" shareToken={null} />,
    )
    expect(html).toContain('Only you can see this program.')
  })
})
