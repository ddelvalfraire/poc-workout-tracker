import Link from 'next/link'
import { Play } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { listWorkoutTemplates } from '@/db/workout-templates'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { getWeightUnit } from '@/db/preferences'
import { resolveActiveSession } from '@/lib/active-session'
import {
  sortTemplatesByUsage,
  templateStatusLine,
  templateUsageByName,
} from '@/lib/template-usage'
import { AppHeader } from '@/components/app-header'
import { GuardedStartLink } from '@/components/guarded-start-link'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Standalone workout templates — reusable session sketches saved OUTSIDE any
 * program. Rows are ALIVE (the drawer rule): the second line is last-run
 * status derived from the summaries the session guard already fetched (the
 * name-match heuristic — see lib/template-usage.ts; zero new queries), the
 * list orders by last-performed, and the most-recently-used template gets
 * the volt hero Start with its name baked in. Templates are created from a
 * logged workout's "Save as template" — there is no blank builder here on
 * purpose: the sketch derives from work actually done.
 */
export default async function TemplatesPage() {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const [templates, summaries, drafts, unit] = await Promise.all([
    listWorkoutTemplates(userId),
    listWorkoutSummaries(userId),
    listWorkoutDrafts(userId),
    getWeightUnit(userId),
  ])
  // Same guard inputs as the home page: starting from a template must not
  // silently stack a second live session.
  const activeSession = resolveActiveSession(drafts, summaries, new Date())
  const guardSession = activeSession && {
    key: activeSession.key,
    name: activeSession.name,
    setCount: activeSession.setCount,
    completedSetCount: activeSession.completedSetCount,
  }

  const now = new Date()
  const usage = templateUsageByName(summaries)
  const ordered = sortTemplatesByUsage(templates, usage)
  // Hero = the most recently RUN template; a never-run list has no hero —
  // the volt treatment celebrates a habit, it doesn't invent one.
  const hero = ordered.length > 0 && usage.has(ordered[0].name) ? ordered[0] : null
  const rest = hero !== null ? ordered.slice(1) : ordered

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Templates"
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {templates.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-display text-xl uppercase tracking-wide">Your future go-to</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Finish a workout, tap “Save as template” on its summary, and it
              lives here ready to start in one tap.
            </p>
            <GuardedStartLink
              href="/workout/new"
              session={guardSession}
              className={cn(buttonVariants(), 'mt-5 w-full gap-2')}
            >
              <Play aria-hidden="true" className="size-4" />
              Start a workout
            </GuardedStartLink>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {hero !== null && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <Link href={`/templates/${hero.id}`} className="block min-w-0">
                  <span className="flex min-w-0 items-baseline gap-2 font-display text-2xl uppercase leading-tight tracking-wide">
                    {hero.icon !== null && (
                      <span aria-hidden="true" className="shrink-0 text-xl leading-none">
                        {hero.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{hero.name}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground tnum">
                    {templateStatusLine(usage.get(hero.name) ?? null, hero.exerciseCount, unit, now)}
                  </span>
                </Link>
                <GuardedStartLink
                  href={`/workout/new?template=${hero.id}`}
                  session={guardSession}
                  className={cn(buttonVariants({ size: 'lg' }), 'mt-4 w-full gap-2')}
                >
                  <Play aria-hidden="true" className="size-4" />
                  <span className="min-w-0 truncate">Start {hero.name}</span>
                </GuardedStartLink>
              </div>
            )}

            {rest.length > 0 && (
              <ul className="space-y-3">
                {rest.map((template) => (
                  // gap-1 keeps the Start button's expanded hit area off the
                  // row link, same geometry as the home history rows.
                  <li
                    key={template.id}
                    className="flex items-center gap-1 rounded-2xl border border-border bg-card transition-colors active:bg-muted/60"
                  >
                    <Link
                      href={`/templates/${template.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 p-4"
                    >
                      {template.icon !== null && (
                        <span aria-hidden="true" className="shrink-0 text-2xl leading-none">
                          {template.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-lg uppercase leading-tight tracking-wide">
                          {template.name}
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                          {templateStatusLine(
                            usage.get(template.name) ?? null,
                            template.exerciseCount,
                            unit,
                            now,
                          )}
                        </span>
                      </span>
                    </Link>
                    <GuardedStartLink
                      href={`/workout/new?template=${template.id}`}
                      session={guardSession}
                      aria-label={`Start ${template.name}`}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                        'relative mr-2 shrink-0 text-muted-foreground before:absolute before:-inset-1',
                      )}
                    >
                      <Play aria-hidden="true" className="size-5" />
                    </GuardedStartLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
