'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setBodyweightAction } from '@/app/actions'
import type { WeightUnit } from '@/lib/units'

/**
 * Quick-log island for the bodyweight page: one labeled decimal input in the
 * display unit + the page's single volt action. Persists through
 * setBodyweightAction (the same write path as the old settings editor — a
 * log row plus the synced current value), then router.refresh() so the
 * server-rendered hero, sparkline, and history pick the entry up. Error
 * handling follows UnitToggle: visible words, value kept in the input so the
 * user just taps again.
 */
export function BodyweightLogForm({ unit }: { unit: WeightUnit }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseFloat(value.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(`Enter a weight above 0 ${unit}.`)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await setBodyweightAction(parsed)
        setValue('')
        router.refresh()
      } catch {
        // Keep the typed value: recovery is one more tap, not a re-type.
        setError('Didn’t save. Check the value and try again.')
      }
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="bodyweight-input" className="text-sm font-medium">
        Today&rsquo;s weight ({unit})
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="bodyweight-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null || undefined}
          placeholder={unit === 'lb' ? 'e.g. 181.5' : 'e.g. 82.5'}
          className="tnum"
        />
        {/* THE volt action on this page — everything else stays quiet. */}
        <Button type="submit" disabled={isPending} className="shrink-0">
          {isPending ? 'Logging…' : 'Log weight'}
        </Button>
      </div>
      {error && (
        // Visible words, not a bare glyph — same rationale as UnitToggle.
        <p role="alert" className="mt-1.5 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
