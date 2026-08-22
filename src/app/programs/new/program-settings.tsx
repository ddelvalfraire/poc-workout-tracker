'use client'

import { useTranslations } from 'next-intl'

import { Choice, ChoiceList } from '@/components/ui/choice-list'
import { Input } from '@/components/ui/input'
import { SwitchRow } from '@/components/ui/switch-row'
import { type DeloadPolicy } from '@/lib/program-input'
import { type ProgramDraft, type ProgramDraftAction } from './program-draft'

/** Option VALUES for the four choice lists; every label is a catalog lookup at
 *  render (see `deloadPolicy.*`, `timedExercises.*`, `dietPhase.*`,
 *  `stallPolicy.*`). A label built at module load would be built before any
 *  request, so it could never be translated. */
const DELOAD_MODES = ['none', 'reactive', 'scheduled'] as const
const TIMED_EXERCISE_ARMS = ['untouched', 'scaled'] as const
const DIET_PHASES = [null, 'cutting', 'maintaining', 'bulking'] as const

/** The `null` diet phase travels through the radio group as this token — a
 *  radio's value is a string, and "no phase" is a real, selectable arm. */
const NO_DIET_PHASE = 'none'

type DietPhaseValue = (typeof DIET_PHASES)[number]

/** The scheduled shape at the historical defaults — what a never-set policy
 *  resolves to, and the seed when the picker writes an explicit one. */
const DEFAULT_DELOAD_SHAPE = {
  loadFactor: 0.85,
  setFactor: 0.5,
  rpeCap: null,
  timedExercises: 'untouched',
} as const

/** The shape the read-only scheduled caption describes: the stored shape when
 *  one exists (agent-configured), the historical defaults otherwise. The
 *  caption itself is assembled at RENDER from the catalog. */
function deloadShapeOf(policy: DeloadPolicy | null) {
  return policy?.mode === 'scheduled' ? policy.shape : DEFAULT_DELOAD_SHAPE
}

/** The scheduled shape's timedExercises arm as the picker shows it. A
 *  pre-field stored policy (or none at all) reads 'untouched' — mirroring the
 *  zod default resolveDeloadPolicy applies at read time. */
function resolvedTimedExercises(policy: DeloadPolicy | null): 'untouched' | 'scaled' {
  return policy?.mode === 'scheduled' ? (policy.shape.timedExercises ?? 'untouched') : 'untouched'
}

/**
 * The deload-mode picker's checked state: an explicit policy wins; a never-set
 * one shows the LEGACY resolution (scheduled when a deload week is typed, none
 * otherwise) — mirroring resolveDeloadPolicy's read path. Exported because the
 * settings SUMMARY line reports the same resolved value the panel checks.
 */
export function resolvedDeloadMode(draft: ProgramDraft): 'none' | 'reactive' | 'scheduled' {
  return draft.deloadPolicy?.mode ?? (draft.deloadWeek.trim() !== '' ? 'scheduled' : 'none')
}

interface ProgramSettingsProps {
  draft: ProgramDraft
  dispatch: React.Dispatch<ProgramDraftAction>
}

/**
 * Everything about the program that is not a day: length, deload, diet phase,
 * auto-regulation, plan sync, check-in cadence.
 *
 * This used to be eleven controls stacked above the day list, which put the
 * actual work below the fold and made the builder read as a form to complete.
 * It now lives behind the settings summary row — the defaults are sane, so
 * these are settings to CHECK, not a gauntlet to pass.
 *
 * Every mode here is a `ChoiceList` rather than a `Select`: the sets are small
 * and closed, and each option needs a sentence to be intelligible. Hiding three
 * explained options behind a collapsed control would force the reader to open,
 * read, close and remember.
 */
export function ProgramSettings({ draft, dispatch }: ProgramSettingsProps) {
  const t = useTranslations('ProgramBuilder')
  const deloadMode = resolvedDeloadMode(draft)
  const shape = deloadShapeOf(draft.deloadPolicy)

  return (
    <div className="space-y-6 pt-3">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t('weeksPlaceholder')}
            value={draft.mesocycleWeeks}
            onChange={(event) =>
              dispatch({ type: 'SET_META', field: 'mesocycleWeeks', value: event.target.value })
            }
            aria-label={t('weeksAriaLabel')}
            className="flex-1 tnum"
          />
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t('deloadWeekPlaceholder')}
            value={draft.deloadWeek}
            onChange={(event) =>
              dispatch({ type: 'SET_META', field: 'deloadWeek', value: event.target.value })
            }
            aria-label={t('deloadWeekAriaLabel')}
            aria-describedby="deload-hint"
            className="flex-1 tnum"
          />
        </div>
        <p id="deload-hint" className="text-sm text-muted-foreground">
          {t('deloadHint')}
        </p>
      </div>

      {/* Deload policy. The checked state shows the RESOLVED mode (a never-set
          policy displays what the program will actually do); picking an option
          writes an explicit one. Scheduled's shape is read-only here — the
          historical back-off unless an agent configured otherwise. */}
      <div>
        <ChoiceList
          label={t('deloadPolicy.legend')}
          value={deloadMode}
          onValueChange={(mode: (typeof DELOAD_MODES)[number]) =>
            dispatch({
              type: 'SET_DELOAD_POLICY',
              value:
                mode === 'scheduled'
                  ? {
                      mode,
                      shape:
                        draft.deloadPolicy?.mode === 'scheduled'
                          ? draft.deloadPolicy.shape
                          : DEFAULT_DELOAD_SHAPE,
                    }
                  : { mode },
            })
          }
        >
          {DELOAD_MODES.map((mode) => (
            <Choice key={mode} value={mode} hint={t(`deloadPolicy.${mode}.hint`)}>
              {t(`deloadPolicy.${mode}.label`)}
            </Choice>
          ))}
        </ChoiceList>

        {deloadMode === 'scheduled' && (
          <>
            <p className="pt-2 text-sm text-muted-foreground">
              {shape.rpeCap !== null
                ? t('deloadPolicy.shapeWithCap', {
                    load: Math.round(shape.loadFactor * 100),
                    sets: Math.round(shape.setFactor * 100),
                    rpeCap: shape.rpeCap,
                  })
                : t('deloadPolicy.shape', {
                    load: Math.round(shape.loadFactor * 100),
                    sets: Math.round(shape.setFactor * 100),
                  })}
            </p>

            {/* Timed exercises on the deload week (D3, "creator decides"),
                nested under Scheduled the way the stall policy nests under
                auto-regulation. Untouched is the default — a duration
                exercise's deload week trains as written unless the creator
                opts its sets into the back-off. */}
            <ChoiceList
              className="mt-4 pl-4"
              label={t('timedExercises.legend')}
              value={resolvedTimedExercises(draft.deloadPolicy)}
              onValueChange={(arm: (typeof TIMED_EXERCISE_ARMS)[number]) =>
                dispatch({
                  type: 'SET_DELOAD_POLICY',
                  value: {
                    mode: 'scheduled',
                    shape: {
                      ...(draft.deloadPolicy?.mode === 'scheduled'
                        ? draft.deloadPolicy.shape
                        : DEFAULT_DELOAD_SHAPE),
                      timedExercises: arm,
                    },
                  },
                })
              }
            >
              {TIMED_EXERCISE_ARMS.map((arm) => (
                <Choice key={arm} value={arm}>
                  {t(`timedExercises.${arm}`)}
                </Choice>
              ))}
            </ChoiceList>
          </>
        )}
      </div>

      {/* Diet phase. None is first and the default — no phase means the engine
          behaves exactly as it always has. Cutting only reframes stall verdicts
          (holding is the win) and asks before backing off; it never changes a
          load. */}
      <ChoiceList
        label={t('dietPhase.legend')}
        value={draft.dietPhase ?? NO_DIET_PHASE}
        onValueChange={(phase: string) =>
          dispatch({
            type: 'SET_DIET_PHASE',
            value: (phase === NO_DIET_PHASE ? null : phase) as DietPhaseValue,
          })
        }
      >
        {DIET_PHASES.map((phase) => (
          <Choice
            key={phase ?? NO_DIET_PHASE}
            value={phase ?? NO_DIET_PHASE}
            hint={t(`dietPhase.${phase ?? NO_DIET_PHASE}.hint`)}
          >
            {t(`dietPhase.${phase ?? NO_DIET_PHASE}.label`)}
          </Choice>
        ))}
      </ChoiceList>

      <div className="divide-y divide-border/60 border-y border-y-border/60">
        {/* Program-level auto-regulation. The adjusted targets always arrive as
            proposals with a per-exercise escape, so one switch is the whole
            control. */}
        <SwitchRow
          checked={draft.autoregulation}
          onCheckedChange={(value) => dispatch({ type: 'SET_AUTOREGULATION', value })}
          hint={t('autoreg.description')}
        >
          {t('autoreg.label')}
        </SwitchRow>

        {/* Performance→plan auto-sync. Off is for deliberate-percentage
            programs (5/3/1-style waves) where lifting past the listed load is
            by design, not a stale plan. */}
        <SwitchRow
          checked={draft.planSync}
          onCheckedChange={(value) => dispatch({ type: 'SET_PLAN_SYNC', value })}
          hint={t('planSync.description')}
        >
          {t('planSync.label')}
        </SwitchRow>
      </div>

      {/* Fixed-mode stall policy: it refines auto-regulation, so it rides just
          under the switch and hides with it (the stored value is preserved
          either way). */}
      {draft.autoregulation && (
        <ChoiceList
          className="pl-4"
          label={t('stallPolicy.legend')}
          value={draft.autoregStallPolicy}
          onValueChange={(value: 'all-sets' | 'first-set') =>
            dispatch({ type: 'SET_AUTOREG_STALL_POLICY', value })
          }
        >
          <Choice value="all-sets">{t('stallPolicy.allSets')}</Choice>
          <Choice value="first-set">{t('stallPolicy.firstSet')}</Choice>
        </ChoiceList>
      )}

      {/* Program-suggested body check-in cadence: a small number input, not a
          toggle — blank IS the off state (programs.checkInEveryDays null), so
          there is no second control to keep in sync. */}
      <div className="space-y-1">
        <label className="flex items-center gap-2.5 text-sm" htmlFor="check-in-every-days">
          <span className="flex-1">{t('checkIn.label')}</span>
          <Input
            id="check-in-every-days"
            type="text"
            inputMode="numeric"
            placeholder={t('checkIn.placeholder')}
            value={draft.checkInEveryDays}
            onChange={(event) =>
              dispatch({ type: 'SET_META', field: 'checkInEveryDays', value: event.target.value })
            }
            aria-label={t('checkIn.ariaLabel')}
            aria-describedby="check-in-hint"
            className="w-16 shrink-0 text-center tnum"
          />
          <span className="shrink-0">{t('checkIn.unit')}</span>
        </label>
        <p id="check-in-hint" className="text-sm text-muted-foreground">
          {t('checkIn.hint')}
        </p>
      </div>
    </div>
  )
}
