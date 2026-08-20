'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

// Replaces the root layout when it (or the root error boundary) throws, so it
// must render its own <html>/<body> and cannot rely on globals.css or any
// shared component — everything here is self-contained inline style.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('GlobalError')
  useEffect(() => {
    console.error(error)
    // Report to Sentry when configured (Sentry's documented global-error
    // pattern, lazy so the SDK stays out of this boundary's chunk). The catch
    // swallows deliberately: reporting must never break the crash screen.
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => {})
    }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          background: '#0a0a0a',
          color: '#f7f7f7',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '1.5rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{t('title')}</h1>
        <p style={{ maxWidth: '24rem', color: '#b8b8b8', fontSize: '0.875rem', margin: 0 }}>
          {t('description')}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            padding: '0.75rem 1.5rem',
            borderRadius: '9999px',
            border: 'none',
            background: '#c8f542',
            color: '#1a2405',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          {t('reload')}
        </button>
        {error.digest && (
          <p style={{ fontSize: '0.75rem', color: '#8a8a8a', margin: 0 }}>
            {t('errorRef', { digest: error.digest })}
          </p>
        )}
      </body>
    </html>
  )
}
