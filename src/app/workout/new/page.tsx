import { requireUserId } from '@/lib/auth'
import { getWeightUnit, getEquipment } from '@/db/preferences'
import { getWorkoutDetail } from '@/db/workouts'
import { WorkoutLogger } from './workout-logger'
import { detailToDraft } from './workout-draft'

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
  const [unit, source] = await Promise.all([
    getWeightUnit(userId),
    fromId ? getWorkoutDetail(userId, fromId) : Promise.resolve(undefined),
  ])
  const equipment = await getEquipment(userId, unit)
  // resetCompleted: repeating an old workout starts a fresh session — no
  // checked-off sets carried over from the source.
  const seed = source ? detailToDraft(source, unit, { resetCompleted: true }) : undefined

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* The logger renders the app bar itself (the session clock lives in
          it) and the width-constrained main. Close still lands home — the
          autosaved draft survives and resumes from the home banner. */}
      <WorkoutLogger
        title="New Workout"
        closeHref="/"
        unit={unit}
        initialDraft={seed?.draft}
        initialName={seed?.name}
        equipment={equipment}
      />
    </div>
  )
}
