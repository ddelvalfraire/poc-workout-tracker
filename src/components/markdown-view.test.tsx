import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from './markdown-view'

/** static-markup convention (back-link.test.tsx): assert on rendered HTML. */
function render(markdown: string): string {
  return renderToStaticMarkup(<MarkdownView markdown={markdown} />)
}

describe('MarkdownView', () => {
  it('renders paragraphs, splitting on blank lines', () => {
    const html = render('Seat pin 4\n\nNarrow grip')
    expect(html).toContain('<p>Seat pin 4</p>')
    expect(html).toContain('<p>Narrow grip</p>')
  })

  it('renders bold, italic, and inline code', () => {
    const html = render('Seat **pin** *4* `slot`')
    expect(html).toContain('<strong>pin</strong>')
    expect(html).toContain('<em>4</em>')
    expect(html).toContain('>slot</code>')
  })

  it('renders bullet and numbered lists', () => {
    const html = render('- pin 4\n- grip\n\n1. warm up\n2. work')
    expect(html).toContain('<li>pin 4</li>')
    expect(html).toContain('<li>grip</li>')
    expect(html).toMatch(/<ol[^>]*><li>warm up<\/li><li>work<\/li><\/ol>/)
  })

  it('renders headings (h2/h3 vocabulary)', () => {
    const html = render('## Setup\n\n### Cues')
    expect(html).toMatch(/<h3[^>]*>Setup<\/h3>/)
    expect(html).toMatch(/<h4[^>]*>Cues<\/h4>/)
  })

  it('renders http(s) links with rel=noopener', () => {
    const html = render('[video](https://example.com/v)')
    expect(html).toContain('href="https://example.com/v"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('>video</a>')
  })

  it('never emits raw HTML — tags in the note render as text', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=y>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('refuses non-http(s) link schemes (javascript:, data:)', () => {
    const html = render('[x](javascript:alert(1)) [y](data:text/html;a)')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('href="data')
    expect(html).not.toContain('<a ')
  })

  it('renders single newlines inside a paragraph as line breaks', () => {
    const html = render('line one\nline two')
    expect(html).toContain('<br/>')
    expect(html).toContain('line two')
  })

  it('renders the editor round-trip corpus faithfully (shared subset)', () => {
    // The same fixtures the TipTap round-trip test guarantees stable — the
    // read path must display every construct the edit path can author.
    const html = render('## Setup\n\n- **pin 4** at *45°*\n\n[video](https://e.co/v)')
    expect(html).toMatch(/<h3[^>]*>Setup<\/h3>/)
    expect(html).toContain('<strong>pin 4</strong>')
    expect(html).toContain('<em>45°</em>')
    expect(html).toContain('href="https://e.co/v"')
  })
})
