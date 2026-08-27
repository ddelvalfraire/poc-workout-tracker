import { cn } from '@/lib/utils'

/**
 * The editor's pane projection — the app's ONLY multi-pane layout
 * (DESIGN.md § Layout & Mobile).
 *
 * Below `editor-pane-breakpoint` (840px, tokens.ts) the editor IS the phone
 * column: the structure list is a page you are on, drilling into a day
 * NAVIGATES to another page, and the inspector is a bottom sheet over it. At or
 * above that width the same address projects into three panes and drilling in
 * SELECTS.
 *
 * The projection is pure CSS over ONE tree, which is how the "same routes and
 * the same state, never a second implementation" rule is actually kept rather
 * than merely intended. There is no width state, no `matchMedia`, no branch
 * choosing between a phone tree and a desktop tree: the panes are always
 * rendered from the same props, and the breakpoint only decides which of them
 * is on screen and how the inspector is positioned. The inspector in
 * particular is one element that is a sheet below the breakpoint and a column
 * at it — never a popover, per DESIGN.md — so its content cannot drift between
 * the two readings.
 *
 * `hasDay` is the only prop the projection branches on, and it does so
 * identically in both directions: with a day addressed the phone shows the day
 * and hides the structure list; with none it shows the structure list and hides
 * the day's empty canvas. At width both are on screen and neither branch fires.
 *
 * The widths are the tokens' values written as Tailwind arbitrary variants —
 * `editor-structure-pane-width` (244) and `editor-inspector-width` (316).
 * LAYOUT tokens are emitted to Swift and Kotlin but not to CSS (see
 * scripts/build-tokens.ts), so the web side cites them in a comment the way
 * `/programs/[id]/edit` already cites the breakpoint.
 */
interface EditorPanesProps {
  /** Pane 1 — weeks and days. A table of contents, so its width is fixed. */
  structure: React.ReactNode
  /** Pane 2 — the addressed day, or the empty canvas when none is addressed. */
  day: React.ReactNode
  /**
   * Pane 3 — the inspector for the selected exercise. Omit (or pass null) when
   * nothing is selected: the inspector COLLAPSES rather than standing empty, so
   * it never costs width for silence.
   */
  inspector?: React.ReactNode
  /** Whether the address names a day — the one thing the projection branches on. */
  hasDay: boolean
  className?: string
}

function EditorPanes({ structure, day, inspector, hasDay, className }: EditorPanesProps) {
  const hasInspector = inspector !== undefined && inspector !== null

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col min-[840px]:flex-row', className)}>
      <div
        className={cn(
          'min-w-0 flex-1 min-[840px]:w-[244px] min-[840px]:flex-none min-[840px]:shrink-0 min-[840px]:overflow-y-auto min-[840px]:border-r min-[840px]:border-r-border/60',
          hasDay && 'hidden min-[840px]:block',
        )}
      >
        {structure}
      </div>

      <div
        className={cn(
          'min-w-0 flex-1 min-[840px]:overflow-y-auto',
          !hasDay && 'hidden min-[840px]:block',
        )}
      >
        {day}
      </div>

      {hasInspector && (
        <aside
          className={
            // Sheet below the breakpoint, column at it — one element, two
            // positionings. `shadow-2xl` is the sheet's elevation (an overlay
            // IS a shell, per the de-card keep-list) and it is dropped once the
            // element becomes a pane, where a hairline does the framing.
            'fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto border-t border-t-border/60 bg-background px-5 pb-[env(safe-area-inset-bottom)] shadow-2xl min-[840px]:static min-[840px]:z-auto min-[840px]:max-h-none min-[840px]:w-[316px] min-[840px]:shrink-0 min-[840px]:border-t-0 min-[840px]:border-l min-[840px]:border-l-border/60 min-[840px]:px-4 min-[840px]:pb-0 min-[840px]:shadow-none'
          }
        >
          {inspector}
        </aside>
      )}
    </div>
  )
}

export { EditorPanes }
