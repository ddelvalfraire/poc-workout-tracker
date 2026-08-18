'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  NOTE_TAG_TOKENS,
  insertToken,
  noteBreadcrumb,
  type NoteScope,
} from './note-capture'

/**
 * The notes-v2 capture sheet: a half-height NON-MODAL bottom sheet over the
 * live session (no <dialog>/showModal, no dim scrim — the session stays
 * visible and interactive behind it; the drafts' "no dim-to-black" rule).
 * Distinct from QuickCaptureSheet (the modal markdown identity-note editor):
 * this is the plain-text instance dialect, keyboard-first.
 *
 * Journal semantics: drag-down (or Escape) SAVES non-empty text — never a
 * discard confirm; empty text closes silently. The save receipt is the set
 * row's dot popping in (the logger owns that) — no toast.
 */

interface NoteSheetProps {
  /** The anchored exercise's name, for the breadcrumb. */
  exerciseName: string
  /** 1-based set number of the pressed row, for the breadcrumb. */
  setNumber: number
  /** The anchored set's snapshot subtitle ("185 lb × 6 · RPE 9"), or null. */
  snapshot: string | null
  /** Scope the sheet opens on (where you pressed — most specific wins). */
  initialScope: NoteScope
  /** Text seeding the field (an existing set note reopened for viewing/edit). */
  initialBody?: string
  /** Fired with the final scope + trimmed body on Save/drag-down/Escape when
   *  the body is non-empty. The logger routes it to the scope's store. */
  onSave: (scope: NoteScope, body: string) => void
  onClose: () => void
}

/** Downward drag (px) past which release dismisses (and saves) the sheet. */
const DRAG_DISMISS_PX = 64

const SCOPES: NoteScope[] = ['set', 'exercise', 'workout']

export function NoteSheet({
  exerciseName,
  setNumber,
  snapshot,
  initialScope,
  initialBody = '',
  onSave,
  onClose,
}: NoteSheetProps) {
  const [scope, setScope] = useState<NoteScope>(initialScope)
  const [body, setBody] = useState(initialBody)
  const [dragY, setDragY] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragStartRef = useRef<number | null>(null)

  /** The one exit: persist non-empty text to the current scope, then close.
   *  Empty → close silently (a note with no words is not a note). */
  function dismiss() {
    const trimmed = body.trim()
    if (trimmed !== '') onSave(scope, trimmed)
    onClose()
  }

  function handleTagTap(token: string) {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? body.length
    const end = textarea?.selectionEnd ?? body.length
    const next = insertToken(body, start, end, token)
    setBody(next.text)
    // Keep writing where the token landed — the chip must not steal the flow.
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(next.caret, next.caret)
    })
  }

  const scopeLabel = (s: NoteScope) =>
    s === 'set' ? `Set ${setNumber}` : s === 'exercise' ? 'Exercise' : 'Workout'

  return (
    // Non-modal: fixed above the sticky bar, session live behind it. The
    // max-w-md/mx-auto pair matches the logger column so the sheet reads as
    // part of the same surface.
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Note for ${noteBreadcrumb(scope, exerciseName, setNumber)}`}
      className={cn(
        // bg-popover (not bg-card): overlay elevation is this surface's
        // point — the popover token is the ratchet-clean way to say it.
        'fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md rounded-t-2xl border-x border-t border-border bg-popover px-5 pb-safe shadow-lg',
        dragY === 0 && 'motion-safe:animate-sheet-up',
      )}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      onKeyDown={(e) => {
        // Escape = dismiss = journal save, never a discard prompt.
        if (e.key === 'Escape') {
          e.preventDefault()
          dismiss()
        }
      }}
    >
      {/* Grab zone: the handle + header rows own the drag-down-to-save
          gesture (the textarea keeps its own touch scrolling). */}
      <div
        className="touch-none"
        onPointerDown={(e) => {
          dragStartRef.current = e.clientY
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (dragStartRef.current === null) return
          setDragY(Math.max(0, e.clientY - dragStartRef.current))
        }}
        onPointerUp={() => {
          const passed = dragY >= DRAG_DISMISS_PX
          dragStartRef.current = null
          setDragY(0)
          if (passed) dismiss()
        }}
        onPointerCancel={() => {
          dragStartRef.current = null
          setDragY(0)
        }}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30"
        />
        <div className="flex items-baseline gap-2 pt-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Note
          </span>
          <span className="min-w-0 truncate font-display text-sm font-semibold uppercase tracking-wider">
            {noteBreadcrumb(scope, exerciseName, setNumber)}
          </span>
        </div>
        {scope === 'set' && snapshot !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground tnum">{snapshot}</p>
        )}
      </div>

      {/* Scope chips: default = where you pressed; switching changes the
          pending anchor, the text follows. Muted On state (effort-chips
          precedent) — Save below is this sheet's one volt. */}
      <div className="mt-3 flex gap-2">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={cn(
              'relative h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors before:absolute before:-inset-1',
              scope === s
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {scopeLabel(s)}
          </button>
        ))}
      </div>

      {/* Borderless field, autofocused during the present animation.
          text-base = 16px — under that iOS zooms the whole page on focus. */}
      <textarea
        ref={textareaRef}
        // Keyboard-first capture: focus during the present animation is the
        // sheet's contract (WWDC21 non-modal detents; Things 3 quick entry).
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add note…"
        aria-label="Note text"
        className="mt-2 block w-full resize-none border-0 bg-transparent px-0 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      {/* Accessory row: tag chips insert their token inline at the caret
          (the body carries its metadata) + the volt Save. */}
      <div className="flex items-center gap-2 border-t border-border/60 pb-4 pt-3">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {NOTE_TAG_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => handleTagTap(token)}
              aria-label={`Insert ${token} tag`}
              className="relative h-9 shrink-0 rounded-full border border-border bg-muted px-3 text-sm text-muted-foreground transition-colors before:absolute before:-inset-1 active:bg-muted/60"
            >
              {token}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="relative ml-auto h-9 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground before:absolute before:-inset-1"
        >
          Save
        </button>
      </div>
    </div>
  )
}
