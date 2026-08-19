'use client'

import { useTransition } from 'react'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutAction } from '@/app/actions'

interface SignOutButtonProps {
  /**
   * `icon` is the compact affordance for headers and the drawer footer, where
   * the old vendor avatar button used to sit; `full` is the labelled control
   * the settings surface wants. Both hit the same 44px target.
   */
  variant?: 'icon' | 'full'
  className?: string
}

/**
 * The way out, app-wide. AuthKit has no drop-in account widget — account
 * management lives on the hosted AuthKit page and on /settings — so sign-out
 * is its own explicit control rather than a menu hidden behind an avatar.
 *
 * Sign-out is a navigation, not a mutation the UI can roll back: the action
 * redirects to AuthKit's logout, so the button only has to stay disabled and
 * say so while the request is in flight.
 */
export function SignOutButton({ variant = 'icon', className }: SignOutButtonProps) {
  const [isPending, startTransition] = useTransition()

  function signOut() {
    startTransition(async () => {
      await signOutAction()
    })
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={isPending}
        aria-label="Sign out"
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
          'outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:opacity-50',
          className,
        )}
      >
        <LogOut aria-hidden="true" className="size-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={isPending}
      className={cn(
        'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
        'outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:opacity-50',
        className,
      )}
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
