import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { SectionTile } from './section-tile'

/**
 * The tile's accessible name used to be assembled from a module-scope
 * Small/Wide/Tall/Block/Hero map — labels built at import time, before any request,
 * so no locale could ever reach them. It is now ONE ICU select message, and
 * every branch is asserted here: a select tested at a single value looks
 * right and is wrong everywhere else.
 */

describe('SectionTile accessible name', () => {
  test('names the shape for each allowed shape', () => {
    const sm = renderStaticIntl(
      <SectionTile title="Momentum" shape="micro" hidden={false} onOpen={() => {}} />,
    )
    expect(sm).toContain('aria-label="Momentum — Small. Edit section"')

    const md = renderStaticIntl(
      <SectionTile title="Today" shape="wide" hidden={false} onOpen={() => {}} />,
    )
    expect(md).toContain('aria-label="Today — Wide. Edit section"')

    const lg = renderStaticIntl(
      <SectionTile title="Momentum" shape="block" hidden={false} onOpen={() => {}} />,
    )
    expect(lg).toContain('aria-label="Momentum — Block. Edit section"')
  })

  test('a hidden tile announces hidden instead of its shape', () => {
    const html = renderStaticIntl(
      <SectionTile title="Today" shape="wide" hidden onOpen={() => {}} />,
    )
    expect(html).toContain('aria-label="Today — hidden. Edit section"')
    expect(html).not.toContain('Wide')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(
      <SectionTile title="Momentum" shape="micro" hidden={false} onOpen={() => {}} />,
    )
    expect(html).not.toMatch(/SectionTile\.[a-zA-Z.]+/)
  })
})
