import { requireUserId } from '@/lib/auth'
import { getWeightUnit, getEquipment, getDefaultRestSec, getRestTimerEnabled } from '@/db/preferences'
import { getWorkoutDetail } from '@/db/workouts'
import { getWorkoutDraft } from '@/db/workout-drafts'
import { WorkoutLogger } from './workout-logger'
import { detailToDraft } from './workout-draft'
import { parseDraftPayload, draftKey, DRAFT_TTL_MS } from './draft-payload'

// Guards a malformed `?from` value from hitting the uuid column (Postgres would
// throw `invalid input syntax for type uuid` and 500 the page).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function NewWorkoutPage({
  searchParams,
}: {
  // A repeated `?from=a&from=b` arrives as an array at runtime, so the type must
  // allow it; only a single uuid string is treated as a valid source.
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const { from } = await searchParams
  const fromId = typeof from === 'string' && UUID_RE.test(from) ? from : undefined
  // An explicit `?from` wins over any stored 'new' draft: the user just asked
  // to repeat that workout, so an abandoned freestyle session must not hijack
  // the seed. We skip the draft read entirely rather than merging.
  const [unit, source, draftRow] = await Promise.all([
    getWeightUnit(userId),
    fromId ? getWorkoutDetail(userId, fromId) : Promise.resolve(undefined),
    fromId ? Promise.resolve(undefined) : getWorkoutDraft(userId, draftKey()),
  ])
  // Equipment and the rest default are independent preference reads — one
  // round-trip of latency instead of two.
  const [equipment, defaultRestSec, restTimerEnabled] = await Promise.all([
    getEquipment(userId, unit),
    getDefaultRestSec(userId),
    getRestTimerEnabled(userId),
  ])
  // resetCompleted: repeating an old workout starts a fresh session — no
  // checked-off sets carried over from the source.
  const seed = source ? detailToDraft(source, unit, { resetCompleted: true }) : undefined
  // Server-side draft seeding: resolving the interrupted session HERE kills
  // the mount-time content swap (empty logger flashes, then the restore
  // effect replaces it). Same codec as the client restore, so both agree on
  // what "valid" means; the client effect stays as the cross-device race net.
  // TTL mirrors getWorkoutDraftAction but only SKIPS a stale row — a page
  // render is a GET and shouldn't mutate; the client action lazily deletes.
  const now = new Date()
  const restored =
    draftRow && now.getTime() - draftRow.updatedAt.getTime() <= DRAFT_TTL_MS
      ? parseDraftPayload(draftRow.payload, { unit, now })
      : null

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
