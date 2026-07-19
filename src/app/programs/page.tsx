import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { listPrograms } from '@/db/programs'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function ProgramsPage() {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const programs = await listPrograms(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Programs"
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

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <Link
          href="/programs/new"
          className={cn(
            buttonVariants({ size: 'lg' }),
            'mt-6 w-full text-base font-semibold uppercase tracking-wide',
          )}
        >
          + New Program
        </Link>

        {/* Secondary path: start from a wger community template instead of a
            blank builder. Outline — the volt CTA above stays the primary. */}
        <Link
          href="/programs/templates"
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-3 w-full')}
        >
          Browse templates
        </Link>

        <h2 className="mt-10 mb-3 text-lg">Your Programs</h2>

        {programs.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No programs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap “New Program” to build your first training plan.
            </p>
          </div>
        ) : (
          /* One card per program (not a divided list): each plan is a
             commitment the lifter picked, and it reads like one — poster-type
             name, the cycle length as the big glanceable numeral, and the
             active plan alone carrying volt. */
          <ul className="space-y-3">
            {programs.map((program) => {
              const isActive = program.status === 'active'
              // A proposal is visible in the list (the owner must find it to
              // confirm it) but visually distinct: dashed volt border + a
              // "Proposed" chip instead of the plain status word.
              const isProposed = program.status === 'proposed'
              return (
                <li key={program.id}>
                  <Link
                    href={`/programs/${program.id}`}
                    className={cn(
                      'flex min-w-0 items-stretch justify-between gap-4 rounded-2xl border bg-card p-5 transition-colors active:bg-muted/60',
                      isActive
                        ? 'border-primary/40'
                        : isProposed
                          ? 'border-dashed border-primary/50'
                          : 'border-border',
                    )}
                  >
                    <span className="flex min-w-0 flex-col justify-between gap-3">
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-baseline gap-2 font-display text-xl uppercase leading-tight tracking-wide">
                          {program.icon !== null && (
                            <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                              {program.icon}
                            </span>
                          )}
                          <span className="min-w-0 truncate">{program.name}</span>
                        </span>
                        {isProposed ? (
                          <span className="mt-1.5 inline-flex items-center rounded-full border border-primary/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                            Proposed
                          </span>
                        ) : (
                          <span
                            className={cn(
                              'mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest',
                              isActive ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {isActive && (
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-primary"
                              />
                            )}
                            {program.status}
                          </span>
                        )}
                      </span>
                      {program.deloadWeek !== null && (
                        <span className="text-sm text-muted-foreground">
                          Deload week {program.deloadWeek}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="flex flex-col-reverse items-end">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {program.mesocycleWeeks === 1 ? 'week' : 'weeks'}
                        </span>
                        <span className="font-display text-4xl leading-none tnum">
                          {program.mesocycleWeeks}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-5 shrink-0 text-muted-foreground"
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
