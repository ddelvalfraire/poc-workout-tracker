'use client'

import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, ArrowUpToLine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAnimatedSheetClose } from '@/components/use-animated-sheet-close'
import {
  HOME_SECTION_SIZES,
  type HomeSectionMeta,
  type HomeSectionSize,
} from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * Bottom sheet for one home section, opened by tapping its tile in the grid
 * preview. The dialog mechanics (showModal, StrictMode guard, geometric
 * backdrop dismiss, scroll lock, close() in cleanup) are copied from
 * rest-sheet.tsx verbatim: one dialog recipe, no per-sheet drift.
 *
 * Everything here is CONTROLLED — the editor owns sections state and
 * persistence; the sheet just fires intents. It stays open across
 * interactions (move twice, resize, then hide — one visit), reflecting the
 * live section each render. The Move buttons are the WCAG 2.5.7 non-drag
 * path and remain even once drag ships — drag is an enhancement, never the
 * only way to reorder.
 */

interface TileSheetProps {
  meta: HomeSectionMeta
  section: ResolvedHomeSection
  /** Position among ALL sections (hidden included) — gates the move buttons. */
  index: number
  count: number
  onClose: () => void
  onSize: (size: HomeSectionSize) => void
  onToggle: () => void
  onMove: (direction: 'up' | 'down') => void
  onMoveToTop: () => void
}

export function TileSheet({
  meta,
  section,
  index,
  count,
  onClose,
  onSize,
  onToggle,
  onMove,
  onMoveToTop,
}: TileSheetProps) {
  const t = useTranslations('TileSheet')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, onClose)
  // Hoisted out of JSX: these carry the intent's DIRECTION, not copy — inline
  // they read to the extraction gate as untranslated strings.
  const moveUp = () => onMove('up')
  const moveDown = () => onMove('down')

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert. Manual body scroll lock, initial focus
  // on the visible ×, focus restore on unmount — the rest-sheet recipe.
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
      aria-label={t('dialogLabel', { section: meta.title })}
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
            {meta.title}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
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

      {/* S/M/L segmented control — the goal-kind picker's radio vocabulary.
          Sizes outside allowedSizes stay visible but disabled: the control
          keeps its shape, the gating stays legible. */}
      <div
        role="radiogroup"
        aria-label={t('sizeGroupLabel', { section: meta.title })}
        className="mt-3 flex gap-1.5"
      >
        {HOME_SECTION_SIZES.map((size) => {
          const isAllowed = meta.allowedSizes.includes(size)
          return (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={section.size === size}
              aria-label={t('sizeOptionLabel', { section: meta.title, size })}
              disabled={!isAllowed}
              onClick={() => onSize(size)}
              className={cn(
                'relative w-11 rounded-lg border py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors before:absolute before:-inset-1',
                'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                section.size === size
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground',
                !isAllowed && 'opacity-30',
              )}
            >
              {t(`sizeLabel.${size}`)}
            </button>
          )
        })}
      </div>

      {/* Visibility — the settings switch vocabulary. A hidden section keeps
          its place in the order, dimmed on the grid. */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="min-w-0">
          <p className="text-sm">{t('visibility.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('visibility.hint')}
          </p>
        </div>
        <VisibilitySwitch
          label={t('visibility.ariaLabel', { section: meta.title })}
          checked={!section.hidden}
          onToggle={onToggle}
        />
      </div>

      {/* Reorder — real buttons, always present (WCAG 2.5.7: dragging is
          never the only path). Edges disable, they don't hide. */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4 pb-4">
        <MoveButton
          label={t('move.upLabel', { section: meta.title })}
          disabled={index === 0}
          onClick={moveUp}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
          {t('move.up')}
        </MoveButton>
        <MoveButton
          label={t('move.downLabel', { section: meta.title })}
          disabled={index === count - 1}
          onClick={moveDown}
        >
          <ArrowDown aria-hidden="true" className="size-4" />
          {t('move.down')}
        </MoveButton>
        <MoveButton
          label={t('move.toTopLabel', { section: meta.title })}
          disabled={index === 0}
          onClick={onMoveToTop}
        >
          <ArrowUpToLine aria-hidden="true" className="size-4" />
          {t('move.toTop')}
        </MoveButton>
      </div>
    </dialog>
  )
}

/** One reorder intent: bordered chip-button (chips are controls), icon + word
 *  so the verb survives without color. */
function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        disabled ? 'opacity-30' : 'hover:bg-muted/50 active:bg-muted/60',
      )}
    >
      {children}
    </button>
  )
}

/** The settings switch vocabulary (RestTimerToggle's track/thumb, verbatim)
 *  as a controlled presentational switch — carried over from the list editor. */
function VisibilitySwitch({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      // 44px effective target via the invisible inset on a compact track.
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors before:absolute before:-inset-2',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
          checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
        )}
      />
    </button>
  )
}
