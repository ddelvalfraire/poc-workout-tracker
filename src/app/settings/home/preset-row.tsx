'use client'

import { HOME_PRESETS, type HomePresetId } from '@/lib/home/presets'
import type { TrainingSignal } from '@/lib/home/signal'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The named layouts, and the app's own read of how you train.
 *
 * THE READ NEVER SPEAKS FIRST. It lives here, on a screen you chose to open,
 * and never on home — a line on home asking you to confirm your training
 * style is a teaser row, and home is the one surface that must never nag.
 * Nothing changes until Use is pressed: the read is information, not an
 * instruction.
 *
 * Applying a preset writes an ordinary layout document, so these chips are a
 * shortcut and not a mode. The selected chip is DERIVED by comparing the
 * current layout to each preset, which is why it clears the moment you edit
 * anything — at that point the layout is yours rather than Cut's, and saying
 * otherwise would be a claim the document cannot back up.
 */
export function PresetRow({
  activePreset,
  signal,
  onApply,
}: {
  /** The preset the current layout still matches exactly, if any. */
  activePreset: HomePresetId | null
  /** What the app reads from logged training. Null when it reads nothing — a
   *  fresh account, or a window the rules do not describe. */
  signal: TrainingSignal | null
  onApply: (id: HomePresetId) => void
}) {
  const t = useTranslations('PresetRow')
  const tPreset = useTranslations('HomePreset')
  // Suggesting the layout you are already on is noise, not help.
  const suggestion = signal !== null && signal.preset !== activePreset ? signal : null

  return (
    <section aria-labelledby="home-presets-heading" className="mt-6">
      <h2
        id="home-presets-heading"
        className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
      >
        {t('heading')}
      </h2>

      <div
        role="group"
        aria-labelledby="home-presets-heading"
        className="mt-2.5 flex flex-wrap gap-1.5"
      >
        {HOME_PRESETS.map((preset) => {
          const isActive = preset.id === activePreset
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onApply(preset.id)}
              className={cn(
                'relative rounded-full border px-3 py-1.5 text-xs font-medium transition-colors before:absolute before:-inset-1',
                'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              {tPreset(preset.labelKey)}
            </button>
          )
        })}
      </div>

      <p className="mt-2.5 text-xs text-muted-foreground">{t('hint')}</p>

      {suggestion !== null && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('derived.heading')}
          </p>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">{tPreset(`label.${suggestion.preset}`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tnum">
                {suggestion.medianWorkingReps === null
                  ? t('derived.evidenceWithoutReps', {
                      groups: suggestion.muscleGroupCount,
                      weeks: suggestion.windowWeeks,
                    })
                  : t('derived.evidence', {
                      reps: suggestion.medianWorkingReps,
                      groups: suggestion.muscleGroupCount,
                      weeks: suggestion.windowWeeks,
                    })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onApply(suggestion.preset)}
              className={cn(
                'relative shrink-0 rounded-full border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors before:absolute before:-inset-1',
                'outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
              )}
            >
              {t('derived.useAction')}
            </button>
          </div>
          {/* States where the read came from AND where it did not. The
              firewall is a promise made to the person, so it is said to
              them rather than only to the next engineer. */}
          <p className="mt-2 text-xs text-muted-foreground">{t('derived.firewall')}</p>
        </div>
      )}
    </section>
  )
}
