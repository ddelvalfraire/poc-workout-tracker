import { Fragment, type ReactNode } from 'react'

/**
 * Trusted-subset markdown renderer for the LEGAL pages only. Deliberately a
 * sibling of components/markdown-view (same philosophy: server-rendered,
 * zero client JS, every input becomes a React text node — no HTML parsing,
 * no dangerouslySetInnerHTML) rather than an extension of it: the legal docs
 * need tables, h1, and anchored h2s, which the notes surface must never
 * grow, and the two surfaces should not drift together.
 *
 * Input is the repo's own generated legal content (docs/legal via
 * scripts/build-legal.ts) — trusted authorship, but the no-HTML rule holds
 * anyway so a pasted "<script>" in a future doc edit renders as text.
 *
 * Readability choices follow the legal-page research (Linear/Stripe school):
 * ~68ch measure lives in the layout; body text uses the muted off-white
 * token (never pure white on dark — halation); links underline in neutral,
 * never the volt accent (saturated accents vibrate in long-form dark text).
 */

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/
const BOLD_RE = /\*\*([^*]+)\*\*/

function isSafeHref(href: string): boolean {
  // '//' would be protocol-relative (resolves off-site) — internal means
  // exactly one leading slash.
  return /^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('//'))
}

/**
 * Maps the docs' relative cross-references onto the public routes. Most
 * specific suffix FIRST: consumer-health-data-privacy-policy.md also ends
 * with privacy-policy.md, and the wrong order sent the MHMDA-required
 * health-policy link back to /privacy itself.
 */
function rewriteHref(href: string): string {
  if (href.endsWith('consumer-health-data-privacy-policy.md')) return '/health-privacy'
  if (href.endsWith('privacy-policy.md')) return '/privacy'
  if (href.endsWith('terms-of-service.md')) return '/terms'
  return href
}

/** Stable anchor slug for a heading (the TOC + self-link target). */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** The h2 outline of a document — feeds the page-top table of contents. */
export function extractHeadings(markdown: string): Array<{ text: string; slug: string }> {
  return markdown
    .split('\n')
    .map((line) => line.trim().match(/^##\s+(.*)$/)?.[1])
    .filter((text): text is string => Boolean(text))
    .map((text) => ({ text: text.replace(/\*\*/g, ''), slug: headingSlug(text) }))
}

function renderInline(text: string, key = 0): ReactNode[] {
  if (text.length === 0) return []
  const candidates = [
    { kind: 'link' as const, match: LINK_RE.exec(text) },
    { kind: 'bold' as const, match: BOLD_RE.exec(text) },
  ].filter((c): c is { kind: 'link' | 'bold'; match: RegExpExecArray } => Boolean(c.match))
  if (candidates.length === 0) return [text]
  const first = candidates.reduce((a, b) => (b.match.index < a.match.index ? b : a))
  const { match } = first
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)
  const inner: ReactNode[] = []
  if (before) inner.push(before)
  if (first.kind === 'link') {
    const href = rewriteHref(match[2])
    inner.push(
      isSafeHref(href) ? (
        <a
          key={`l${key}`}
          href={href}
          className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
        >
          {renderInline(match[1], key + 1)}
        </a>
      ) : (
        match[0]
      ),
    )
  } else {
    inner.push(
      <strong key={`b${key}`} className="font-semibold text-foreground">
        {renderInline(match[1], key + 1)}
      </strong>,
    )
  }
  return [...inner, ...renderInline(after, key + 100)]
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parse(markdown: string): Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed === '---') {
      i += 1
      continue
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] })
      i += 1
      continue
    }
    if (trimmed.startsWith('|')) {
      const header = splitRow(trimmed)
      const rows: string[][] = []
      i += 2 // skip the |---| divider row
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()))
        i += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    const listMatch = trimmed.match(/^(-|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const ordered = listMatch[1] !== '-'
      const items: string[] = []
      while (i < lines.length) {
        const itemLine = lines[i].trim()
        const m = itemLine.match(/^(-|\d+\.)\s+(.*)$/)
        if (m) {
          items.push(m[2])
          i += 1
        } else if (itemLine !== '' && !/^#/.test(itemLine) && !itemLine.startsWith('|')) {
          // continuation of the previous item (source-wrapped line)
          items[items.length - 1] = `${items[items.length - 1]} ${itemLine}`
          i += 1
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const parts: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === '' || /^#{1,3}\s/.test(t) || t.startsWith('|') || /^(-|\d+\.)\s/.test(t)) break
      parts.push(t)
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: parts.join(' ') })
  }
  return blocks
}

export function LegalMarkdown({ markdown }: { markdown: string }) {
  const blocks = parse(markdown)
  return (
    <Fragment>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            if (block.level === 1) {
              return (
                // Fluid scale (research: type escalation, not more columns,
                // is what keeps a reading column from feeling phone-zoomed).
                <h1
                  key={i}
                  className="text-[clamp(1.75rem,1.2rem+2.2vw,2.75rem)] leading-tight font-semibold tracking-tight text-balance"
                >
                  {renderInline(block.text)}
                </h1>
              )
            }
            if (block.level === 2) {
              const slug = headingSlug(block.text)
              return (
                <h2
                  key={i}
                  id={slug}
                  className="mt-[clamp(2.25rem,1.5rem+2.5vw,3.5rem)] scroll-mt-20 border-t border-border pt-6 text-[clamp(1.2rem,1rem+0.7vw,1.5rem)] font-semibold tracking-tight"
                >
                  <a href={`#${slug}`} className="hover:underline">
                    {renderInline(block.text)}
                  </a>
                </h2>
              )
            }
            return (
              <h3 key={i} className="mt-6 text-base font-semibold">
                {renderInline(block.text)}
              </h3>
            )
          case 'paragraph':
            return (
              <p
                key={i}
                className="mt-4 text-[clamp(1rem,0.96rem+0.2vw,1.0625rem)] leading-relaxed text-muted-foreground"
              >
                {renderInline(block.text)}
              </p>
            )
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag
                key={i}
                className={`mt-4 space-y-2 pl-5 leading-relaxed text-muted-foreground ${
                  block.ordered ? 'list-decimal' : 'list-disc'
                }`}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </Tag>
            )
          }
          case 'table':
            return (
              <div key={i} className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {block.header.map((cell, j) => (
                        <th key={j} className="py-2 pr-4 font-medium">
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-b border-border/50 align-top">
                        {row.map((cell, k) => (
                          <td key={k} className="py-2 pr-4 text-muted-foreground">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </Fragment>
  )
}
