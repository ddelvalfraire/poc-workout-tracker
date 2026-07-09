'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { SessionConflictDialog, type SessionSummary } from './session-conflict-dialog'

/**
 * A "start a new workout" link that respects the single-active-session rule:
 * with no live session it is a plain <Link>; with one it becomes a button
 * that raises the conflict dialog, and only a confirmed discard lets the
 * original navigation through. Styled by the caller (`className` carries the
 * same buttonVariants classes either way) so guarded and unguarded renders
 * are visually identical — the guard is behavior, not chrome.
 */
interface GuardedStartLinkProps {
  href: string
  /** The live session to guard against, or null for a plain link. */
  session: SessionSummary | null
  className?: string
  /** For icon-only starts (e.g. the history Repeat button) — both renders keep it. */
  'aria-label'?: string
  children: ReactNode
}

export function GuardedStartLink({
  href,
  session,
  className,
  'aria-label': ariaLabel,
  children,
}: GuardedStartLinkProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const router = useRouter()

  // No session, no ceremony: a real link keeps prefetch, middle-click and
  // long-press previews — everything a <button onClick={push}> would lose.
  if (!session) {
    return (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        onClick={() => setIsDialogOpen(true)}
      >
        {children}
      </button>
      {isDialogOpen && (
        <SessionConflictDialog
          session={session}
          onClose={() => setIsDialogOpen(false)}
          // The original intent, deferred: the dialog awaits this after a
          // successful discard (await-then-navigate — never inside a
          // transition; see workout-actions.tsx).
          onProceed={() => router.push(href)}
        />
      )}
    </>
  )
}
