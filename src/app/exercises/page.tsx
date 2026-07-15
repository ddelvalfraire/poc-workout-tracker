import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { listLoggedExercises } from '@/db/exercise-stats'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LibraryFilter, type LibraryEntry } from './library-filter'

/**
 * The exercise library: every movement the user has trained in a completed
 * workout, newest first, filterable by name — each row opens that exercise's
 * all-time stats. History-first by design: catalog discovery (wger search)
 * already lives in the logger's picker, so this list only shows exercises
 * that HAVE a story to tell. Server component; the filter is the one island.
 */
export default async function ExercisesPage() {
  const userId = await requireUserId()
  const exercises = await listLoggedExercises(userId)

  // Dates become display strings HERE — one server locale, no hydration drift.
  const entries: LibraryEntry[] = exercises.map((e) => ({
    source: e.source,
    wgerExerciseId: e.wgerExerciseId,
    name: e.name,
    sessionCount: e.sessionCount,
    lastPerformedLabel: formatWorkoutDate(e.lastPerformedAt),
  }))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Exercises"
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-6">
        <LibraryFilter entries={entries} />
      </main>
    </div>
  )
}
