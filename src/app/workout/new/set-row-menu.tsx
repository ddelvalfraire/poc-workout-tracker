'use client'

import { useEffect, useRef } from 'react'
import { NotebookPen, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { TECHNIQUE_KINDS, TECHNIQUE_LABEL_KEY, type TechniqueKind } from '@/lib/technique'

/**
 * The set-row long-press context menu (notes v2 grammar): a small anchored
 * popover — keep-list elevation, popovers earn a shell — with the row's
 * actions: note capture, the SET-TYPE picker (warm-up plus the four intensity
 * techniques — a second door to the circle-hold's TAG_SET; the circle keeps
 * working), and remove. Fixed-positioned at the press point (clamped to the
 * viewport) because the row itself lives inside SwipeToDelete's
 * overflow-hidden clip.
 *
 * The technique arm follows Hevy's grammar exactly: a technique is a property
 * of the ROW, picked from the set number's menu, and a stage CONTINUES the
 * set above it — so the items are hidden on an exercise's first set, which
 * has nothing to continue.
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
  /** The technique this row is a stage of, or null for an ordinary set. */
  techniqueKind: TechniqueKind | null
  /** False on an exercise's first set: a stage continues the set above it,
   *  and there is none — the technique items don't render at all. */
  canTagTechnique: boolean
  onNote: () => void
  onTagWarmup: () => void
  /** Picks a technique for this row, or clears it with a null kind. */
  onTagTechnique: (kind: TechniqueKind | null) => void
  onRemove: () => void
  onClose: () => void
}

/** Menu box width (px) used for viewport clamping. */
const MENU_WIDTH = 176
/** Approximate item height (px) — the menu grows by one per offered item, so
 *  the bottom clamp has to grow with it. */
const MENU_ITEM_HEIGHT = 44

export function SetRowMenu({
  x,
  y,
  setLabel,
  hasNote,
  isWarmup,
  techniqueKind,
  canTagTechnique,
  onNote,
  onTagWarmup,
  onTagTechnique,
  onRemove,
  onClose,
}: SetRowMenuProps) {
  const t = useTranslations('SetRowMenu')
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Focus the first item so keyboard users aren't stranded; Escape closes.
  // Arrow keys rove between items (wrapping) — role="menu" promises the
  // ARIA menu keyboard model, not just Tab order.
  useEffect(() => {
    firstItemRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const menu = menuRef.current
      if (!menu) return
      e.preventDefault()
      const items = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
      )
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      // A focus outside the menu (current === -1) enters at the first item
      // going down and the last going up, matching the ARIA pattern.
      const next =
        current === -1
          ? delta === 1
            ? 0
            : items.length - 1
          : (current + delta + items.length) % items.length
      items[next]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Clamp to the viewport so a press near an edge never renders off-screen.
  // Guarded for the static render (no window on the server).
  const viewportW = typeof window === 'undefined' ? 400 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight
  const left = Math.max(8, Math.min(x, viewportW - MENU_WIDTH - 8))
  // note + warm-up + remove, plus one row per offered technique.
  const itemCount = 3 + (canTagTechnique ? TECHNIQUE_KINDS.length : 0)
  const top = Math.max(8, Math.min(y, viewportH - itemCount * MENU_ITEM_HEIGHT - 16))

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
        ref={menuRef}
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
        {/* The technique arm of the picker: one item per kind, each a
            toggle — picking the kind this row already carries clears it, the
            same way the warm-up item offers the way back. A hairline separates
            the roles (warm-up) from the techniques; no second shell. */}
        {canTagTechnique && (
          <div className="mt-1 border-t border-border pt-1">
            {TECHNIQUE_KINDS.map((kind) => {
              const active = techniqueKind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={cn(itemClass, active && 'text-primary')}
                  onClick={() => onTagTechnique(active ? null : kind)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-4 place-items-center text-xs font-semibold',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {t(`techniqueGlyph.${TECHNIQUE_LABEL_KEY[kind]}`)}
                  </span>
                  {t(`technique.${TECHNIQUE_LABEL_KEY[kind]}`)}
                </button>
              )
            })}
          </div>
        )}
        <button
          type="button"
          role="menuitem"
          className={cn(itemClass, 'text-destructive', 'mt-1 border-t border-border')}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {t('remove')}
        </button>
      </div>
    </>
  )
}
