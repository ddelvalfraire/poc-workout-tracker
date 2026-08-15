'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * SessionToast — the in-session status strip family (#210). ONE component,
 * two modes, for the sticky bar's transient messages:
 *
 * - Undo toast (`countdown` set): auto-dismisses when the 2px volt hairline
 *   finishes draining across the bottom edge. The drain is a CSS animation
 *   (`toast-drain` in globals.css — the rest pill's scaleX depletion
 *   vocabulary) and dismissal fires from ITS animationend, so pausing the
 *   visual (hover/focus-within pauses `animation-play-state`) pauses the
 *   actual timer too — they can never disagree. Reduced motion swaps the
 *   hairline for a ticking "· 8s" text suffix driven by a plain interval.
 * - Prompt (`countdown` absent): persists until answered — no timer, no
 *   hairline, same skin.
 *
 * Skin: a hairline-bordered strip on the bar background — deliberately NOT
 * a card shell (no bg-card, no radius; DESIGN.md "hairlines not shells").
 * The drain hairline is the strips' only volt; the screen's solid volt
 * stays on Finish.
 *
 * Motion: enter rises 12px over 200ms; exit ACTUALLY PLAYS before unmount —
 * when `open` flips false the last-rendered content is kept on screen, the
 * exit animation runs (150ms drop-fade; `exit="quick"` = 100ms fade for
 * undo-pressed), and the node unmounts on animationend (timeout backstop, as
 * use-animated-sheet-close). Reduced motion: opacity-only both ways.
 *
 * A11y: `role="status"` lives on the strip and mounts WITH the content, so
 * assistive tech announces on entry and the exit animation can never cut an
 * announcement short (content is stale-cached during exit, not removed).
 */

interface SessionToastCountdown {
  /** The auto-dismiss window — also the drain animation's duration. */
  durationMs: number
  /** Bump to restart the window (e.g. every new removal on the shared stack). */
  resetKey: number
  /** The window elapsed — the owner clears the state, which plays the exit. */
  onExpire: () => void
}

interface SessionToastProps {
  /** Whether the strip has content to show; false plays the exit, then unmounts. */
  open: boolean
  /** Present = undo mode (drain hairline + auto-dismiss); absent = prompt mode. */
  countdown?: SessionToastCountdown
  /** Exit flavor: 'quick' is the 100ms undo-pressed fade. */
  exit?: 'default' | 'quick'
  children: ReactNode
}

/** Exit backstop, same shape as use-animated-sheet-close: longest exit + slack. */
const EXIT_BACKSTOP_MS = 240

/** Live media-query subscription; false until mounted (SSR-safe). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync; the listener drives later updates
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function SessionToast({ open, countdown, exit = 'default', children }: SessionToastProps) {
  const [phase, setPhase] = useState<'open' | 'exiting' | 'closed'>(open ? 'open' : 'closed')
  const reducedMotion = usePrefersReducedMotion()

  // The exit renders content the owner has already cleared (the removed[]
  // stack is empty by the time the toast fades), so the last open render's
  // children are cached here. A render-time ref write/read is normally a
  // hazard, but this is the deterministic "latest value" memo the exit frame
  // needs — state would demand a cascading setState per parent render, and
  // an effect would capture one frame too late (children are already gone).
  const lastChildrenRef = useRef<ReactNode>(null)
  // eslint-disable-next-line react-hooks/refs -- see above: exit-frame children cache
  if (open) lastChildrenRef.current = children

  // The owner's callback, by ref: the countdown effects must depend only on
  // the window's identity (resetKey/duration), never on the parent's render
  // cadence — an inline onExpire prop re-created per keystroke must not
  // restart the reduced-motion timer.
  const onExpire = countdown?.onExpire
  const onExpireRef = useRef<(() => void) | undefined>(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    // Presence state machine: `open` is the external signal; the phase must
    // lag it through 'exiting' so the exit animation gets its frames.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open→phase sync IS this component's job
    if (open) setPhase('open')
    else setPhase((prev) => (prev === 'open' ? 'exiting' : prev))
  }, [open])

  // Backstop: animationend can be lost (throttled tab, interrupted
  // animation) — the unmount must not be.
  useEffect(() => {
    if (phase !== 'exiting') return
    const id = setTimeout(() => setPhase('closed'), EXIT_BACKSTOP_MS)
    return () => clearTimeout(id)
  }, [phase])

  // Reduced motion: the drain hairline never runs, so its animationend can't
  // drive dismissal — a plain timeout stands in (per the direction doc), plus
  // a 1s tick for the "· 8s" text suffix.
  const durationMs = countdown?.durationMs
  const resetKey = countdown?.resetKey
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  useEffect(() => {
    if (!reducedMotion || !open || durationMs === undefined) return
    const startedAt = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the tick for this window; the interval drives later updates
    setRemainingSec(Math.ceil(durationMs / 1_000))
    const id = setInterval(() => {
      const left = Math.ceil((durationMs - (Date.now() - startedAt)) / 1_000)
      if (left <= 0) {
        clearInterval(id)
        onExpireRef.current?.()
      } else {
        setRemainingSec(left)
      }
    }, 1_000)
    return () => clearInterval(id)
  }, [reducedMotion, open, durationMs, resetKey])

  if (phase === 'closed') return null

  return (
    <div
      role="status"
      className={cn(
        // `session-toast` scopes the pause-on-hover/focus rule for the drain
        // (globals.css); border-y = the hairline strip, no shell.
        'session-toast relative mb-3 border-y border-border px-1 py-2.5',
        'motion-safe:animate-toast-in motion-reduce:animate-fade-in',
        phase === 'exiting' && (exit === 'quick' ? 'toast-exit-quick' : 'toast-exit'),
      )}
      onAnimationEnd={(event) => {
        // The drain child's animationend bubbles here — only the strip's OWN
        // exit animation may unmount it.
        if (phase === 'exiting' && event.target === event.currentTarget) setPhase('closed')
      }}
    >
      {/* eslint-disable-next-line react-hooks/refs -- exit-frame children cache (see the ref's comment) */}
      {open ? children : lastChildrenRef.current}
      {/* Reduced-motion countdown voice: a ticking seconds suffix. aria-hidden
          keeps the once-a-second churn out of the live region — the message
          itself is the announcement, not the timer. */}
      {reducedMotion && open && countdown && remainingSec !== null && (
        <span
          aria-hidden="true"
          className="mt-1 block text-right text-xs text-muted-foreground tnum"
        >
          · {remainingSec}s
        </span>
      )}
      {/* The drain hairline: 2px of volt emptying left-to-right over the undo
          window, riding the strip's bottom hairline. animationend IS the
          dismiss signal, so the CSS hover/focus pause holds the window open
          too. Keyed by resetKey so a new removal restarts the drain (and with
          it, the window). Hidden under reduced motion (CSS + the JS branch
          above). Exit renders without it — the window is already spent. */}
      {open && countdown && !reducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
        >
          <div
            key={countdown.resetKey}
            className="toast-drain h-full w-full bg-primary"
            style={{ animationDuration: `${countdown.durationMs}ms` }}
            onAnimationEnd={() => onExpireRef.current?.()}
          />
        </div>
      )}
    </div>
  )
}
