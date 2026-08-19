import Link from 'next/link'
import { LegalMarkdown, extractHeadings } from './legal-markdown'
import { Toc } from './toc'

/**
 * Shared shell for the three public legal routes. Layout follows the
 * Linear/Stripe legal-page school within our (dark-only) token system:
 * ~68ch measure, page-top collapsible table of contents (anchor links to
 * the renderer's self-linking h2s), cross-links to the sibling documents,
 * zero client JS and zero motion — these pages are for reading.
 *
 * Design-system note: the research says documents read best LIGHT even in
 * dark products; our tokens are deliberately dark-only today, so this ships
 * on the dark tokens with the halation mitigations (muted off-white body,
 * no volt in body text). A "paper" light scheme is a tokens.ts decision,
 * tracked in the PR, not something this page invents locally.
 */

const SIBLINGS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/health-privacy', label: 'Health Data Privacy' },
] as const

export function LegalPage({ markdown, currentPath }: { markdown: string; currentPath: string }) {
  const headings = extractHeadings(markdown)
  return (
    // Desktop: sticky scroll-spy rail left of the 68ch column (the
    // Stripe/Linear layout); mobile: the rail hides and the collapsible
    // page-top TOC below takes over.
    <main className="mx-auto w-full max-w-[68ch] px-[clamp(1.25rem,4vw,2.5rem)] pt-[clamp(2rem,1rem+3vw,3.5rem)] pb-16 lg:grid lg:max-w-[calc(68ch+18rem)] lg:grid-cols-[15rem_minmax(0,68ch)] lg:gap-12">
      <nav className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground lg:col-span-2">
        <Link href="/" className="hover:text-foreground">
          ← App
        </Link>
        <span aria-hidden className="text-border">
          |
        </span>
        {SIBLINGS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            aria-current={s.href === currentPath ? 'page' : undefined}
            className={
              s.href === currentPath ? 'font-medium text-foreground' : 'hover:text-foreground'
            }
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {headings.length > 2 && (
        // Sticky, not deleted, on mobile (the Next.js docs pattern): the TOC
        // re-homes into a disclosure that stays reachable mid-read.
        <details className="sticky top-0 z-10 -mx-[clamp(1.25rem,4vw,2.5rem)] mb-8 border-y border-border bg-background px-[clamp(1.25rem,4vw,2.5rem)] py-3 text-sm lg:hidden">
          <summary className="cursor-pointer font-medium">On this page</summary>
          <ol className="mt-3 space-y-1.5 pl-4 text-muted-foreground">
            {headings.map((h) => (
              <li key={h.slug}>
                <a href={`#${h.slug}`} className="hover:text-foreground hover:underline">
                  {h.text}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}

      {headings.length > 2 && (
        <aside className="hidden lg:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto pr-2">
            <Toc headings={headings} />
          </div>
        </aside>
      )}

      <article className="min-w-0">
        <LegalMarkdown markdown={markdown} />
      </article>
    </main>
  )
}
