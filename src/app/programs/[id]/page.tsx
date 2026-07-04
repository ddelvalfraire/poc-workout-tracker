import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getProgramDetail, nextProgramWeek, deriveDayPrescription } from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatTargetLine, groupDerivedSets } from './derived-format'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
  if (!program) notFound()

  const week = await nextProgramWeek(userId, program.id, program.mesocycleWeeks)
  // getProgramDetail days carry no back-ref to the program row, so the
  // DayForDerivation `program` slice is attached inline per day.
  const prescriptions = await Promise.all(
    program.days.map((day) =>
      deriveDayPrescription(
        userId,
        {
          exercises: day.exercises,
          program: { mesocycleWeeks: program.mesocycleWeeks, deloadWeek: program.deloadWeek },
        },
        week,
      ),
    ),
  )
  const status = (
    program.status === 'active' || program.status === 'archived' ? program.status : 'draft'
  ) as 'draft' | 'active' | 'archived'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={program.name}
        leading={
          <Link
            href="/programs"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        }
        trailing={
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
              status === 'active'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {status}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <p className="mt-4 text-sm text-muted-foreground">
          Week {week} of {program.mesocycleWeeks}
          {program.deloadWeek !== null && ` · deload wk ${program.deloadWeek}`}
        </p>

        <div className="mt-4 space-y-3">
          {program.days.map((day, dayIndex) => (
            <section key={day.id} className="rounded-2xl border border-border bg-card p-4">
              <h2 className="min-w-0 text-base">
                Day {dayIndex + 1} · {day.name}
              </h2>

              <div className="mt-3 space-y-3">
                {day.exercises.map((exercise, exerciseIndex) => (
                  <div key={exercise.id}>
                    <p className="text-sm font-medium">{exercise.name}</p>
                    <div className="mt-1 space-y-0.5">
                      {groupDerivedSets(prescriptions[dayIndex][exerciseIndex]).map(
                        (group, groupIndex) => (
                          <p
                            key={groupIndex}
                            className="flex items-baseline gap-2 text-sm text-muted-foreground"
                          >
                            <span className="tnum">
                              {formatTargetLine(group.set, group.count, unit)}
                            </span>
                            {group.set.derivedFrom === 'deload' && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                                Deload
                              </span>
                            )}
                            {group.set.technique && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                                {group.set.technique.kind}
                              </span>
                            )}
                          </p>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <StartDayButton programDayId={day.id} />
              </div>
            </section>
          ))}
        </div>

        <ProgramActions id={program.id} status={status} />
      </main>
    </div>
  )
}
