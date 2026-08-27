import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Trusted-subset markdown renderer for READ surfaces (notes, program article
 * descriptions) — deliberately NOT the editor bundle and NOT streamdown: a
 * server-renderable component with zero client JS, covering paragraphs,
 * h2–h4, bold, italic, inline code, bullet/numbered lists, http(s) links,
 * blockquotes, GitHub-flavoured alert callouts and tables.
 *
 * The subset widened when the program article became its own route: an
 * author writing up how to run a block reaches for a week-by-week TABLE and a
 * "do not run this into a meet" WARNING almost immediately, and a renderer
 * that silently drops both teaches them the feature does not exist. Every
 * addition maps onto an existing token — alerts reuse the five status colours
 * the app already ships, tables get hairlines and tabular figures, and a
 * blockquote is a left rule with no fill and no italic. A document may not
 * introduce a radius, colour or shadow the design system does not have.
 *
 * Alert syntax is GitHub's (`> [!WARNING]`) rather than something invented:
 * authors already know it, so adopting it costs nothing and inventing a
 * dialect would cost everything.
 *
 * Sanitized by construction: every piece of input becomes a React TEXT node —
 * there is no HTML parsing and no dangerouslySetInnerHTML, so `<script>` in a
 * note renders as the literal text. Link hrefs are allowlisted to http(s);
 * anything else (javascript:, data:) renders as plain text.
 */

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/
const BOLD_RE = /\*\*([^*]+)\*\*/
const ITALIC_RE = /(?<![*\w])\*([^*]+)\*(?![*\w])/
const CODE_RE = /`([^`]+)`/

/** True when the href may become a real link (the editor's same allowlist). */
function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** Renders inline markdown (links, bold, italic, code) into React nodes. */
function renderInline(text: string, key = 0): ReactNode[] {
  if (text.length === 0) return []
  // Earliest match wins so constructs don't swallow each other.
  const candidates = [
    { kind: 'link' as const, match: LINK_RE.exec(text) },
    { kind: 'bold' as const, match: BOLD_RE.exec(text) },
    { kind: 'italic' as const, match: ITALIC_RE.exec(text) },
    { kind: 'code' as const, match: CODE_RE.exec(text) },
  ].filter((c): c is { kind: 'link' | 'bold' | 'italic' | 'code'; match: RegExpExecArray } =>
    Boolean(c.match),
  )
  if (candidates.length === 0) return [text]
  const first = candidates.reduce((a, b) => (b.match.index < a.match.index ? b : a))
  const { match } = first
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)
  let node: ReactNode
  if (first.kind === 'link') {
    const [, label, href] = match
    node = isSafeHref(href) ? (
      <a
        key={`l${key}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        {renderInline(label, key + 1)}
      </a>
    ) : (
      match[0] // unsafe scheme: the raw text, not a link
    )
  } else if (first.kind === 'bold') {
    node = <strong key={`b${key}`}>{renderInline(match[1], key + 1)}</strong>
  } else if (first.kind === 'italic') {
    node = <em key={`i${key}`}>{renderInline(match[1], key + 1)}</em>
  } else {
    node = (
      <code key={`c${key}`} className="rounded bg-muted px-1 font-mono text-[0.85em]">
        {match[1]}
      </code>
    )
  }
  return [
    ...(before ? renderInline(before, key + 100) : []),
    node,
    ...renderInline(after, key + 200),
  ]
}

/** The five GitHub alert types, in the order GitHub documents them. */
const ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
type AlertType = (typeof ALERT_TYPES)[number]

/** Alerts borrow the app's own status colours — no new palette enters a
 *  document. Caution takes the destructive TINT with destructive-ink on top,
 *  never destructive as ink on itself. */
const ALERT_STYLE: Record<AlertType, { rule: string; ink: string; tint: string }> = {
  NOTE: { rule: 'border-l-border', ink: 'text-muted-foreground', tint: 'bg-muted/40' },
  TIP: { rule: 'border-l-primary', ink: 'text-primary', tint: 'bg-primary/10' },
  IMPORTANT: { rule: 'border-l-foreground', ink: 'text-foreground', tint: 'bg-muted/40' },
  WARNING: { rule: 'border-l-warning', ink: 'text-warning', tint: 'bg-warning/10' },
  CAUTION: {
    rule: 'border-l-destructive',
    ink: 'text-destructive-ink',
    tint: 'bg-destructive/10',
  },
}

type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'alert'; type: AlertType; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][]; numeric: boolean[] }
  | { kind: 'p'; lines: string[] }

/** `| a | b |` → ['a', 'b']. Leading/trailing pipes are optional in GFM. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** True for a GFM delimiter row (`|---|:--:|`), which is what actually
 *  promotes the line above it from a paragraph to a table header. */
function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell))
}

/** Groups markdown lines into the subset's block structure. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    const quoted = /^>\s?(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]

    // A table needs its delimiter row to exist before the header line means
    // anything — otherwise "| not | a table |" is just a paragraph.
    if (line.trim().includes('|') && isDelimiterRow(lines[i + 1] ?? '')) {
      const head = splitRow(line)
      const numeric = splitRow(lines[i + 1]).map((cell) => cell.endsWith(':'))
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim() !== '') {
        rows.push(splitRow(lines[j]))
        j += 1
      }
      blocks.push({ kind: 'table', head, rows, numeric })
      i = j - 1
      continue
    }

    if (quoted) {
      const alert = /^\[!([A-Z]+)\]\s*$/.exec(quoted[1].trim())
      const type = alert?.[1] as AlertType | undefined
      if (type !== undefined && (ALERT_TYPES as readonly string[]).includes(type)) {
        blocks.push({ kind: 'alert', type, lines: [] })
      } else if (last?.kind === 'alert' || last?.kind === 'quote') {
        last.lines.push(quoted[1])
      } else {
        blocks.push({ kind: 'quote', lines: [quoted[1]] })
      }
      continue
    }

    if (line.trim() === '') {
      // blank line closes the open block
      if (last && last.kind === 'p' && last.lines.length === 0) continue
      blocks.push({ kind: 'p', lines: [] })
    } else if (heading) {
      // h1–h2 clamp to the h2 tier (the page title owns h1), h3 stays, and
      // h4+ collapses to the micro-caps label tier: four sizes of condensed
      // heading is a ladder nobody can read.
      const depth = heading[1].length
      const level = depth <= 2 ? 2 : depth === 3 ? 3 : 4
      blocks.push({ kind: 'heading', level, text: heading[2] })
    } else if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1])
      else blocks.push({ kind: 'ul', items: [bullet[1]] })
    } else if (ordered) {
      if (last?.kind === 'ol') last.items.push(ordered[1])
      else blocks.push({ kind: 'ol', items: [ordered[1]] })
    } else {
      if (last?.kind === 'p') last.lines.push(line)
      else blocks.push({ kind: 'p', lines: [line] })
    }
  }
  return blocks.filter(
    (b) => (b.kind !== 'p' && b.kind !== 'quote' && b.kind !== 'alert') || b.lines.length > 0,
  )
}

interface MarkdownViewProps {
  markdown: string
  className?: string
}

/** Read-only markdown display; typography follows the muted prose idiom. */
export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  const blocks = parseBlocks(markdown)
  // Heading LEVELS are normalized; heading LOOKS are not. An author who jumps
  // from ## straight to #### would otherwise have that skip rendered
  // faithfully as h3 → h5, which is a real axe heading-order violation
  // shipped into the app by someone else's typing. So the emitted level never
  // climbs by more than one, while the visual tier stays keyed to what was
  // actually written — the document still reads the way its author meant.
  const headingLevels = new Map<number, 3 | 4 | 5>()
  let previous = 2
  blocks.forEach((block, i) => {
    if (block.kind !== 'heading') return
    const desired = block.level + 1
    const level = Math.min(desired, previous + 1) as 3 | 4 | 5
    headingLevels.set(i, level)
    previous = level
  })
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed', className)}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          const Heading = `h${headingLevels.get(i) ?? 3}` as 'h3' | 'h4' | 'h5'
          if (block.level === 2) {
            return (
              <Heading key={i} className="pt-1 font-semibold text-foreground">
                {renderInline(block.text)}
              </Heading>
            )
          }
          if (block.level === 3) {
            return (
              <Heading key={i} className="pt-0.5 text-[0.95em] font-semibold text-foreground">
                {renderInline(block.text)}
              </Heading>
            )
          }
          // The fourth tier leaves the heading ladder entirely and becomes a
          // micro-caps label — another size of the same voice would be a
          // distinction nobody can see.
          return (
            <Heading
              key={i}
              className="pt-1 text-[0.8em] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {renderInline(block.text)}
            </Heading>
          )
        }
        if (block.kind === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'ol') {
          return (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'quote') {
          // A left hairline and an indent — no fill, no italic. Italics at a
          // long measure measurably slow reading, which is the opposite of
          // what a pulled-out quote is for.
          return (
            <blockquote key={i} className="border-l-2 border-border pl-4 text-muted-foreground">
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(line)}
                </Fragment>
              ))}
            </blockquote>
          )
        }
        if (block.kind === 'alert') {
          const style = ALERT_STYLE[block.type]
          return (
            <div key={i} className={cn('rounded-lg border-l-2 px-4 py-3', style.rule, style.tint)}>
              <p
                className={cn(
                  'text-[0.75em] font-semibold uppercase tracking-widest',
                  style.ink,
                )}
              >
                {block.type.charAt(0) + block.type.slice(1).toLowerCase()}
              </p>
              <div className="mt-1">
                {block.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(line)}
                  </Fragment>
                ))}
              </div>
            </div>
          )
        }
        if (block.kind === 'table') {
          // Hairlines only — no vertical rules, no zebra fill. The table gets
          // its OWN horizontal scroll so a wide week-by-week grid never makes
          // the page scroll sideways.
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-b-border">
                    {block.head.map((cell, j) => (
                      <th
                        key={j}
                        scope="col"
                        className={cn(
                          'pb-1.5 pr-4 text-[0.75em] font-semibold uppercase tracking-widest text-muted-foreground',
                          block.numeric[j] && 'pr-0 pl-4 text-right',
                        )}
                      >
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j} className="border-b border-b-border/60">
                      {row.map((cell, k) => (
                        <td
                          key={k}
                          className={cn(
                            'py-2 pr-4 align-baseline',
                            // Numeric columns get tabular figures and
                            // right-alignment so magnitudes compare down the
                            // column by their least-significant digit.
                            block.numeric[k] && 'tnum pr-0 pl-4 text-right',
                          )}
                        >
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
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
