import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { SectionTile } from './section-tile'

/**
 * The tile's accessible name used to be assembled from a module-scope
 * Small/Medium/Large map — labels built at import time, before any request,
 * so no locale could ever reach them. It is now ONE ICU select message, and
 * every branch is asserted here: a select tested at a single value looks
 * right and is wrong everywhere else.
 */

describe('SectionTile accessible name', () => {
  test('names the size for each allowed size', () => {
    const sm = renderStaticIntl(
      <SectionTile title="Momentum" size="sm" hidden={false} onOpen={() => {}} />,
    )
    expect(sm).toContain('aria-label="Momentum — Small. Edit section"')

    const md = renderStaticIntl(
      <SectionTile title="Today" size="md" hidden={false} onOpen={() => {}} />,
    )
    expect(md).toContain('aria-label="Today — Medium. Edit section"')

    const lg = renderStaticIntl(
      <SectionTile title="History" size="lg" hidden={false} onOpen={() => {}} />,
    )
    expect(lg).toContain('aria-label="History — Large. Edit section"')
  })

  test('a hidden tile announces hidden instead of its size', () => {
    const html = renderStaticIntl(
      <SectionTile title="Today" size="md" hidden onOpen={() => {}} />,
    )
    expect(html).toContain('aria-label="Today — hidden. Edit section"')
    expect(html).not.toContain('Medium')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(
      <SectionTile title="Momentum" size="sm" hidden={false} onOpen={() => {}} />,
    )
    expect(html).not.toMatch(/SectionTile\.[a-zA-Z.]+/)
  })
})
