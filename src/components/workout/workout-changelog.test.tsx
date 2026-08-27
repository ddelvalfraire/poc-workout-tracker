// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderStaticIntl, withIntl } from '../../../vitest.intl'
import { WorkoutChangelog } from './workout-changelog'
import type { WorkoutChangelogEntry } from './workout-changelog-view'

/**
 * The surface's contract, in the order a reader meets it: it is ABSENT for an
 * untouched record; it leads with the permanent amended mark; it shows
 * amendments only until asked for the rest.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSION_AT = new Date('2026-01-10T18:00:00Z')
const NOW = new Date('2026-01-15T09:00:00Z')

function entry(overrides: Partial<WorkoutChangelogEntry> = {}): WorkoutChangelogEntry {
  return {
    id: 'e1',
    kind: 'amendment',
    actor: 'ui',
    occurredAt: new Date('2026-01-12T18:00:00Z'),
    summary: 'Set 3 of Squat — weight 100 → 102.5, reps 5 → 6',
    ...overrides,
  }
}

function markup(entries: readonly WorkoutChangelogEntry[]): string {
  return renderStaticIntl(
    <WorkoutChangelog entries={entries} sessionAt={SESSION_AT} now={NOW} locale="en" />,
  )
}

describe('WorkoutChangelog markup', () => {
  it('renders nothing at all when the record was never amended', () => {
    // Arrange — a full stream with no correction in it
    const html = markup([
      entry({ id: 'a', kind: 'original', occurredAt: SESSION_AT }),
      entry({ id: 'b', kind: 'system' }),
    ])

    // Assert — absent, not an empty state
    expect(html).toBe('')
  })

  it('leads with the permanent amended mark', () => {
    const html = markup([
      entry({ id: 'a' }),
      entry({ id: 'b', occurredAt: new Date('2026-01-11T18:00:00Z') }),
    ])

    expect(html).toContain('Edited twice, 2 days after the session')
  })

  it('phrases a single same-day correction without a day count', () => {
    const html = markup([entry({ occurredAt: new Date('2026-01-10T21:00:00Z') })])
    expect(html).toContain('Edited once, later the same day')
  })

  it('renders one row per intent, not one per changed field', () => {
    // The write path folded both fields into one summary; the row is one <li>.
    const html = markup([entry()])
    expect(html.match(/<li /g) ?? []).toHaveLength(1)
    expect(html).toContain('weight 100 → 102.5, reps 5 → 6')
  })

  it('hides the rest of the log behind a disclosure', () => {
    const html = markup([
      entry({ id: 'a' }),
      entry({ id: 'b', kind: 'original', summary: 'Logged 4 exercises' }),
    ])

    expect(html).toContain('Show the full log')
    expect(html).not.toContain('Logged 4 exercises')
  })

  it('offers no disclosure when the amendments are the whole log', () => {
    expect(markup([entry()])).not.toContain('Show the full log')
  })

  it('names the actor as a word and your own edits stay muted', () => {
    const html = markup([entry({ actor: 'ui' })])
    expect(html).toContain('You')
    expect(html).toContain('text-muted-foreground')
  })

  it("reads an agent's edit in the foreground ink", () => {
    const html = markup([entry({ actor: 'mcp' })])
    expect(html).toContain('Claude')
    expect(html).toContain('text-foreground')
  })

  it('gives the three kinds three distinct rails', () => {
    const full = markup([
      entry({ id: 'a', kind: 'amendment' }),
      entry({ id: 'b', kind: 'late_entry' }),
      entry({ id: 'c', kind: 'system' }),
    ])
    // Only the amendment is visible by default, and it wears the volt rail.
    expect(full).toContain('border-l-primary')
    expect(full).not.toContain('border-l-border/40')
  })
})

describe('WorkoutChangelog disclosure', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function toggle(): HTMLButtonElement {
    const button = container.querySelector('button')
    expect(button).toBeTruthy()
    return button as HTMLButtonElement
  }

  it('reveals the rest of the log and gives it back', () => {
    // Arrange
    act(() => {
      root.render(
        withIntl(
          <WorkoutChangelog
            entries={[
              entry({ id: 'a' }),
              entry({ id: 'b', kind: 'late_entry', summary: 'Added Squat, 3 sets' }),
              entry({ id: 'c', kind: 'original', summary: 'Logged 4 exercises' }),
            ]}
            sessionAt={SESSION_AT}
            now={NOW}
            locale="en"
          />,
        ),
      )
    })
    expect(container.textContent).not.toContain('Logged 4 exercises')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    // Act — open
    act(() => toggle().click())

    // Assert — the rest is there, late entries say what they are
    expect(container.textContent).toContain('Logged 4 exercises')
    expect(container.textContent).toContain('Added afterwards')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    // Act — close again
    act(() => toggle().click())
    expect(container.textContent).not.toContain('Logged 4 exercises')
  })
})
