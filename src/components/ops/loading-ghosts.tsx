import { cn } from '@/lib/utils'
import { Ghost } from '@/components/ui/ghost'

/**
 * Ghost frames for the ops segment's loading.tsx files (DESIGN.md § Pending
 * states). Each copies the REAL component's box classes verbatim —
 * OpsPanel's section/header recipe, StatusStrip's pill recipe — so the
 * resolved page lands on identical geometry (grid spans are passed through
 * className exactly as the pages pass them). Only the text nodes are stood
 * in for by Ghost bars sized to their line boxes; bars appear after Ghost's
 * 150ms delay and pulse, while the frames render immediately so the header/
 * grid never blank.
 */

/** Ghost of one OpsPanel: the real frame, bars for the title row + content. */
export function OpsGhostPanel({ className, lines = 4 }: { className?: string; lines?: number }) {
  return (
    <section
      aria-hidden="true"
      // Frame classes copied from OpsPanel verbatim.
      className={cn(
        'flex scroll-mt-20 flex-col rounded-2xl border border-border bg-card p-5',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Status dot + text-sm title line (h-4.5 = the 18px footnote line box). */}
          <Ghost className="size-2 shrink-0 rounded-full" />
          <span className="flex h-4.5 items-center">
            <Ghost className="h-2.5 w-20" />
          </span>
        </div>
        {/* text-xs status label (h-4 line box). */}
        <span className="flex h-4 items-center">
          <Ghost className="h-2 w-10" />
        </span>
      </header>
      <div className="mt-4 flex-1 space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className="flex h-4.5 items-center">
            <Ghost className={cn('h-2.5', index % 2 ? 'w-3/5' : 'w-4/5')} />
          </span>
        ))}
      </div>
    </section>
  )
}

/** Ghost of the StatusStrip: five real pill frames, bars for dot/label/value. */
export function OpsGhostStrip() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-2">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          // Pill classes copied from StatusStrip verbatim (minus hover/focus —
          // a ghost is not interactive).
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5"
        >
          <Ghost className="size-2 shrink-0 rounded-full" />
          {/* text-xs label (h-4) + text-sm value (h-4.5) line boxes. */}
          <span className="flex h-4 items-center">
            <Ghost className="h-2 w-12" />
          </span>
          <span className="flex h-4.5 items-center">
            <Ghost className="h-2.5 w-6" />
          </span>
        </span>
      ))}
    </div>
  )
}
