// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import messages from '../../../messages/en.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { ConsentForm } from './consent-form'

/**
 * The other half of the presentation-proof contract. actions.test.ts pins the
 * labels the ledger RECORDS; this pins the labels the form actually RENDERS.
 * Both read the same catalog keys, so if either drifts the pair disagrees and
 * one of these two suites fails — which is the whole point of moving the
 * strings into the catalog rather than duplicating them.
 */
const html = () => renderStaticIntl(<ConsentForm />)

describe('ConsentForm localization', () => {
  it('renders every consent control label the ledger records as proof', () => {
    const out = html()

    expect(out).toContain('Store your health data')
    expect(out).toContain('Share with our service providers')
    expect(out).toContain(
      'I agree to the Terms of Service and have read the Privacy Notice and Health Data Privacy Policy.',
    )
    expect(out).toContain('Analytics identity')
  })

  it('renders the required and optional section headings', () => {
    const out = html()

    expect(out).toContain('Required to use the app')
    expect(out).toContain('Optional')
  })

  it('keeps a straight apostrophe rather than an entity or a curled quote', () => {
    // Two different layers. The CHARACTER is a property of the catalog value:
    // &apos; renders as U+0027 in JSX, so curling it to U+2019 during
    // extraction would have been a silent copy change. The ENTITY is a
    // property of the render: a JSON message does not decode entities, so an
    // &apos; left in a value ships literally to the user.
    expect(messages.ConsentForm.requiredNote).toContain("can't")
    expect(messages.ConsentForm.requiredNote).not.toContain('’')
    expect(html()).not.toContain('&apos;')
  })

  it('leaves no unresolved key path in the output', () => {
    expect(html()).not.toMatch(/ConsentForm\.[a-zA-Z.]+/)
  })
})
