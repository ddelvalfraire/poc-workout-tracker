'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { GuardedStartLink } from '@/components/guarded-start-link'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import { cn } from '@/lib/utils'
import { deleteTemplateAction } from '@/app/templates/actions'
import { TemplateEditSheet } from './template-edit-sheet'

interface TemplateActionsProps {
  template: {
    id: string
    name: string
    description: string | null
    icon: string | null
  }
  /** Live session for the start guard, or null for a plain link. */
  session: SessionSummary | null
}

/**
 * Detail-page action island: Start (volt, through the single-active-session
 * guard), Edit in a bottom sheet (template-edit-sheet.tsx — the app's one
 * dialog vocabulary, replacing the old inline card), and Delete behind
 * ConfirmDialog. Kept as one island so the detail page stays a Server
 * Component; navigation follows the await-then-navigate rule (never inside
 * a transition — see workout-actions.tsx).
 */
export function TemplateActions({ template, session }: TemplateActionsProps) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const closeDialogRef = useRef<(() => void) | null>(null)

  async function handleDelete() {
    setIsDeleting(true)
    try {
      setDeleteError(null)
      await deleteTemplateAction(template.id)
      // Release the top layer before navigating (the #25 stranded-::backdrop
      // race — see ConfirmDialog's contract).
      closeDialogRef.current?.()
      setIsDeleteOpen(false)
      router.push('/templates')
      // isDeleting stays true on success: navigation unmounts this screen.
    } catch {
      setIsDeleting(false)
      setDeleteError('Could not delete template. Please try again.')
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <GuardedStartLink
        href={`/workout/new?template=${template.id}`}
        session={session}
        className={cn(buttonVariants(), 'w-full gap-2')}
      >
        <Play aria-hidden="true" className="size-4" />
        Start workout
      </GuardedStartLink>

      <div className="flex items-center gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setIsEditing(true)}>
          Edit details
        </Button>
        {/* Demoted on purpose: destructive never carries the same weight
            as the everyday action beside it. */}
        <Button
          variant="ghost"
          className="shrink-0 text-destructive"
          disabled={isDeleting}
          onClick={() => {
            setDeleteError(null)
            setIsDeleteOpen(true)
          }}
        >
          Delete
        </Button>
      </div>

      {isEditing && (
        <TemplateEditSheet
          template={template}
          onClose={(saved) => {
            setIsEditing(false)
            if (saved) router.refresh()
          }}
        />
      )}

      {isDeleteOpen && (
        <ConfirmDialog
          title="Delete this template?"
          body="Your logged workouts are untouched — only the template goes."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={deleteError}
          isPending={isDeleting}
          onConfirm={handleDelete}
          onClose={() => setIsDeleteOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </div>
  )
}
