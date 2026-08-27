import { describe, expect, test } from 'vitest'

import { renderStaticIntl } from '../../vitest.intl'
import { OvershootField } from './overshoot-field'

/**
 * A key path reaching the DOM means next-intl could not resolve it — the
 * component asked for `OvershootField.something` the catalog never got.
 */
function expectNoUnresolvedKeys(html: string) {
  expect(html).not.toMatch(/OvershootField\.[a-zA-Z.]+/)
}

describe('OvershootField', () => {
  test('the row states the CURRENT choice, not just a label', () => {
    // The old select showed "default" and left you to guess. A closed row has
    // to answer "what is this set to" without being opened.
    const html = renderStaticIntl(
      <OvershootField
        value="strict-load"
        onChange={() => {}}
        exerciseName="Back Squat"
        resolvesTo="e1rm-equivalent"
      />,
    )
    expect(html).toContain('Beating the target')
    expect(html).toContain('More weight only')
    expectNoUnresolvedKeys(html)
  })

  test('an unset policy reads as deferring, never as empty', () => {
    // null is a real choice — defer to the program, then to the scheme — so
    // the row must not look like a field nobody filled in.
    const html = renderStaticIntl(
      <OvershootField value={null} onChange={() => {}} resolvesTo="strict-load" />,
    )
    expect(html).toContain('Follow the plan')
    expectNoUnresolvedKeys(html)
  })

  test('names the exercise in the accessible label so stacked rows differ', () => {
    // Several of these sit on one editor screen; a label of pure state would
    // announce four identical controls.
    const html = renderStaticIntl(
      <OvershootField
        value={null}
        onChange={() => {}}
        exerciseName="Barbell Row"
        resolvesTo="strict-load"
      />,
    )
    expect(html).toContain('What counts as beating the target for Barbell Row')
  })

  test('the program-level row has its own label rather than a blank name', () => {
    const html = renderStaticIntl(
      <OvershootField value={null} onChange={() => {}} resolvesTo="strict-load" />,
    )
    expect(html).toContain('What counts as beating the target, for the whole program')
    expect(html).not.toContain('for undefined')
  })

  test('the sheet is closed until asked for', () => {
    // The row is the surface; the sheet is summoned. Rendering the dialog
    // eagerly would put four option paragraphs into the page for every
    // exercise in the editor.
    const html = renderStaticIntl(
      <OvershootField
        value={null}
        onChange={() => {}}
        exerciseName="Back Squat"
        resolvesTo="strict-load"
        preview={{ reps: '5', load: '120 kg' }}
      />,
    )
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('This asks for')
  })

  test('every policy resolves a name and a consequence from the catalog', () => {
    // The component builds these keys with a template literal, so a renamed
    // or missing branch fails silently at runtime rather than at build.
    for (const value of ['strict-load', 'e1rm-equivalent', 'any-metric'] as const) {
      const html = renderStaticIntl(
        <OvershootField value={value} onChange={() => {}} resolvesTo="strict-load" />,
      )
      expectNoUnresolvedKeys(html)
    }
  })
})
