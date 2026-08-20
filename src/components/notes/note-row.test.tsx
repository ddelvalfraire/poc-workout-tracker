import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { NoteView } from './note-view'
import { NoteBody, NoteRow } from './note-row'

/** Synthetic NoteView with overrides — the same static-render recipe as
 *  divider-list.test.tsx (markup contract, no DOM). */
function view(overrides: Partial<NoteView> = {}): NoteView {
  return {
    id: 'n1',
    author: 'user',
    anchorKind: 'set',
    outdated: false,
    breadcrumb: 'Bench Press · Set 3',
    body: 'left shoulder clicked on rep 4 #form',
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

describe('NoteBody', () => {
  test('renders #tags in the volt ink and everything else plain', () => {
    const html = renderToStaticMarkup(<NoteBody body="bar path drifted #form today" />)
    expect(html).toContain('<span class="font-medium text-primary">#form</span>')
    expect(html).toContain('bar path drifted ')
    expect(html).toContain(' today')
  })

  test('a tagless body carries no volt span', () => {
    const html = renderToStaticMarkup(<NoteBody body="plain words" />)
    expect(html).not.toContain('text-primary')
  })
})

describe('NoteRow', () => {
  test('row anatomy: caps breadcrumb, right-aligned time, body, snapshot line', () => {
    const html = renderToStaticMarkup(<NoteRow note={view()} />)
    expect(html).toContain('Bench Press · Set 3')
    expect(html).toContain('uppercase tracking-widest') // caps breadcrumb recipe
    expect(html).toContain('2h ago')
    expect(html).toContain('ml-auto') // time right-aligned
    expect(html).toContain('185 lb × 6')
  })

  test('outdated fallback: quiet caps word + the preserved "was" snapshot', () => {
    const html = renderToStaticMarkup(
      <NoteRow
        note={view({
          anchorKind: 'workout',
          outdated: true,
          breadcrumb: 'Smith Lunge · Set 2',
          snapshotLine: '35 lb × 8',
        })}
      />,
    )
    expect(html).toContain('Outdated')
    expect(html).toContain('was 35 lb × 8 — set edited after')
    // A word, never a chip: no pill shell on the outdated marker.
    expect(html).not.toContain('rounded-full px-')
  })

  test('a plain user row keeps volt off everything but its tags', () => {
    const html = renderToStaticMarkup(<NoteRow note={view({ body: 'no tags here' })} />)
    expect(html).not.toContain('text-primary')
    expect(html).not.toContain('border-l-primary')
  })

  test('coach fixture: 17px avatar + name + volt left hairline (render-ready)', () => {
    const html = renderToStaticMarkup(
      <NoteRow note={view({ author: 'coach', body: 'own the eccentric' })} />,
    )
    expect(html).toContain('border-l-2 border-l-primary') // volt left hairline
    expect(html).toContain('size-[17px]') // the drafts&#x27; 17px avatar — assert raw class
    expect(html).toContain('Coach') // the author name beside the avatar
  })

  test('no snapshot line renders when there is nothing to show', () => {
    const html = renderToStaticMarkup(<NoteRow note={view({ snapshotLine: null })} />)
    expect(html).not.toContain('was ')
    expect(html).not.toContain('×')
  })

  test('resolves every catalog key it references', () => {
    // The assertions above read the copy the catalog produced; this one
    // catches the other failure — a key the catalog never got, which
    // next-intl renders as the key path itself.
    const html = renderToStaticMarkup(
      <NoteRow note={view({ author: 'coach', outdated: true })} />,
    )
    expect(html).not.toMatch(/NoteRow\.[a-zA-Z.]+/)
  })
})
