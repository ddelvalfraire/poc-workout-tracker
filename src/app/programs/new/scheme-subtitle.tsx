import { schemeName, schemeSubtitle, type ProgressionScheme } from '@/lib/scheme-copy'
import { useTranslations } from 'next-intl'

/**
 * The builder's plain-English scheme line (#228): human scheme name + the
 * researched one-line subtitle, muted — the Liftosaur name+description
 * pattern. The builder has no scheme picker (progression is agent-authored
 * pass-through), so the line renders under each exercise that CARRIES a
 * progression, saying in lifter language what the sketch will actually do.
 * Words on a hairline row, no chip, no shell (DESIGN.md de-card vocabulary).
 */
export function SchemeSubtitle({ scheme }: { scheme: ProgressionScheme }) {
  const t = useTranslations('SchemeSubtitle')
  // The name and the one-liner are scheme vocabulary shared with the program
  // detail's "how this progresses" line; only the separator belongs to this row.
  const tScheme = useTranslations('SchemeCopy')
  const name = schemeName(scheme)
  const subtitle = schemeSubtitle(scheme)
  return (
    <p className="px-0.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{tScheme(name.key)}</span>
      <span aria-hidden="true"> {t('separator')} </span>
      {tScheme(subtitle.key)}
    </p>
  )
}
