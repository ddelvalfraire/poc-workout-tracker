import type { TemplatesUnavailableReason } from '@/lib/wger-templates'
import { useTranslations } from 'next-intl'

/** The graceful empty state for an unreachable template catalog — plain
 *  words (the EmptyWords voice), not a boxed apology. Why the catalog could
 *  not be served is one source of copy, so the browse list and the template
 *  detail degrade identically; it lives in the catalog under
 *  `title.<reason>` / `body.<reason>` rather than a module-scope table,
 *  which would be built before any request and so could never be
 *  translated. */
export function TemplatesUnavailable({ reason }: { reason: TemplatesUnavailableReason }) {
  const t = useTranslations('TemplatesUnavailable')
  return (
    <div className="mt-6 px-1 py-6 text-center">
      <p className="text-sm font-medium">{t(`title.${reason}`)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(`body.${reason}`)}</p>
    </div>
  )
}
