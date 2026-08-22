import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { NavList, NavRow } from './nav-list'

describe('NavList', () => {
  test('renders a NAMED nav landmark around the hairline list', () => {
    const html = renderToStaticMarkup(
      <NavList label="Program">
        <li>row</li>
      </NavList>,
    )
    // The landmark must carry a name: an unnamed <nav> is indistinguishable
    // from every other landmark in a screen reader's rotor, and the point of
    // this component is that assistive tech gets the grouping a sighted
    // reader gets from proximity.
    expect(html).toContain('<nav')
    expect(html).toContain('aria-label="Program"')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>row</li>')
  })

  test('closes top AND bottom — the cluster is bounded, not trailing off', () => {
    const html = renderToStaticMarkup(
      <NavList label="Program">
        <li>row</li>
      </NavList>,
    )
    expect(html).toContain('divide-y divide-border/60 border-y border-y-border/60')
  })

  test('leads with a gap larger than the section beat', () => {
    // Proximity does the grouping work a header would otherwise do, so the
    // leading gap has to beat every inter-section gap on the page (mt-8).
    const html = renderToStaticMarkup(
      <NavList label="Program">
        <li>row</li>
      </NavList>,
    )
    expect(html).toContain('mt-14')
  })

  test('merges className', () => {
    const html = renderToStaticMarkup(
      <NavList label="Program" className="mt-6">
        <li>row</li>
      </NavList>,
    )
    expect(html).toContain('mt-6')
  })
})

describe('NavRow', () => {
  test('renders li > link with the shared row recipe and a decorative chevron', () => {
    const html = renderToStaticMarkup(<NavRow href="/programs/1/stats">Program stats</NavRow>)
    expect(html).toContain('<li>')
    expect(html).toContain('href="/programs/1/stats"')
    expect(html).toContain('Program stats')
    // Same hover/focus recipe as every other row in the system — focus is the
    // volt ring, never a muted wash, with outline-hidden as the forced-colors
    // fallback (WHCM drops box-shadow).
    expect(html).toContain('hover:bg-muted/50')
    expect(html).toContain('focus-visible:ring-3 focus-visible:ring-ring/50')
    expect(html).toContain('focus-visible:outline-hidden')
    // The chevron is the disclosure indicator, and it is decorative: the link
    // text already names the destination.
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<svg')
  })

  test('carries nothing between the label and the chevron', () => {
    // The load-bearing assertion. NavRow exposes no trailing slot, so a value
    // CANNOT be threaded in — density is the only thing distinguishing this
    // cluster from the content lists stacked above it, and a count slipping
    // into a nav row is precisely the regression this component prevents.
    const html = renderToStaticMarkup(<NavRow href="/x">Coach</NavRow>)
    const between = html.slice(html.indexOf('Coach') + 'Coach'.length, html.indexOf('<svg'))
    expect(between.replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  test('is a single-line row at the touch-target floor', () => {
    // py-4 over a 24px line box clears 44px without a hit-area inset.
    const html = renderToStaticMarkup(<NavRow href="/x">Coach</NavRow>)
    expect(html).toContain('py-4')
    expect(html).toContain('text-base font-medium')
  })

  test('merges className onto the link', () => {
    const html = renderToStaticMarkup(
      <NavRow href="/x" className="active:bg-muted/60">
        Coach
      </NavRow>,
    )
    expect(html).toContain('active:bg-muted/60')
  })
})
