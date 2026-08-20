'use client'

import { useEffect, useRef } from 'react'
import { NotebookPen, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The set-row long-press context menu (notes v2 grammar): a small anchored
 * popover — keep-list elevation, popovers earn a shell — with the row's
 * actions: note capture, the warm-up tag (a second door to the circle-hold's
 * TAG_SET; the circle keeps working), and remove. Fixed-positioned at the
 * press point (clamped to the viewport) because the row itself lives inside
 * SwipeToDelete's overflow-hidden clip.
 *
 * A transparent full-screen backdrop swallows the tap that dismisses it —
 * closing must never ALSO toggle a set circle or focus an input underneath.
 */

interface SetRowMenuProps {
  /** Press-point viewport coordinates the menu anchors to. */
  x: number
  y: number
  /** Which set the menu addresses, for accessible labels. */
  setLabel: string
  /** True when the set already carries a note — the item reads "Note · view". */
  hasNote: boolean
  /** True when the set is tagged warm-up — the item offers the way back. */
  isWarmup: boolean
  onNote: () => void
  onTagWarmup: () => void
  onRemove: () => void
  onClose: () => void
}

/** Menu box width (px) used for viewport clamping. */
const MENU_WIDTH = 176
/** Approximate menu height (3 × 44px items + padding) for bottom clamping. */
const MENU_HEIGHT = 148

export function SetRowMenu({
  x,
  y,
  setLabel,
  hasNote,
  isWarmup,
  onNote,
  onTagWarmup,
  onRemove,
  onClose,
}: SetRowMenuProps) {
  const t = useTranslations('SetRowMenu')
  const firstItemRef = useRef<HTMLButtonElement>(null)

  // Focus the first item so keyboard users aren't stranded; Escape closes.
  useEffect(() => {
    firstItemRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Clamp to the viewport so a press near an edge never renders off-screen.
  // Guarded for the static render (no window on the server).
  const viewportW = typeof window === 'undefined' ? 400 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight
  const left = Math.max(8, Math.min(x, viewportW - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, viewportH - MENU_HEIGHT - 8))

  const itemClass =
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hit-44-y active:bg-muted'

  return (
    <>
      {/* Backdrop: dismiss on press-down and swallow the paired click so it
          can't fall through to the logger underneath. */}
      <div
        className="fixed inset-0 z-40"
        onPointerDown={(e) => {
          e.preventDefault()
          onClose()
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      />
      <div
        role="menu"
        aria-label={t('ariaLabel', { set: setLabel })}
        style={{ left, top, width: MENU_WIDTH }}
        className={cn(
          // bg-popover + rounded-lg: popover elevation on the popover token —
          // the ratchet-clean vocabulary for a menu shell.
          'fixed z-50 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg',
          'motion-safe:animate-rise-in',
        )}
        // The menu swallows its own clicks — an item tap must never reach
        // the set row it visually covers.
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={firstItemRef}
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={onNote}
        >
          <NotebookPen aria-hidden="true" className="size-4 text-muted-foreground" />
          {hasNote ? t('noteView') : t('noteAdd')}
        </button>
        <button type="button" role="menuitem" className={itemClass} onClick={onTagWarmup}>
          <span
            aria-hidden="true"
            className="grid size-4 place-items-center text-xs font-semibold text-muted-foreground"
          >
            {t('warmupGlyph')}
          </span>
          {isWarmup ? t('warmupUntag') : t('warmupTag')}
        </button>
        <button
          type="button"
          role="menuitem"
          className={cn(itemClass, 'text-destructive')}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {t('remove')}
        </button>
      </div>
    </>
  )
}
