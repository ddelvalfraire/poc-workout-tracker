import type { TemplatesUnavailableReason } from '@/lib/wger-templates'

/** Why the catalog could not be served, in user terms — one source of copy so
 *  the browse list and the template detail degrade identically. */
const UNAVAILABLE_COPY: Record<TemplatesUnavailableReason, { title: string; body: string }> = {
  unconfigured: {
    title: 'Template browsing is not configured',
    body: 'Connecting to the wger template catalog needs a WGER_API_KEY. Add one and reload.',
  },
  unavailable: {
    title: 'wger is not answering right now',
    body: 'The template catalog could not be loaded. Try again in a minute.',
  },
}

/** The graceful empty state for an unreachable template catalog — plain
 *  words (the EmptyWords voice), not a boxed apology. */
export function TemplatesUnavailable({ reason }: { reason: TemplatesUnavailableReason }) {
  return (
    <div className="mt-6 px-1 py-6 text-center">
      <p className="text-sm font-medium">{UNAVAILABLE_COPY[reason].title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{UNAVAILABLE_COPY[reason].body}</p>
    </div>
  )
}
