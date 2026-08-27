'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookmarkPlus, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { UncompleteSession } from '@/components/workout/uncomplete-session'
import { cn } from '@/lib/utils'
import { deleteWorkoutAction } from '@/app/workout/actions'
import { saveWorkoutAsTemplateAction } from '@/app/templates/actions'
import { useTranslations } from 'next-intl'

/**
 * Detail-page action island: an Edit link to the edit route and a Delete
 * button that confirms in a centered modal (ConfirmDialog — a true <dialog>,
 * replacing the old inline card the user read as "shows up near the bottom of
 * the phone"), deletes (cascade), then navigates home. Kept small so the
 * detail page itself stays a Server Component.
 *
 * Un-complete sits BELOW delete's row and owns its own guard: it is the one
 * action here whose consequence reaches past this workout (a rolled-back
 * block week), and that guard is gated on the cascade actually existing —
 * see `UncompleteSession`.
 */
export function WorkoutActions({ id }: { id: string }) {
  const t = useTranslations('WorkoutActions')
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
      setError(t('deleteError'))
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
      setTemplateError(t('templateError'))
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <Link href={`/workout/new?from=${id}`} className={cn(buttonVariants(), 'w-full gap-2')}>
        <RotateCcw aria-hidden="true" className="size-4" />
        {t('repeatAction')}
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
        {isTemplatePending ? t('templateActionPending') : t('templateAction')}
      </Button>
      {templateError && <p className="text-sm text-destructive">{templateError}</p>}
      <div className="flex items-center gap-2">
        <Link
          href={`/workout/${id}/edit`}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          {t('editAction')}
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
          {t('delete')}
        </Button>
      </div>
      {/* Reopening a finished session. Its own dialog, its own undo — the
          consequence that needs guarding is the cascade, not the delete. */}
      <UncompleteSession workoutId={id} />
      {isModalOpen && (
        <ConfirmDialog
          title={t('deleteDialog.title')}
          body={t('deleteDialog.body')}
          confirmLabel={t('deleteDialog.confirm')}
          pendingLabel={t('deleteDialog.pending')}
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
