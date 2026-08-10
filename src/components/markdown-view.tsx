import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Trusted-subset markdown renderer for READ surfaces (notes, program article
 * descriptions) — deliberately NOT the editor bundle and NOT streamdown: a
 * server-renderable component with zero client JS, covering exactly what the
 * notes editor can author (paragraphs, h2/h3, bold, italic, inline code,
 * bullet/numbered lists, http(s) links).
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

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; lines: string[] }

/** Groups markdown lines into the subset's block structure. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (line.trim() === '') {
      // blank line closes the open block
      if (last && last.kind === 'p' && last.lines.length === 0) continue
      blocks.push({ kind: 'p', lines: [] })
    } else if (heading) {
      // h1–h2 clamp to the display's h2 tier, deeper levels to h3 (the
      // editor only authors 2–3; imported text keeps hierarchy readable).
      const level = heading[1].length <= 2 ? 2 : 3
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
  return blocks.filter((b) => b.kind !== 'p' || b.lines.length > 0)
}

interface MarkdownViewProps {
  markdown: string
  className?: string
}

/** Read-only markdown display; typography follows the muted prose idiom. */
export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  const blocks = parseBlocks(markdown)
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed', className)}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return block.level === 2 ? (
            <h3 key={i} className="pt-1 font-semibold text-foreground">
              {renderInline(block.text)}
            </h3>
          ) : (
            <h4 key={i} className="pt-0.5 text-[0.95em] font-semibold text-foreground">
              {renderInline(block.text)}
            </h4>
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
