'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Swipe-left-to-remove wrapper for logger set rows (Hevy's set-row idiom).
 * Touch-only by design: `touch-action: pan-y` leaves vertical scrolling to
 * the browser, and an 8px directional lock keeps diagonal scrolls from
 * half-dragging rows. Crossing the threshold fires `onDelete` on release —
 * no confirm, because the logger's undo stack already covers mistakes.
 * Mouse/keyboard/screen-reader users keep the visible remove button the
 * caller renders inside the row; this adds a faster path, replaces nothing.
 */

interface SwipeToDeleteProps {
  onDelete: () => void
  children: ReactNode
}

/** Drag distance (px) that commits the delete on release. */
const TRIGGER_PX = 72
/** Movement (px) before the gesture locks horizontal or vertical. */
const LOCK_PX = 8

export function SwipeToDelete({ onDelete, children }: SwipeToDeleteProps) {
  const [dx, setDx] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const start = useRef<{ id: number; x: number; y: number; locked: 'h' | 'v' | null } | null>(
    null,
  )

  function reset() {
    setDx(0)
    setIsDragging(false)
    start.current = null
  }

  return (
    // Negative margin + matching padding on the slider: the clip bounds sit
    // OUTSIDE the row's box, so input focus rings and the buttons' invisible
    // before:-inset tap-target expansions aren't sheared off at the edges.
    <div className="relative -mx-2 -my-1 overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {/* Destructive backdrop revealed by the drag — visual affordance only;
          the actionable element is the gesture (and the row's own X). */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 inset-x-2 flex items-center justify-end rounded-lg bg-destructive/15 pr-4 text-sm font-semibold text-destructive',
          dx === 0 && 'invisible',
        )}
      >
        Remove
      </div>
      <div
        className={cn('px-2 py-1', !isDragging && 'transition-transform duration-150')}
        style={{ transform: dx === 0 ? undefined : `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          // One finger owns the gesture; a second touchdown must not re-seed
          // the origin (a large spurious delta would look like a fast swipe).
          if (start.current) return
          // Never start from an input or button: a horizontal drag inside a
          // focused weight field is cursor placement, not a delete.
          if (e.target instanceof Element && e.target.closest('input, button, select, a')) return
          const touch = e.changedTouches[0]
          start.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, locked: null }
        }}
        onTouchMove={(e) => {
          const origin = start.current
          if (!origin) return
          // Track OUR finger by identifier — touches[0] is not guaranteed to
          // stay the same physical finger once a second one lands.
          const touch = Array.from(e.touches).find((t) => t.identifier === origin.id)
          if (!touch) return
          const moveX = touch.clientX - origin.x
          const moveY = touch.clientY - origin.y
          if (origin.locked === null) {
            if (Math.abs(moveX) < LOCK_PX && Math.abs(moveY) < LOCK_PX) return
            origin.locked = Math.abs(moveX) > Math.abs(moveY) ? 'h' : 'v'
            if (origin.locked === 'h') setIsDragging(true)
          }
          // Left-only: rightward drags clamp to rest so there's no bounce.
          if (origin.locked === 'h') setDx(Math.min(0, moveX))
        }}
        onTouchEnd={(e) => {
          const origin = start.current
          if (!origin) return
          // Only OUR finger lifting ends the gesture.
          if (!Array.from(e.changedTouches).some((t) => t.identifier === origin.id)) return
          if (dx <= -TRIGGER_PX) onDelete()
          reset()
        }}
        onTouchCancel={reset}
      >
        {children}
      </div>
    </div>
  )
}
