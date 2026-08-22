'use client'

import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A hairline row that states where a group of settings currently stands, and
 * opens to the settings themselves.
 *
 * WHY A SUMMARY AND NOT THE FORM. The defaults are already sane, so a program's
 * settings are one line to CHECK, not a gauntlet to pass. Laying eleven
 * controls out inline makes the day list — the actual work — start below the
 * fold, and reads as a form that must be completed before anything happens.
 *
 * The panel is hidden with the `hidden` attribute rather than unmounted: the
 * controls keep their DOM identity across opens (a half-typed week number
 * survives a stray collapse) while staying out of the tab order while closed.
 */

interface SummaryRowProps {
  /** What this group is. */
  label: React.ReactNode
  /** Where it currently stands, in the muted ink — words, never chips. */
  summary: React.ReactNode
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}

function SummaryRow({ label, summary, defaultOpen = false, className, children }: SummaryRowProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className={cn('border-y border-y-border/60', className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="truncate text-xs tabular-nums">{summary}</span>
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 transition-transform motion-reduce:transition-none',
              isOpen && 'rotate-90',
            )}
          />
        </span>
      </button>
      <div id={panelId} hidden={!isOpen} className="pb-4">
        {children}
      </div>
    </div>
  )
}

export { SummaryRow }
