import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  getProgramDetail,
  nextProgramWeek,
  deriveDayPrescription,
  getNextProgramDay,
} from '@/db/programs'
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

  const [week, nextDay] = await Promise.all([
    nextProgramWeek(userId, program.id, program.mesocycleWeeks),
    getNextProgramDay(userId),
  ])
  // One volt CTA per screen (the design system's spine): only the day the
  // user would actually train next keeps the primary variant; the rest
  // demote to outline. A non-active program has no "next", so all demote.
  const nextDayId = nextDay?.programId === program.id ? nextDay.dayId : null
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
            <ChevronLeft aria-hidden="true" className="size-5" />
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
              {/* Day ordinal as the quiet anchor, day name in display type —
                  same voice as the summary cards and program cards. */}
              <h2 className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                  Day {dayIndex + 1}
                </span>
                <span className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                  {day.name}
                </span>
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
                <StartDayButton
                  programDayId={day.id}
                  variant={day.id === nextDayId ? 'default' : 'outline'}
                />
              </div>
            </section>
          ))}
        </div>

        <ProgramActions id={program.id} status={status} />
      </main>
    </div>
  )
}
