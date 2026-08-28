'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import type { Technique } from '@/lib/program-input'
import type { DerivedSet } from '@/lib/progression'
import {
  TECHNIQUE_KINDS,
  TECHNIQUE_LABEL_KEY,
  expandTechniqueStages,
  plannedTechniqueWeight,
} from '@/lib/technique'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The technique stack — Blender's modifier stack, not a repeated fieldset.
 *
 * Stages are ORDERED and each states its own numbers, because that is what a
 * technique is: one prescription with N results. A fieldset repeated four times
 * says the same thing while hiding the order, which is the only structure the
 * logger actually reads.
 *
 * `The set becomes` calls the REAL `expandTechniqueStages` — the same pure
 * function instantiation and the logger's ghosts run through. A preview that
 * reimplemented the expansion could disagree with what gets trained, and the
 * entire point of showing it is that it cannot. Percentage stages therefore
 * show the kg they will actually prescribe, quantized to the grid, rather than
 * the author's arithmetic.
 *
 * Controlled and presentational: the parent owns the value and the persistence.
 * A stack is edited many times before it means anything, so a per-keystroke
 * write would be both wrong and expensive; whatever mounts this decides when a
 * stack is worth saving.
 */

/** A stage's load can be stated three ways, and the third is not "empty". */
export type StageLoadMode = 'kg' | 'pct' | 'rack'

interface EditorTechniqueFormProps {
  /** null = no technique on this set (a straight set). */
  value: Technique | null
  onChange: (next: Technique | null) => void
  /**
   * The set the stack hangs off, for the preview. Its `loadKg` is what a
   * percentage stage resolves against, so the preview and the derivation agree
   * about the actual weight.
   */
  topSet: DerivedSet
  unit: WeightUnit
  /** 1-based, for the preview's row labels ("Set 3", then 3a, 3b, …). */
  setNumber: number
  /** Names the set this stack belongs to, e.g. "Cable Face Pull · set 3 of 3". */
  scope: string
  className?: string
}

const MAX_STAGES = 12

function stageLoadMode(stage: Technique['stages'][number]): StageLoadMode {
  if (stage.loadKg != null) return 'kg'
  if (stage.loadPct != null) return 'pct'
  return 'rack'
}

/**
 * Switching mode CONVERTS where it can: 80 kg off a 100 kg top set becomes
 * 80%, and back again. Clearing on every mode change would punish curiosity —
 * a tap to see what the other mode looks like should not cost the number
 * already typed.
 */
function withLoadMode(
  stage: Technique['stages'][number],
  mode: StageLoadMode,
  topLoadKg: number | null,
): Technique['stages'][number] {
  const { loadKg, loadPct, ...rest } = stage
  if (mode === 'rack') return rest
  if (mode === 'kg') {
    const converted = loadPct != null && topLoadKg != null ? topLoadKg * loadPct : loadKg
    return converted != null ? { ...rest, loadKg: converted } : rest
  }
  const converted =
    loadKg != null && topLoadKg != null && topLoadKg > 0 ? loadKg / topLoadKg : loadPct
  return converted != null ? { ...rest, loadPct: converted } : rest
}

export function EditorTechniqueForm({
  value,
  onChange,
  topSet,
  unit,
  setNumber,
  scope,
  className,
}: EditorTechniqueFormProps) {
  const t = useTranslations('EditorTechniqueForm')

  const stages = value?.stages ?? []
  const topLoadKg = topSet.loadKg

  function patchStage(index: number, patch: Partial<Technique['stages'][number]>) {
    if (!value) return
    onChange({
      ...value,
      stages: value.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  function setMode(index: number, mode: StageLoadMode) {
    if (!value) return
    onChange({
      ...value,
      stages: value.stages.map((s, i) => (i === index ? withLoadMode(s, mode, topLoadKg) : s)),
    })
  }

  // The preview runs the real expansion over a copy of the top set carrying
  // this stack, so what it shows is what instantiation will write.
  const previewRows = expandTechniqueStages([{ ...topSet, technique: value }], unit)
  const volume = plannedTechniqueWeight(value)

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <section aria-label={t('kindTitle')}>
        <Section>{t('kindTitle')}</Section>
        <p className="mt-1 text-sm text-muted-foreground">{scope}</p>
        <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
          <KindRow
            label={t('straightSet')}
            description={t('straightSetDescription')}
            selected={value === null}
            onSelect={() => onChange(null)}
          />
          {TECHNIQUE_KINDS.map((kind) => (
            <KindRow
              key={kind}
              label={t(`kind.${TECHNIQUE_LABEL_KEY[kind]}`)}
              description={t(`kindDescription.${TECHNIQUE_LABEL_KEY[kind]}`)}
              selected={value?.kind === kind}
              onSelect={() =>
                onChange({
                  version: 1,
                  kind,
                  stages: value?.stages.length ? value.stages : [{ reps: null }],
                })
              }
            />
          ))}
        </ul>
      </section>

      {value !== null && (
        <>
          <section aria-label={t('stagesTitle')}>
            <Section>{t('stagesTitle')}</Section>
            <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
              {stages.map((stage, index) => (
                <li key={index} className="flex flex-col gap-2 py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium">
                      {t('stageLabel', { number: index + 1 })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onChange({ ...value, stages: stages.filter((_, i) => i !== index) })
                      }
                      disabled={stages.length <= 1}
                    >
                      {t('removeStage')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      className="w-20 text-center tnum"
                      aria-label={`${t('stageLabel', { number: index + 1 })} · ${t('reps')}`}
                      value={stage.reps ?? ''}
                      onChange={(e) =>
                        patchStage(index, { reps: numberOrNull(e.currentTarget.value) })
                      }
                    />
                    <span className="text-sm text-muted-foreground">{t('reps')}</span>
                    <LoadCell
                      stage={stage}
                      label={t('stageLabel', { number: index + 1 })}
                      loadLabel={t('load')}
                      modeLabels={{ kg: unit, pct: '%', rack: t('rack') }}
                      onMode={(mode) => setMode(index, mode)}
                      onValue={(next) =>
                        patchStage(
                          index,
                          stageLoadMode(stage) === 'pct' ? { loadPct: next } : { loadKg: next },
                        )
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full"
              disabled={stages.length >= MAX_STAGES}
              onClick={() => onChange({ ...value, stages: [...stages, { reps: null }] })}
            >
              {t('addStage')}
            </Button>
          </section>

          <section aria-label={t('previewTitle')}>
            <Section>{t('previewTitle')}</Section>
            <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
              {previewRows.map((row, index) => (
                <li key={index} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground tnum">
                    {index === 0
                      ? t('previewTop', { number: setNumber })
                      : t('previewStage', {
                          number: setNumber,
                          letter: String.fromCharCode(96 + index),
                        })}
                  </span>
                  <span className="text-sm tnum">
                    {row.loadKg == null
                      ? t('previewNoLoad', { reps: row.repMin ?? 0 })
                      : t('previewRow', { reps: row.repMin ?? 0, load: row.loadKg, unit })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              {t('volumeNote', { rows: previewRows.length, volume })}
            </p>
            {/* D3 — the most consequential thing this form does, and the one
                the mock never showed. A technique group testifies to nothing:
                these are failure methods, so a rep floor would read the
                technique working as a missed target. Stated where the choice is
                made, not in a help sheet. */}
            <p className="mt-2 text-sm text-muted-foreground">{t('autoregNote')}</p>
          </section>
        </>
      )}
    </div>
  )
}

function KindRow({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full items-start gap-3 py-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 rounded-full border',
            selected ? 'border-4 border-primary' : 'border-input',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * The load cell, with its mode AS the control — E2's rule that the column
 * header is the control, applied per stage because a stack may mix modes: a
 * percentage drop followed by a fixed dumbbell is a real prescription.
 */
function LoadCell({
  stage,
  label,
  loadLabel,
  modeLabels,
  onMode,
  onValue,
}: {
  stage: Technique['stages'][number]
  label: string
  loadLabel: string
  modeLabels: Record<StageLoadMode, string>
  onMode: (mode: StageLoadMode) => void
  onValue: (next: number | null) => void
}) {
  const mode = stageLoadMode(stage)
  const nextMode: Record<StageLoadMode, StageLoadMode> = { kg: 'pct', pct: 'rack', rack: 'kg' }
  const shown = mode === 'kg' ? stage.loadKg : mode === 'pct' ? pctToWhole(stage.loadPct) : null

  return (
    <span className="flex items-center gap-2">
      {/* In rack mode the button IS the label — rendering the words beside a
          button carrying the same words says it twice and gives a screen
          reader two identical strings to disambiguate. */}
      {mode !== 'rack' && (
        <Input
          type="text"
          inputMode="decimal"
          className="w-20 text-center tnum"
          aria-label={`${label} · ${loadLabel}`}
          value={shown ?? ''}
          onChange={(e) => {
            const parsed = numberOrNull(e.currentTarget.value)
            onValue(mode === 'pct' && parsed != null ? parsed / 100 : parsed)
          }}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="tnum"
        aria-label={`${label} · ${loadLabel}`}
        onClick={() => onMode(nextMode[mode])}
      >
        {modeLabels[mode]}
      </Button>
    </span>
  )
}

/** Blank means "no value", never zero — the same rule the set form follows. */
function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Stored as a fraction, shown as a whole number: 0.8 reads as 80. */
function pctToWhole(pct: number | null | undefined): number | null {
  return pct == null ? null : Math.round(pct * 1000) / 10
}
