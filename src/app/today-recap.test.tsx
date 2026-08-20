// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TodayRecap, type RecapWorkout } from './today-recap'

/**
 * "Today" is the USER'S calendar day, so the recap renders nothing until it
 * has mounted — a static render can never reach its copy. These mount for
 * real and pin the compact line's session count, which used to be
 * `length === 1 ? '1 session today' : `${length} sessions today`` and so
 * carried exactly two hard-coded plural forms.
 */

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

/** Sessions completed a few minutes ago — always the user's local today. */
function completedToday(count: number): RecapWorkout[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i}`,
    name: 'Push A',
    startedAtMs: now - 60 * 60 * 1000,
    completedAtMs: now - i * 60 * 1000,
    volumeKg: 1000,
  }))
}

function render(workouts: RecapWorkout[], size: 'sm' | 'md' = 'sm'): string {
  act(() => {
    root.render(<TodayRecap workouts={workouts} unit="kg" size={size} />)
  })
  return container.innerHTML
}

describe('TodayRecap copy', () => {
  test('reads the singular session form after one session', () => {
    const html = render(completedToday(1))

    expect(html).toContain('1 session today')
    expect(html).not.toContain('sessions today')
  })

  test('reads the plural session form after several sessions', () => {
    expect(render(completedToday(2))).toContain('2 sessions today')
  })

  test('names the section and its heading', () => {
    const html = render(completedToday(1), 'md')

    expect(html).toContain('aria-label="Completed today"')
    expect(html).toContain('Today')
  })

  test('falls back to the untitled-workout name', () => {
    const [only] = completedToday(1)
    const html = render([{ ...only, name: null }], 'md')

    expect(html).toContain('Workout')
  })

  test('resolves every key it references', () => {
    expect(render(completedToday(2), 'md')).not.toMatch(/TodayRecap\.[a-zA-Z.]+/)
  })
})
