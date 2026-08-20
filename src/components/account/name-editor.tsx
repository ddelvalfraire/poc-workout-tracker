'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateNameAction } from '@/app/settings/account/actions'

/**
 * Editing the display name.
 *
 * Explicit Save, never save-on-blur. On mobile "blur" is ambiguous — it fires
 * on keyboard dismiss, on scroll, on app switch — so the user cannot tell
 * whether their change persisted, and the failure is silent.
 *
 * Not optimistic either, despite a name being about the safest field there
 * is: the value it writes is re-read from the server on the next render, so
 * an optimistic flash followed by a revert would be the only thing the user
 * noticed. The save is fast; honesty is cheaper than the illusion.
 */
export function NameEditor({
  initialFirstName,
  initialLastName,
}: {
  initialFirstName: string
  initialLastName: string
}) {
  const t = useTranslations('Account')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [error, setError] = useState<string | null>(null)

  const dirty = firstName !== initialFirstName || lastName !== initialLastName

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateNameAction(firstName, lastName)
      if (result.status === 'invalid') {
        setError(t('nameLengthError'))
        return
      }
      router.push('/settings/account')
      router.refresh()
    })
  }

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Field
        id="first-name"
        label={t('firstNameLabel')}
        value={firstName}
        onChange={setFirstName}
        disabled={isPending}
        autoComplete="given-name"
      />
      <Field
        id="last-name"
        label={t('lastNameLabel')}
        value={lastName}
        onChange={setLastName}
        disabled={isPending}
        autoComplete="family-name"
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Disabled until something actually changed: a live Save button on an
          untouched form invites a pointless round-trip and reads as though
          the screen is waiting on the user. */}
      <Button type="submit" disabled={isPending || !dirty}>
        {isPending ? t('saving') : t('saveAction')}
      </Button>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
  autoComplete: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete={autoComplete}
        enterKeyHint="done"
      />
    </div>
  )
}
