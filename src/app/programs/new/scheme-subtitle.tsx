import { schemeName, schemeSubtitle, type ProgressionScheme } from '@/lib/scheme-copy'

/**
 * The builder's plain-English scheme line (#228): human scheme name + the
 * researched one-line subtitle, muted — the Liftosaur name+description
 * pattern. The builder has no scheme picker (progression is agent-authored
 * pass-through), so the line renders under each exercise that CARRIES a
 * progression, saying in lifter language what the sketch will actually do.
 * Words on a hairline row, no chip, no shell (DESIGN.md de-card vocabulary).
 */
export function SchemeSubtitle({ scheme }: { scheme: ProgressionScheme }) {
  return (
    <p className="px-0.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{schemeName(scheme)}</span>
      <span aria-hidden="true"> — </span>
      {schemeSubtitle(scheme)}
    </p>
  )
}
