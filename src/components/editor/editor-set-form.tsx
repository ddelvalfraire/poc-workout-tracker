import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { EditorSet } from './editor-model'

/**
 * One editable set — the INPUT side of the boundary.
 *
 * The pairing with the log row in `EditorDayPane` is the point. The spec's
 * third channel for the settled/editable boundary is a change in FORM, not a
 * change in lightness: a settled set is values as text at full contrast, and an
 * editable one is fields. That difference is structural, satisfies WCAG 1.4.1's
 * non-colour requirement, and never asks a reader to compare two greys.
 *
 * Nothing here is ever `disabled` to express settledness. `disabled` drops
 * content out of the tab order, invites 1.4.3's inactive-component contrast
 * exemption, and means "do something and this becomes available" — which is
 * false, since nothing a user can do makes an already-instantiated session
 * editable again. Settled sets simply are not rendered by this component.
 *
 * The write is a per-WEEK override, which is exactly the scope the surface
 * claims: you are looking at week 3, so you edit week 3, and weeks already
 * instantiated are untouched because their sets were copied at start time. A
 * blank field CLEARS that field's override rather than writing a zero.
 *
 * A plain `<form action>` and no client state: the row posts, the server
 * revalidates, and the rendered values come back from the database rather than
 * from a local copy that could disagree with it.
 */
interface EditorSetFormProps {
  set: EditorSet
  programId: string
  /** 0-based day position — the addressing `setProgramSetOverride` takes. */
  day: number
  /** 0-based exercise position. */
  exercise: number
  /** 1-based week the override belongs to. */
  week: number
  unit: WeightUnit
  action: (formData: FormData) => void | Promise<void>
  className?: string
}

/**
 * A number field; blank means "no value", never zero.
 *
 * The accessible name is SCOPED to its set ("Set 2 · Min reps") while the
 * visible placeholder stays short. Four identical "Min reps" fields down a
 * column are indistinguishable to a screen reader otherwise, and the obvious
 * alternative — naming the whole `<form>` — turns every set row into a `form`
 * LANDMARK, which axe rightly flags as duplicated. The join is punctuation, not
 * language, so it needs no catalog entry of its own.
 */
function Field({
  name,
  scope,
  label,
  value,
  step,
}: {
  name: string
  scope: string
  label: string
  value: number | null
  step?: string
}) {
  return (
    <Input
      type="number"
      name={name}
      aria-label={`${scope} · ${label}`}
      placeholder={label}
      defaultValue={value ?? ''}
      inputMode="decimal"
      step={step}
      className="w-20 tnum"
    />
  )
}

function EditorSetForm({
  set,
  programId,
  day,
  exercise,
  week,
  unit,
  action,
  className,
}: EditorSetFormProps) {
  const t = useTranslations('ProgramEditor')
  const scope = t('setNumber', { number: set.setNumber })

  return (
    // No `aria-label` on the form: a named form is a LANDMARK, and one per set
    // row would be a column of indistinguishable landmarks. The scoping lives
    // on the fields instead (see `Field`).
    <form action={action} className={cn('flex flex-wrap items-center gap-2 py-2', className)}>
      {/* The address travels with the row, so the action needs no session
          state to know which set it is writing. */}
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="exercise" value={exercise} />
      <input type="hidden" name="setNumber" value={set.setNumber} />
      <input type="hidden" name="week" value={week} />

      <span aria-hidden="true" className="w-14 shrink-0 text-xs uppercase tracking-widest text-muted-foreground tnum">
        {scope}
      </span>
      <Field name="repMin" scope={scope} label={t('fieldRepMin')} value={set.repMin} />
      <Field name="repMax" scope={scope} label={t('fieldRepMax')} value={set.repMax} />
      <Field
        name="load"
        scope={scope}
        label={t('fieldLoad', { unit })}
        value={set.load}
        step="0.5"
      />
      <Field name="rir" scope={scope} label={t('fieldRir')} value={set.rir} />
      {/* The accessible name is scoped for the same reason the fields are, and
          it CONTAINS the visible word so speech input still reaches it
          (WCAG 2.5.3). */}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        aria-label={`${scope} · ${t('setSave')}`}
      >
        {t('setSave')}
      </Button>
    </form>
  )
}

export { EditorSetForm }
