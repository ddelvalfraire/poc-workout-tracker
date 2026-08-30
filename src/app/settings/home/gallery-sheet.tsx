'use client'

import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAnimatedSheetClose } from '@/components/ui/use-animated-sheet-close'
import type { HomeSectionMeta } from '@/lib/home/registry'
import { useTranslations } from 'next-intl'

/**
 * The widget gallery: everything not currently on your home, offered back.
 *
 * The dialog mechanics (showModal, StrictMode guard, geometric backdrop
 * dismiss, scroll lock, close() in cleanup) are the tile-sheet recipe
 * verbatim — one dialog vocabulary in this editor, no per-sheet drift.
 *
 * ADDING MEANS TWO DIFFERENT THINGS, and the registry decides which: a
 * once-only widget is un-hidden, while a repeatable one gains a whole new
 * instance. That is why a repeatable kind stays listed here even when it is
 * already on your home — a second lift-trend pinned to a second lift is a
 * legitimate thing to want, and it is the entire reason sections carry ids.
 *
 * Controlled, like the tile sheet: the editor owns state and persistence, and
 * this only fires intents.
 */
export function GallerySheet({
  addable,
  onAdd,
  onClose,
}: {
  /** What can be added right now, with a flag for the repeatable kinds that
   *  are already present — they read as "add another", not "add". */
  addable: readonly { meta: HomeSectionMeta; isAnother: boolean }[]
  onAdd: (kind: string) => void
  onClose: () => void
}) {
  const t = useTranslations('GallerySheet')
  const tCommon = useTranslations('Common')
  const tSection = useTranslations('HomeSection')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, onClose)

  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    // StrictMode re-runs effects against the SAME node; showModal() on an
    // already-open dialog throws InvalidStateError.
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer: unmounting a modal dialog without
      // close() can strand its ::backdrop over the page, eating every tap.
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('dialogLabel')}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        requestClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // sheet's own padding also target the dialog element and must not
        // dismiss it.
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
            {t('title')}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('hint')}</p>
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

      {addable.length === 0 ? (
        // Everything is already on your home. Saying so beats an empty box.
        <p className="mt-4 border-t border-border/60 pt-4 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {addable.map(({ meta, isAnother }) => {
            const name = tSection(meta.titleKey)
            return (
              <li key={meta.kind}>
                <button
                  type="button"
                  onClick={() => onAdd(meta.kind)}
                  aria-label={
                    isAnother
                      ? t('addAnotherAriaLabel', { section: name })
                      : t('addAriaLabel', { section: name })
                  }
                  className="flex w-full items-center gap-3 border-b border-b-border/60 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {isAnother ? t('anotherLabel', { section: name }) : name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {tSection(meta.descriptionKey)}
                    </span>
                  </span>
                  <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </dialog>
  )
}
