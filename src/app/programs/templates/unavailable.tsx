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

/** The graceful empty-state card for an unreachable template catalog. */
export function TemplatesUnavailableCard({ reason }: { reason: TemplatesUnavailableReason }) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-12 text-center">
      <p className="font-medium">{UNAVAILABLE_COPY[reason].title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{UNAVAILABLE_COPY[reason].body}</p>
    </div>
  )
}
