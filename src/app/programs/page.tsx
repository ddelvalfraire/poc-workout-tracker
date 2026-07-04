import Link from 'next/link'
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

        <h2 className="mt-10 mb-3 text-lg">Your Programs</h2>

        {programs.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No programs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap “New Program” to build your first training plan.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {programs.map((program) => (
              <li key={program.id}>
                <Link
                  href={`/programs/${program.id}`}
                  className="flex min-w-0 items-center justify-between gap-3 px-4 py-4 transition-colors active:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{program.name}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      <span
                        className={cn(
                          'text-xs font-semibold uppercase tracking-wide',
                          program.status === 'active' ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {program.status}
                      </span>{' '}
                      · {program.mesocycleWeeks}-wk cycle
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-5 shrink-0 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
