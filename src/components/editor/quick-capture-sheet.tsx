'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAnimatedSheetClose } from '@/components/use-animated-sheet-close'
import { cn } from '@/lib/utils'
import type { NotesEditorVariant } from './extensions'
import { useTranslations } from 'next-intl'

/**
 * Bottom-sheet note editor (QuickCapture) — the app's one dialog vocabulary
 * (native <dialog> + showModal(), mechanics copied from plate-sheet.tsx /
 * template-edit-sheet.tsx: browser-owned focus trap, manual body scroll lock,
 * animated dismissal, geometric backdrop light-dismiss).
 *
 * TipTap loads ONLY here, on demand: the editor is a next/dynamic import that
 * resolves after the sheet mounts, so surfaces that merely SHOW notes ship
 * zero editor bytes. Markdown strings in and out — the sheet never sees
 * editor JSON.
 */
const NotesEditor = dynamic(() => import('./notes-editor').then((m) => m.NotesEditor), {
  ssr: false,
  // Reserve the editor's min height so the sheet doesn't jump when the chunk
  // lands (CLS discipline).
  loading: () => <div aria-hidden="true" className="min-h-24 rounded-lg border border-border" />,
})

interface QuickCaptureSheetProps {
  /** Sheet heading — usually the exercise name. */
  title: string
  /** Small caps context line above the title (e.g. "Exercise note"). */
  eyebrow: string
  /** Editor variant: quick (marks only) or full (+ headings). */
  variant?: NotesEditorVariant
  initialBody: string
  initialPinned: boolean
  /** Hide the pin control on surfaces where pinning has no meaning. */
  showPinToggle?: boolean
  /** Persists the note; throwing keeps the sheet open with an inline error. */
  onSave: (value: { body: string; pinned: boolean }) => Promise<void>
  /** When present, a Delete control removes the note entirely. */
  onDelete?: () => Promise<void>
  /** Fired after close (cancel, save, or delete); `saved` = anything changed. */
  onClose: (saved: boolean) => void
}

export function QuickCaptureSheet({
  title,
  eyebrow,
  variant = 'quick',
  initialBody,
  initialPinned,
  showPinToggle = true,
  onSave,
  onDelete,
  onClose,
}: QuickCaptureSheetProps) {
  const t = useTranslations('QuickCaptureSheet')
  const tCommon = useTranslations('Common')
  const [body, setBody] = useState(initialBody)
  const [pinned, setPinned] = useState(initialPinned)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedRef = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, () => onClose(savedRef.current))

  // Same mount mechanics as plate-sheet.tsx: StrictMode-guarded showModal,
  // manual body scroll lock, initial focus on the safe default, and
  // close() + focus restore in cleanup.
  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer (the #25 stranded-::backdrop rule).
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  async function handleSave() {
    setIsPending(true)
    setError(null)
    try {
      await onSave({ body, pinned })
      savedRef.current = true
      requestClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('saveError'))
    } finally {
      setIsPending(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setIsPending(true)
    setError(null)
    try {
      await onDelete()
      savedRef.current = true
      requestClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('deleteError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('dialogLabel', { eyebrow, title })}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        requestClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog` (plate-sheet's
        // light-dismiss rule): taps in the sheet's own padding must not close.
        const rect = dialogRef.current?.getBoundingClientRect()
        if (!rect) return
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) requestClose()
      }}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 pb-safe text-foreground backdrop:bg-black/60 motion-safe:animate-sheet-up"
    >
      <div className="flex items-start justify-between gap-3 pb-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
          <h3 className="mt-0.5 text-lg leading-tight">{title}</h3>
        </div>
        <Button
          ref={closeButtonRef}
          size="icon-sm"
          variant="ghost"
          className="-mr-1 text-muted-foreground"
          onClick={requestClose}
          aria-label={tCommon('close')}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div className="mt-2">
        <NotesEditor
          variant={variant}
          initialMarkdown={initialBody}
          onChangeMarkdown={setBody}
          ariaLabel={t('editorLabel', { eyebrow, title })}
          autofocus
        />
      </div>

      {showPinToggle && (
        <button
          type="button"
          onClick={() => setPinned((p) => !p)}
          aria-pressed={pinned}
          className={cn(
            'mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest transition-colors',
            pinned ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Pin aria-hidden="true" className="size-3.5" />
          {pinned ? t('pinActionActive') : t('pinAction')}
        </button>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex gap-2 pb-2">
        {onDelete && (
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {t('delete')}
          </Button>
        )}
        <Button variant="outline" className="flex-1" disabled={isPending} onClick={requestClose}>
          {tCommon('cancel')}
        </Button>
        <Button
          className="flex-1"
          disabled={isPending || body.trim().length === 0}
          onClick={handleSave}
        >
          {isPending ? t('savingAction') : t('save')}
        </Button>
      </div>
    </dialog>
  )
}
