'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { startProgramDayAction } from '@/app/programs/actions'
import {
  SessionConflictDialog,
  type SessionSummary,
} from '@/components/session-conflict-dialog'

/**
 * Per-day client island: instantiates the day into a real workout (week
 * auto-derived, targets engine-seeded) and navigates to it. Navigation happens
 * client-side AFTER the action resolves — the action must not redirect.
 */
interface StartDayButtonProps {
  programDayId: string
  size?: 'sm' | 'default' | 'lg'
  label?: string
  /** Demotes the button when another CTA owns the screen (e.g. a resume banner). */
  variant?: 'default' | 'outline'
  /**
   * The live session this start would collide with, or null/absent for the
   * plain one-tap start. When set, tapping raises the conflict dialog and the
   * day is only instantiated after a confirmed discard — starting a program
   * day creates a real workout row immediately, so an unguarded tap would
   * mint a SECOND active session behind the user's back.
   */
  activeSession?: SessionSummary | null
}

export function StartDayButton({
  programDayId,
  size = 'sm',
  label = 'Start this day',
  variant = 'default',
  activeSession = null,
}: StartDayButtonProps) {
  const [isPending, setIsPending] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  // Throws on failure — the un-guarded path catches below and shows its
  // inline error; the dialog path lets SessionConflictDialog catch so the
  // error text lands inside the sheet and nothing navigates.
  async function instantiateAndGo() {
    const { workoutId } = await startProgramDayAction(programDayId)
    // Straight into the logger: the intent behind "Start" is to log, not
    // to review — the read-only detail page is the post-session view.
    router.push(`/workout/${workoutId}/edit`)
  }

  async function handleStart() {
    setIsPending(true)
    try {
      setError(null)
      await instantiateAndGo()
    } catch {
      setIsPending(false)
      setError('Could not start this day. Please try again.')
    }
  }

  return (
    <div className="space-y-2">
      <Button
        size={size}
        variant={variant}
        className="w-full"
        disabled={isPending}
        // With a live session, the tap asks before it acts; otherwise the
        // original one-tap start stands.
        onClick={activeSession ? () => setIsDialogOpen(true) : handleStart}
      >
        {isPending ? 'Starting…' : label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isDialogOpen && activeSession && (
        <SessionConflictDialog
          session={activeSession}
          onClose={() => setIsDialogOpen(false)}
          onProceed={instantiateAndGo}
        />
      )}
    </div>
  )
}
