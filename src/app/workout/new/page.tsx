import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { getWorkoutDetail } from '@/db/workouts'
import { buttonVariants } from '@/components/ui/button'
import { AppHeader } from '@/components/app-header'
import { cn } from '@/lib/utils'
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
  // resetCompleted: repeating an old workout starts a fresh session — no
  // checked-off sets carried over from the source.
  const seed = source ? detailToDraft(source, unit, { resetCompleted: true }) : undefined

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="New Workout"
        trailing={
          <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            Cancel
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <WorkoutLogger unit={unit} initialDraft={seed?.draft} initialName={seed?.name} />
      </main>
    </div>
  )
}
