'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { ExercisePicker, type PickedExercise } from '@/app/workout/new/exercise-picker'
import type { GoalKind } from '@/lib/goals/goal-input'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { createGoalAction } from './actions'
import { useTranslations } from 'next-intl'

/**
 * Inline goal composer: kind picker → per-kind fields. Strength reuses the
 * app's one exercise-search vocabulary (ExercisePicker, customs included);
 * consistency exposes the user's OWN grace setting ("user should be able to
 * setup streak grace") as three plain choices — Strict / 1 miss / 2 misses
 * per week, defaulting to 1. Values are entered in the display unit; the
 * server action converts against the STORED unit preference.
 */

// Option lists carry VALUES only. A label baked in here would be built at
// module load, before any request — so it could never be translated.
const KIND_OPTIONS: GoalKind[] = ['strength', 'bodyweight', 'consistency']

const GRACE_OPTIONS: (0 | 1 | 2)[] = [0, 1, 2]

const DIRECTION_OPTIONS = ['down', 'up'] as const

export function GoalCreate({
  unit,
  compact = false,
}: {
  unit: WeightUnit
  /** Header-row trigger (goals exist — the list leads); the full-width volt
   *  invitation stays for the empty state only. */
  compact?: boolean
}) {
  const t = useTranslations('GoalCreate')
  const tCommon = useTranslations('Common')
  const [isOpen, setIsOpen] = useState(false)
  const [kind, setKind] = useState<GoalKind>('strength')
  const [exercise, setExercise] = useState<PickedExercise | null>(null)
  const [targetValue, setTargetValue] = useState('') // e1RM or bodyweight, display unit
  const [direction, setDirection] = useState<'down' | 'up'>('down')
  const [targetWeeks, setTargetWeeks] = useState('8')
  const [grace, setGrace] = useState<0 | 1 | 2>(1)
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function reset() {
    setExercise(null)
    setTargetValue('')
    setDirection('down')
    setTargetWeeks('8')
    setGrace(1)
    setDeadline('')
    setError(null)
  }

  function buildInput(): Record<string, unknown> | string {
    const common = deadline !== '' ? { deadline } : {}
    if (kind === 'strength') {
      if (!exercise) return t('validation.pickExercise')
      const e1rm = parseFloat(targetValue.trim())
      if (!Number.isFinite(e1rm) || e1rm <= 0) return t('validation.enterE1rm', { unit })
      return {
        kind,
        target: { e1rm },
        exercise: {
          wgerExerciseId: exercise.wgerExerciseId,
          source: exercise.source,
          name: exercise.name,
        },
        ...common,
      }
    }
    if (kind === 'bodyweight') {
      const weight = parseFloat(targetValue.trim())
      if (!Number.isFinite(weight) || weight <= 0) return t('validation.enterWeight', { unit })
      return { kind, target: { weight, direction }, ...common }
    }
    const weeks = parseInt(targetWeeks.trim(), 10)
    if (!Number.isInteger(weeks) || weeks < 1) return t('validation.enterWeeks')
    return { kind, target: { targetWeeks: weeks, allowedMissesPerWeek: grace }, ...common }
  }

  function submit() {
    const input = buildInput()
    if (typeof input === 'string') {
      setError(input)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await createGoalAction(input)
        reset()
        setIsOpen(false)
        router.refresh()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t('createError'))
      }
    })
  }

  if (!isOpen) {
    return compact ? (
      <Button
        variant="outline"
        size="sm"
        className="font-semibold uppercase"
        onClick={() => setIsOpen(true)}
      >
        {t('newGoalAction')}
      </Button>
    ) : (
      <Button className="w-full font-semibold uppercase" onClick={() => setIsOpen(true)}>
        {t('newGoalAction')}
      </Button>
    )
  }

  return (
    <Section title={t('sectionTitle')} className="mt-0">
      {/* Kind picker — segmented, one row. */}
      <div role="radiogroup" aria-label={t('kindGroupLabel')} className="mt-3 grid grid-cols-3 gap-1.5">
        {KIND_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => {
              setKind(option)
              setError(null)
            }}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
              kind === option
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            {t(`kind.${option}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {kind === 'strength' && (
          <>
            {exercise ? (
              <div className="flex items-center justify-between gap-2 border-b border-b-border/60 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium">{exercise.name}</span>
                <button
                  type="button"
                  onClick={() => setExercise(null)}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t('changeExerciseAction')}
                </button>
              </div>
            ) : (
              <ExercisePicker onAdd={(picked) => setExercise(picked)} includeCustom />
            )}
            <div>
              <label htmlFor="goal-e1rm" className="text-sm font-medium">
                {t('e1rmLabel', { unit })}
              </label>
              <Input
                id="goal-e1rm"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={t('e1rmPlaceholder', { example: unit === 'lb' ? 315 : 142.5 })}
                className="mt-1.5 tnum"
              />
            </div>
          </>
        )}

        {kind === 'bodyweight' && (
          <>
            <div>
              <label htmlFor="goal-bodyweight" className="text-sm font-medium">
                {t('bodyweightLabel', { unit })}
              </label>
              <Input
                id="goal-bodyweight"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={t('weightPlaceholder', { example: unit === 'lb' ? 175 : 80 })}
                className="mt-1.5 tnum"
              />
            </div>
            <div role="radiogroup" aria-label={t('directionGroupLabel')} className="grid grid-cols-2 gap-1.5">
              {DIRECTION_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={direction === option}
                  onClick={() => setDirection(option)}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                    direction === option
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {t(`direction.${option}`)}
                </button>
              ))}
            </div>
          </>
        )}

        {kind === 'consistency' && (
          <>
            <div>
              <label htmlFor="goal-weeks" className="text-sm font-medium">
                {t('streakLengthLabel')}
              </label>
              <Input
                id="goal-weeks"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={targetWeeks}
                onChange={(e) => setTargetWeeks(e.target.value)}
                className="mt-1.5 tnum"
              />
            </div>
            <div>
              {/* The user's own grace setting — per goal, forgiving default. */}
              <p className="text-sm font-medium">{t('graceLabel')}</p>
              <div
                role="radiogroup"
                aria-label={t('graceGroupLabel')}
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {GRACE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={grace === option}
                    onClick={() => setGrace(option)}
                    className={cn(
                      'rounded-lg border px-1 py-2 text-xs font-medium transition-colors',
                      grace === option
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {t('graceOption', { misses: option })}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('graceHint')}
              </p>
            </div>
          </>
        )}

        <div>
          <label htmlFor="goal-deadline" className="text-sm font-medium">
            {t.rich('deadlineLabel', {
              optional: (chunks) => (
                <span className="font-normal text-muted-foreground">{chunks}</span>
              ),
            })}
          </label>
          <Input
            id="goal-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => {
            reset()
            setIsOpen(false)
          }}
        >
          {tCommon('cancel')}
        </Button>
        <Button className="flex-1" disabled={isPending} onClick={submit}>
          {isPending ? t('creatingAction') : t('createAction')}
        </Button>
      </div>
    </Section>
  )
}
