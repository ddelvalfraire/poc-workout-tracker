'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TIERS, type Tier } from '@/lib/entitlements/tiers'
import { grantTierAction } from '@/app/ops/billing/actions'
import { GRANT_DURATIONS, type GrantDuration } from '@/lib/entitlements/duration'

/**
 * Granting a tier by hand.
 *
 * Two-step on purpose. Every other control on /ops reads data; this one gives
 * away money, and the confirm step exists so the second press names exactly
 * what is about to happen ("Grant Max, never expires") rather than repeating a
 * generic label. A slip on a single button should not be able to comp somebody
 * forever.
 *
 * Changing any field after arming cancels the confirm — the sentence on the
 * button must never describe something other than what the form now holds.
 */
/**
 * Explicit key strings, for the same reason PlanSurface uses them: a key built
 * from a template literal is invisible to the catalog's orphan check.
 */
const DURATION_KEY = {
  '7d': 'duration.option.7d',
  '30d': 'duration.option.30d',
  '90d': 'duration.option.90d',
  '1y': 'duration.option.1y',
  forever: 'duration.option.forever',
} as const satisfies Record<GrantDuration, string>

export function GrantForm({ userId }: { userId: string }) {
  const t = useTranslations('GrantForm')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [tier, setTier] = useState<Tier>('pro')
  const [duration, setDuration] = useState<GrantDuration>('30d')
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Any edit invalidates an armed confirm. */
  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      setArmed(false)
      setError(null)
      set(value)
    }
  }

  function submit() {
    if (!armed) {
      if (reason.trim().length < 3) {
        setError(t('reason.validation'))
        return
      }
      setArmed(true)
      return
    }
    startTransition(async () => {
      const result = await grantTierAction({ userId, tier, duration, reason })
      setArmed(false)
      if (result.status === 'granted') {
        setReason('')
        router.refresh()
        return
      }
      setError(result.status === 'denied' ? t('errorDenied') : t('errorInvalid'))
    })
  }

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{t('title')}</p>

      <div className="flex flex-wrap gap-3">
        <Field id="grant-tier" label={t('tier.label')}>
          <Select id="grant-tier" value={tier} onChange={edit<Tier>(setTier)} disabled={isPending}>
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="grant-duration" label={t('duration.label')}>
          <Select
            id="grant-duration"
            value={duration}
            onChange={edit<GrantDuration>(setDuration)}
            disabled={isPending}
          >
            {GRANT_DURATIONS.map((value) => (
              <option key={value} value={value}>
                {t(DURATION_KEY[value])}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field id="grant-reason" label={t('reason.label')}>
        <Input
          id="grant-reason"
          value={reason}
          onChange={(event) => edit<string>(setReason)(event.target.value)}
          disabled={isPending}
          placeholder={t('reason.placeholder')}
          autoComplete="off"
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-destructive-ink">
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant={armed ? 'destructive' : 'default'}
        disabled={isPending}
        className="self-start"
      >
        {isPending
          ? t('loading')
          : armed
            ? t('actionArmed', { tier, duration: t(DURATION_KEY[duration]) })
            : t('action')}
      </Button>
    </form>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * A native select, deliberately. The value sets are three and five items long
 * and never grow at runtime; a custom listbox would add focus management and
 * a portal to an internal form for no gain over what the platform ships.
 */
function Select<T extends string>({
  id,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string
  value: T
  onChange: (value: T) => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring disabled:opacity-50"
    >
      {children}
    </select>
  )
}
