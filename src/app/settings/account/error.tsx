'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'

/**
 * Scoped boundary for the account surface.
 *
 * The account read deliberately throws rather than defaulting its fields —
 * rendering "Two-step verification: Off" because we could not ASK would be a
 * security-relevant lie. That honesty needs somewhere to land, and the
 * app-wide boundary is the wrong place twice over: it replaces the whole
 * shell for what is one failed upstream call, and it strands the user with no
 * route to account deletion — the one action here that must stay reachable.
 *
 * So: name the failure, offer the retry, and keep the deletion path alive.
 */
export default function AccountErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('Account')

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-safe py-12 text-center">
      <h1 className="text-2xl">{t('loadErrorTitle')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('loadErrorBody')}</p>
      <div className="flex gap-3">
        <Button onClick={reset}>{t('loadErrorRetry')}</Button>
        {/* Deletion does not depend on the read that just failed, so it stays
            available even while the rest of the surface cannot render. */}
        <Link href="/settings/delete-account" className={buttonVariants({ variant: 'outline' })}>
          {t('deleteLabel')}
        </Link>
      </div>
      {error.digest && <p className="text-xs text-muted-foreground">{error.digest}</p>}
    </main>
  )
}
