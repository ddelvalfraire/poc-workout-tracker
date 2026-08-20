'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { deleteAccountAction } from './actions'
import { DELETE_CONFIRM_PHRASE } from './confirm-phrase'
import { useTranslations } from 'next-intl'

/**
 * The type-to-confirm gate: the destructive button stays disabled until the
 * user types the exact phrase — a deliberate speed bump where a two-tap
 * dialog is too easy to sleepwalk through (this one erases an account). On
 * success we hard-navigate to /sign-in: the Clerk user is gone, so any
 * client-side route change would just bounce off dead auth state; a full
 * document load starts clean.
 */
export function DeleteAccountForm() {
  const t = useTranslations('DeleteAccountForm')
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const armed = phrase === DELETE_CONFIRM_PHRASE
  // Hoisted out of JSX: this is the error paragraph's element id, not copy —
  // inline it would read to the extraction gate as an untranslated string.
  const errorId = error ? 'delete-error' : undefined

  const handleDelete = () => {
    if (!armed || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await deleteAccountAction(phrase)
      if (result.ok) {
        window.location.assign('/sign-in')
        return
      }
      setError(result.error)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleDelete()
      }}
      className="mt-6"
    >
      <label htmlFor="delete-confirm" className="block text-sm font-medium">
        {t.rich('confirmInstruction', {
          phrase: DELETE_CONFIRM_PHRASE,
          code: (chunks) => <span className="font-mono text-destructive">{chunks}</span>,
        })}
      </label>
      <Input
        id="delete-confirm"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={isPending}
        className="mt-2"
        aria-describedby={errorId}
      />
      <Button
        type="submit"
        variant="destructive"
        className="mt-4 w-full"
        disabled={!armed || isPending}
      >
        {isPending ? t('pendingAction') : t('action')}
      </Button>
      {error && (
        <p id="delete-error" role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
