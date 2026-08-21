import { and, asc, count, countDistinct, desc, eq, isNotNull, max, ne, sql } from 'drizzle-orm'
import { cache } from 'react'
import type { ProgramInput, ProgramStatus } from '@/lib/program-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { getAllExercises, type Exercise } from '@/lib/wger'
// Runtime-only cycle with ./program-patches (it imports our catalog helpers,
// we call its TM setter in cloneProgram's block-restart carry-forward) — safe
// because both directions are used strictly inside function bodies, never at
// module init.
import { setTrainingMax, withTx, ProgramPatchError } from './program-patches'
import type { TmIncrement } from '@/lib/tm-restart'
import { hasFeature, requireFeature } from './entitlements'
import { pickNextProgramDay } from '@/lib/next-program-day'
import { nextBlockName } from '@/lib/block-name'
import { db } from './index'
import { NotCoachProposalError, ProposedProgramError } from './program-errors'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import { listCustomExercises } from './custom-exercises'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
  workouts,
  workoutExercises,
  sets,
} from './schema'

/**
 * Data access for training programs, always scoped to a WorkOS userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` on the
 * `programs` root and the children inherit ownership through the FK chain
 * (programs → program_days → program_exercises → program_sets). Route/MCP
 * handlers must go through these helpers rather than touching `program_*`
 * tables directly, so a caller can never read or mutate another user's program.
 */

/** Name-only single-row read (e.g. seeding the coach's context starters) —
 *  deliberately cheaper than getProgramDetail's full nested tree. */
export async function getProgramName(userId: string, id: string): Promise<string | null> {
  const rows = await db
    .select({ name: programs.name })
    .from(programs)
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .limit(1)
  return rows[0]?.name ?? null
}

/** Lists a user's programs, most recently updated first. */
export function listPrograms(userId: string) {
  return db
    .select()
    .from(programs)
    .where(eq(programs.userId, userId))
    .orderBy(desc(programs.updatedAt))
}

/** The user's outstanding program proposals (status 'proposed'), newest
 *  first — the coach's own drafts inbox for `list_proposals`. Read-only:
 *  adopt/decline stay owner-only server actions. */
export function listProposals(userId: string) {
  return db
    .select({
      id: programs.id,
      name: programs.name,
      createdAt: programs.createdAt,
      authorActor: programs.authorActor,
    })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'proposed')))
    .orderBy(desc(programs.createdAt))
}

/** Fetches a single program with its days/exercises (incl. muscle tags)/sets
 *  (incl. per-week overrides), only if owned by the user. */
export function getProgramDetail(userId: string, id: string) {
  return db.query.programs.findFirst({
    where: and(eq(programs.id, id), eq(programs.userId, userId)),
    with: {
      days: {
        orderBy: (d) => [asc(d.position)],
        with: {
          exercises: {
            orderBy: (e) => [asc(e.position)],
            with: {
              muscles: true,
              sets: { orderBy: (s) => [asc(s.setNumber)], with: { overrides: true } },
            },
          },
        },
      },
    },
  })
}

/** The full nested shape returned by getProgramDetail (program + days + exercises + sets). */
export type ProgramDetail = NonNullable<Awaited<ReturnType<typeof getProgramDetail>>>

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The merged (wger + the user's customs) catalog keyed by the composite
 *  `${source}:${id}`; null = neither source available. */
export type ExerciseCatalog = Map<string, Exercise>

/** The composite catalog key — exercise identity is (source, id). Exported
 *  for db/prescriptions.ts, which keys history rows the same way. */
export function catalogKey(source: ExerciseSource, exerciseId: number): string {
  return `${source}:${exerciseId}`
}

/**
 * Fetches the merged exercise catalog — the (in-memory cached) wger catalog
 * plus the user's custom exercises — for author-time muscle tagging. Never
 * called inside a transaction, and failure-tolerant PER SOURCE: muscle tags
 * are enrichment, not integrity, so a wger outage still tags custom slots (and
 * vice versa); both failing yields null and the save proceeds untagged.
 */
export async function loadExerciseCatalog(userId: string): Promise<ExerciseCatalog | null> {
  // Async wrappers so even a synchronous throw lands as a rejection.
  const [wger, customs] = await Promise.allSettled([
    (async () => getAllExercises())(),
    (async () => listCustomExercises(userId))(),
  ])
  if (wger.status === 'rejected' && customs.status === 'rejected') return null
  const catalog: ExerciseCatalog = new Map()
  if (wger.status === 'fulfilled') {
    for (const e of wger.value) catalog.set(catalogKey('wger', e.id), e)
  }
  if (customs.status === 'fulfilled') {
    for (const c of customs.value) {
      catalog.set(catalogKey('custom', c.id), {
        id: c.id,
        name: c.name,
        category: c.category,
        ...(c.muscles && c.muscles.length > 0 ? { muscles: c.muscles } : {}),
        ...(c.musclesSecondary && c.musclesSecondary.length > 0
          ? { musclesSecondary: c.musclesSecondary }
          : {}),
      })
    }
  }
  return catalog
}

/**
 * The `program_exercise_muscles` rows for one exercise slot, from the merged
 * catalog. Primary names win when a muscle is listed on both sides (the unique
 * is per (exercise, muscle)); an unknown (source, id) or missing catalog
 * yields no rows.
 */
export function muscleRowsFor(
  programExerciseId: string,
  source: ExerciseSource,
  exerciseId: number,
  catalog: ExerciseCatalog | null,
): { programExerciseId: string; muscle: string; role: 'primary' | 'secondary' }[] {
  const entry = catalog?.get(catalogKey(source, exerciseId))
  if (!entry) return []
  const primary = entry.muscles ?? []
  const secondary = (entry.musclesSecondary ?? []).filter((m) => !primary.includes(m))
  return [
    ...primary.map((muscle) => ({ programExerciseId, muscle, role: 'primary' as const })),
    ...secondary.map((muscle) => ({ programExerciseId, muscle, role: 'secondary' as const })),
  ]
}

/**
 * Inserts a program's days → exercises → sets (shared by saveProgram and
 * updateProgram). `position` is the 0-based order within its parent; `setNumber`
 * is 1-based within its exercise — mirroring `insertWorkoutChildren`. Each
 * exercise is muscle-tagged from the pre-fetched catalog (after its sets, so
 * the long-standing program→day→exercise→sets write order stays put).
 */
async function insertProgramChildren(
  tx: Tx,
  programId: string,
  days: ProgramInput['days'],
  catalog: ExerciseCatalog | null,
) {
  for (const [dayPosition, day] of days.entries()) {
    const [pd] = await tx
      .insert(programDays)
      .values({
        programId,
        name: day.name,
        position: dayPosition,
        notes: day.notes ?? null,
        // Full-replace like `name`: omitted = unscheduled, not preserved.
        weekdays: day.weekdays ?? [],
      })
      .returning({ id: programDays.id })

    for (const [exPosition, exercise] of day.exercises.entries()) {
      const [pe] = await tx
        .insert(programExercises)
        .values({
          programDayId: pd.id,
          wgerExerciseId: exercise.wgerExerciseId,
          source: exercise.source,
          name: exercise.name,
          position: exPosition,
          supersetGroup: exercise.supersetGroup ?? null,
          progression: exercise.progression ?? null,
        })
        .returning({ id: programExercises.id })

      if (exercise.sets.length > 0) {
        await tx.insert(programSets).values(
          exercise.sets.map((s, i) => ({
            programExerciseId: pe.id,
            setNumber: i + 1,
            setType: s.setType,
            metricMode: s.metricMode,
            repMin: s.repMin ?? null,
            repMax: s.repMax ?? null,
            rir: s.rir ?? null,
            rpe: s.rpe ?? null,
            suggestedLoadKg: s.suggestedLoadKg ?? null,
            tempo: s.tempo ?? null,
            durationSec: s.durationSec ?? null,
            distanceM: s.distanceM ?? null,
            restSec: s.restSec ?? null,
            technique: s.technique ?? null,
          })),
        )
      }

      const muscles = muscleRowsFor(pe.id, exercise.source, exercise.wgerExerciseId, catalog)
      if (muscles.length > 0) {
        await tx.insert(programExerciseMuscles).values(muscles)
      }
    }
  }
}

/**
 * Persists a full program — the `programs` row plus its nested days/exercises/
 * sets — for the given user, atomically. Everything runs inside one
 * `db.transaction`, so a partial save can never happen. The program is stamped
 * with `userId`; the children inherit ownership through the FK chain.
 *
 * Coach drafting policy (enforced HERE, not in the prompt or tool schema): a
 * 'coach' actor always creates `status = 'proposed'` + `authorActor = 'coach'`,
 * whatever status the input carries — the only exits from 'proposed' are the
 * owner's adoptProgram/declineProgram ("we always force the user to confirm").
 *
 * Paid-capability gate (same enforced-HERE stance as the drafting policy):
 * an input asking for `autoregulation: true` requires the 'autoreg' feature,
 * checked before any work. Gating only in the server action left every other
 * adapter — MCP's upsert_program above all — writing the flag ungated; and
 * gating creation alone would let anyone save a Free program and then edit
 * autoregulation onto it, so updateProgram (and the narrow toggle op in
 * program-patches.ts) run the same check. An explicit `true` is a hard
 * refusal — FeatureRequiredError (db/entitlements.ts), which names the plan
 * that says yes — never a silent downgrade of what the caller asked for.
 *
 * An OMITTED flag on create follows the entitlement instead of riding a flat
 * ON default: the web builder always submits the boolean explicitly, so the
 * old `?? true` was only ever exercised by adapters that can omit — exactly
 * the MCP tool this gate exists for, where "just don't mention the flag"
 * must not hand out what "autoregulation: true" refuses. Entitled users keep
 * the propose-don't-impose ON default; Free users land OFF (fail-to-Free,
 * same stance as getEntitlement). updateProgram's omitted flag still
 * PRESERVES the stored value — round-tripping an existing fact is not an
 * acquisition.
 */
export async function saveProgram(
  userId: string,
  input: ProgramInput,
  actor: ProgramEventActor,
): Promise<{ id: string; status: string }> {
  if (input.autoregulation) await requireFeature(userId, 'autoreg')
  // `??` short-circuits on an explicit boolean — the extra entitlement read
  // happens only on the omission path the gate above cannot see.
  const autoregulation = input.autoregulation ?? (await hasFeature(userId, 'autoreg'))
  // Omitted on create = 'draft' (the column default, materialized here so the
  // event payload and the returned echo state it); the coach path forces
  // 'proposed' regardless. The input schema deliberately carries NO default —
  // it would ride updateProgram's full-replace path and deactivate an active
  // program whose upsert omits the field.
  const status = actor === 'coach' ? 'proposed' : (input.status ?? 'draft')
  const catalog = await loadExerciseCatalog(userId) // network read stays outside the tx
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId,
        name: input.name,
        status,
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        // Entitlement-resolved above: explicit input verbatim (true already
        // passed the gate), omitted = ON for entitled users (propose-don't-
        // impose delivery is the softener, not an opt-in gate), OFF for Free.
        autoregulation,
        // Omitted on create = the column default ('all-sets' — C1's rule).
        // No materialization, same discipline as `visibility` below.
        ...(input.autoregStallPolicy !== undefined
          ? { autoregStallPolicy: input.autoregStallPolicy }
          : {}),
        // Omitted on create = null (legacy read-time resolution — see
        // resolveDeloadPolicy). Same no-materialization discipline.
        ...(input.deloadPolicy !== undefined ? { deloadPolicy: input.deloadPolicy } : {}),
        // Diet phase: omitted/null on create = no phase (null IS the off
        // state). An explicit phase stamps set_at — the staleness anchor.
        ...(input.dietPhase !== undefined && input.dietPhase !== null
          ? { dietPhase: input.dietPhase, dietPhaseSetAt: new Date() }
          : {}),
        // Same omitted-on-create = ON rule: default-on keeps fresh users'
        // plans tracking what they actually lift.
        planSync: input.planSync ?? true,
        // Omitted on create = no suggestion (null IS the off state — a
        // cadence is opt-in, unlike the default-on switches above).
        checkInEveryDays: input.checkInEveryDays ?? null,
        // Omitted on create = the column default ('private' — the default
        // forever); an explicit value writes through. No `?? 'private'`
        // materialization — same no-default discipline as the switches above.
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        notes: input.notes ?? null,
        // Article metadata rides create like notes: omitted = null.
        // authorActor mirrors the drafting policy above; a wger import is
        // attributed to 'wger' (open value space) but lands as the input's
        // status ('draft' — the user asked for it, no forced confirm) and
        // every other non-coach caller is an owner path (the column default).
        ...(actor === 'coach'
          ? { authorActor: 'coach' }
          : actor === 'wger'
            ? { authorActor: 'wger' }
            : {}),
        description: input.description ?? null,
        icon: input.icon ?? null,
        heroImageUrl: input.heroImageUrl ?? null,
        sourceUrl: input.sourceUrl ?? null,
      })
      .returning({ id: programs.id })

    await insertProgramChildren(tx, program.id, input.days, catalog)

    // One coarse event — the timeline's opening line, not a per-slot diff.
    await recordProgramEvent(tx, {
      programId: program.id,
      userId,
      actor,
      action: 'upsert_program',
      summary: `Program created ("${input.name}")`,
      payload: { after: { name: input.name, status } },
    })

    // The effective status rides back so the MCP echo reports what was
    // actually saved, not what the input said (or omitted).
    return { id: program.id, status }
  })
}

/** Structural address of one planned set within a program tree. Row ids die
 *  in a full replace; this address is the identity a preserved override
 *  re-keys on. */
function setAddress(dayPosition: number, exercisePosition: number, setNumber: number): string {
  return `${dayPosition}:${exercisePosition}:${setNumber}`
}

/**
 * Snapshots a program's per-week set overrides, each addressed by
 * (day position, exercise position, setNumber). Must run BEFORE the child
 * wipe: `ProgramInput` cannot express overrides, so without this snapshot a
 * full replace cascades them away with the old set rows.
 */
function snapshotSetOverrides(tx: Tx, programId: string) {
  return tx
    .select({
      dayPosition: programDays.position,
      exercisePosition: programExercises.position,
      setNumber: programSets.setNumber,
      week: programSetOverrides.week,
      repMin: programSetOverrides.repMin,
      repMax: programSetOverrides.repMax,
      rir: programSetOverrides.rir,
      rpe: programSetOverrides.rpe,
      suggestedLoadKg: programSetOverrides.suggestedLoadKg,
      tempo: programSetOverrides.tempo,
      durationSec: programSetOverrides.durationSec,
      distanceM: programSetOverrides.distanceM,
      restSec: programSetOverrides.restSec,
      technique: programSetOverrides.technique,
    })
    .from(programSetOverrides)
    .innerJoin(programSets, eq(programSets.id, programSetOverrides.programSetId))
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .where(eq(programDays.programId, programId))
}

type OverrideSnapshot = Awaited<ReturnType<typeof snapshotSetOverrides>>

/**
 * Re-attaches snapshotted overrides to the RECREATED set rows at the same
 * structural address (same-position semantics). An address the new tree no
 * longer has — a removed day/exercise/set — takes its overrides with it, by
 * design: an override without its slot has nothing to override.
 */
async function reattachSetOverrides(
  tx: Tx,
  programId: string,
  snapshot: OverrideSnapshot,
): Promise<void> {
  if (snapshot.length === 0) return
  const newSets = await tx
    .select({
      id: programSets.id,
      dayPosition: programDays.position,
      exercisePosition: programExercises.position,
      setNumber: programSets.setNumber,
    })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .where(eq(programDays.programId, programId))
  const idByAddress = new Map(
    newSets.map((s) => [setAddress(s.dayPosition, s.exercisePosition, s.setNumber), s.id]),
  )
  const rows = snapshot.flatMap((o) => {
    const programSetId = idByAddress.get(setAddress(o.dayPosition, o.exercisePosition, o.setNumber))
    if (!programSetId) return []
    return [
      {
        programSetId,
        week: o.week,
        repMin: o.repMin,
        repMax: o.repMax,
        rir: o.rir,
        rpe: o.rpe,
        suggestedLoadKg: o.suggestedLoadKg,
        tempo: o.tempo,
        durationSec: o.durationSec,
        distanceM: o.distanceM,
        restSec: o.restSec,
        technique: o.technique,
      },
    ]
  })
  if (rows.length > 0) await tx.insert(programSetOverrides).values(rows)
}

/**
 * Replaces a program's metadata + days/exercises/sets atomically, only if owned
 * by the user. The `update ... returning` doubles as the ownership gate: no row
 * back means the caller doesn't own it (or it's gone) and nothing is mutated.
 * Children are deleted (cascade removes their descendants) and re-inserted.
 * Per-week set overrides — inexpressible in `ProgramInput` — are preserved by
 * re-keying onto the recreated rows at the same (day, exercise, setNumber)
 * address; overrides on removed slots die with them.
 *
 * Coach drafting policy (the write-side twin of saveProgram's): a 'coach'
 * actor may replace ONLY its own still-unadopted drafts — rows with
 * `status = 'proposed'` AND `authorActor = 'coach'` — and the row stays
 * 'proposed' (never a promotion path). Anything else owned by the user is
 * refused with NotCoachProposalError; adopted/owner programs are reachable
 * for the coach only through the approval-gated patch tools.
 */
export async function updateProgram(
  userId: string,
  id: string,
  input: ProgramInput,
  actor: ProgramEventActor,
): Promise<{ id: string; status: string } | null> {
  // The autoreg paid gate — see saveProgram's doc: a full replace can edit
  // the flag onto a Free program, so the create-side check alone is not a
  // gate. Runs before the ownership read, matching the action-era ordering
  // (an unentitled ask fails as an entitlement refusal, not a not-found).
  if (input.autoregulation) await requireFeature(userId, 'autoreg')
  const isCoach = actor === 'coach'
  const status = isCoach ? 'proposed' : input.status
  const catalog = await loadExerciseCatalog(userId) // network read stays outside the tx
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .update(programs)
      .set({
        name: input.name,
        // Omitted on update = PRESERVE the stored status: an upsert that
        // never mentions it must not deactivate an ACTIVE program back to
        // 'draft'. Same discipline as the switches below; the coach path
        // always writes 'proposed' (its gate only matches such rows anyway).
        ...(status !== undefined ? { status } : {}),
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        // Omitted on update = PRESERVE the stored switch: an upsert that
        // doesn't mention the field must never flip a user's OFF back ON.
        ...(input.autoregulation !== undefined ? { autoregulation: input.autoregulation } : {}),
        // Same preserve rule for the stall policy: an upsert that omits it
        // must never flip a stored 'first-set' back to the default.
        ...(input.autoregStallPolicy !== undefined
          ? { autoregStallPolicy: input.autoregStallPolicy }
          : {}),
        // Same preserve rule for the deload policy; explicit null clears it
        // back to legacy read-time resolution.
        ...(input.deloadPolicy !== undefined ? { deloadPolicy: input.deloadPolicy } : {}),
        // Same preserve rule for the diet phase; explicit null clears it.
        // set_at bumps ONLY when the stored value actually changes (IS
        // DISTINCT FROM — null-safe), so a full-replace save that round-trips
        // an unchanged phase never fakes freshness on the staleness signal.
        ...(input.dietPhase !== undefined
          ? {
              dietPhase: input.dietPhase,
              dietPhaseSetAt: sql`case when ${programs.dietPhase} is distinct from ${input.dietPhase ?? null} then now() else ${programs.dietPhaseSetAt} end`,
            }
          : {}),
        ...(input.planSync !== undefined ? { planSync: input.planSync } : {}),
        // Same preserve rule for the check-in cadence; explicit null clears it.
        ...(input.checkInEveryDays !== undefined
          ? { checkInEveryDays: input.checkInEveryDays }
          : {}),
        // Same preserve rule for sharing visibility: an upsert that omits the
        // field must never flip a shared program back to private.
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        notes: input.notes ?? null,
        description: input.description ?? null,
        icon: input.icon ?? null,
        heroImageUrl: input.heroImageUrl ?? null,
        sourceUrl: input.sourceUrl ?? null,
        updatedAt: new Date(),
      })
      // Owner path — ne('proposed'): a full replace may set status, so it is
      // a promotion path and must never move a proposal — only adoptProgram/
      // declineProgram may (and even an omitted-status replace must not
      // rewrite a proposal's content). Coach path — the inverse gate: ONLY
      // its own proposal rows match, so the coach can never touch an
      // owner-authored or adopted program through this write.
      .where(
        isCoach
          ? and(
              eq(programs.id, id),
              eq(programs.userId, userId),
              eq(programs.status, 'proposed'),
              eq(programs.authorActor, 'coach'),
            )
          : and(eq(programs.id, id), eq(programs.userId, userId), ne(programs.status, 'proposed')),
      )
      // status rides back so an omitted-status replace can report the
      // PRESERVED stored value (the row's post-update truth either way).
      .returning({ id: programs.id, status: programs.status })
    if (!owned) {
      // Distinguish "not owned/missing" (null, like before) from "refused
      // by policy" (a clear, actionable error for the caller).
      const [existing] = await tx
        .select({ status: programs.status })
        .from(programs)
        .where(and(eq(programs.id, id), eq(programs.userId, userId)))
      if (!existing) return null
      if (isCoach) throw new NotCoachProposalError(id)
      if (existing.status === 'proposed') throw new ProposedProgramError(id)
      return null
    }

    // Snapshot → wipe → re-attach: overrides can't ride ProgramInput, so
    // they'd otherwise cascade away with the deleted set rows.
    const overrides = await snapshotSetOverrides(tx, id)
    await tx.delete(programDays).where(eq(programDays.programId, id))
    await insertProgramChildren(tx, id, input.days, catalog)
    await reattachSetOverrides(tx, id, overrides)
    // Full-replace is deliberately ONE coarse event, not a per-slot diff —
    // the granular story lives on the patch ops.
    await recordProgramEvent(tx, {
      programId: id,
      userId,
      actor,
      action: 'upsert_program',
      summary: 'Program replaced',
      // The event records the row's actual post-write status — for an
      // omitted-status replace that is the preserved stored value, which the
      // input can't know.
      payload: { after: { name: input.name, status: owned.status } },
    })
    return { id, status: owned.status }
  })
}

/** Deletes a program (and its children, via FK cascade) only if owned by the user. */
export function deleteProgram(userId: string, id: string) {
  return db
    .delete(programs)
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
}

/**
 * Updates only a program's lifecycle status, gated on ownership via the
 * `update ... returning`. Returns null when the user doesn't own the program.
 * Activating also archives the user's other active programs — the home hero
 * must never tiebreak between two actives by recency (one active at a time).
 *
 * Promotion guard: a 'proposed' row is refused (ProposedProgramError) — its
 * only exits are adoptProgram/declineProgram. The refusal check runs only
 * when the gated update matched nothing, so the happy path stays one write.
 */
export async function setProgramStatus(
  userId: string,
  id: string,
  status: ProgramStatus,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId), ne(programs.status, 'proposed')))
    .returning({ id: programs.id })
  if (!owned) {
    const [existing] = await db
      .select({ status: programs.status })
      .from(programs)
      .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    if (existing?.status === 'proposed') throw new ProposedProgramError(id)
    return null
  }
  // Sibling sweep AFTER the ownership gate: a not-owned activate must never
  // archive anything. eq(status,'active') keeps 'proposed' rows out of the
  // sweep by construction — a proposal is never "the other active".
  // No transaction — a sweep failure just preserves the
  // pre-existing two-active state, which self-heals on the next activate.
  if (status === 'active' && owned) {
    await db
      .update(programs)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(programs.userId, userId), eq(programs.status, 'active'), ne(programs.id, id)))
  }
  // Event only after the gated update matched — a not-owned call logs nothing.
  // No transaction here (see above), so the event rides the root handle; the
  // archived SIBLINGS get no event of their own — the activation is the fact.
  if (owned) {
    await recordProgramEvent(db, {
      programId: id,
      userId,
      actor,
      action: 'set_program_status',
      summary: `Status → ${status}`,
      payload: { after: { status } },
    })
  }
  return owned ?? null
}

/**
 * Narrow metadata write: the program article's description only (markdown —
 * the FullEditor's save path; MCP's upsert_program remains the full-replace
 * route). Owner-gated like setProgramStatus, and 'proposed' rows are excluded
 * the same way — a proposal's article is the proposer's draft until adopted.
 * Returns null when not owned (or proposed).
 */
export async function updateProgramDescription(
  userId: string,
  id: string,
  description: string | null,
): Promise<{ id: string } | null> {
  // Read the prior value first so the event line can say add vs edit vs clear
  // (the UPDATE's RETURNING only sees the new row). Same owner gate as the
  // write; a not-owned call selects nothing and the update matches nothing.
  const [prior] = await db
    .select({ description: programs.description })
    .from(programs)
    .where(and(eq(programs.id, id), eq(programs.userId, userId), ne(programs.status, 'proposed')))
  const [owned] = await db
    .update(programs)
    .set({ description, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId), ne(programs.status, 'proposed')))
    .returning({ id: programs.id })
  // Event only after the gated update matched — mirrors setProgramStatus.
  // Owner-only server action is the sole caller, hence the hardcoded 'ui'.
  if (owned) {
    const hadDescription = Boolean(prior?.description)
    const summary =
      description === null
        ? 'Description cleared'
        : hadDescription
          ? 'Description updated'
          : 'Description added'
    await recordProgramEvent(db, {
      programId: id,
      userId,
      actor: 'ui',
      action: 'update_description',
      summary,
      payload: { after: { hasDescription: description !== null } },
    })
  }
  return owned ?? null
}

/**
 * The forced confirm's accept path — the ONLY way a 'proposed' program leaves
 * that status upward. Owner-only by construction (userId gate + the UI server
 * action is the sole caller), hence the hardcoded 'ui' actor. `activate: true`
 * goes straight to 'active' and runs the same single-active sweep as
 * setProgramStatus; false lands on 'draft'. Returns null when the row isn't
 * owned or isn't a proposal (adopt is meaningless elsewhere — no side effects).
 */
export async function adoptProgram(
  userId: string,
  programId: string,
  activate: boolean,
): Promise<{ id: string } | null> {
  const status = activate ? 'active' : 'draft'
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(programs.id, programId),
        eq(programs.userId, userId),
        eq(programs.status, 'proposed'),
      ),
    )
    .returning({ id: programs.id })
  if (!owned) return null
  // Same sweep discipline as setProgramStatus: gate first, no transaction (a
  // sweep failure self-heals on the next activate).
  if (activate) {
    await db
      .update(programs)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(eq(programs.userId, userId), eq(programs.status, 'active'), ne(programs.id, programId)),
      )
  }
  // The adoption is an OWNER fact — the audit line the PRD's attribution
  // metric asserts on ("adoption logs an owner event").
  await recordProgramEvent(db, {
    programId,
    userId,
    actor: 'ui',
    action: 'adopt_program',
    summary: `Proposal adopted → ${status}`,
    payload: { after: { status } },
  })
  return owned
}

/**
 * The forced confirm's reject path: hard delete (PRD open question resolved —
 * hard-delete v1; restart-as-clone never applied, a proposal has no history).
 * Gated on ownership AND 'proposed' so this can never delete an adopted or
 * owner-authored program. The decline event is recorded in the same
 * transaction BEFORE the delete (FK order); it cascades away with the row —
 * accepted for v1, and it becomes a durable trail the day decline turns into
 * a soft status instead of a delete.
 */
export async function declineProgram(
  userId: string,
  programId: string,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(
          eq(programs.id, programId),
          eq(programs.userId, userId),
          eq(programs.status, 'proposed'),
        ),
      )
    if (!owned) return null
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor: 'ui',
      action: 'decline_program',
      summary: 'Proposal declined',
      payload: { after: { deleted: true } },
    })
    await tx.delete(programs).where(eq(programs.id, programId))
    return { id: owned.id }
  })
}

/**
 * Clones a program's ENTIRE tree row-for-row — days, exercises (superset
 * groups, custom-exercise source, progression), sets (technique, per-set
 * rest), per-week set overrides, and muscle tags — as a fresh DRAFT named by
 * `nextBlockName` ("PPL" → "PPL — Block 2"). Row copy, NOT a ProgramInput
 * round-trip: the input schema cannot express per-week overrides (the update
 * path preserves them by re-keying; the clone copies them row-for-row with no
 * address remap), and copying muscle rows verbatim skips the catalog fetch —
 * no network in this path. Positions/setNumbers are copied
 * from the source rows. Returns null when the source isn't owned; the caller
 * decides activation (restart activates, which archives an active source via
 * the single-active sweep).
 */
export async function cloneProgram(
  userId: string,
  sourceId: string,
  actor: ProgramEventActor,
  options?: {
    /**
     * Block-restart TM carry-forward (plan §5): each entry applies ONE
     * `setTrainingMax` (reason 'block-restart') to the CLONE inside the clone
     * transaction — event-logged on the new program's timeline. Callers
     * compute the list via `restartTmPlan` (amrap-cycle exercises minus M4
     * flags); an entry whose address/scheme no longer matches is skipped
     * (the restart itself must not fail over a lost bump — silence over
     * corruption). Omitted = a pure copy.
     */
    tmIncrements?: readonly TmIncrement[]
  },
): Promise<{ id: string } | null> {
  const source = await getProgramDetail(userId, sourceId) // ownership gate
  if (!source) return null
  // A proposal must not be laundered into an adopted plan through clone/
  // restart — cloning would mint an owner-authored draft twin with no adopt
  // event. Adopt or decline first; the clone paths stay owner-only.
  if (source.status === 'proposed') throw new ProposedProgramError(sourceId)
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId,
        name: nextBlockName(source.name),
        status: 'draft',
        mesocycleWeeks: source.mesocycleWeeks,
        deloadWeek: source.deloadWeek,
        // Deliberately NOT clamped to the adopter-entitlement check that
        // adoptTemplate/adoptShared apply: a block restart CONTINUES the
        // owner's own stored flag rather than ACQUIRING a new one, and
        // clamping here would flip live prescriptions for a lifter mid-block
        // after a lapse — worse than carrying the stored value forward.
        autoregulation: source.autoregulation,
        autoregStallPolicy: source.autoregStallPolicy,
        deloadPolicy: source.deloadPolicy,
        // The overshoot policy encodes the program's GOAL (like deloadPolicy),
        // so it travels with the block. Per-exercise overrides copy with the
        // tree (copyProgramTree copies exercise rows verbatim).
        overshootPolicy: source.overshootPolicy,
        // dietPhase / dietPhaseSetAt deliberately do NOT travel: a phase is a
        // fact about the lifter's CURRENT diet, not about the plan — a new
        // block starts phase-less until the owner says otherwise (same
        // rationale in adoptTemplate/adoptShared).
        planSync: source.planSync,
        checkInEveryDays: source.checkInEveryDays,
        notes: source.notes,
        // Article metadata travels with the block; authorActor deliberately
        // does NOT — the owner initiated the clone, so the copy is
        // owner-authored (column default). `visibility` deliberately does NOT
        // travel either (a deliberate divergence from the metadata carry): a
        // clone is a NEW private thing, so omitting the column lands it on
        // the 'private' default instead of inheriting a shared source's reach.
        description: source.description,
        icon: source.icon,
        heroImageUrl: source.heroImageUrl,
        sourceUrl: source.sourceUrl,
      })
      .returning({ id: programs.id })

    await copyProgramTree(tx, source.days, program.id)

    // Logged on the NEW program: its timeline opens with where it came from
    // (the source keeps its own history — clone rows cascade with the clone).
    await recordProgramEvent(tx, {
      programId: program.id,
      userId,
      actor,
      action: 'restart_program',
      summary: `Block restarted from "${source.name}"`,
      payload: { sourceProgramId: sourceId },
    })

    // TM carry-forward: one block-boundary bump per clean amrap-cycle
    // exercise, through THE setter (event-logged, actor-attributed), riding
    // this same transaction. bankedWaves resets to 0: the clone has no
    // history, so a stale bank from the source would wrongly suppress the
    // new block's first wave bumps. A mismatch (null / wrong scheme after a
    // concurrent edit) skips that bump rather than failing the restart.
    for (const increment of options?.tmIncrements ?? []) {
      try {
        await setTrainingMax(
          userId,
          program.id,
          increment.dayPosition,
          increment.exercisePosition,
          increment.toKg,
          'block-restart',
          actor,
          { bankedWaves: 0, runIn: withTx(tx) },
        )
      } catch (error: unknown) {
        if (!(error instanceof ProgramPatchError)) throw error
      }
    }

    return { id: program.id }
  })
}

/**
 * Row-for-row copy of a program's day → exercise → set (+ per-week overrides)
 * → muscle-tag tree onto an already-inserted `programs` row. Extracted from
 * cloneProgram (which established the copy semantics) so adoptShared
 * (db/program-shares.ts) reuses the exact same fidelity for cross-account
 * clones. Positions/setNumbers copy verbatim; no catalog fetch — muscle rows
 * copy as stored. Runs on the CALLER's transaction handle.
 */
export async function copyProgramTree(
  tx: Tx,
  days: ProgramDetail['days'],
  programId: string,
): Promise<void> {
  for (const day of days) {
    const [pd] = await tx
      .insert(programDays)
      .values({
        programId,
        name: day.name,
        position: day.position,
        notes: day.notes,
        // The schedule is part of the day, so the next block trains on the
        // same weekdays until the owner edits it.
        weekdays: day.weekdays,
      })
      .returning({ id: programDays.id })

    for (const exercise of day.exercises) {
      const [pe] = await tx
        .insert(programExercises)
        .values({
          programDayId: pd.id,
          wgerExerciseId: exercise.wgerExerciseId,
          source: exercise.source,
          name: exercise.name,
          position: exercise.position,
          supersetGroup: exercise.supersetGroup,
          progression: exercise.progression,
          overshootPolicy: exercise.overshootPolicy,
        })
        .returning({ id: programExercises.id })

      if (exercise.sets.length > 0) {
        // Postgres returns batch-insert RETURNING rows in VALUES order —
        // the index zip below relies on it to remap overrides.
        const newSets = await tx
          .insert(programSets)
          .values(
            exercise.sets.map((s) => ({
              programExerciseId: pe.id,
              setNumber: s.setNumber,
              setType: s.setType,
              metricMode: s.metricMode,
              repMin: s.repMin,
              repMax: s.repMax,
              rir: s.rir,
              rpe: s.rpe,
              suggestedLoadKg: s.suggestedLoadKg,
              tempo: s.tempo,
              durationSec: s.durationSec,
              distanceM: s.distanceM,
              restSec: s.restSec,
              technique: s.technique,
            })),
          )
          .returning({ id: programSets.id })

        const overrideRows = exercise.sets.flatMap((s, i) =>
          s.overrides.map((o) => ({
            programSetId: newSets[i].id,
            week: o.week,
            repMin: o.repMin,
            repMax: o.repMax,
            rir: o.rir,
            rpe: o.rpe,
            suggestedLoadKg: o.suggestedLoadKg,
            tempo: o.tempo,
            durationSec: o.durationSec,
            distanceM: o.distanceM,
            restSec: o.restSec,
            technique: o.technique,
          })),
        )
        if (overrideRows.length > 0) {
          await tx.insert(programSetOverrides).values(overrideRows)
        }
      }

      if (exercise.muscles.length > 0) {
        await tx.insert(programExerciseMuscles).values(
          exercise.muscles.map((m) => ({
            programExerciseId: pe.id,
            muscle: m.muscle,
            role: m.role,
          })),
        )
      }
    }
  }
}

/**
 * Fetches a single program day with its exercises and sets, only if the parent
 * program is owned by the user. Ownership is gated through the day's program
 * (the `program: one(programs)` relation); a day whose program belongs to
 * someone else returns null. Used to instantiate a day into a workout and to
 * build the plan overlay on `get_workout`.
 */
export async function getProgramDayDetail(userId: string, programDayId: string) {
  const day = await db.query.programDays.findFirst({
    where: eq(programDays.id, programDayId),
    with: {
      program: {
        // status rides along so instantiation can refuse proposals — a
        // 'proposed' plan instantiates nothing until the owner adopts it.
        // planSync rides along for the post-finish auto-sync gate
        // (lib/auto-plan-sync) — same read, no extra round-trip.
        columns: { id: true, userId: true, status: true, mesocycleWeeks: true, deloadWeek: true, autoregulation: true, autoregStallPolicy: true, deloadPolicy: true, dietPhase: true, overshootPolicy: true, planSync: true },
      },
      exercises: {
        orderBy: (e) => [asc(e.position)],
        with: {
          sets: { orderBy: (s) => [asc(s.setNumber)], with: { overrides: true } },
        },
      },
    },
  })
  if (!day || day.program.userId !== userId) return null
  return day
}

/** The nested shape returned by getProgramDayDetail (day + exercises + sets). */
export type ProgramDayDetail = NonNullable<Awaited<ReturnType<typeof getProgramDayDetail>>>

/** Where the program's history places the user in the mesocycle. */
export interface ProgramWeekState {
  /** Same value `nextProgramWeek` has always returned (clamped). */
  currentWeek: number
  /**
   * The advancement rule fired AT the final week: every day of week
   * `mesocycleWeeks` has a completed session. Earlier skipped weeks don't
   * block completion — the same policy that lets the week advance past them.
   */
  blockComplete: boolean
}

/**
 * The week `instantiate_program_day` should default to, derived from the
 * program's own workout history (no stored counter to drift): the highest
 * `programWeek` actually TRAINED (≥1 completed set — instantiating alone
 * counts for nothing, see the predicate below) is the current week; once
 * every day of the program has a completed, trained workout at that week, the
 * cycle is complete and the next week begins — clamped to `mesocycleWeeks` so
 * a finished meso re-runs its last week rather than extrapolating. No trained
 * history → week 1.
 *
 * `blockComplete` is that same rule firing AT the boundary: the observed week
 * is at (or past) `mesocycleWeeks` and every day of it is done. Accepted
 * edge: a manually overshot week (`current > mesocycleWeeks`) computes
 * completion against the OVERSHOT week, so a finished final week followed by
 * a partial overshoot reads incomplete — manual overshoot is already a
 * documented anomaly path.
 */
export async function programWeekState(
  userId: string,
  programId: string,
  mesocycleWeeks: number,
): Promise<ProgramWeekState> {
  // A workout counts toward the week axis only when it was actually TRAINED:
  // ≥1 completed set. `completedAt` alone is a weak proxy — MCP-created and
  // legacy rows can carry completedAt with zero completed sets, and such
  // ghosts both raised the observed week and advanced the cycle (the
  // cooked-block incident, 2026-07-19). Raw sql (not db.select) so the
  // predicate stays a plain introspectable expression.
  const trainedWorkout = sql`exists (
    select 1 from ${workoutExercises}
    inner join ${sets} on ${sets.workoutExerciseId} = ${workoutExercises.id}
    where ${workoutExercises.workoutId} = ${workouts.id} and ${sets.completed}
  )`

  const [agg] = await db
    .select({ current: max(workouts.programWeek) })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(and(eq(programDays.programId, programId), eq(workouts.userId, userId), trainedWorkout))
  const current = agg?.current ?? null
  if (current === null) return { currentWeek: 1, blockComplete: false }

  // Independent reads — one round-trip of latency instead of two.
  const [[dayTotal], [daysDone]] = await Promise.all([
    db
      .select({ value: count(programDays.id) })
      .from(programDays)
      .where(eq(programDays.programId, programId)),
    db
      .select({ value: countDistinct(workouts.programDayId) })
      .from(workouts)
      .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
      .where(
        and(
          eq(programDays.programId, programId),
          eq(workouts.userId, userId),
          eq(workouts.programWeek, current),
          // COMPLETED days only: a started-but-unfinished (or later-
          // discarded) session must not advance the mesocycle week — and
          // "completed" means trained (≥1 completed set), not just a
          // completedAt stamp (see trainedWorkout above).
          isNotNull(workouts.completedAt),
          trainedWorkout,
        ),
      ),
  ])

  const cycleComplete = daysDone.value >= dayTotal.value
  return {
    currentWeek: cycleComplete ? Math.min(current + 1, Math.max(1, mesocycleWeeks)) : current,
    blockComplete: cycleComplete && current >= mesocycleWeeks,
  }
}

/** Thin wrapper: the number every existing caller reads. See `programWeekState`. */
export async function nextProgramWeek(
  userId: string,
  programId: string,
  mesocycleWeeks: number,
): Promise<number> {
  return (await programWeekState(userId, programId, mesocycleWeeks)).currentWeek
}

/** A program-scoped workout row for the week view: provenance (which day,
 *  which week) plus the summary aggregates a day card renders. */
export interface ProgramWorkout {
  id: string
  programDayId: string | null
  programWeek: number | null
  startedAt: Date
  completedAt: Date | null
  setCount: number
  completedSetCount: number
  volumeKg: number
}

/**
 * Every workout instantiated from this program's days, freshest first, with
 * the same per-workout aggregates as `listWorkoutSummaries` (set counts +
 * Σ reps × weight volume via leftJoins, so a set-less workout still lists).
 * Double-gated per the module convention: `workouts.userId` is the
 * authorization boundary and `programDays.programId` scopes to the program —
 * the innerJoin through `program_days` is what ties a workout to the program
 * (workouts carry `programDayId`, not `programId`). The page buckets these
 * rows by (programDayId, programWeek) to resolve each day card's state.
 */
export function listProgramWorkouts(userId: string, programId: string) {
  return db
    .select({
      id: workouts.id,
      programDayId: workouts.programDayId,
      programWeek: workouts.programWeek,
      startedAt: workouts.startedAt,
      completedAt: workouts.completedAt,
      setCount: count(sets.id),
      completedSetCount:
        sql<number>`coalesce(sum(case when ${sets.completed} then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
    })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(and(eq(workouts.userId, userId), eq(programDays.programId, programId)))
    .groupBy(workouts.id)
    .orderBy(desc(workouts.startedAt))
}

/** What the home screen's "up next" card renders: the day a user should train
 *  next in their active program, plus enough context to preview it. */
export interface NextProgramDay {
  programId: string
  programName: string
  dayId: string
  dayName: string
  week: number
  exerciseNames: string[]
  /** The day's weekday schedule (0–6, Sunday-first); empty = unscheduled. The
   *  hero's time anchor ("Today"/"Tomorrow"/weekday) is computed CLIENT-side
   *  from this — the server's calendar day is not the user's (local-day.ts). */
  weekdays: number[]
  /** The block finished its final week — the hero swaps its Start CTA for a
   *  completion banner. The final week stays re-runnable on the program page. */
  blockComplete: boolean
  /** Block length for the completion banner's "N weeks" line. */
  mesocycleWeeks: number
}

/**
 * The next day to train in the user's active program — the composition the
 * home screen widget needs, or null when there's nothing to suggest (no
 * active program, or an active program with no days).
 *
 * "Active" is the most recently updated program with status 'active'. The
 * activate paths (`setProgramStatus`, `adoptProgram`) sweep sibling actives to
 * 'archived', but the sweep is best-effort and no DB constraint enforces
 * uniqueness — recency is the tiebreak for a brief two-active state. The week
 * comes from `programWeekState`; the day rotates forward from the last day
 * trained at that week, wrapping to make up skipped days
 * (`pickNextProgramDay`).
 */
async function getNextProgramDayUncached(userId: string): Promise<NextProgramDay | null> {
  const [program] = await db
    .select({
      id: programs.id,
      name: programs.name,
      mesocycleWeeks: programs.mesocycleWeeks,
    })
    .from(programs)
    // eq(status,'active') is also the proposal exclusion: a 'proposed' row can
    // never become 'active' outside adoptProgram, so next-day derivation
    // structurally cannot pick one.
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program) return null

  // The day list and the current week don't depend on each other — fetch them
  // concurrently (this runs on every home-page load).
  const [days, weekState] = await Promise.all([
    db
      .select({
        id: programDays.id,
        name: programDays.name,
        position: programDays.position,
        weekdays: programDays.weekdays,
      })
      .from(programDays)
      .where(eq(programDays.programId, program.id))
      .orderBy(asc(programDays.position)),
    programWeekState(userId, program.id, program.mesocycleWeeks),
  ])
  const week = weekState.currentWeek

  const logged = await db
    .selectDistinct({ dayId: workouts.programDayId })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(programDays.programId, program.id),
        eq(workouts.userId, userId),
        eq(workouts.programWeek, week),
        // COMPLETED days only. Merely STARTING a day used to consume it for
        // the week — an accidental start (or an in-progress session) rotated
        // the hero to the next day as if the work had been done.
        isNotNull(workouts.completedAt),
      ),
    )

  const next = pickNextProgramDay(
    days,
    new Set(logged.map((r) => r.dayId).filter((id): id is string => id !== null)),
  )
  if (!next) return null

  const exerciseRows = await db
    .select({ name: programExercises.name })
    .from(programExercises)
    .where(eq(programExercises.programDayId, next.id))
    .orderBy(asc(programExercises.position))

  return {
    programId: program.id,
    programName: program.name,
    dayId: next.id,
    dayName: next.name,
    week,
    exerciseNames: exerciseRows.map((r) => r.name),
    weekdays: next.weekdays,
    blockComplete: weekState.blockComplete,
    mesocycleWeeks: program.mesocycleWeeks,
  }
}

/** Request-memoized entrypoint (React cache — per-request only, never
 *  cross-request): home + drawer + any section can call it freely within one
 *  render and share a single derivation. CONSTRAINT: args must stay
 *  cache-key-safe primitives. */
export const getNextProgramDay = cache(getNextProgramDayUncached)

/**
 * Day count for one owned program — the program_started analytics event's
 * day_count property. 0 when the program isn't found/owned (the capture
 * helper treats that as fine; analytics never gates on ownership errors).
 */
export async function countProgramDays(userId: string, programId: string): Promise<number> {
  const [row] = await db
    .select({ value: count(programDays.id) })
    .from(programDays)
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(and(eq(programDays.programId, programId), eq(programs.userId, userId)))
  return row?.value ?? 0
}
