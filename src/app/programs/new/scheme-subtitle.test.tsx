import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { SchemeSubtitle } from './scheme-subtitle'

describe('SchemeSubtitle (#228 — builder scheme line)', () => {
  test('renders the human name plus the plain one-liner, muted', () => {
    const html = renderToStaticMarkup(<SchemeSubtitle scheme="double-progression" />)
    expect(html).toContain('Double progression')
    expect(html).toContain(
      'Work up to the top of your rep range, then the weight goes up and reps start over.',
    )
    expect(html).toContain('text-muted-foreground')
  })

  test('never prints the technical scheme id', () => {
    const html = renderToStaticMarkup(<SchemeSubtitle scheme="percent-1rm" />)
    expect(html).not.toContain('percent-1rm')
    expect(html).toContain('Percent of 1RM')
  })
})
