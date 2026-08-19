'use client'

import { useEffect, useState } from 'react'

/**
 * Scroll-spy table of contents for the legal pages — the Stripe/Linear
 * pattern: a sticky rail that tracks the section currently in view. Plain
 * IntersectionObserver, no animation library (checked: Aceternity has no TOC
 * component, and its scroll effects would pull Framer Motion for what sixty
 * lines do natively).
 *
 * Active detection: the topmost heading above a reading line ~35% down the
 * viewport wins. rootMargin does the math so scroll handlers never run.
 * Volt appears ONLY on the active marker (the research's one-volt rule for
 * these pages); everything else stays muted.
 */

export interface TocHeading {
  text: string
  slug: string
}

export function Toc({ headings }: { headings: TocHeading[] }) {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const targets = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        // Topmost heading in the band wins; when the band is empty (inside a
        // long section), keep the last heading scrolled past.
        const first = headings.find((h) => visible.has(h.slug))
        if (first) {
          setActive(first.slug)
        } else {
          const line = window.innerHeight * 0.35
          const passed = targets.filter((el) => el.getBoundingClientRect().top < line)
          if (passed.length > 0) setActive(passed[passed.length - 1].id)
          // Above the first heading nothing is active — a stale
          // aria-current would lie.
          else setActive(null)
        }
      },
      // Band from the top of the viewport to the 35% reading line.
      { rootMargin: '0px 0px -65% 0px' },
    )
    for (const el of targets) observer.observe(el)
    return () => observer.disconnect()
  }, [headings])

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        On this page
      </p>
      <ol className="space-y-0.5 border-l border-border">
        {headings.map((h) => {
          const isActive = h.slug === active
          return (
            <li key={h.slug}>
              <a
                href={`#${h.slug}`}
                aria-current={isActive ? 'location' : undefined}
                className={`-ml-px block border-l py-1 pl-3 transition-colors ${
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {h.text}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
