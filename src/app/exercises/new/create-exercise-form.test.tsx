import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Render-level contract for the #218 create page (the workout-logger.test.tsx
 * static-markup convention): the `?name=` prefill lands in the field, the
 * primary action is contextual per return mode, and the form speaks the
 * de-card vocabulary (Section caps header, hairline close, no card shell).
 * The interactive save/duplicate flow is navigation + sessionStorage
 * territory covered by pending-pick's pure tests.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

import { CreateExerciseForm } from './create-exercise-form'

function render(props: Partial<Parameters<typeof CreateExerciseForm>[0]> = {}): string {
  // queries disabled: a static render must never kick off fetches.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderStaticIntl(
    <QueryClientProvider client={client}>
      <CreateExerciseForm initialName="" returnMode={null} targetId={null} {...props} />
    </QueryClientProvider>,
  )
}

describe('CreateExerciseForm (#218)', () => {
  it('prefills the name from the query param', () => {
    const html = render({ initialName: 'Nordic Curl' })
    expect(html).toContain('value="Nordic Curl"')
  })

  it('labels the primary action per return mode', () => {
    expect(render({ returnMode: 'swap', targetId: 'ex-1' })).toContain('Save &amp; replace')
    expect(render({ returnMode: 'add' })).toContain('Save &amp; add')
    expect(render()).toContain('>Save<')
  })

  it('never shows the swap/add labels in library mode', () => {
    const html = render()
    expect(html).not.toContain('Save &amp; replace')
    expect(html).not.toContain('Save &amp; add')
  })

  it('speaks the de-card vocabulary: caps Section header, hairline, no shell', () => {
    const html = render()
    expect(html).toContain('Primary muscles')
    expect(html).toContain('border-b-border/60')
    // No card shell anywhere (the keep-listed Input primitive keeps its own
    // bg-card field skin, so the shell check is the radius, not the bg).
    expect(html).not.toContain('rounded-2xl')
  })

  it('offers the full wger category set with a required placeholder', () => {
    const html = render()
    expect(html).toContain('Category…')
    for (const category of ['Abs', 'Arms', 'Back', 'Calves', 'Cardio', 'Chest', 'Legs', 'Shoulders']) {
      expect(html).toContain(`>${category}<`)
    }
  })
})
