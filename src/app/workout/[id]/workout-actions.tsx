'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookmarkPlus, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'
import { deleteWorkoutAction } from '@/app/workout/actions'
import { saveWorkoutAsTemplateAction } from '@/app/templates/actions'

/**
 * Detail-page action island: an Edit link to the edit route and a Delete
 * button that confirms in a centered modal (ConfirmDialog — a true <dialog>,
 * replacing the old inline card the user read as "shows up near the bottom of
 * the phone"), deletes (cascade), then navigates home. Kept small so the
 * detail page itself stays a Server Component.
 */
export function WorkoutActions({ id }: { id: string }) {
  const [isPending, setIsPending] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isTemplatePending, setIsTemplatePending] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  // ConfirmDialog populates this with an imperative close; the success path
  // calls it BEFORE router.push (see the dialog's contract — the #25
  // stranded-::backdrop race).
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  async function handleDelete() {
    setIsPending(true)
    try {
      setError(null)
      await deleteWorkoutAction(id)
      // Release the top layer imperatively before navigating: relying on
      // unmount cleanup to close() races React's flush against router.push.
      closeDialogRef.current?.()
      setIsModalOpen(false)
      router.push('/')
      // isPending stays true on success: navigation unmounts this screen.
    } catch {
      setIsPending(false)
      // The dialog stays open: the error renders inside it, retry in place.
      setError('Could not delete workout. Please try again.')
    }
  }

  // Same await-then-navigate rule as handleDelete: the new template's id only
  // exists after the action resolves, so a transition would strand the old
  // screen's snapshot over /templates/[id].
  async function handleSaveAsTemplate() {
    setIsTemplatePending(true)
    setTemplateError(null)
    try {
      const { id: templateId } = await saveWorkoutAsTemplateAction(id)
      router.push(`/templates/${templateId}`)
      // isTemplatePending stays true on success: navigation unmounts this screen.
    } catch {
      setIsTemplatePending(false)
      setTemplateError('Could not save the template. Please try again.')
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <Link href={`/workout/new?from=${id}`} className={cn(buttonVariants(), 'w-full gap-2')}>
        <RotateCcw aria-hidden="true" className="size-4" />
        Repeat workout
      </Link>
      {/* Save the session's shape for reuse OUTSIDE any program — lands on
          the new template's page. Outline: Repeat above keeps the one volt. */}
      <Button
        variant="outline"
        className="w-full gap-2"
        disabled={isTemplatePending}
        onClick={handleSaveAsTemplate}
      >
        <BookmarkPlus aria-hidden="true" className="size-4" />
        {isTemplatePending ? 'Saving template…' : 'Save as template'}
      </Button>
      {templateError && <p className="text-sm text-destructive">{templateError}</p>}
      <div className="flex items-center gap-2">
        <Link
          href={`/workout/${id}/edit`}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          Edit
        </Link>
        {/* Demoted on purpose: a destructive action should never carry the
            same visual weight as the everyday one beside it. */}
        <Button
          variant="ghost"
          className="shrink-0 text-destructive"
          disabled={isPending}
          onClick={() => {
            setError(null) // a stale failure from a prior attempt must not reopen with it
            setIsModalOpen(true)
          }}
        >
          Delete
        </Button>
      </div>
      {isModalOpen && (
        <ConfirmDialog
          title="Delete this workout?"
          body="Every logged set goes with it. This cannot be undone."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={error}
          isPending={isPending}
          onConfirm={handleDelete}
          onClose={() => setIsModalOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </div>
  )
}
