import Link from 'next/link'
import {
  CalendarCheck,
  ChevronLeft,
  Dumbbell,
  Flag,
  Flame,
  Lock,
  Medal,
  Weight,
} from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { evaluateTrophies, trophyContextLine, trophyHint, trophyLabel } from '@/lib/trophies'
import { TROPHY_DEFS, type TrophyDef } from '@/lib/trophy-kinds'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * /trophies — fact-derived milestones only (the honesty brand): earned grid
 * up top, locked kinds below with progress hints computed from the SAME
 * evidence detection reads ("285/315 lb — 30 lb to go"), never invented.
 * Streaks/goals surfaces stay untouched — this page is the trophy case.
 */
export default async function TrophiesPage() {
  const userId = await requireUserId()
  const [{ earned, locked, evidence }, unit] = await Promise.all([
    evaluateTrophies(userId),
    getWeightUnit(userId),
  ])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Trophies"
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

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        {earned.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No trophies yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every trophy is a lifting fact — plate clubs, workout counts, streaks. Train and
              they stamp themselves.
            </p>
          </div>
        ) : (
          <section aria-label="Earned trophies" className="grid grid-cols-2 gap-3">
            {earned.map((row) => {
              const Icon = familyIcon(TROPHY_DEFS[row.kind])
              const context = trophyContextLine(row, unit)
              return (
                <article
                  key={row.id}
                  className="rounded-2xl border border-primary/50 bg-card p-4"
                >
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                  <h2 className="mt-2 font-display text-lg uppercase leading-tight tracking-wide">
                    {trophyLabel(row.kind)}
                  </h2>
                  {context !== null && (
                    <p className="mt-1 text-xs text-muted-foreground tnum">{context}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatWorkoutDate(row.achievedAt)}
                  </p>
                </article>
              )
            })}
          </section>
        )}

        {locked.length > 0 && (
          <section aria-label="Locked trophies">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Locked
            </h2>
            <ul className="mt-2 space-y-2">
              {locked.map((kind) => {
                const Icon = familyIcon(TROPHY_DEFS[kind])
                return (
                  <li
                    key={kind}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-muted-foreground">
                        {trophyLabel(kind)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/80 tnum">
                        {trophyHint(kind, evidence, unit)}
                      </p>
                    </div>
                    <Lock aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

/** One icon per kind family — markers, not decoration (matches /goals). */
function familyIcon(def: TrophyDef) {
  switch (def.family) {
    case 'club':
      return Dumbbell
    case 'sum_club':
      return Medal
    case 'count':
      return CalendarCheck
    case 'streak':
      return Flame
    case 'block':
      return Flag
    case 'tonnage':
      return Weight
  }
}
