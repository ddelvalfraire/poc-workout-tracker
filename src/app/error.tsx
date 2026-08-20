'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('ErrorBoundary')
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-safe py-12 text-center">
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t('description')}
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>{t('retry')}</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">{t('errorRef', { digest: error.digest })}</p>
      )}
    </main>
  )
}
