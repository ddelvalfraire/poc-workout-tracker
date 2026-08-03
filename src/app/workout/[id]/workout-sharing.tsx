'use client'

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { createWorkoutShareAction, revokeWorkoutShareAction } from '@/app/workout/actions'

const COPIED_RESET_MS = 2000

/** Static-value subscription for useSyncExternalStore: never notifies. */
function subscribeNever(): () => void {
  return () => {}
}

interface WorkoutSharingProps {
  workoutId: string
  /** The live share token (null until a link is minted). */
  shareToken: string | null
}

/**
 * The owner's share control on the completed-workout summary — the program
 * sharing-section's link row without the visibility selector (workouts have
 * none: a live link IS the grant). The link is minted LAZILY on the first
 * "Share workout" press; Revoke (ConfirmDialog) is the off-switch, and
 * pressing Share again afterwards mints a FRESH token — rotation by explicit
 * re-create, the program-shares semantics. Never rendered on live sessions
 * (the page redirects them to the logger before this mounts).
 */
export function WorkoutSharing({ workoutId, shareToken }: WorkoutSharingProps) {
  const [token, setToken] = useState<string | null>(shareToken)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showRevoke, setShowRevoke] = useState(false)
  const [isPending, startTransition] = useTransition()
  const closeRef = useRef<(() => void) | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The live origin as a client-only external value (see SharingSection):
  // composing from the origin means preview and production deployments each
  // hand out their own host without config.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => null,
  )

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const shareUrl = token !== null && origin !== null ? `${origin}/w/${token}` : null

  function mint() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await createWorkoutShareAction(workoutId)
        setToken(result.token)
      } catch {
        setError('Could not create the link. Try again.')
      }
    })
  }

  function copyLink() {
    if (shareUrl === null) return
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
      })
      .catch(() => setError('Could not copy the link.'))
  }

  function revoke() {
    setError(null)
    startTransition(async () => {
      try {
        await revokeWorkoutShareAction(workoutId)
        setToken(null)
        closeRef.current?.()
        setShowRevoke(false)
      } catch {
        setError('Could not revoke the link. Try again.')
      }
    })
  }

  return (
    <section aria-label="Sharing" className="mt-6">
      {token === null ? (
        <>
          {/* Outline: Repeat in WorkoutActions below keeps the one volt. */}
          <Button variant="outline" className="w-full gap-2" disabled={isPending} onClick={mint}>
            <Link2 aria-hidden="true" className="size-4" />
            {isPending ? 'Creating link…' : 'Share workout'}
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Anyone with the link sees this summary — sets, volume, PRs. Your notes and body data
            stay private.
          </p>
        </>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Share link
          </p>
          <div className="mt-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm tnum">{shareUrl ?? `/w/${token}`}</p>
            <button
              type="button"
              onClick={copyLink}
              aria-label={copied ? 'Link copied' : 'Copy share link'}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Anyone with the link sees this summary. Notes and body data stay private.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowRevoke(true)}
            className="mt-3 text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-destructive disabled:opacity-60"
          >
            Revoke link
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {showRevoke && (
        <ConfirmDialog
          title="Revoke this link?"
          body="Anyone holding the link loses access immediately. Sharing again creates a fresh link."
          confirmLabel="Revoke"
          pendingLabel="Revoking…"
          error={error}
          isPending={isPending}
          onConfirm={revoke}
          onClose={() => setShowRevoke(false)}
          closeRef={closeRef}
        />
      )}
    </section>
  )
}
