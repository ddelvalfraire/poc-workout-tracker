import { describe, expect, test, vi } from 'vitest'

import { renderStaticIntl } from '../../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('./actions', () => ({
  adoptTemplateAction: vi.fn(),
  importWgerTemplateAction: vi.fn(),
}))

import { ImportTemplateButton } from './import-button'
import { TemplatesUnavailable } from './unavailable'
import { UseTemplateButton } from './use-template-button'

describe('template CTA copy', () => {
  test('the wger import button names the action from the catalog', () => {
    const html = renderStaticIntl(<ImportTemplateButton templateId={42} />)
    expect(html).toContain('Add to my programs')
    expect(html).not.toMatch(/ImportTemplateButton\.[a-zA-Z.]+/)
  })

  test('the curated adopt button names its own action', () => {
    const html = renderStaticIntl(<UseTemplateButton templateId="tpl-1" />)
    expect(html).toContain('Use this program')
    expect(html).not.toMatch(/UseTemplateButton\.[a-zA-Z.]+/)
  })
})

describe('TemplatesUnavailable copy', () => {
  // One catalog entry per reason: the degraded state has to say WHICH failure
  // it is, or the browse list and the detail page degrade into the same
  // useless sentence.
  test('an unconfigured catalog names the missing key', () => {
    const html = renderStaticIntl(<TemplatesUnavailable reason="unconfigured" />)
    expect(html).toContain('Template browsing is not configured')
    expect(html).toContain('WGER_API_KEY')
    expect(html).not.toMatch(/TemplatesUnavailable\.[a-zA-Z.]+/)
  })

  test('an unreachable catalog says so instead', () => {
    const html = renderStaticIntl(<TemplatesUnavailable reason="unavailable" />)
    expect(html).toContain('wger is not answering right now')
    expect(html).not.toContain('WGER_API_KEY')
    expect(html).not.toMatch(/TemplatesUnavailable\.[a-zA-Z.]+/)
  })
})
