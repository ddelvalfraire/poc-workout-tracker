import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegalMarkdown, extractHeadings, headingSlug } from './legal-markdown'
import { tos, privacy, healthNotice } from '@/lib/legal-content.generated'

/**
 * Exercises the renderer against the REAL generated documents — the review
 * that introduced these tests caught the health-privacy self-link bug by
 * hand-tracing exactly this content, so the regression net parses the same.
 */

function render(markdown: string): string {
  return renderToStaticMarkup(<LegalMarkdown markdown={markdown} />)
}

describe('LegalMarkdown against the generated documents', () => {
  it("rewrites the privacy policy's health-policy cross-link to /health-privacy, not itself", () => {
    const html = render(privacy.contentMd)
    expect(html).toContain('href="/health-privacy"')
  })

  it('renders the processor tables from both privacy documents', () => {
    expect(render(privacy.contentMd)).toContain('<table')
    expect(render(healthNotice.contentMd)).toContain('<table')
  })

  it('renders bracketed placeholders as plain text, never links', () => {
    const html = render(tos.contentMd)
    expect(html).toContain('[COMPANY]')
    expect(html).not.toContain('href="[')
  })

  it('never emits raw HTML from document content', () => {
    const html = render('# T\n\nhello <script>alert(1)</script> world')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('drops protocol-relative and non-http hrefs to plain text', () => {
    const html = render('a [x](//evil.example) b [y](javascript:alert(1)) c [ok](/terms) d')
    expect(html).not.toContain('href="//evil.example"')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('href="/terms"')
  })

  it('strips attorney flags from live content (build-legal removes them)', () => {
    for (const doc of [tos, privacy, healthNotice]) {
      expect(doc.contentMd).not.toContain('⚖️')
    }
  })

  it('anchors every h2 with a slug the TOC can target', () => {
    const headings = extractHeadings(tos.contentMd)
    expect(headings.length).toBeGreaterThan(5)
    const html = render(tos.contentMd)
    for (const h of headings) {
      expect(html).toContain(`id="${h.slug}"`)
    }
    // No duplicate slugs within any real document (collision guard is a
    // known non-feature — this pins that the real docs never need it).
    const slugs = headings.map((h) => h.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('slugifies punctuation and case predictably', () => {
    expect(headingSlug('7. Subscriptions, billing, and refunds')).toBe(
      '7-subscriptions-billing-and-refunds',
    )
  })
})
