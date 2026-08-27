'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getWeightUnit } from '@/db/preferences'
import { setProgramSetOverride } from '@/db/program-patches'
import { requireUserId } from '@/lib/auth'
import { displayToKg } from '@/lib/units'

/**
 * The editor's one write: a per-WEEK override on a single set.
 *
 * Per-week is the honest scope for a week-addressed surface — you are looking
 * at week 3, so you edit week 3 — and it is also the only op that takes a week
 * at all. Sessions already instantiated are untouched by construction: their
 * set rows were copied at start time and no edit path updates them.
 *
 * The write is NOT gated on trained state, and deliberately so. Nothing in the
 * db layer is, so a guard here would be a second rule that the MCP tools and
 * proposal application do not share — and the surface has already said where
 * editing begins, before the user touched anything. Allowing an inert edit
 * quietly is the design; a dialog on a frequent action is habituated away
 * within days, and blocking would claim an enforcement that does not exist.
 */

/**
 * A blank field CLEARS that field's override — it is not zero.
 *
 * The union orders the empty string FIRST because `z.coerce.number()` turns
 * `''` into 0, which would silently write "0 reps" every time someone emptied a
 * box. This is the whole reason the fields are parsed rather than read.
 */
function blankable<T extends z.ZodType<number>>(schema: T) {
  return z.union([z.literal(''), schema]).transform((value) => (value === '' ? null : value))
}

const countField = blankable(z.coerce.number().int().min(0).max(999))

const overrideSchema = z.object({
  programId: z.string().uuid(),
  // 0-based positions + 1-based setNumber: the addressing `setProgramSetOverride`
  // and `editor-address.ts` already agree on.
  day: z.coerce.number().int().min(0),
  exercise: z.coerce.number().int().min(0),
  setNumber: z.coerce.number().int().min(1),
  week: z.coerce.number().int().min(1),
  repMin: countField,
  repMax: countField,
  rir: countField,
  /** In the user's DISPLAY unit; converted to kg below, never stored as typed. */
  load: blankable(z.coerce.number().min(0).max(2000)),
})

export async function saveSetOverrideAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const input = overrideSchema.parse(Object.fromEntries(formData))

  const unit = await getWeightUnit(userId)
  const result = await setProgramSetOverride(
    userId,
    input.programId,
    input.day,
    input.exercise,
    input.setNumber,
    input.week,
    {
      repMin: input.repMin,
      repMax: input.repMax,
      rir: input.rir,
      suggestedLoadKg: input.load === null ? null : displayToKg(input.load, unit),
    },
    'ui',
  )
  if (!result) throw new Error('set not found')

  // 'layout' so both editor routes refresh — the structure-only one and the
  // day segment beneath it. The detail page reads the same plan, so it goes
  // stale on the same write.
  revalidatePath(`/programs/${input.programId}/editor`, 'layout')
  revalidatePath(`/programs/${input.programId}`)
}
