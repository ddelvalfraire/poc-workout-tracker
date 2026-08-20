'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAnimatedSheetClose } from '@/components/use-animated-sheet-close'
import { updateTemplateMetaAction } from '@/app/templates/actions'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * Bottom-sheet editor for a template's name/icon/description — the inline
 * edit card promoted into the app's one dialog vocabulary (native <dialog> +
 * showModal(), mechanics copied from plate-sheet.tsx: browser-owned focus
 * trap and inertness, manual body scroll lock, animated dismissal, geometric
 * backdrop light-dismiss). The icon field keeps free text but leads with a
 * curated emoji quick-pick — one tap covers the common case, typing covers
 * the rest.
 */

/** The quick-pick row — training-flavored, one row on a phone. */
const ICON_CHOICES = ['💪', '🏋️', '🦵', '🔥', '🫀', '🏃', '🧗', '⚡'] as const

// The description textarea retired onto the notes editor (plan §7): markdown
// in/out, quick variant (marks only). Dynamic so TipTap only loads when this
// sheet actually opens.
const NotesEditor = dynamic(
  () => import('@/components/editor/notes-editor').then((m) => m.NotesEditor),
  {
    ssr: false,
    loading: () => <div aria-hidden="true" className="min-h-24 rounded-lg border border-border" />,
  },
)

interface TemplateEditSheetProps {
  template: {
    id: string
    name: string
    description: string | null
    icon: string | null
  }
  /** Fired after close (cancel or save); `saved` tells the parent to refresh. */
  onClose: (saved: boolean) => void
}

export function TemplateEditSheet({ template, onClose }: TemplateEditSheetProps) {
  const t = useTranslations('TemplateEditSheet')
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState(template.icon ?? '')
  const [description, setDescription] = useState(template.description ?? '')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedRef = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, () => onClose(savedRef.current))

  // Same mount mechanics as plate-sheet.tsx: StrictMode-guarded showModal,
  // manual body scroll lock (dialog doesn't lock it), initial focus on the
  // safe default, and close() + focus restore in cleanup.
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
      await updateTemplateMetaAction(template.id, {
        name,
        // Blank optionals clear: the boundary maps '' → omitted → null.
        description,
        icon,
      })
      savedRef.current = true
      requestClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('saveError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('ariaLabel', { name: template.name })}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        requestClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // sheet's own padding also target the dialog element and must not
        // dismiss it (plate-sheet's light-dismiss rule).
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
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {t('eyebrow')}
          </p>
          <h3 className="mt-0.5 text-lg leading-tight">{template.name}</h3>
        </div>
        <Button
          ref={closeButtonRef}
          size="icon-sm"
          variant="ghost"
          className="-mr-1 text-muted-foreground"
          onClick={requestClose}
          aria-label={t('close')}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <label className="mt-3 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t('nameLabel')}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="mt-1"
        />
      </label>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('iconLabel')}
        </legend>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setIcon(icon === choice ? '' : choice)}
              aria-pressed={icon === choice}
              aria-label={t('iconChoiceAriaLabel', { icon: choice })}
              className={cn(
                'rounded-xl border px-2.5 py-1.5 text-xl leading-none transition-colors',
                icon === choice
                  ? 'border-primary bg-primary/15'
                  : 'border-border bg-muted/40 active:bg-muted',
              )}
            >
              {choice}
            </button>
          ))}
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            maxLength={16}
            placeholder={t('iconPlaceholder')}
            aria-label={t('iconFieldLabel')}
            className="w-20"
          />
        </div>
      </fieldset>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('descriptionLabel')}
        </p>
        <div className="mt-1">
          <NotesEditor
            variant="quick"
            initialMarkdown={description}
            onChangeMarkdown={setDescription}
            ariaLabel={t('descriptionAriaLabel', { name: template.name })}
          />
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex gap-2 pb-2">
        <Button variant="outline" className="flex-1" disabled={isPending} onClick={requestClose}>
          {t('cancel')}
        </Button>
        <Button
          className="flex-1"
          disabled={isPending || name.trim().length === 0}
          onClick={handleSave}
        >
          {isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </dialog>
  )
}
