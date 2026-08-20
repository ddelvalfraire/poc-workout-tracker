import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

/**
 * Copy contract for the logger surface: the words the user reads come out of
 * the REAL en.json (vitest.intl feeds the shipped catalog), no key path
 * survives into the markup, every plural is pinned at one AND at many, and
 * every rich message still carries its tag around real content.
 *
 * The logger renders statically; the messages that only appear behind state
 * (the undo toast, the swap prompt, the finish dialog) are replayed through
 * the same keys and argument names the component uses.
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

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'

/** A key path leaking into the output means the catalog is missing that message. */
const UNRESOLVED = /WorkoutLogger\.[a-zA-Z.]+/

function draft(): WorkoutDraft {
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
          { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function renderLogger(props: Partial<Parameters<typeof WorkoutLogger>[0]> = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderStaticIntl(
    <QueryClientProvider client={client}>
      <WorkoutLogger title="New Workout" closeHref="/" initialDraft={draft()} {...props} />
    </QueryClientProvider>,
  )
}

function Probe({ render }: { render: (t: ReturnType<typeof useTranslations>) => ReactNode }) {
  const t = useTranslations('WorkoutLogger')
  return <>{render(t)}</>
}

const message = (render: (t: ReturnType<typeof useTranslations>) => ReactNode) =>
  renderStaticIntl(<Probe render={render} />)

describe('WorkoutLogger copy resolves through the catalog', () => {
  it('renders the chrome, the columns and the actions as words', () => {
    const html = renderLogger({ isLive: true })

    expect(html).toContain('Workout name')
    expect(html).toContain('Prev')
    expect(html).toContain('Reps')
    expect(html).toContain('+ Add set')
    expect(html).toContain('+ Exercise')
    expect(html).toContain('Discard workout')
    expect(html).not.toMatch(UNRESOLVED)
  })

  it('renders the empty state and its hint', () => {
    const html = renderLogger({ initialDraft: { notes: '', exercises: [] } })

    expect(html).toContain('Empty bar.')
    expect(html).toContain('Tap + Exercise below to add your first movement.')
    expect(html).not.toMatch(UNRESOLVED)
  })

  it('labels the set controls for assistive tech, warm-up rows included', () => {
    const warmup = draft()
    warmup.exercises[0].sets[0].tag = 'warmup'
    const html = renderLogger({ initialDraft: warmup })

    expect(html).toContain('Mark warm-up set 1 incomplete')
    expect(html).toContain('Set 1 reps')
    expect(html).toContain('Set 1 weight in kg')
    expect(html).not.toMatch(UNRESOLVED)
  })

  it('keeps the finish CTA rich tag around its arrow', () => {
    const html = renderLogger({ isLive: true })

    expect(html).toContain('Finish workout')
    expect(html).toContain('<span aria-hidden="true">→</span>')
  })

  it('names the logging-type options from the catalog, not a module map', () => {
    const html = renderLogger()

    expect(html).toContain('Weight × reps')
    expect(html).toContain('BW + weight')
    expect(html).toContain('BW − assist')
  })
})

describe('WorkoutLogger plurals', () => {
  it('counts exercise notes at one and at many', () => {
    const one = message((t) => t('noteCountAriaLabel', { count: 1, name: 'Squat' }))
    const many = message((t) => t('noteCountAriaLabel', { count: 3, name: 'Squat' }))

    expect(one).toContain('1 note on Squat')
    expect(one).not.toContain('1 notes')
    expect(many).toContain('3 notes on Squat')
  })

  it('agrees the finish warning with its set count at one and at many', () => {
    const one = message((t) => t('finishDialog.body', { count: 1 }))
    const many = message((t) => t('finishDialog.body', { count: 4 }))

    expect(one).toContain('1 set has no reps logged')
    expect(many).toContain('4 sets have no reps logged')
  })
})

describe('WorkoutLogger rich messages', () => {
  it('emphasises the next-up exercise name inside its tag', () => {
    const out = message((t) =>
      t.rich('nextUp', {
        name: 'Bench Press',
        set: 2,
        exercise: (chunks) => <span className="fg">{chunks}</span>,
      }),
    )

    expect(out).toContain('Next: <span class="fg">Bench Press</span> — set 2')
    expect(out).not.toMatch(UNRESOLVED)
  })

  it('emphasises the substitute in the remember prompt', () => {
    const out = message((t) =>
      t.rich('rememberPrompt', {
        name: 'Hack Squat',
        substitute: (chunks) => <b>{chunks}</b>,
      }),
    )

    expect(out).toContain('Use <b>Hack Squat</b> for the rest of the block?')
  })

  it('emphasises the subject of both undo sentences', () => {
    const removed = message((t) =>
      t.rich('undoRemoved', { subject: 'Squat', name: (chunks) => <b>{chunks}</b> }),
    )
    const replaced = message((t) =>
      t.rich('undoReplaced', { subject: 'Squat', name: (chunks) => <b>{chunks}</b> }),
    )

    expect(removed).toContain('Removed <b>Squat</b>')
    expect(replaced).toContain('Replaced <b>Squat</b>')
  })
})

describe('WorkoutLogger expand label', () => {
  it('appends the PR and superset clauses only when they apply', () => {
    const plain = message((t) =>
      t('expandAriaLabel', { name: 'Squat', summary: '3 sets', pr: 'no', superset: 'none' }),
    )
    const decorated = message((t) =>
      t('expandAriaLabel', { name: 'Squat', summary: '3 sets', pr: 'yes', superset: 'A' }),
    )

    expect(plain).toBe('Expand Squat — completed, 3 sets')
    expect(decorated).toBe('Expand Squat — completed, 3 sets, new PR, superset A')
  })
})
