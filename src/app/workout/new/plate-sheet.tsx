'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setEquipmentAction } from '@/app/actions'
import { loadBar, warmupRamp } from '@/lib/plate-math'
import type { Equipment } from '@/lib/equipment'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * Bottom sheet for one exercise: per-weight plate breakdowns and the warm-up
 * ramp toward the heaviest working set, both computed against the user's own
 * bars and plate denominations. Bar choice is ephemeral picker state (a
 * per-open selection, not a persisted per-exercise setting); the gear itself
 * is editable inline and persisted per user.
 */

interface PlateSheetProps {
  exerciseName: string
  /** Distinct filled working weights for this exercise, heaviest first (display unit). */
  weights: number[]
  unit: WeightUnit
  equipment: Equipment
  onClose: () => void
  /** Fired after a successful gear save so the logger can refresh its copy. */
  onEquipmentSaved: (equipment: Equipment) => void
}

/** 2.5 → "2.5", 45 → "45" — JS number formatting is already what lifters write. */
const fmt = (n: number) => n.toString()

function perSideLabel(perSide: number[]): string {
  return perSide.length === 0 ? 'bar only' : `${perSide.map(fmt).join(' + ')} / side`
}

/** Parses "45, 35, 2.5" into numbers; returns null when anything isn't numeric. */
function parseWeightList(text: string): number[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean)
  if (parts.length === 0) return null
  const values = parts.map(Number)
  return values.every((v) => Number.isFinite(v) && v > 0) ? values : null
}

export function PlateSheet({
  exerciseName,
  weights,
  unit,
  equipment,
  onClose,
  onEquipmentSaved,
}: PlateSheetProps) {
  // Bar options: the user's bars plus the UI-level "no bar" (plate-loaded).
  const [bar, setBar] = useState<number>(equipment.bars[0] ?? 0)
  const [isEditing, setIsEditing] = useState(false)
  const [barsText, setBarsText] = useState(equipment.bars.map(fmt).join(', '))
  const [platesText, setPlatesText] = useState(equipment.plates.map(fmt).join(', '))
  const [editError, setEditError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert — a screen reader's virtual cursor can't
  // walk behind the sheet, which a hand-rolled Tab trap never guarantees.
  // We keep manual body scroll lock (dialog doesn't lock it), initial focus
  // on the visible ×, and focus restore on unmount (we unmount instead of
  // calling close(), so the native restore doesn't fire).
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
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const ramp = weights.length > 0 ? warmupRamp(weights[0], bar, equipment.plates) : []

  async function handleSaveGear() {
    const bars = parseWeightList(barsText)
    const plates = parseWeightList(platesText)
    if (!bars || !plates) {
      setEditError('Weights must be positive numbers, separated by commas.')
      return
    }
    try {
      setIsSaving(true)
      setEditError(null)
      await setEquipmentAction({ unit, bars, plates })
      // Mirror the server's normalization (dedupe, heaviest first) locally.
      const normalized = {
        bars: Array.from(new Set(bars)).sort((a, b) => b - a),
        plates: Array.from(new Set(plates)).sort((a, b) => b - a),
      }
      onEquipmentSaved(normalized)
      setBar(normalized.bars[0] ?? 0)
      setIsEditing(false)
    } catch {
      setEditError('Could not save your gear. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    // Top-layer bottom sheet: margins pin it to the bottom edge, centered.
    // A click whose target is the <dialog> itself landed on ::backdrop
    // (children swallow their own clicks) — the standard light-dismiss trick.
    // max-h + scroll: many weights + the ramp + the gear editor can exceed a
    // phone viewport, and content above the fold would be unreachable.
    <dialog
      ref={dialogRef}
      aria-label={`Bar and plates for ${exerciseName}`}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        onClose()
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
        if (!inside) onClose()
      }}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 pb-safe text-foreground backdrop:bg-black/60"
    >
        <div className="flex items-start justify-between gap-3 pb-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Bar &amp; plates</p>
            <h3 className="mt-0.5 text-lg leading-tight">{exerciseName}</h3>
          </div>
          <Button
            ref={closeButtonRef}
            size="icon-sm"
            variant="ghost"
            className="-mr-1 text-muted-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        {/* Bar picker — ephemeral, per open */}
        <div className="mt-3 flex flex-wrap gap-2">
          {equipment.bars.map((weight) => (
            <button
              key={weight}
              type="button"
              onClick={() => setBar(weight)}
              aria-pressed={bar === weight}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold tnum transition-colors',
                bar === weight
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {fmt(weight)} {unit} bar
            </button>
          ))}
          <button
            type="button"
            onClick={() => setBar(0)}
            aria-pressed={bar === 0}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
              bar === 0
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            No bar
          </button>
        </div>

        {/* Plate breakdown per distinct working weight */}
        <div className="mt-4 space-y-1.5">
          {weights.length === 0 && (
            <p className="text-sm text-muted-foreground">Enter a weight on a set to see the plate math.</p>
          )}
          {weights.map((weight) => {
            const load = loadBar(weight, bar, equipment.plates)
            return (
              <p key={weight} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold tnum">
                  {fmt(weight)} {unit}
                </span>
                <span className="text-right text-muted-foreground tnum">
                  {load === null
                    ? 'below the bar'
                    : load.exact
                      ? perSideLabel(load.perSide)
                      : `closest ${fmt(load.achieved)} — ${perSideLabel(load.perSide)}`}
                </span>
              </p>
            )
          })}
        </div>

        {/* Warm-up ramp toward the top working weight */}
        {ramp.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Warm-up · toward {fmt(weights[0])} {unit}
            </p>
            <div className="mt-2 space-y-1.5">
              {ramp.map((step) => (
                <p key={step.weight} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold tnum">
                    {fmt(step.weight)} × {step.reps}
                  </span>
                  <span className="text-right text-muted-foreground tnum">{perSideLabel(step.perSide)}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Gear editor */}
        <div className="mt-5 border-t border-border pt-4 pb-4">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={barsText}
                onChange={(e) => setBarsText(e.target.value)}
                aria-label={`Your bars in ${unit}`}
                placeholder="45, 35"
                inputMode="decimal"
              />
              <Input
                value={platesText}
                onChange={(e) => setPlatesText(e.target.value)}
                aria-label={`Your plates in ${unit}`}
                placeholder="45, 35, 25, 10, 5, 2.5"
                inputMode="decimal"
              />
              {editError && <p className="text-sm text-destructive">{editError}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveGear} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save gear'}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-sm text-muted-foreground underline-offset-2 active:underline"
            >
              Edit your bars &amp; plates ({unit})
            </button>
          )}
        </div>
    </dialog>
  )
}
