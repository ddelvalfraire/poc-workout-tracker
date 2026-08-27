'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { parseWorkoutInput } from '@/lib/workout-input'
import {
  saveWorkout,
  updateWorkout,
  deleteWorkout,
  uncompleteWorkout,
  recompleteWorkout,
  getLastPerformance,
  getWorkoutDetail,
  hasAnyCompletedWorkout,
  getWorkoutAnalyticsState,
  type LastPerformance,
} from '@/db/workouts'
import { captureServerEvent, durationMin, workoutInputCounts } from '@/lib/analytics'
import { getProgramDayDetail } from '@/db/programs'
import { deriveDayPrescription } from '@/db/prescriptions'
import { substituteProgramExercise } from '@/db/program-patches'
import { completeWorkoutSideEffects } from '@/lib/workout-completion'
import { substituteSlot } from '@/lib/substitute-slot'
import type { PlanSetTarget } from '@/lib/format'
import {
  getExerciseStats,
  getExerciseSessions,
  type ExerciseAllTimeStats,
  type ExerciseSession,
} from '@/db/exercise-stats'
import { getWorkoutDraft, putWorkoutDraft, deleteWorkoutDraft } from '@/db/workout-drafts'
import { createWorkoutShare, revokeWorkoutShare } from '@/db/workout-shares'
import { isDraftPayload, DRAFT_TTL_MS, draftKey } from '@/app/workout/new/draft-payload'
import type { WorkoutEventKind } from '@/db/workout-events'
import { uncompleteCascade, type UncompleteCascade } from '@/db/uncomplete-cascade'

/**
 * Validates and persists a workout for the signed-in user, returning the new id.
 *
 * Validation runs here on the server — independent of any client-side checks —
 * so malformed input is rejected even if the browser sends it directly. A throw
 * (auth redirect, validation failure, or DB error) surfaces to the caller as a
 * rejected action; the client component is expected to `try/catch` it.
 */
/**
 * Analytics wrapper: the pre-reads (is_first, prior state) can themselves
 * throw, and captureServerEvent's own fail-open only covers the transport —
 * so the WHOLE capture path runs inside one swallow. Never awaited by the
 * user-facing work below; a lost event is always preferable to a failed save.
 */
async function captureWorkoutEvent(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.error('[analytics] workout event failed', error)
  }
}

/**
 * Analytics pre-read that can NEVER fail the surrounding action — catches
 * synchronous throws too (a bare `.catch()` on the call wouldn't), degrading
 * to the fallback.
 */
async function safeRead<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  // Read BEFORE the save so the workout being logged doesn't count itself.
  const isFirstPromise = safeRead(async () => !(await hasAnyCompletedWorkout(userId)), false)
  // A manual log is the session's ORIGINAL record — first persist, nothing
  // to contradict. The UI is the actor.
  const result = await saveWorkout(userId, parsed, { actor: 'ui', kind: 'original' })
  // A manual log IS a completion (saveWorkout stamps completedAt) — this is
  // the activation metric's event. Counts only; no workout content.
  void captureWorkoutEvent(async () =>
    captureServerEvent(userId, {
      name: 'workout_completed',
      properties: {
        duration_min: durationMin(parsed.startedAt ?? null, parsed.completedAt ?? null),
        ...workoutInputCounts(parsed),
        is_first: await isFirstPromise,
      },
    }),
  )
  // The saved workout supersedes the /workout/new draft on every device.
  await deleteWorkoutDraft(userId, draftKey())
  // The shared post-save domain pipeline (plan sync → goals → trophies) —
  // lib/workout-completion.ts owns the ordering and the fail-soft contract,
  // and the MCP write tools ride the same seam. A quick log is a guaranteed
  // plan-sync no-op (no provenance), but the seam always fires so a future
  // provenance-carrying save path can't silently miss it.
  await completeWorkoutSideEffects(userId, result.id)
  revalidatePath('/') // keep the home history list fresh
  return result
}

/**
 * What a save through `updateWorkoutAction` MEANS, in the change log's terms.
 *
 * The action serves two callers that are indistinguishable from the server's
 * side: the logger FINISHING an instantiated program day — that session's
 * first real persist, an 'original' — and edit mode's "Save changes", which
 * contradicts what was already recorded, an 'amendment'. Only the caller
 * knows which it is, so it declares it; `workouts.completedAt` (or any other
 * timestamp) cannot discriminate, and inferring from one is precisely the
 * guesswork this log exists to replace.
 *
 * The other two event kinds are deliberately out of reach here: 'system' is
 * the app's own writes, never a UI action, and 'late_entry' belongs to a
 * backdated-capture path this action is not.
 */
export type WorkoutUpdateKind = Extract<WorkoutEventKind, 'original' | 'amendment'>

const UPDATE_KINDS: readonly string[] = ['original', 'amendment'] satisfies WorkoutUpdateKind[]

/** Server-actions are a public boundary: the declared kind arrives as
 *  whatever the browser sent, so it is validated here rather than trusted
 *  from the parameter's type. An unrecognised value is a bug or an attack —
 *  either way, refusing beats writing a mislabelled fact into the log. */
function parseUpdateKind(kind: unknown): WorkoutUpdateKind {
  if (typeof kind !== 'string' || !UPDATE_KINDS.includes(kind)) {
    throw new Error('invalid workout change kind')
  }
  return kind as WorkoutUpdateKind
}

/**
 * Validates and applies an edit to an owned workout, returning its id. A missing
 * result means the workout isn't owned (or was concurrently deleted); we throw
 * so the client's try/catch surfaces an inline error.
 */
export async function updateWorkoutAction(
  id: string,
  input: unknown,
  kind: unknown,
): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const changeKind = parseUpdateKind(kind)
  // Pre-reads for the completion-transition event (updateWorkout's coalesce
  // means only a first edit completes): both race the write harmlessly —
  // they describe the BEFORE state by design, and failures degrade to "no
  // event" inside captureWorkoutEvent.
  const preStatePromise = safeRead(() => getWorkoutAnalyticsState(userId, id), null)
  const isFirstPromise = safeRead(async () => !(await hasAnyCompletedWorkout(userId)), false)
  // The caller DECLARES what its save means (see parseUpdateKind): the logger
  // finishing a live program day is that session's 'original' persist, while
  // edit mode's "Save changes" is an 'amendment'. The UI is the actor either
  // way.
  const result = await updateWorkout(userId, id, parsed, { actor: 'ui', kind: changeKind })
  if (!result) throw new Error('workout not found')
  void captureWorkoutEvent(async () => {
    const pre = await preStatePromise
    // Already completed before this edit → not a completion, no event.
    if (!pre || pre.completedAt !== null) return
    await captureServerEvent(userId, {
      name: 'workout_completed',
      properties: {
        // Live program finish: the session ran from its instantiation to now
        // (or to the backdated completion the edit carried).
        duration_min: durationMin(pre.startedAt, parsed.completedAt ?? parsed.startedAt ?? new Date()),
        ...workoutInputCounts(parsed),
        is_first: await isFirstPromise,
      },
    })
  })
  // The saved edit supersedes this workout's draft on every device.
  await deleteWorkoutDraft(userId, draftKey(id))
  // Live program finishes land here (updateWorkout stamps completedAt) — the
  // shared post-save pipeline (lib/workout-completion.ts) adopts outperformed
  // loads into the plan, completes goals, and stamps trophies, exactly as the
  // save path does. Edits to an OLDER workout no-op inside the sync's
  // latest-for-day guard; nothing in the pipeline can fail the save.
  await completeWorkoutSideEffects(userId, id)
  revalidatePath('/')
  revalidatePath(`/workout/${id}`)
  return result
}

/**
 * Deletes an owned workout (children cascade). Returns void — the client
 * navigates home after; we must NOT redirect() here, as the client wraps the
 * call in try/catch and would mistake NEXT_REDIRECT for a failure.
 *
 * A missing result means the workout isn't owned (or was already deleted); we
 * throw so the client surfaces an error rather than navigating away as if it
 * had worked — mirroring updateWorkoutAction's ownership handling.
 */
export async function deleteWorkoutAction(id: string): Promise<void> {
  const userId = await requireUserId()
  // Pre-read MUST resolve before the delete (the row is gone after); deleting
  // a never-completed session is the abandonment signal, deleting history is
  // not an event at all.
  const preState = await safeRead(() => getWorkoutAnalyticsState(userId, id), null)
  const [deleted] = await deleteWorkout(userId, id)
  if (!deleted) throw new Error('workout not found')
  if (preState && preState.completedAt === null) {
    void captureWorkoutEvent(async () =>
      captureServerEvent(userId, {
        name: 'workout_abandoned',
        properties: {
          elapsed_min: durationMin(preState.startedAt, new Date()),
          set_count_logged: preState.setCount,
        },
      }),
    )
  }
  // Drop any draft keyed to this workout — an orphaned draft keeps the home
  // "workout in progress" banner alive with a Resume that 404s.
  await deleteWorkoutDraft(userId, draftKey(id))
  revalidatePath('/')
}

/**
 * Mints (or returns the existing live) share link for an owned COMPLETED
 * workout — the lazy mint behind the summary's Share control. The db layer
 * gates via can(): not-owned nulls (we throw for the client's try/catch),
 * an unfinished session throws UnfinishedWorkoutShareError upward as-is.
 */
export async function createWorkoutShareAction(id: unknown): Promise<{ token: string }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid workout id')
  const share = await createWorkoutShare(userId, id)
  if (!share) throw new Error('workout not found')
  revalidatePath(`/workout/${id}`)
  return { token: share.token }
}

/**
 * Kills every live link for the workout (revokedAt — old URLs 404
 * immediately). With no visibility column this IS the off-switch; a fresh
 * link is an explicit re-create via createWorkoutShareAction, which then
 * mints a NEW token — the rotate semantics without a combined endpoint.
 */
export async function revokeWorkoutShareAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid workout id')
  const revoked = await revokeWorkoutShare(userId, id)
  if (!revoked) throw new Error('workout not found')
  revalidatePath(`/workout/${id}`)
}

/**
 * The signed-in user's most recent prior performance of an exercise, or null.
 * Read-only — no revalidate. `excludeWorkoutId` omits the workout being edited so
 * it doesn't report itself. Used by the logger to seed per-set "last time" ghosts.
 */
export async function getLastPerformanceAction(
  wgerExerciseId: unknown,
  excludeWorkoutId?: unknown,
  source?: unknown,
): Promise<LastPerformance | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const exclude = typeof excludeWorkoutId === 'string' ? excludeWorkoutId : undefined
  return getLastPerformance(userId, parseSourceParam(source), wgerExerciseId as number, exclude)
}

/** Trailing-optional source param shared by the read actions: absent defaults
 *  to 'wger' (pre-discriminator callers keep their shape); anything else must
 *  be on the whitelist — a typo'd source would read the wrong history. */
function parseSourceParam(source: unknown): 'wger' | 'custom' {
  if (source === undefined || source === null || source === 'wger') return 'wger'
  if (source === 'custom') return 'custom'
  throw new Error("invalid exercise source: must be 'wger' or 'custom'")
}

/** Sessions the stats sheet lists under "Recent". */
const RECENT_SESSIONS = 3

/** Everything the logger's stats sheet renders, in one round trip. */
export interface ExerciseSheetData {
  stats: ExerciseAllTimeStats
  recent: ExerciseSession[]
}

/**
 * All-time records + the last few sessions of an exercise, for the logger's
 * stats sheet. Null = no completed history (the sheet shows an empty state).
 * Read-only — no revalidate. Identity is the composite (source, id): callers
 * pass the draft exercise's `source`, and an absent one falls back to 'wger'
 * (parseSourceParam) for pre-discriminator payloads.
 */
export async function getExerciseSheetAction(
  wgerExerciseId: unknown,
  source?: unknown,
): Promise<ExerciseSheetData | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const id = wgerExerciseId as number
  const exerciseSource = parseSourceParam(source)
  const [stats, recent] = await Promise.all([
    getExerciseStats(userId, exerciseSource, id),
    getExerciseSessions(userId, exerciseSource, id, { limit: RECENT_SESSIONS, offset: 0 }),
  ])
  if (!stats) return null
  return { stats, recent }
}

/**
 * The exercise's all-time best estimated 1RM in kg, or null when no
 * e1rm-scorable history — the lean baseline for the logger's live PR watch.
 * A live session can't be its own baseline: its workout has completedAt null,
 * so the completed-only stats query excludes it by construction. Same
 * composite-identity treatment as the sheet action (an absent `source` falls
 * back to 'wger').
 */
export async function getExerciseBestAction(
  wgerExerciseId: unknown,
  source?: unknown,
): Promise<number | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const stats = await getExerciseStats(userId, parseSourceParam(source), wgerExerciseId as number)
  return stats?.records.bestE1rm?.e1rm ?? null
}

/**
 * Week-N plan targets for a MID-SESSION substitute: the original slot's
 * scheme re-derived for the replacement exercise (loads from the substitute's
 * own history where the scheme supports it; original-movement absolutes
 * stripped — see lib/substitute-slot). Null (not a throw) when the workout is
 * ad-hoc, provenance is gone, or the original isn't in the day — the logger
 * just keeps history-only ghosts.
 */
export async function substitutePlanTargetsAction(
  workoutId: unknown,
  originalWgerExerciseId: unknown,
  substituteWgerExerciseId: unknown,
  originalSource?: unknown,
  substituteSource?: unknown,
): Promise<PlanSetTarget[] | null> {
  const userId = await requireUserId()
  if (typeof workoutId !== 'string' || workoutId.length === 0) {
    throw new Error('invalid workout id')
  }
  if (!Number.isInteger(originalWgerExerciseId) || (originalWgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  if (!Number.isInteger(substituteWgerExerciseId) || (substituteWgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const fromSource = parseSourceParam(originalSource)
  const toSource = parseSourceParam(substituteSource)
  const workout = await getWorkoutDetail(userId, workoutId)
  if (!workout?.programDayId || !workout.programWeek) return null
  const day = await getProgramDayDetail(userId, workout.programDayId)
  if (!day) return null
  // First match mirrors loadPlanTargets' first-slot-wins convention; identity
  // is the composite (source, id).
  const slot = day.exercises.find(
    (e) => e.wgerExerciseId === originalWgerExerciseId && e.source === fromSource,
  )
  if (!slot) return null

  // One-exercise synthetic day: the engine's history reads key on the
  // exercise identity, so re-pointing the slot derives SUBSTITUTE-scale loads.
  const [derived] = await deriveDayPrescription(
    userId,
    {
      exercises: [substituteSlot(slot, toSource, substituteWgerExerciseId as number)],
      program: day.program,
    },
    workout.programWeek,
    { excludeWorkoutId: workout.id },
  )
  // Field-for-field the same mapping as the edit page's loadPlanTargets —
  // the substitute's ghosts must speak the same dialect as everyone else's.
  return derived.sets.map((s) => ({
    repMin: s.repMin,
    repMax: s.repMax,
    loadKg: s.loadKg,
    ...(s.derivedFrom === 'autoreg' && s.schemeLoadKg !== undefined
      ? { planLoadKg: s.schemeLoadKg }
      : {}),
    restSec: s.restSec,
    rir: s.rir,
    rpe: s.rpe,
    // Cardio targets — same dialect as loadPlanTargets (the comment above).
    durationSec: s.durationSec,
    distanceM: s.distanceM,
  }))
}

/**
 * Persists a mid-session swap into the PROGRAM: the slot that prescribed the
 * original exercise is re-pointed at the substitute via
 * substituteProgramExercise — identity + name swapped, muscle tags
 * re-derived, and every load that belonged to the OLD movement stripped
 * (template/override suggestedLoadKg, TM-based progressions) so the plan
 * can't keep prescribing the original lift's weights to the substitute
 * (#215) — the persisted twin of substitutePlanTargetsAction's preview
 * sanitization. Position addresses are resolved server-side from the
 * workout's provenance AT ACCEPT TIME (a program edited elsewhere meanwhile
 * throws on the vanished original instead of patching the wrong slot).
 * Throws (not null) on any broken link: the client offered the prompt
 * because the plan link existed moments ago, so a failure is surfaced for
 * retry rather than swallowed.
 */
export async function rememberSwapAction(
  workoutId: unknown,
  originalWgerExerciseId: unknown,
  substitute: { wgerExerciseId: unknown; name: unknown; source?: unknown },
  originalSource?: unknown,
): Promise<void> {
  const userId = await requireUserId()
  if (typeof workoutId !== 'string' || workoutId.length === 0) {
    throw new Error('invalid workout id')
  }
  if (!Number.isInteger(originalWgerExerciseId) || (originalWgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  if (!Number.isInteger(substitute.wgerExerciseId) || (substitute.wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  if (typeof substitute.name !== 'string' || substitute.name.trim().length === 0) {
    throw new Error('invalid exercise name')
  }
  const fromSource = parseSourceParam(originalSource)
  const toSource = parseSourceParam(substitute.source)
  const workout = await getWorkoutDetail(userId, workoutId)
  if (!workout?.programDayId) throw new Error('workout has no program')
  const day = await getProgramDayDetail(userId, workout.programDayId)
  if (!day) throw new Error('program day not found')
  // This is a WRITE, so first-match isn't good enough: a day listing the
  // same exercise twice would silently patch the slot the user never
  // touched. Ambiguity throws instead — no silent wrong-slot mutations.
  const matches = day.exercises.filter(
    (e) => e.wgerExerciseId === originalWgerExerciseId && e.source === fromSource,
  )
  if (matches.length === 0) throw new Error('exercise not found in program')
  if (matches.length > 1) throw new Error('exercise appears more than once in this day')
  const slot = matches[0]

  const updated = await substituteProgramExercise(
    userId,
    day.program.id,
    day.position,
    slot.position,
    {
      wgerExerciseId: substitute.wgerExerciseId as number,
      source: toSource,
      name: substitute.name.trim(),
    },
    // The swap sheet is a UI surface even though it edits mid-session.
    'ui',
  )
  if (!updated) throw new Error('could not update the program')
  // No revalidatePath here: a Server-Action revalidation also re-renders the
  // CURRENT route's RSC payload, and mid-session that re-runs the whole
  // logger page (plan derivation included) under the app-wide page
  // <ViewTransition> — the "full reload" jank of #214. The program pages
  // this write affects render dynamically per request (auth cookies), so
  // the only staleness is the client router cache's brief TTL — and there
  // is no path from a live session to /programs that matters within it.
}

// ---------------------------------------------------------------------------
// Cross-device workout drafts. The logger autosaves its in-progress state
// through these; the payload is opaque jsonb validated on both sides of the
// wire (isDraftPayload here, parseDraftPayload on restore).

// 'new' (the /workout/new surface) or a workout uuid (edit surfaces). Guarding
// the shape keeps arbitrary strings out of the key column; keys are
// lower-cased first so 'NEW' or an uppercase-uuid URL can't mint a second
// surface for the same session.
const DRAFT_KEY_RE = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

// Generous ceiling for one session's draft; blocks abuse of the jsonb column.
const MAX_DRAFT_PAYLOAD_BYTES = 32_768

function parseDraftKey(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('invalid draft key')
  const key = raw.toLowerCase()
  if (!DRAFT_KEY_RE.test(key)) throw new Error('invalid draft key')
  return key
}

/**
 * The stored draft payload for a logging surface, or null. Enforces the TTL
 * against the row's authoritative `updated_at`, lazily deleting expired rows —
 * an abandoned draft from last week should not hijack today's session.
 */
export async function getWorkoutDraftAction(key: unknown): Promise<unknown | null> {
  const userId = await requireUserId()
  const parsedKey = parseDraftKey(key)
  const row = await getWorkoutDraft(userId, parsedKey)
  if (!row) return null
  if (Date.now() - row.updatedAt.getTime() > DRAFT_TTL_MS) {
    await deleteWorkoutDraft(userId, parsedKey)
    return null
  }
  return row.payload
}

/**
 * Upserts the draft for a logging surface (last writer wins across devices).
 * Validates structure and size here on the server — the payload is client
 * data and must never land in the column unchecked.
 */
export async function putWorkoutDraftAction(key: unknown, payload: unknown): Promise<void> {
  const userId = await requireUserId()
  const parsedKey = parseDraftKey(key)
  if (!isDraftPayload(payload)) throw new Error('invalid draft payload')
  if (JSON.stringify(payload).length > MAX_DRAFT_PAYLOAD_BYTES) {
    throw new Error('draft payload too large')
  }
  await putWorkoutDraft(userId, parsedKey, payload)
}

/** Deletes the draft for a logging surface (the user cleared the session out). */
export async function deleteWorkoutDraftAction(key: unknown): Promise<void> {
  const userId = await requireUserId()
  await deleteWorkoutDraft(userId, parseDraftKey(key))
}

/**
 * The cascade of un-completing a session, WITHOUT performing it — what the
 * guard dialog needs before it decides whether to exist.
 *
 * Split from the write on purpose: the modal is gated on the cascade being
 * real, so the answer has to arrive before anything is written. It is one
 * round-trip on a rare action, which beats paying for the dry run on every
 * summary-page render.
 */
export async function previewUncompleteAction(id: string): Promise<UncompleteCascade> {
  const userId = await requireUserId()
  return uncompleteCascade(userId, id)
}

/**
 * Clears an owned session's completion stamp, returning the instant that was
 * cleared so the client can offer a truthful undo.
 *
 * The ISO string, not a Date: this crosses the server-action boundary, and a
 * caller handing the instant back to `recompleteWorkoutAction` must send back
 * exactly what it was given. Throws when nothing was un-completed, so a
 * client never shows an undo for a write that did not happen.
 */
export async function uncompleteWorkoutAction(id: string): Promise<{ completedAt: string }> {
  const userId = await requireUserId()
  const result = await uncompleteWorkout(userId, id, { actor: 'ui', kind: 'amendment' })
  if (!result) throw new Error('workout not found')
  revalidatePath('/')
  revalidatePath(`/workout/${id}`)
  return { completedAt: result.completedAt.toISOString() }
}

/**
 * Puts a cleared completion stamp back — the undo half.
 *
 * The instant is re-validated here rather than trusted: a server action is a
 * public boundary, and an unparseable or absent stamp must be refused rather
 * than silently become `now()`, which would move the session to today.
 */
export async function recompleteWorkoutAction(id: string, completedAt: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof completedAt !== 'string') throw new Error('invalid completion time')
  const stamp = new Date(completedAt)
  if (Number.isNaN(stamp.getTime())) throw new Error('invalid completion time')
  const result = await recompleteWorkout(userId, id, stamp, { actor: 'ui', kind: 'amendment' })
  if (!result) throw new Error('workout not found')
  revalidatePath('/')
  revalidatePath(`/workout/${id}`)
}
