// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StatusHero, type StatusHeroProps } from './status-hero'

/**
 * Home's hero picks its CTA from a local-calendar question, so it renders an
 * empty placeholder until it has mounted — these mount for real. The CTA that
 * matters most for translation is "Start {day}", which used to be a template
 * literal: the day name can precede the verb in other languages, and only an
 * argument lets a translator move it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

let container: HTMLDivElement
let root: Root

/**
 * Mon 3 Aug 2026, local — the same instant home-status.test.ts pins, and a
 * day that IS in the fixture's Mon/Wed/Fri schedule.
 *
 * StatusHero reads the real clock (`new Date()`) to decide whether a program
 * day is due, so without this the day-name assertions passed only on Mondays,
 * Wednesdays and Fridays and failed the rest of the week. Only Date is faked:
 * faking timers as well would starve React's scheduler inside act().
 */
const MONDAY_NOON = new Date(2026, 7, 3, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: MONDAY_NOON })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const base: StatusHeroProps = {
  session: null,
  nextDay: null,
  recentCompletedAtTimes: [],
  lastCompleted: null,
  lastTimeVolumeKg: null,
  streak: null,
  guardSession: null,
  unit: 'kg',
}

const nextDay: NonNullable<StatusHeroProps['nextDay']> = {
  dayId: 'd1',
  programId: 'p1',
  programName: 'GZCLP',
  dayName: 'Push A',
  week: 2,
  mesocycleWeeks: 4,
  weekdays: [1, 3, 5],
  blockComplete: false,
}

function render(over: Partial<StatusHeroProps> = {}): string {
  act(() => {
    root.render(<StatusHero {...base} {...over} />)
  })
  return container.innerHTML
}

describe('StatusHero copy', () => {
  test('names the zone for assistive tech', () => {
    expect(render()).toContain('aria-label="Training status"')
  })

  test('invites a first session when there is nothing to resume', () => {
    const html = render()

    expect(html).toContain('+ Start Workout')
    expect(html).toContain('Browse programs')
  })

  test('keeps the day name inside the start CTA rather than beside it', () => {
    const html = render({ nextDay })

    expect(html).toContain('Start Push A')
    expect(html).not.toContain('{day}')
  })

  test('offers the resume CTA and a labelled progress bar on a live session', () => {
    const html = render({
      session: { key: 'new', name: 'Push A', setCount: 4, completedSetCount: 2 },
    })

    expect(html).toContain('Resume workout')
    expect(html).toContain('aria-label="Sets completed"')
  })

  test('resolves every key it references', () => {
    expect(render({ nextDay })).not.toMatch(/StatusHero\.[a-zA-Z.]+/)
    expect(render()).not.toMatch(/StatusHero\.[a-zA-Z.]+/)
    expect(
      render({ session: { key: 'new', name: 'Push A', setCount: 4, completedSetCount: 2 } }),
    ).not.toMatch(/StatusHero\.[a-zA-Z.]+/)
  })

  // The eyebrow, headline and context are DECIDED in lib/home-status.ts and
  // rendered here (docs/I18N-KEYS.md §9) — these are the assertions that the
  // hero actually speaks, rather than handing the user a descriptor.
  test('day one speaks the fresh invitation', () => {
    const html = render()

    expect(html).toContain('Day one.')
    expect(html).toContain('Log your first session — a program gives every set a target.')
  })

  test('a live session names it and counts its sets, singular and plural', () => {
    expect(
      render({ session: { key: 'new', name: 'Push A', setCount: 4, completedSetCount: 1 } }),
    ).toContain('Push A · 1 set logged')
    expect(
      render({ session: { key: 'new', name: 'Push A', setCount: 4, completedSetCount: 2 } }),
    ).toContain('Push A · 2 sets logged')
  })

  test('an unnamed session falls back to the untitled noun, not to a blank', () => {
    const html = render({ session: { key: 'new', name: null, setCount: 1, completedSetCount: 1 } })

    expect(html).toContain('Unnamed session · 1 set logged')
  })

  test('a due program day states the day and the week', () => {
    const html = render({ nextDay })

    expect(html).toContain('Push A day.')
    expect(html).toContain('Week 2 of 4')
  })
})
