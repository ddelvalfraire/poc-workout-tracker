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

  describe('the widened subset (program articles)', () => {
    it('renders a blockquote as a left rule, never a fill or an italic', () => {
      // Italics at a long measure measurably slow reading — the opposite of
      // what a pulled-out quote is for.
      const html = render('> The deficit is the stimulus you are managing.')
      expect(html).toContain('<blockquote')
      expect(html).toContain('border-l-2')
      expect(html).not.toContain('<em>')
      expect(html).toContain('The deficit is the stimulus you are managing.')
    })

    it('renders each GFM alert type with its own status token', () => {
      // Authors already know this syntax from GitHub; adopting it costs
      // nothing and inventing a dialect would cost everything.
      expect(render('> [!WARNING]\n> Do not run this into a meet.')).toContain('border-l-warning')
      expect(render('> [!TIP]\n> Set the bar height once.')).toContain('border-l-primary')
      expect(render('> [!NOTE]\n> Days are ordered, not dated.')).toContain('border-l-border')
      expect(render('> [!IMPORTANT]\n> Seed your maxes first.')).toContain('border-l-foreground')
      // Caution takes the destructive TINT with destructive-ink on top —
      // never destructive as the ink on itself.
      const caution = render('> [!CAUTION]\n> Skipping the deload ends the block.')
      expect(caution).toContain('border-l-destructive')
      expect(caution).toContain('text-destructive-ink')
    })

    it('names the alert and keeps its body', () => {
      const html = render('> [!WARNING]\n> Do not run this into a meet.')
      expect(html).toContain('Warning')
      expect(html).toContain('Do not run this into a meet.')
    })

    it('treats an unknown alert tag as an ordinary quote, not a broken one', () => {
      const html = render('> [!BOGUS]\n> still just a quote')
      expect(html).toContain('<blockquote')
      expect(html).toContain('still just a quote')
    })

    it('renders a table with hairlines and right-aligned numeric columns', () => {
      const html = render(
        ['| Week | Focus | Top set |', '| --- | --- | ---: |', '| 1–2 | Accumulate | 70% |'].join(
          '\n',
        ),
      )
      expect(html).toContain('<table')
      expect(html).toContain('<th')
      expect(html).toContain('Accumulate')
      // The delimiter row's trailing colon is what marks a column numeric, and
      // numeric columns get tabular figures so digits line up down the column.
      expect(html).toContain('tnum')
      expect(html).toContain('text-right')
      // Its own scroll container: a wide grid must never make the PAGE scroll
      // sideways.
      expect(html).toContain('overflow-x-auto')
    })

    it('needs the delimiter row before a pipe line becomes a table', () => {
      const html = render('| not | a table |')
      expect(html).not.toContain('<table')
      expect(html).toContain('not | a table')
    })

    it('collapses h4 and deeper into the micro-caps label tier', () => {
      // Four sizes of condensed heading is a ladder nobody can read.
      const html = render('#### Substitutions')
      expect(html).toContain('uppercase')
      expect(html).toContain('Substitutions')
    })

    it('normalizes heading LEVELS so an author cannot ship a skipped level', () => {
      // ## then #### would render h3 → h5, which axe flags as heading-order.
      // The visual tier still follows what was written; only the element
      // level is clamped, so the document reads as its author meant.
      const html = render('## How to run it\n\n#### Substitutions')
      expect(html).toContain('<h3')
      expect(html).toContain('<h4')
      expect(html).not.toContain('<h5')
      // Still the micro-caps LOOK, despite being an h4.
      expect(html).toMatch(/<h4[^>]*uppercase[^>]*>Substitutions<\/h4>/)
    })

    it('keeps the full ladder when the author uses every level', () => {
      const html = render('## Two\n\n### Three\n\n#### Four')
      expect(html).toContain('<h3')
      expect(html).toContain('<h4')
      expect(html).toContain('<h5')
    })

    it('stays sanitized by construction across every new block', () => {
      // Same guarantee as the rest of the renderer: every piece of input
      // becomes a React TEXT node, so there is nothing to inject into.
      const html = render(
        [
          '> [!NOTE]',
          '> <script>alert(1)</script>',
          '',
          '| a |',
          '| --- |',
          '| <img src=x onerror=y> |',
        ].join('\n'),
      )
      // The dangerous strings survive as escaped TEXT — that IS the
      // guarantee. What must not exist is an element or an attribute, so
      // assert on the tags rather than on a substring that legitimately
      // appears inside escaped content.
      expect(html).not.toContain('<script')
      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&lt;img src=x onerror=y&gt;')
    })
  })
})
