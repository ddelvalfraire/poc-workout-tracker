import Link from 'next/link'
import { BackLink } from '@/components/back-link'
import { cn } from '@/lib/utils'
import { AutoRefreshToggle } from './auto-refresh-toggle'
import { OpsRefreshButton } from './refresh-button'
import { OpsTabPending } from './tab-pending'
import { useTranslations } from 'next-intl'

/**
 * Shared header for the ops surface: back link, title, the Ops | Product tab
 * nav, and the refresh controls. Server component — the active tab is a fact
 * of the route, so each page passes it instead of a client usePathname read.
 *
 * The tabs are real routes (/ops, /ops/product), each independently gated and
 * force-dynamic, so both are deep-linkable and a refresh on either only
 * re-hits that tab's sources.
 */

export type OpsTab = 'ops' | 'product'

// VALUES only. A label baked in here would be built at module load, before
// any request — so it could never be translated.
const TABS: { tab: OpsTab; href: string }[] = [
  { tab: 'ops', href: '/ops' },
  { tab: 'product', href: '/ops/product' },
]

export function OpsHeader({ active }: { active: OpsTab }) {
  const t = useTranslations('OpsHeader')
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center gap-2 px-5">
        <BackLink fallback="/" />
        <h1 className="min-w-0 truncate text-xl uppercase tracking-tight">{t('title')}</h1>
        <nav aria-label={t('navLabel')} className="ml-3 flex min-w-0 flex-1 items-center gap-1">
          {TABS.map(({ tab, href }) => (
            <Link
              key={tab}
              href={href}
              aria-current={active === tab ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs uppercase tracking-wider outline-none transition-colors',
                active === tab
                  ? 'border-primary/40 bg-primary/10 font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 focus-visible:border-primary',
              )}
            >
              {/* Pending hint (useLinkStatus): the label dims after 150ms of
                  pending navigation — zero layout impact, fast navs never
                  flash it. */}
              <OpsTabPending>{t(`tab.${tab}`)}</OpsTabPending>
            </Link>
          ))}
        </nav>
        <AutoRefreshToggle />
        <OpsRefreshButton />
      </div>
    </header>
  )
}
