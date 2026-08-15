import { Button, buttonVariants } from './button'
import type { VariantProps } from 'class-variance-authority'

/**
 * The button role → variant contract (logger UX overhaul, #212):
 *
 * - default            the screen's ONE primary action (solid volt)
 * - band               session-peak action (live Finish): full-bleed
 *                      volt-tinted display-face band — the skin only; the
 *                      -mx gutter bleed is layout and lives at the call site
 * - outline            constructive-additive ("adds something": + Add set,
 *                      + Exercise) and paperwork-primary (Save changes)
 * - ghost              quiet utility (tool rails, sheet close)
 * - reversal           walks something back (Undo, Just today, Use plan as
 *                      written): ghost-quiet with a standing underline
 * - destructive        destructive COMMIT, confirm surfaces only
 * - destructive-outline standing destructive entry point (Discard workout)
 * - secondary / link   shadcn defaults, outside the logger vocabulary
 *
 * CSF-shaped module: renders under Storybook when the workbench lands; until
 * then it is the reviewable variant matrix and a compile-checked contract.
 */

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>

const VARIANTS: ButtonVariant[] = [
  'default',
  'band',
  'outline',
  'secondary',
  'ghost',
  'reversal',
  'destructive',
  'destructive-outline',
  'link',
]

const SIZES: ButtonSize[] = ['xs', 'sm', 'default', 'lg']

const meta = {
  title: 'UI/Button',
  component: Button,
}

export default meta

/** Every variant at every text size, plus the disabled column. */
export const Matrix = {
  render: () => (
    <div className="flex flex-col gap-4 p-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-40 text-xs text-muted-foreground">{variant}</span>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              Button
            </Button>
          ))}
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
}

/** The band in situ: full width inside a gutter-bled sticky-bar stand-in.
 *  The bleed classes stay with the LAYOUT (this wrapper), never the skin. */
export const Band = {
  render: () => (
    <div className="w-96 border-t border-border px-5 pt-3 pb-4">
      <Button
        size="lg"
        variant="band"
        className="-mx-5 w-[calc(100%+2.5rem)] font-semibold uppercase tracking-wide"
      >
        Finish workout <span aria-hidden="true">→</span>
      </Button>
    </div>
  ),
}

/** The reversal family next to ghost — the underline is the differentiator. */
export const Reversal = {
  render: () => (
    <div className="flex items-center gap-3 p-6">
      <Button size="sm" variant="ghost">
        Ghost utility
      </Button>
      <Button size="sm" variant="reversal">
        Undo
      </Button>
      <Button size="sm" variant="reversal">
        Just today
      </Button>
      <Button size="sm" variant="reversal" disabled>
        Undo
      </Button>
    </div>
  ),
}

/** Standing destructive vs destructive commit, side by side. */
export const Destructive = {
  render: () => (
    <div className="flex w-80 flex-col gap-3 p-6">
      <Button variant="destructive-outline" className="w-full">
        Discard workout
      </Button>
      <Button variant="destructive" className="w-full">
        Delete (confirm surface)
      </Button>
    </div>
  ),
}
