// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ExercisePicker, type PickedExercise } from './exercise-picker'

/**
 * The #209/#213 contract, interactively (jsdom — the picker's surface only
 * exists after typing, which a static render can't do):
 * - results and suggestions are hairline divider lists, never card shells;
 * - the ROW is the control in both modes — no per-row "Add" affordance;
 * - the combobox a11y model survives the de-card (listbox/option roles,
 *   aria-activedescendant, ArrowDown/Enter picks);
 * - the empty state is EmptyWords-shaped plain words.
 */

// React 19 requires the explicit act-environment opt-in outside test renderers.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no layout: the keyboard-nav effect's scrollIntoView is a no-op.
Element.prototype.scrollIntoView = () => {}

/** Muscle data makes rows 1↔2 mutual alternatives for the replace-mode rail. */
const CATALOG = [
  { id: 1, name: 'Bench Press', category: 'Chest', muscles: ['Pectoralis major'] },
  { id: 2, name: 'Incline Press', category: 'Chest', muscles: ['Pectoralis major'] },
  { id: 3, name: 'Squat', category: 'Legs', muscles: ['Quadriceps'] },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Mount with the catalog pre-seeded (fresh within staleTime → no fetch).
 *  Customs are seeded empty too so `includeCustom` mounts stay offline. */
function renderPicker(props: Partial<Parameters<typeof ExercisePicker>[0]> = {}) {
  const picks: PickedExercise[] = []
  const queryClient = new QueryClient()
  queryClient.setQueryData(['exercises', 'catalog'], CATALOG)
  queryClient.setQueryData(['exercises', 'custom'], [])
  root = createRoot(container)
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ExercisePicker onAdd={(e) => picks.push(e)} {...props} />
      </QueryClientProvider>,
    )
  })
  return { picks }
}

function searchInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')
  if (!input) throw new Error('search input not rendered')
  return input
}

/** Native-setter trick so React's onChange sees the new value. */
function type(value: string) {
  const input = searchInput()
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(key: string) {
  act(() => {
    searchInput().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

describe('ExercisePicker de-card (#209)', () => {
  it('renders results as a hairline divider list, not a card shell', () => {
    renderPicker()
    type('press')
    const listbox = container.querySelector('[role="listbox"]')!
    expect(listbox.className).toContain('divide-border/60')
    expect(listbox.className).toContain('border-b-border/60')
    // No shell on the list or its rows (the keep-listed Input field keeps
    // its own bg-card skin, so scope to the list markup).
    expect(listbox.outerHTML).not.toContain('bg-card')
    expect(listbox.outerHTML).not.toContain('rounded-xl')
    expect(listbox.outerHTML).not.toContain('shadow-lg')
  })

  it('keeps the inline max-h scroll cap by default and drops it in fill mode', () => {
    renderPicker()
    type('press')
    expect(container.querySelector('[role="listbox"]')!.className).toContain('max-h-72')
    act(() => root.unmount())
    renderPicker({ fill: true })
    type('press')
    const listbox = container.querySelector('[role="listbox"]')!
    expect(listbox.className).not.toContain('max-h-72')
    expect(listbox.className).toContain('flex-1')
  })

  it('renders the empty state as EmptyWords-shaped plain words', () => {
    renderPicker()
    type('zzzz')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    const empty = [...container.querySelectorAll('p')].find(
      (p) => p.textContent === 'No exercises found.',
    )!
    expect(empty).toBeDefined()
    expect(empty.className).toContain('py-6')
    expect(empty.className).toContain('text-center')
    expect(empty.className).toContain('text-muted-foreground')
  })
})

describe('rows are the control (#213)', () => {
  it('add mode: no per-row Add button — tapping the option row performs the pick', () => {
    const { picks } = renderPicker()
    type('press')
    const addButtons = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Add',
    )
    expect(addButtons).toHaveLength(0)
    const option = container.querySelector<HTMLElement>('[role="option"]')!
    act(() => option.click())
    expect(picks).toEqual([
      { wgerExerciseId: 1, source: 'wger', name: 'Bench Press', category: 'Chest' },
    ])
    // The pick clears the search so the list collapses for the next add.
    expect(searchInput().value).toBe('')
  })

  it('replace mode: suggestions render as hairline rows with no Add text, and tapping one is the swap', () => {
    const { picks } = renderPicker({ suggestFor: 1 })
    expect(container.textContent).toContain('Suggested')
    expect(container.textContent).not.toContain('Add')
    const rail = container.querySelector('ul[aria-label="Suggested replacements"]')!
    expect(rail.outerHTML).not.toContain('bg-card')
    expect(rail.outerHTML).not.toContain('rounded-xl')
    expect(rail.className).toContain('divide-border/60')
    expect(rail.className).toContain('border-b-border/60')
    // Suggestions stay OUTSIDE the combobox model.
    expect(rail.querySelector('[role="option"]')).toBeNull()
    const row = rail.querySelector('button')!
    act(() => row.click())
    expect(picks).toEqual([
      { wgerExerciseId: 2, source: 'wger', name: 'Incline Press', category: 'Chest' },
    ])
  })

  it('keyboard flow survives: ArrowDown moves aria-activedescendant, Enter picks', () => {
    const { picks } = renderPicker()
    type('press')
    const input = searchInput()
    expect(input.getAttribute('aria-activedescendant')).toBe('exercise-option-wger-1')
    press('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('exercise-option-wger-2')
    press('Enter')
    expect(picks).toEqual([
      { wgerExerciseId: 2, source: 'wger', name: 'Incline Press', category: 'Chest' },
    ])
  })
})

describe('create row (#218)', () => {
  function createRow(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Create'),
    )
  }

  it('appends a final Create row echoing the query under results', () => {
    renderPicker({ includeCustom: true })
    type('press')
    const row = createRow()!
    expect(row.textContent).toContain('Create “press”')
    // Final row: it renders AFTER the results listbox in document order.
    const listbox = container.querySelector('[role="listbox"]')!
    expect(listbox.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the plain-sentence empty state with the create row beneath', () => {
    renderPicker({ includeCustom: true })
    type('zzzz')
    const empty = [...container.querySelectorAll('p')].find(
      (p) => p.textContent === 'No exercises found.',
    )!
    expect(empty).toBeDefined()
    expect(createRow()!.textContent).toContain('Create “zzzz”')
  })

  it('shows the persistent generic create row while the query is empty', () => {
    renderPicker({ includeCustom: true })
    expect(createRow()!.textContent).toContain('Create custom exercise')
  })

  it('hides the create affordance entirely without includeCustom', () => {
    renderPicker()
    type('zzzz')
    expect(createRow()).toBeUndefined()
  })

  it('onCreateNavigate: the row hands the host the query instead of opening the inline form', () => {
    const navigated: string[] = []
    renderPicker({ includeCustom: true, onCreateNavigate: (q) => navigated.push(q) })
    type('zzzz')
    act(() => createRow()!.click())
    expect(navigated).toEqual(['zzzz'])
    expect(container.textContent).not.toContain('New custom exercise')
  })

  it('without onCreateNavigate the row still opens the inline form (builder host)', () => {
    renderPicker({ includeCustom: true })
    type('zzzz')
    act(() => createRow()!.click())
    expect(container.textContent).toContain('New custom exercise')
  })
})
