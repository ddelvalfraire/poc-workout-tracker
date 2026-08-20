import { describe, expect, test, vi } from 'vitest'
import { createTranslator } from 'next-intl'

import en from '../../../messages/en.json'
import { renderStaticIntl } from '../../../vitest.intl'
import { NotesBrowser } from './notes-browser'
import type { NoteView } from '@/components/notes/note-view'

/**
 * Copy contract for /notes: every string the surface renders resolves through
 * the REAL catalog (vitest.intl feeds en.json on purpose), the window notice
 * is asserted at both plural categories, and no rendered markup may contain a
 * raw `Namespace.key` path — an unresolved key renders as its own name, which
 * a `toContain` on the English words would never catch.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

const t = (namespace: 'Notes' | 'NotesBrowser' | 'FacetSelect') =>
  createTranslator({ locale: 'en', messages: en, namespace })

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

describe('Notes catalog', () => {
  test('the window notice pluralises the note count', () => {
    const notes = t('Notes')
    expect(notes('windowNotice', { count: 1 })).toBe('Showing your latest 1 note.')
    expect(notes('windowNotice', { count: 200 })).toBe('Showing your latest 200 notes.')
  })

  test('the filter rail labels resolve', () => {
    const notes = t('Notes')
    expect(notes('title')).toBe('Notes')
    expect(notes('filters.ariaLabel')).toBe('Filter notes')
    expect(notes('filters.all')).toBe('All')
    expect(notes('filters.mine')).toBe('Mine')
    expect(notes('filters.coach')).toBe('Coach')
  })

  test('each facet owns a whole accessible name and trigger', () => {
    const facet = t('FacetSelect')
    expect(facet('ariaLabel.exercise')).toBe('Filter by exercise')
    expect(facet('ariaLabel.program')).toBe('Filter by program')
    expect(facet('trigger.exercise')).toBe('Exercise ▾')
    expect(facet('trigger.program')).toBe('Program ▾')
  })
})

describe('NotesBrowser copy', () => {
  test('search field takes its placeholder and label from the catalog', () => {
    const html = renderStaticIntl(<NotesBrowser corpusEmpty={false} notes={[view()]} />)
    expect(html).toContain('placeholder="Search notes"')
    expect(html).toContain('aria-label="Search notes"')
  })

  test('the empty corpus renders its sentence, not a key path', () => {
    const html = renderStaticIntl(<NotesBrowser corpusEmpty notes={[]} />)
    expect(html).toContain('Notes you write while training land here.')
    expect(html).not.toMatch(/NotesBrowser\.[a-zA-Z.]+/)
  })

  test('filters matching nothing read as a filter miss (one whole message)', () => {
    const html = renderStaticIntl(<NotesBrowser corpusEmpty={false} notes={[]} />)
    expect(html).toContain('No note matches these filters.')
  })

  test('the searched-miss variant is a separate whole message', () => {
    // The query case is component state a static render cannot reach, so the
    // message itself is asserted through the catalog.
    expect(t('NotesBrowser')('emptyQuery', { query: 'squat' })).toBe('No note matches “squat”.')
  })

  test('no rendered markup leaks an unresolved key path', () => {
    const html = renderStaticIntl(
      <NotesBrowser corpusEmpty={false} notes={[view(), view({ id: 'b' })]} />,
    )
    expect(html).not.toMatch(/NotesBrowser\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/Notes\.[a-zA-Z.]+/)
  })
})
