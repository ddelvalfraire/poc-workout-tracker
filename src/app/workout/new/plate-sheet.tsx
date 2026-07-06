'use client'

import { useState } from 'react'
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
    <div
      className="fixed inset-0 z-30 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Bar and plates for ${exerciseName}`}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close plate calculator"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 pb-safe">
        <div className="flex items-start justify-between gap-3 pb-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Bar &amp; plates</p>
            <h3 className="mt-0.5 text-lg leading-tight">{exerciseName}</h3>
          </div>
          <Button
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
      </div>
    </div>
  )
}
