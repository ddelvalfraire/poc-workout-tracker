import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'

import type { NoteView } from '@/components/notes/note-view'
import { NotesBrowser } from './notes-browser'

/** Synthetic NoteView rows — the same static-render recipe as
 *  nav-drawer.test.tsx (markup contract, no DOM, no interaction). */
function view(overrides: Partial<NoteView> = {}): NoteView {
  return {
    id: 'n1',
    author: 'user',
    anchorKind: 'set',
    outdated: false,
    breadcrumb: 'Bench Press · Set 3',
    body: 'left shoulder clicked #form',
    snapshotLine: '185 lb × 6',
    timeLabel: '2h ago',
    threadKey: 'w:w1',
    threadTitle: 'Push',
    threadDateLabel: 'Yesterday',
    exerciseName: 'Bench Press',
    programName: null,
    workoutId: 'w1',
    tags: ['#form'],
    ...overrides,
  }
}

describe('NotesBrowser', () => {
  test('groups rows under SESSION headers: title left, relative date right', () => {
    const html = renderStaticIntl(
      <NotesBrowser
        corpusEmpty={false}
        notes={[
          view({ id: 'a' }),
          view({ id: 'b', breadcrumb: 'Workout', anchorKind: 'workout' }),
          view({
            id: 'c',
            threadKey: 'w:w2',
            threadTitle: 'Legs',
            threadDateLabel: 'Aug 10',
            breadcrumb: 'Calf Raise · exercise',
            anchorKind: 'workout_exercise',
          }),
        ]}
      />,
    )
    // Two session threads, in row order (newest first comes pre-sorted).
    const pushIndex = html.indexOf('Push')
    const legsIndex = html.indexOf('Legs')
    expect(pushIndex).toBeGreaterThan(-1)
    expect(legsIndex).toBeGreaterThan(pushIndex)
    expect(html).toContain('Yesterday')
    expect(html).toContain('Aug 10')
    // Caps Section header recipe, and hairline rows via DividerList.
    expect(html).toContain('font-display text-base uppercase leading-none tracking-wide')
    expect(html).toContain('divide-y divide-border/60')
    // Row anatomy rides along: breadcrumbs land under their threads.
    expect(html).toContain('Bench Press · Set 3')
    expect(html).toContain('Calf Raise · exercise')
  })

  test('empty corpus: the EmptyWords sentence, no shells', () => {
    const html = renderStaticIntl(<NotesBrowser corpusEmpty notes={[]} />)
    expect(html).toContain('Notes you write while training land here.')
    expect(html).not.toContain('rounded-2xl')
  })

  test('filters matching nothing (corpus non-empty) reads as a filter miss', () => {
    const html = renderStaticIntl(<NotesBrowser corpusEmpty={false} notes={[]} />)
    expect(html).toContain('No note matches these filters.')
  })

  test('the chip rail (children) renders between search and the list', () => {
    const html = renderStaticIntl(
      <NotesBrowser corpusEmpty={false} notes={[view()]}>
        <nav aria-label="Filter notes">chips</nav>
      </NotesBrowser>,
    )
    expect(html.indexOf('Search notes')).toBeLessThan(html.indexOf('chips'))
    expect(html.indexOf('chips')).toBeLessThan(html.indexOf('Push'))
  })
})
