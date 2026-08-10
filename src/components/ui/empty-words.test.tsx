import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { EmptyWords } from './empty-words'

describe('EmptyWords', () => {
  test('renders the plain-words empty-state recipe', () => {
    const html = renderToStaticMarkup(<EmptyWords>No sessions yet.</EmptyWords>)
    expect(html).toContain('<p')
    expect(html).toContain('px-1 py-6 text-center text-sm text-muted-foreground')
    expect(html).toContain('No sessions yet.')
  })

  test('merges className (callers add margins or padding)', () => {
    const html = renderToStaticMarkup(<EmptyWords className="mt-2 py-8">Nothing here.</EmptyWords>)
    expect(html).toContain('mt-2')
    // tailwind-merge: the caller's padding wins.
    expect(html).toContain('py-8')
    expect(html).not.toContain('py-6')
  })
})
