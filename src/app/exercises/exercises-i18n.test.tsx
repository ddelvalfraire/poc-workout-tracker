import { describe, expect, test, vi } from 'vitest'
import { createTranslator, useTranslations } from 'next-intl'

import en from '../../../messages/en.json'
import { renderStaticIntl } from '../../../vitest.intl'
import { LibraryFilter, type LibraryEntry } from './library-filter'
import { CustomExerciseEditor } from './custom-exercise-editor'
import { ExerciseNoteSection } from './[source]/[id]/exercise-note-section'

/**
 * Copy contract for /exercises and /exercises/[source]/[id]. The detail page
 * is a Server Component behind six database reads, so its messages are
 * asserted through the REAL catalog plus a probe for the one rich message;
 * the client islands render for the markup-level checks.
 *
 * Exercise, muscle and category names are deliberately NOT asserted as copy —
 * they are catalog/database content and stay out of the message catalog.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

const t = (
  namespace:
    | 'Exercises'
    | 'ExerciseStats'
    | 'LibraryFilter'
    | 'CustomExerciseEditor'
    | 'ExerciseNoteSection'
    | 'NewExercise'
    | 'CreateExerciseForm',
) => createTranslator({ locale: 'en', messages: en, namespace })

/** The history PR chip: a rich message whose visually-hidden expansion is the
 *  only thing telling a screen reader what "PR" means. */
function PrChipProbe() {
  const stats = useTranslations('ExerciseStats')
  return (
    <span>
      {stats.rich('history.prChip', {
        sr: (chunks) => <span className="sr-only">{chunks}</span>,
      })}
    </span>
  )
}

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    source: 'wger',
    wgerExerciseId: 1,
    name: 'Bench Press',
    zone: 'moving',
    statusBase: '142 kg e1RM',
    deltaText: null,
    deltaDirection: null,
    recencyLabel: 'Today',
    ...overrides,
  }
}

describe('Exercises library copy', () => {
  const exercises = t('Exercises')

  test('facet and sort chrome resolves; muscle groups stay data', () => {
    expect(exercises('title')).toBe('Exercises')
    expect(exercises('facets.ariaLabel')).toBe('Filter by muscle group')
    expect(exercises('facets.all')).toBe('All')
    expect(exercises('sort.ariaLabel')).toBe('Sort')
    expect(exercises('sort.recent')).toBe('Recent')
    expect(exercises('sort.trained')).toBe('Most trained')
  })

  test('zone headers resolve at render, not from a module-scope label map', () => {
    const html = renderStaticIntl(
      <LibraryFilter
        entries={[
          entry(),
          entry({ wgerExerciseId: 2, name: 'Row', zone: 'training' }),
          entry({ wgerExerciseId: 3, name: 'Curl', zone: 'dormant' }),
        ]}
      />,
    )
    expect(html).toContain('Moving')
    expect(html).toContain('Training')
    expect(html).toContain('Dormant')
    expect(html).toContain('aria-label="Moving"')
  })

  test('the search field and empty state resolve; no key path leaks', () => {
    const html = renderStaticIntl(<LibraryFilter entries={[]} />)
    expect(html).toContain('placeholder="Filter exercises"')
    expect(html).toContain('aria-label="Filter exercises by name"')
    expect(html).toContain('Nothing here yet')
    expect(html).not.toMatch(/LibraryFilter\.[a-zA-Z.]+/)
  })

  test('the searched-miss message quotes the needle inside one message', () => {
    expect(t('LibraryFilter')('emptyQuery', { query: 'squat' })).toBe('No exercise matches “squat”.')
  })
})

describe('CustomExerciseEditor', () => {
  test('the collapsed affordance and its expanded fields resolve', () => {
    const editor = t('CustomExerciseEditor')
    expect(editor('openAction')).toBe('Edit custom exercise')
    expect(editor('sectionTitle')).toBe('Edit custom exercise')
    expect(editor('nameLabel')).toBe('Custom exercise name')
    expect(editor('categoryLabel')).toBe('Category')
    expect(editor('musclesLabel')).toBe('Primary muscles')
    expect(editor('validationName')).toBe('Give it a name.')
    expect(editor('saveError')).toBe('Could not save changes.')
  })

  test('no unresolved key path reaches the markup', () => {
    const html = renderStaticIntl(
      <CustomExerciseEditor
        id={1}
        name="Nordic Curl"
        category="Legs"
        muscles={[]}
        musclesSecondary={[]}
      />,
    )
    expect(html).toContain('Edit custom exercise')
    expect(html).not.toMatch(/CustomExerciseEditor\.[a-zA-Z.]+/)
  })
})

describe('CreateExerciseForm copy', () => {
  const form = t('CreateExerciseForm')

  test('the duplicate warning is a whole sentence per source', () => {
    expect(form('duplicateCustom', { name: 'Nordic Curl' })).toBe(
      '“Nordic Curl” already exists in your exercises.',
    )
    expect(form('duplicateCatalog', { name: 'Bench Press' })).toBe(
      '“Bench Press” already exists in the catalog.',
    )
  })

  test('the contextual primary action resolves by return mode', () => {
    expect(form('primaryAction.swap')).toBe('Save & replace')
    expect(form('primaryAction.add')).toBe('Save & add')
    expect(form('save')).toBe('Save')
  })

  test('validation and failure messages resolve', () => {
    expect(form('validationName')).toBe('Give it a name.')
    expect(form('validationCategory')).toBe('Pick a category.')
    expect(form('createError')).toBe('Could not create the exercise.')
    expect(t('NewExercise')('title')).toBe('New custom exercise')
  })
})

describe('ExerciseNoteSection', () => {
  test('the empty and populated affordances resolve', () => {
    const empty = renderStaticIntl(
      <ExerciseNoteSection source="wger" exerciseId={1} exerciseName="Bench Press" note={null} />,
    )
    expect(empty).toContain('Add note')
    expect(empty).toContain('Setup that follows this exercise everywhere')
    expect(empty).not.toMatch(/ExerciseNoteSection\.[a-zA-Z.]+/)

    const filled = renderStaticIntl(
      <ExerciseNoteSection
        source="wger"
        exerciseId={1}
        exerciseName="Bench Press"
        note={{ body: 'seat pin 4', pinned: true }}
      />,
    )
    expect(filled).toContain('>Edit<')
    expect(filled).toContain('aria-label="Pinned in logger"')
    expect(filled).not.toMatch(/ExerciseNoteSection\.[a-zA-Z.]+/)
  })
})

describe('ExerciseStats copy', () => {
  const stats = t('ExerciseStats')

  test('the standing-time caption pluralises every bucket, both categories', () => {
    expect(stats('standing.week', { count: 1 })).toBe('held 1 week')
    expect(stats('standing.week', { count: 6 })).toBe('held 6 weeks')
    expect(stats('standing.month', { count: 1 })).toBe('held 1 month')
    expect(stats('standing.month', { count: 8 })).toBe('held 8 months')
    expect(stats('standing.year', { count: 1 })).toBe('held 1 year')
    expect(stats('standing.year', { count: 4 })).toBe('held 4 years')
  })

  test('the history set count pluralises at both categories', () => {
    expect(stats('history.setCount', { count: 1 })).toBe('1 set')
    expect(stats('history.setCount', { count: 5 })).toBe('5 sets')
  })

  test('the trend heading and chart name pluralise the session count', () => {
    expect(stats('trend.title', { sessions: 1 })).toBe('Est. 1RM trend · 1 session')
    expect(stats('trend.title', { sessions: 9 })).toBe('Est. 1RM trend · 9 sessions')
    expect(stats('trend.chartAriaLabel', { sessions: 1, current: '100 kg' })).toBe(
      'Estimated 1RM across 1 session, currently 100 kg',
    )
    expect(stats('trend.chartAriaLabel', { sessions: 9, current: '100 kg' })).toBe(
      'Estimated 1RM across 9 sessions, currently 100 kg',
    )
  })

  test('the PR chip renders its screen-reader expansion inside the tag', () => {
    const html = renderStaticIntl(<PrChipProbe />)
    expect(html).toContain('PR')
    expect(html).toContain('<span class="sr-only"> (personal record)</span>')
    expect(html).not.toMatch(/ExerciseStats\.[a-zA-Z.]+/)
  })

  test('the headline delta is three whole messages, one per basis', () => {
    expect(stats('deltaFirst', { gain: 5, unit: 'kg' })).toBe('+5 kg vs first session')
    expect(stats('deltaMonth', { gain: 5, unit: 'kg' })).toBe('+5 kg this month')
    expect(stats('deltaEarlier', { gain: 5, unit: 'kg' })).toBe('+5 kg vs earlier sessions')
  })

  test('record labels, units and the empty state resolve', () => {
    expect(stats('records.title')).toBe('All-time records')
    expect(stats('records.bestE1rmLabel')).toBe('Best est. 1RM')
    expect(stats('records.highRepEstimate')).toBe('High-rep est.')
    expect(stats('records.heaviestLoadLabel')).toBe('Heaviest load')
    expect(stats('records.mostRepsLabel')).toBe('Most reps')
    expect(stats('records.bestVolumeLabel')).toBe('Best session volume')
    expect(stats('records.longestDurationLabel')).toBe('Longest duration')
    expect(stats('records.longestDistanceLabel')).toBe('Longest distance')
    expect(stats('records.bestPaceLabel')).toBe('Best pace')
    expect(stats('records.distanceUnit')).toBe('km')
    expect(stats('records.paceUnit')).toBe('/km')
    expect(stats('records.empty')).toContain('No load records yet')
  })

  test('history chrome, pagination and the share titles resolve', () => {
    expect(stats('history.title')).toBe('History')
    expect(stats('history.empty')).toBe('No sessions yet.')
    expect(stats('history.emptyOlder')).toBe('No older sessions.')
    expect(stats('history.newer')).toBe('Newer')
    expect(stats('history.older')).toBe('Older')
    expect(stats('history.e1rmChip', { value: '142 kg' })).toBe('142 kg e1RM')
    expect(stats('notes.title')).toBe('Notes')
    expect(stats('shareTitleProgress', { name: 'Bench Press' })).toBe('Bench Press progress')
    expect(stats('shareTitlePr', { name: 'Bench Press' })).toBe('Bench Press PR')
  })
})
