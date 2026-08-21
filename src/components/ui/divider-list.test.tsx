import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { DividerList, DividerRow } from './divider-list'

describe('DividerList', () => {
  test('renders a ul with the muted-hairline recipe and a closing hairline', () => {
    const html = renderToStaticMarkup(
      <DividerList>
        <li>row</li>
      </DividerList>,
    )
    expect(html).toContain('<ul')
    expect(html).toContain('divide-y divide-border/60 border-b border-b-border/60')
    expect(html).toContain('<li>row</li>')
  })

  test('dashed variant keeps the quarantined voice', () => {
    const html = renderToStaticMarkup(
      <DividerList dashed>
        <li>row</li>
      </DividerList>,
    )
    expect(html).toContain('divide-dashed')
    expect(html).toContain('border-dashed')
  })

  test('merges className (settings zones pass mt-1)', () => {
    const html = renderToStaticMarkup(
      <DividerList className="mt-1">
        <li>row</li>
      </DividerList>,
    )
    expect(html).toContain('mt-1')
  })
})

describe('DividerRow', () => {
  test('renders li > link with the settings link-row recipe and a chevron', () => {
    const html = renderToStaticMarkup(<DividerRow href="/body">Body</DividerRow>)
    expect(html).toContain('<li>')
    expect(html).toContain('href="/body"')
    // The shipped row recipe, verbatim. Focus is the volt ring, not a muted
    // wash — bg-muted/50 over the page background is ~1.1:1, invisible. The
    // trailing outline-hidden is the forced-colors fallback: WHCM drops
    // box-shadow, so focus paints a system-color outline there instead.
    expect(html).toContain(
      'flex items-center justify-between gap-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
    )
    // Trailing cluster + decorative chevron.
    expect(html).toContain('flex shrink-0 items-center gap-1 text-muted-foreground')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('size-4')
    expect(html).toContain('<svg')
  })

  test('renders the trailing slot before the chevron', () => {
    const html = renderToStaticMarkup(
      <DividerRow href="/body" trailing={<span>82 kg</span>}>
        Body
      </DividerRow>,
    )
    expect(html.indexOf('82 kg')).toBeGreaterThan(html.indexOf('Body'))
    expect(html.indexOf('82 kg')).toBeLessThan(html.indexOf('<svg'))
  })

  test('merges className onto the link', () => {
    const html = renderToStaticMarkup(
      <DividerRow href="/x" className="active:bg-muted/60">
        Row
      </DividerRow>,
    )
    expect(html).toContain('active:bg-muted/60')
  })
})
