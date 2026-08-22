import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface NavListProps {
  /**
   * Names the destination group for assistive tech — the grouping a sighted
   * reader gets for free from proximity. Required: an unnamed `<nav>` is a
   * landmark screen-reader users cannot tell apart from any other.
   */
  label: string
  className?: string
  children: React.ReactNode
}

/**
 * A cluster of sub-destinations hanging off a detail screen — the rows that
 * leave the page, as opposed to the rows that ARE the page.
 *
 * Why this exists when `DividerList` renders the same hairlines: the
 * difference is the missing `trailing` slot on `NavRow`. On a screen that
 * already stacks several divider lists, density is the only differentiator
 * left once card shells are off the table — content rows carry numerals and
 * sentences, so navigation rows must carry nothing. Making that a *type*
 * rather than a convention is the point; a reviewer will eventually let a
 * count or a delta slip into a nav row, and the compiler will not.
 *
 * Deliberately headerless. The three destinations this was built for (About /
 * Stats / Coach) share only "not the plan", and the honest names for that set
 * — More, Other, Details — are the documented zero-scent category labels. On a
 * page where every content group carries a condensed-caps `Section` header,
 * the absence of one is itself the signal, and it costs nothing. Wrap it in a
 * `Section` only if a real superordinate ever exists.
 *
 * `mt-14` rather than the `mt-8` section beat: proximity does the grouping
 * work a header would otherwise do, so the leading gap has to be visibly
 * larger than any gap between content sections.
 */
function NavList({ label, className, children }: NavListProps) {
  return (
    <nav aria-label={label} className={cn('mt-14', className)}>
      <ul className="divide-y divide-border/60 border-y border-y-border/60">{children}</ul>
    </nav>
  )
}

interface NavRowProps {
  href: string
  className?: string
  /** The destination's name. One line, no metadata — see NavList. */
  children: React.ReactNode
}

/**
 * One destination. The whole row is the control; the trailing chevron is the
 * disclosure indicator every platform reserves for "this navigates", which is
 * why it must not spread to the content rows around it — a chevron on every
 * row carries no information.
 *
 * There is no `trailing` prop and no icon slot, both on purpose. Icons help
 * visual search *within a long list*; the closest study on short list menus
 * finds no effect, and a partly-iconed cluster breaks sibling consistency
 * outright.
 */
function NavRow({ href, className, children }: NavRowProps) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex items-center justify-between gap-4 py-4 text-base font-medium transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
          className,
        )}
      >
        {children}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

export { NavList, NavRow }
