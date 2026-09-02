'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { signOutAction } from '@/app/actions'
import { clearPersistedDrawer } from '@/lib/query-persister'

interface SignOutButtonProps {
  /**
   * `icon` is the compact affordance for the home header and the drawer
   * footer, where the old vendor avatar button used to sit; `full` is the
   * labelled control the settings identity row wants.
   */
  variant?: 'icon' | 'full'
  className?: string
}

/**
 * The way out, app-wide. AuthKit has no drop-in account widget — account
 * management lives on the hosted AuthKit page and on /settings — so sign-out
 * is its own explicit control rather than a menu hidden behind an avatar.
 *
 * Built on Button rather than a bespoke element so both variants inherit the
 * 44px touch floor (`icon` and `default` sizes) along with the focus ring and
 * disabled treatment. The hand-rolled version this replaced sized the labelled
 * variant off padding alone and landed near 32px — under the floor, on the one
 * control a user reaches for when they want out.
 *
 * Sign-out is a navigation, not a mutation the UI can roll back: the action
 * redirects to AuthKit's logout, so the button only has to stay disabled and
 * say so while the request is in flight.
 */
export function SignOutButton({ variant = 'icon', className }: SignOutButtonProps) {
  const t = useTranslations('SignOutButton')
  const [isPending, startTransition] = useTransition()

  function signOut() {
    // The device keeps nothing of the user after they leave: the drawer's
    // persisted snapshot (lib/query-persister) goes before the session does.
    // Before, not after, on purpose: if the action fails the user is still
    // signed in and merely gets one cold drawer open — the failure mode that
    // errs toward privacy, not away from it.
    clearPersistedDrawer()
    startTransition(async () => {
      await signOutAction()
    })
  }

  if (variant === 'icon') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={signOut}
        disabled={isPending}
        aria-label={t('ariaLabel')}
        className={cn('text-muted-foreground', className)}
      >
        <LogOut aria-hidden="true" className="size-5" />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={signOut}
      disabled={isPending}
      className={cn('text-muted-foreground', className)}
    >
      {isPending ? t('pending') : t('action')}
    </Button>
  )
}
