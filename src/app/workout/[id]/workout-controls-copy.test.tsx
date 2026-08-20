import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { useTranslations } from 'next-intl'

/**
 * Copy contract for the summary page's two client islands. Both call
 * useRouter, so next/navigation is mocked; both resolve their words through
 * the REAL en.json (vitest.intl feeds the shipped catalog).
 *
 * The dialog bodies live behind state a static render never reaches, so they
 * are replayed through the same keys the components pass to ConfirmDialog.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/workout/actions', () => ({
  deleteWorkoutAction: vi.fn(),
  createWorkoutShareAction: vi.fn(),
  revokeWorkoutShareAction: vi.fn(),
}))

vi.mock('@/app/templates/actions', () => ({
  saveWorkoutAsTemplateAction: vi.fn(),
}))

import { WorkoutActions } from './workout-actions'
import { WorkoutSharing } from './workout-sharing'

describe('WorkoutActions copy', () => {
  it('renders every action from the catalog', () => {
    const html = renderStaticIntl(<WorkoutActions id="w1" />)

    expect(html).toContain('Repeat workout')
    expect(html).toContain('Save as template')
    expect(html).toContain('Edit')
    expect(html).toContain('Delete')
    expect(html).not.toMatch(/WorkoutActions\.[a-zA-Z.]+/)
  })

  it('carries the delete dialog and its failure copy', () => {
    function Dialog() {
      const t = useTranslations('WorkoutActions')
      return (
        <>
          {t('deleteDialog.title')}
          {t('deleteDialog.body')}
          {t('deleteDialog.pending')}
          {t('deleteError')}
          {t('templateActionPending')}
        </>
      )
    }
    const html = renderStaticIntl(<Dialog />)

    expect(html).toContain('Delete this workout?')
    expect(html).toContain('Every logged set goes with it. This cannot be undone.')
    expect(html).toContain('Deleting…')
    expect(html).toContain('Could not delete workout. Please try again.')
    expect(html).toContain('Saving template…')
    expect(html).not.toMatch(/WorkoutActions\.[a-zA-Z.]+/)
  })
})

describe('WorkoutSharing copy', () => {
  it('renders the pre-mint invitation', () => {
    const html = renderStaticIntl(<WorkoutSharing workoutId="w1" shareToken={null} />)

    expect(html).toContain('Sharing')
    expect(html).toContain('Share workout')
    expect(html).toContain(
      'Anyone with the link sees this summary — sets, volume, PRs. Your notes and body data stay private.',
    )
    expect(html).not.toMatch(/WorkoutSharing\.[a-zA-Z.]+/)
  })

  it('renders the minted-link row with its copy and revoke controls', () => {
    const html = renderStaticIntl(<WorkoutSharing workoutId="w1" shareToken="tok" />)

    expect(html).toContain('Share link')
    expect(html).toContain('Copy share link')
    expect(html).toContain('Revoke link')
    expect(html).not.toMatch(/WorkoutSharing\.[a-zA-Z.]+/)
  })

  it('carries the revoke dialog and its failure copy', () => {
    function Dialog() {
      const t = useTranslations('WorkoutSharing')
      return (
        <>
          {t('revokeDialog.title')}
          {t('revokeDialog.body')}
          {t('revokeDialog.pending')}
          {t('copyAriaLabelCopied')}
          {t('createError')}
        </>
      )
    }
    const html = renderStaticIntl(<Dialog />)

    expect(html).toContain('Revoke this link?')
    expect(html).toContain(
      'Anyone holding the link loses access immediately. Sharing again creates a fresh link.',
    )
    expect(html).toContain('Revoking…')
    expect(html).toContain('Link copied')
    expect(html).toContain('Could not create the link. Try again.')
    expect(html).not.toMatch(/WorkoutSharing\.[a-zA-Z.]+/)
  })
})

describe('HeaderClock and the logger page titles', () => {
  it('keeps the elapsed value inside the accessible name', () => {
    function Labels() {
      const clock = useTranslations('HeaderClock')
      const edit = useTranslations('WorkoutEdit')
      const fresh = useTranslations('NewWorkout')
      return (
        <>
          {clock('ariaLabel', { elapsed: '12:04' })}
          {edit('titleLive')}
          {edit('titleCompleted')}
          {edit('programContext', { day: 'Lower A', week: 3 })}
          {fresh('title')}
        </>
      )
    }
    const html = renderStaticIntl(<Labels />)

    expect(html).toContain('Session time 12:04')
    expect(html).toContain('Log Workout')
    expect(html).toContain('Edit Workout')
    expect(html).toContain('Lower A · Week 3')
    expect(html).toContain('New Workout')
  })
})
