import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { DELETE_CONFIRM_PHRASE } from './confirm-phrase'
import { DeleteAccountForm } from './delete-account-form'

/**
 * The deletion gate's copy. The destructive CTA used to be a ternary of two
 * English literals, which the text-only lint mode could not see; the
 * instruction above it is a t.rich message whose <code> tag carries the
 * phrase the user has to type — a tag silently vanishing would leave the
 * gate unexplained.
 */

describe('DeleteAccountForm copy', () => {
  test('the rich instruction renders its tag around the confirm phrase', () => {
    const html = renderStaticIntl(<DeleteAccountForm />)
    expect(html).toContain('Type <span class="font-mono text-destructive">DELETE</span> to confirm')
    expect(html).toContain(DELETE_CONFIRM_PHRASE)
  })

  test('the destructive CTA resolves through the catalog', () => {
    const html = renderStaticIntl(<DeleteAccountForm />)
    expect(html).toContain('Delete my account')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(<DeleteAccountForm />)
    expect(html).not.toMatch(/DeleteAccountForm\.[a-zA-Z.]+/)
  })
})
