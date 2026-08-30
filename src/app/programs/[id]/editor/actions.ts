'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { getWeightUnit } from '@/db/preferences'
import { getProgramDetail } from '@/db/programs'
import { setProgramSetOverride, updateProgramSet } from '@/db/program-patches'
import { requireUserId } from '@/lib/auth'
import { techniqueSchema as programTechniqueSchema } from '@/lib/programs/program-input'
import { displayToKg } from '@/lib/units'
import { editorHref } from './editor-address'

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

  // A LOAD change is the one edit that raises a question the surface can
  // answer: this week, or the plan. The param only NAMES the set — whether
  // there is anything to ask is decided by `reachDivergence` when the surface
  // renders, so a pin that matches the rule opens nothing and this costs no
  // extra read here. Reps, RIR and a cleared field ask nothing and redirect
  // nowhere.
  if (input.load !== null) {
    redirect(
      editorHref(input.programId, {
        day: input.day,
        exercise: input.exercise,
        week: input.week,
        reach: { exercise: input.exercise, setNumber: input.setNumber },
      }),
    )
  }
}

/**
 * The reach sheet's one write: widen a per-week pin to the PLAN.
 *
 * The pin already exists — the set row wrote it, and this is the follow-up
 * offer, not a confirmation gate in front of it. So the action reads the week's
 * pinned load and moves the TEMPLATE to it. There is no third scope to
 * implement: nothing in the schema is week-ranged, so "this week onward" has
 * nowhere to be stored (docs/specs/per-week-set-count.md).
 *
 * The per-week pin is deliberately LEFT IN PLACE afterwards. Removing it would
 * be indistinguishable in the data — the week now resolves to the same number
 * either way — right up until the rule moves again, at which point a week the
 * user pinned by hand would silently follow it. "Pinned weeks stay pinned even
 * when you change the rule" is the promise every editor surface makes, and this
 * is where it would be quietly broken.
 *
 * Sessions already instantiated are untouched by construction: their set rows
 * were copied at start time and no edit path updates them.
 */
const reachSchema = z.object({
  programId: z.string().uuid(),
  day: z.coerce.number().int().min(0),
  exercise: z.coerce.number().int().min(0),
  setNumber: z.coerce.number().int().min(1),
  week: z.coerce.number().int().min(1),
})

export async function applyReachToPlanAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const input = reachSchema.parse(Object.fromEntries(formData))

  // The load comes from the STORED pin rather than the form. A hidden field
  // carrying the number would let a stale sheet — one rendered before another
  // edit landed — write back a weight nobody is looking at.
  const program = await getProgramDetail(userId, input.programId)
  const set = program?.days[input.day]?.exercises[input.exercise]?.sets.find(
    (row) => row.setNumber === input.setNumber,
  )
  const pinned = set?.overrides.find((row) => row.week === input.week)?.suggestedLoadKg
  if (pinned == null) throw new Error('no pinned load to apply')

  const result = await updateProgramSet(
    userId,
    input.programId,
    input.day,
    input.exercise,
    input.setNumber,
    { suggestedLoadKg: pinned },
    'ui',
  )
  if (!result) throw new Error('set not found')

  revalidatePath(`/programs/${input.programId}/editor`, 'layout')
  revalidatePath(`/programs/${input.programId}`)
}

/**
 * The technique stack's write: the set's PLAN, not this week.
 *
 * Every other write on this surface is a per-week override, and this one is
 * deliberately not. A technique is a property of how the set is performed
 * rather than a number that moves week to week, and `program_set_overrides`
 * can only hold a WHOLE replacement technique — there is no partial per-week
 * stage edit in the schema (`lib/progression.ts` swaps the entire object). A
 * per-week technique editor is a second surface, scoped out of v1 in
 * docs/specs/technique-authoring.md §08. So this writes the template and every
 * underived week follows it.
 *
 * Weeks already instantiated are untouched by construction, as everywhere else
 * here: their set rows were copied at start time.
 *
 * The payload arrives as JSON because a technique is a TREE — an ordered list
 * of stages, each with three optional fields — and flattening it into
 * `stages[0][loadPct]` form-field names would invent a wire format that
 * nothing else in the app speaks. It is re-parsed through the real
 * `techniqueSchema` here, so the client cannot post a shape the database would
 * refuse, and `updateProgramSet` parses it a second time at the db boundary.
 */
const techniqueSchema_ = z.object({
  programId: z.string().uuid(),
  day: z.coerce.number().int().min(0),
  exercise: z.coerce.number().int().min(0),
  setNumber: z.coerce.number().int().min(1),
  /** '' clears the technique — a straight set is the absence of one. */
  technique: z.string(),
})

export async function saveTechniqueAction(formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const input = techniqueSchema_.parse(Object.fromEntries(formData))

  const technique =
    input.technique === '' ? null : programTechniqueSchema.parse(JSON.parse(input.technique))

  const result = await updateProgramSet(
    userId,
    input.programId,
    input.day,
    input.exercise,
    input.setNumber,
    { technique },
    'ui',
  )
  if (!result) throw new Error('set not found')

  revalidatePath(`/programs/${input.programId}/editor`, 'layout')
  revalidatePath(`/programs/${input.programId}`)
}
