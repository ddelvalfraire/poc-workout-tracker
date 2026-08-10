import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { resolveWorkoutShare } from '@/db/workout-shares'
import { getWeightUnit } from '@/db/preferences'
import { DEFAULT_WEIGHT_UNIT } from '@/lib/units'
import {
  formatWorkoutDate,
  formatLoggedSet,
  formatE1RM,
  formatVolume,
  formatWorkoutDuration,
} from '@/lib/format'
import { bestScoredSet } from '@/lib/one-rep-max'
import { AppHeader } from '@/components/app-header'
import { PrBadge } from '@/components/pr-badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Share tokens are 32 base64url chars (24 random bytes); anything shaped
 *  differently is a bad URL and 404s before touching the db — the /p/[token]
 *  fail-fast idiom, same generous bounds. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/**
 * The public workout share page — a Clerk-PUBLIC route (proxy.ts) that gates
 * itself: `resolveWorkoutShare` collapses every failure (unknown token,
 * revoked, unfinished session) into the same null → constant-shape
 * notFound(), never acknowledging which gate refused. Renders the summary
 * CONTENT only — date, duration, volume, exercise cards with sets, PR badges
 * — and NEVER notes, body data, program provenance, or the owner's history
 * (resolveWorkoutShare cannot even return them). No owner controls, no
 * celebrations, no plan-sync, no up-next: the completion aesthetic without
 * the owner's moment. The one CTA is the sign-in funnel — the acquisition
 * surface.
 */
export default async function SharedWorkoutPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!TOKEN_PATTERN.test(token)) notFound()
  const shared = await resolveWorkoutShare(token)
  if (!shared) notFound()
  const { workout, ownerUserId, prExerciseIds } = shared

  // Who's looking decides the footer — signed-out visitors still get the
  // full read (this page is the acquisition surface).
  const { userId } = await auth()
  const isOwner = userId !== null && userId === ownerUserId
  // Loads render in the VIEWER's unit when signed in; anonymous visitors get
  // the app default.
  const unit = userId !== null ? await getWeightUnit(userId) : DEFAULT_WEIGHT_UNIT

  const prBadgeRowIds = new Set(prExerciseIds)
  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0)
  const volumeKg = workout.exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, set) => s + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  )
  const duration = formatWorkoutDuration(workout.startedAt, workout.completedAt)

  // De-carded notices: a plain sentence over the page background, opening
  // past a hairline — the button, not a shell, carries the affordance.
  const footer = isOwner ? (
    <div className="border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        This is your workout — this is what people with the link see.
      </p>
      <Link
        href={`/workout/${workout.id}`}
        className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 w-full')}
      >
        Open your workout
      </Link>
    </div>
  ) : userId === null ? (
    // Post-sign-in returns here (Clerk honors redirect_url) so a curious
    // visitor lands back on the session that brought them in.
    <div className="border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        Logged with this app — track your own sessions, PRs, and programs.
      </p>
      <Link
        href={`/sign-in?redirect_url=${encodeURIComponent(`/w/${token}`)}`}
        className={cn(buttonVariants(), 'mt-3 w-full')}
      >
        Sign in to start tracking
      </Link>
    </div>
  ) : null

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={workout.name ?? 'Shared workout'} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <div className="mt-4 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{formatWorkoutDate(workout.startedAt)}</p>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Shared workout
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-card">
          <Stat label="Duration" value={duration ?? '—'} />
          <Stat label="Volume" value={volumeKg > 0 ? formatVolume(volumeKg, unit) : '—'} />
          <Stat label={totalSets === 1 ? 'Set' : 'Sets'} value={String(totalSets)} />
        </dl>

        {/* De-carded (owner-summary vocabulary): exercises sit on hairline
            dividers, no shells — the public read speaks the same language. */}
        <div className="mt-6 space-y-4">
          {workout.exercises.map((exercise) => {
            // Same top-set scoring as the owner summary — but bodyweightKg is
            // null by the hard rule (body data never crosses), so bodyweight
            // work marks its best set by reps here.
            const current = exercise.skipped
              ? null
              : bestScoredSet(exercise.sets, exercise.loggingType, null)
            const bestIndex = current && exercise.sets.length > 1 ? current.index : -1
            const isPR = prBadgeRowIds.has(exercise.id)

            return (
              <section key={exercise.id} className="border-b border-b-border/60 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h2
                    className={cn(
                      'min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide',
                      exercise.skipped && 'text-muted-foreground',
                    )}
                  >
                    {exercise.name}
                  </h2>
                  {exercise.skipped ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Skipped
                    </span>
                  ) : (
                    isPR && <PrBadge />
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {exercise.sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sets logged.</p>
                  ) : (
                    exercise.sets.map((set, setIndex) => (
                      <div key={set.id} className="flex items-center gap-3">
                        <span
                          aria-label={`Set ${set.setNumber}`}
                          className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tnum text-muted-foreground"
                        >
                          {set.setNumber}
                        </span>
                        <span
                          className={cn(
                            'tnum text-base',
                            setIndex === bestIndex
                              ? 'font-semibold'
                              : 'font-medium text-foreground/80',
                          )}
                        >
                          {formatLoggedSet(set, unit, exercise.loggingType)}
                        </span>
                        {setIndex === bestIndex && (
                          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            Top set
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {current && (
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {current.kind === 'e1rm' ? 'Est. 1RM' : 'Top set'}
                    </span>
                    {current.kind === 'e1rm' ? (
                      <span className="font-display text-3xl leading-none tnum">
                        <span aria-hidden="true" className="text-muted-foreground">
                          ~
                        </span>
                        {formatE1RM(current.e1rm, unit)}
                      </span>
                    ) : (
                      <span className="font-display text-3xl leading-none tnum">
                        {current.reps} reps
                      </span>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {footer !== null && <div className="mt-6 pb-2">{footer}</div>}
      </main>
    </div>
  )
}

/** One tile of the session stat row — the workout/[id] page's vocabulary.
 *  DOM keeps the valid dt→dd order; flex-col-reverse renders value on top. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse border-l border-border px-4 py-3 first:border-l-0">
      <dt className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tnum text-3xl font-semibold tracking-tight">{value}</dd>
    </div>
  )
}
