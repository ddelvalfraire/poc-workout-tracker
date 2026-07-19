'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { GuardedStartLink } from '@/components/guarded-start-link'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import { cn } from '@/lib/utils'
import { updateTemplateMetaAction, deleteTemplateAction } from '@/app/templates/actions'

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
 * guard), a small inline Edit form (name/description/icon → meta action),
 * and Delete behind ConfirmDialog. Kept as one island so the detail page
 * stays a Server Component; navigation follows the await-then-navigate rule
 * (never inside a transition — see workout-actions.tsx).
 */
export function TemplateActions({ template, session }: TemplateActionsProps) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState(template.icon ?? '')
  const [description, setDescription] = useState(template.description ?? '')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const closeDialogRef = useRef<(() => void) | null>(null)

  async function handleSave() {
    setIsPending(true)
    setError(null)
    try {
      await updateTemplateMetaAction(template.id, {
        name,
        // Blank optionals clear: the boundary maps '' → omitted → null.
        description,
        icon,
      })
      setIsEditing(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save changes. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

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

      {isEditing ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="mt-1"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Icon
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={16}
              placeholder="💪"
              className="mt-1"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Description
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1"
            />
          </label>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={isPending}
              onClick={() => {
                // Discard edits: reset to the server truth this page rendered.
                setName(template.name)
                setIcon(template.icon ?? '')
                setDescription(template.description ?? '')
                setError(null)
                setIsEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={isPending || name.trim().length === 0}
              onClick={handleSave}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
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
