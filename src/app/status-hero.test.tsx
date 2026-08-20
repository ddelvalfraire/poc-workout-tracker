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

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
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
  })
})
