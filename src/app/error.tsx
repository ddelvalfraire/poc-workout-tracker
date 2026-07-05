'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-safe py-12 text-center">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The app hit an unexpected error. Your saved workouts are safe — try again or reload.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">Error ref: {error.digest}</p>
      )}
    </main>
  )
}
