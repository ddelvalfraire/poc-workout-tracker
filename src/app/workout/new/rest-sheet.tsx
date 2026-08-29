'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setDefaultRestSecAction } from '@/app/actions'
import { MAX_REST_SEC } from '@/lib/program-input'
import { isRestChimeEnabled, setRestChimeEnabled, unlockRestChime } from './rest-chime'
import { useAnimatedSheetClose } from '@/components/ui/use-animated-sheet-close'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * Bottom sheet for the session's rest target — the number the sticky bar's
 * rest pill counts down when the completed set has no per-set plan restSec.
 * Opened by tapping the pill's time area. The dialog mechanics (showModal, StrictMode
 * guard, geometric backdrop dismiss, scroll lock, close() in cleanup) are
 * copied from plate-sheet.tsx verbatim: two sheets, one behavior.
 *
 * Saving is OPTIMISTIC: the logger's session default updates the moment Save
 * is tapped (the countdown must react now, mid-rest, not after a round-trip);
 * the server persist is best-effort and a failure only surfaces as text here —
 * the session keeps the chosen target either way.
 */

/** The rest presets most lifters actually use, in seconds. null = Off (count-up only). */
const REST_PRESETS: (number | null)[] = [null, 60, 90, 120, 150, 180]

/** "90" → 90; null for anything non-integer or outside 0..3600 (the shared bound). */
export function parseCustomRest(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = parseInt(trimmed, 10)
  return value >= 0 && value <= MAX_REST_SEC ? value : null
}

interface RestSheetProps {
  /** The current session default, seeding the selected pill. */
  currentSec: number | null
  onClose: () => void
  /** Fired IMMEDIATELY on save (optimistic) so the running countdown reacts. */
  onSaved: (sec: number | null) => void
}

export function RestSheet({ currentSec, onClose, onSaved }: RestSheetProps) {
  const t = useTranslations('RestSheet')
  const tCommon = useTranslations('Common')
  // Pill selection is local until Save — mirroring the plate sheet's gear
  // editor, a cancelled sheet must not leak a half-picked target.
  const [selected, setSelected] = useState<number | null>(currentSec)
  const [customText, setCustomText] = useState('')
  // Device pref, not a saved target: applied on tap (no Save round-trip),
  // stored client-side by rest-chime. Sheet mounts are user-initiated, so
  // reading localStorage in the initializer never runs during hydration.
  const [chimeOn, setChimeOn] = useState(isRestChimeEnabled)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, onClose)

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert — a screen reader's virtual cursor can't
  // walk behind the sheet, which a hand-rolled Tab trap never guarantees.
  // We keep manual body scroll lock (dialog doesn't lock it), initial focus
  // on the visible ×, and focus restore on unmount.
  useEffect(() => {
    const dialog = dialogRef.current
    // Restore target: only an element OUTSIDE the dialog (on a StrictMode
    // re-run the active element is our own close button).
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
      // close() can strand its ::backdrop over the incoming page when the
      // unmount happens mid-navigation, eating every tap afterwards. The
      // manual focus restore stays as the fallback for targets close()'s
      // native restore doesn't cover.
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  async function handleSave() {
    // A filled custom field wins over the pills — typing IS choosing; making
    // the user also tap their own number would be a silent discard trap.
    let value = selected
    if (customText.trim() !== '') {
      const parsed = parseCustomRest(customText)
      if (parsed === null) {
        setError(t('validation', { max: MAX_REST_SEC }))
        return
      }
      value = parsed
    }
    setError(null)
    setIsSaving(true)
    // Optimistic: the running countdown adopts the target NOW; the server
    // write is durability, not permission.
    onSaved(value)
    try {
      await setDefaultRestSecAction(value)
      requestClose()
    } catch {
      // Session state already applied — only the cross-session default failed.
      setError(t('saveError'))
      setIsSaving(false)
    }
  }

  return (
    // Top-layer bottom sheet: margins pin it to the bottom edge, centered.
    // A click whose target is the <dialog> itself landed on ::backdrop
    // (children swallow their own clicks) — the standard light-dismiss trick.
    // max-h + scroll matches the plate sheet even though this sheet is short:
    // one dialog recipe, no per-sheet drift.
    <dialog
      ref={dialogRef}
      aria-label={t('title')}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        requestClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // sheet's own padding and inter-section margin gaps also target the
        // dialog element and must not dismiss it.
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
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t('title')}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('lede')}
          </p>
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

      {/* Preset pills — same compact 36px pill + invisible inset (~44px
          effective target) vocabulary as the plate sheet's bar picker.
          Selection is muted foreground-on-background (effort-chips
          precedent, #217): Save below is this sheet's ONE volt moment. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {REST_PRESETS.map((preset) => (
          <button
            key={preset ?? 'off'}
            type="button"
            onClick={() => setSelected(preset)}
            aria-pressed={selected === preset}
            className={cn(
              'relative h-9 rounded-full border px-3.5 text-sm font-semibold tnum transition-colors before:absolute before:-inset-1',
              selected === preset
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {preset === null ? t('presetOff') : t('presetSeconds', { seconds: preset })}
          </button>
        ))}
      </div>

      {/* Custom seconds + Save. The input rides pill-sized like the plate
          sheet's custom slot; Enter submits so one thumb finishes the job. */}
      <div className="mt-4 flex items-center gap-2 pb-4">
        <Input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSave()
            }
          }}
          aria-label={t('customAriaLabel')}
          placeholder={t('customPlaceholder')}
          type="text"
          inputMode="numeric"
          className="h-9 w-28 rounded-full text-center text-sm tnum"
        />
        <Button size="sm" className="flex-1" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t('savePending') : t('save')}
        </Button>
      </div>

      {error && <p className="pb-4 text-sm text-destructive">{error}</p>}

      {/* End-of-rest chirp: a device preference (this phone, all sessions),
          deliberately OUTSIDE the Save flow — sound is not a rest target.
          The enabling tap doubles as the AudioContext unlock gesture, so the
          first rest-over after enabling can actually sound. */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4 pb-4">
        <div className="min-w-0">
          <p className="text-sm">{t('chimeLabel')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('chimeHint')}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={chimeOn}
          onClick={() => {
            const next = !chimeOn
            setChimeOn(next)
            setRestChimeEnabled(next)
            // This tap IS the user gesture the autoplay policy wants.
            if (next) unlockRestChime()
          }}
          className={cn(
            'relative h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors before:absolute before:-inset-1',
            // Muted On state (effort-chips precedent, #217) — a device
            // toggle is not the sheet's volt moment; Save is.
            chimeOn
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {chimeOn ? t('chimeOn') : t('chimeOff')}
        </button>
      </div>
    </dialog>
  )
}
