import { requireUserId } from '@/lib/auth'
import { getWeightUnit, getEquipment, getDefaultRestSec, getRestTimerEnabled } from '@/db/preferences'
import { getWorkoutDetail } from '@/db/workouts'
import { getWorkoutTemplateDetail } from '@/db/workout-templates'
import { getWorkoutDraft } from '@/db/workout-drafts'
import { templateToDraft } from '@/lib/workout-template'
import { WorkoutLogger } from './workout-logger'
import { detailToDraft } from './workout-draft'
import { resolveDraftSeed, draftKey } from './draft-payload'

// Guards a malformed `?from` value from hitting the uuid column (Postgres would
// throw `invalid input syntax for type uuid` and 500 the page).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function NewWorkoutPage({
  searchParams,
}: {
  // A repeated `?from=a&from=b` arrives as an array at runtime, so the type must
  // allow it; only a single uuid string is treated as a valid source.
  searchParams: Promise<{ from?: string | string[]; template?: string | string[] }>
}) {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const { from, template } = await searchParams
  const fromId = typeof from === 'string' && UUID_RE.test(from) ? from : undefined
  const templateId = typeof template === 'string' && UUID_RE.test(template) ? template : undefined
  // All reads always run: an explicit `?from`/`?template` that RESOLVES wins
  // over any stored 'new' draft (the user just asked for that seed), but a
  // stale or deleted id falls back to the stored draft rather than presenting
  // an empty logger while a live draft exists. `from` outranks `template` —
  // repeating a concrete session is the more specific intent.
  const [unit, source, templateSource, draftRow] = await Promise.all([
    getWeightUnit(userId),
    fromId ? getWorkoutDetail(userId, fromId) : Promise.resolve(undefined),
    templateId ? getWorkoutTemplateDetail(userId, templateId) : Promise.resolve(undefined),
    getWorkoutDraft(userId, draftKey()),
  ])
  // Equipment and the rest default are independent preference reads — one
  // round-trip of latency instead of two.
  const [equipment, defaultRestSec, restTimerEnabled] = await Promise.all([
    getEquipment(userId, unit),
    getDefaultRestSec(userId),
    getRestTimerEnabled(userId),
  ])
  // resetCompleted: repeating an old workout starts a fresh session — no
  // checked-off sets carried over from the source. A template seeds
  // plannedSets empty sets per exercise instead (no values to carry — ghosts
  // come from history at log time, like any fresh session).
  const seed = source
    ? detailToDraft(source, unit, { resetCompleted: true })
    : templateSource
      ? templateToDraft(templateSource)
      : undefined
  // Server-side draft seeding: resolving the interrupted session HERE kills
  // the mount-time content swap (empty logger flashes, then the restore
  // effect replaces it). Shared TTL+codec helper — same rules as the client
  // restore, which stays as the cross-device race net.
  const restored = seed ? null : resolveDraftSeed(draftRow, { unit, now: new Date() })

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* The logger renders the app bar itself (the session clock lives in
          it) and the width-constrained main. Close still lands home — the
          autosaved draft survives and resumes from the home banner. */}
      <WorkoutLogger
        title="New Workout"
        closeHref="/"
        unit={unit}
        initialDraft={seed?.draft ?? restored?.draft}
        initialName={seed?.name ?? restored?.name}
        // The draft's openedAt IS the session start (the logger saved it);
        // without it the clock would restart from this page load.
        startedAt={restored?.openedAt}
        equipment={equipment}
        defaultRestSec={defaultRestSec}
        restTimerEnabled={restTimerEnabled}
      />
    </div>
  )
}
