'use client'

import { useEffect } from 'react'

// Replaces the root layout when it (or the root error boundary) throws, so it
// must render its own <html>/<body> and cannot rely on globals.css or any
// shared component — everything here is self-contained inline style.
//
// THAT INCLUDES THE TRANSLATOR. NextIntlClientProvider lives in the root
// layout, which this component replaces, so useTranslations here throws for
// want of context — turning the branded crash screen into Next's bare error
// page and discarding the error digest, the one string support can act on.
// The copy is inlined in English deliberately: a last-resort boundary that
// depends on anything is a boundary that can fail twice. Same reason
// <html lang> is fixed — resolving a locale needs the request scope this
// boundary does not have.
// Verbatim from before the i18n pass: the extraction had quietly reworded
// both the description and the button, which the copy diff missed.
const COPY = {
  title: 'Something went wrong',
  description:
    'The app hit an unexpected error. Your saved workouts are safe — reload to continue.',
  reload: 'Reload app',
  errorRef: 'Error ref:',
}
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
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
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{COPY.title}</h1>
        <p style={{ maxWidth: '24rem', color: '#b8b8b8', fontSize: '0.875rem', margin: 0 }}>
          {COPY.description}
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
          {COPY.reload}
        </button>
        {error.digest && (
          <p style={{ fontSize: '0.75rem', color: '#8a8a8a', margin: 0 }}>
            {COPY.errorRef} {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
