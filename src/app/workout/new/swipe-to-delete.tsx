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
  const start = useRef<{ x: number; y: number; locked: 'h' | 'v' | null } | null>(null)

  function reset() {
    setDx(0)
    setIsDragging(false)
    start.current = null
  }

  return (
    <div className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {/* Destructive backdrop revealed by the drag — visual affordance only;
          the actionable element is the gesture (and the row's own X). */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 flex items-center justify-end rounded-lg bg-destructive/15 pr-4 text-sm font-semibold text-destructive',
          dx === 0 && 'invisible',
        )}
      >
        Remove
      </div>
      <div
        className={cn(!isDragging && 'transition-transform duration-150')}
        style={{ transform: dx === 0 ? undefined : `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          const touch = e.touches[0]
          start.current = { x: touch.clientX, y: touch.clientY, locked: null }
        }}
        onTouchMove={(e) => {
          const origin = start.current
          if (!origin) return
          const touch = e.touches[0]
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
        onTouchEnd={() => {
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
