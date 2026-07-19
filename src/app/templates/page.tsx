import Link from 'next/link'
import { ChevronLeft, Play } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { listWorkoutTemplates } from '@/db/workout-templates'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/active-session'
import { AppHeader } from '@/components/app-header'
import { GuardedStartLink } from '@/components/guarded-start-link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Standalone workout templates — reusable session sketches saved OUTSIDE any
 * program. Rows open the detail sketch; the per-row Start button seeds a
 * fresh logger draft (through the single-active-session guard, same as every
 * other start CTA). Templates are created from a logged workout's "Save as
 * template" — there is no blank builder here on purpose: the sketch derives
 * from work actually done.
 */
export default async function TemplatesPage() {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const [templates, summaries, drafts] = await Promise.all([
    listWorkoutTemplates(userId),
    listWorkoutSummaries(userId),
    listWorkoutDrafts(userId),
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

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Templates"
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
        <h2 className="mt-6 mb-3 text-lg">Your Templates</h2>

        {templates.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No templates yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Finish a workout, then tap “Save as template” on its summary to
              reuse it here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {templates.map((template) => (
              // gap-1 keeps the Start button's expanded hit area off the row
              // link, same geometry as the home history rows.
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
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {[
                        `${template.exerciseCount} exercise${template.exerciseCount === 1 ? '' : 's'}`,
                        template.description,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
      </main>
    </div>
  )
}
