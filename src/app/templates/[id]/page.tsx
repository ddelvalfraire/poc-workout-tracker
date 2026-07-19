import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWorkoutTemplateDetail } from '@/db/workout-templates'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/active-session'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TemplateActions } from './template-actions'

// Same guard as /workout/new's `?from`: a malformed path id must not reach
// the uuid column (Postgres would throw and 500 the page).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Human labels for the non-default logging types; the default stays silent
 *  (every plain weight×reps exercise would otherwise wear a redundant tag). */
const LOGGING_TYPE_LABELS: Record<string, string> = {
  bodyweight_reps: 'Bodyweight',
  weighted_bodyweight: 'Weighted bodyweight',
  assisted_bodyweight: 'Assisted bodyweight',
}

/** "3 sets", "3 × 8", or "3 × 8–12" — the sketch line for one exercise. */
function formatSetPlan(plannedSets: number, repMin: number | null, repMax: number | null): string {
  if (repMin === null && repMax === null) {
    return `${plannedSets} set${plannedSets === 1 ? '' : 's'}`
  }
  const range = repMin !== null && repMax !== null && repMin !== repMax
    ? `${repMin}–${repMax}`
    : `${repMin ?? repMax}`
  return `${plannedSets} × ${range}`
}

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()
  const [template, summaries, drafts] = await Promise.all([
    getWorkoutTemplateDetail(userId, id),
    listWorkoutSummaries(userId),
    listWorkoutDrafts(userId),
  ])
  if (!template) notFound()
  // Single-active-session guard for the Start CTA, same as the list page.
  const activeSession = resolveActiveSession(drafts, summaries, new Date())
  const guardSession = activeSession && {
    key: activeSession.key,
    name: activeSession.name,
    setCount: activeSession.setCount,
    completedSetCount: activeSession.completedSetCount,
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Template"
        leading={
          <Link
            href="/templates"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Header block: poster-type name (programs-page vocabulary) over the
            description. The sketch below is intentionally loose — templates
            carry no per-set prescriptions; programs are the precision tool. */}
        <div className="mt-6">
          <h2 className="flex min-w-0 items-baseline gap-2 font-display text-3xl uppercase leading-tight tracking-wide">
            {template.icon !== null && (
              <span aria-hidden="true" className="shrink-0 text-2xl leading-none">
                {template.icon}
              </span>
            )}
            <span className="min-w-0 break-words">{template.name}</span>
          </h2>
          {template.description !== null && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {template.description}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {template.exercises.map((exercise) => {
            const typeLabel = LOGGING_TYPE_LABELS[exercise.loggingType]
            return (
              <section
                key={exercise.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                    {exercise.name}
                  </h3>
                  <span className="shrink-0 tnum text-base font-semibold">
                    {formatSetPlan(exercise.plannedSets, exercise.repMin, exercise.repMax)}
                  </span>
                </div>
                {(typeLabel !== undefined || exercise.restSec !== null) && (
                  <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {[typeLabel, exercise.restSec !== null ? `Rest ${exercise.restSec}s` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {exercise.notes !== null && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {exercise.notes}
                  </p>
                )}
              </section>
            )
          })}
        </div>

        <TemplateActions
          template={{
            id: template.id,
            name: template.name,
            description: template.description,
            icon: template.icon,
          }}
          session={guardSession}
        />
      </main>
    </div>
  )
}
