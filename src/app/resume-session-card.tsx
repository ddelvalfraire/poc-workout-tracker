import Link from 'next/link'
import { activeSessionHref, type ActiveSession } from '@/lib/active-session'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * "Workout in progress" banner — surfaces the cross-device draft on the home
 * screen so an interrupted session is one tap from where it left off, instead
 * of silently waiting inside the logger. Counts only, no clock time: this is
 * a Server Component and the server's timezone would lie about local time.
 */
export function ResumeSessionCard({ session }: { session: ActiveSession }) {
  const href = activeSessionHref(session.key)
  const summary = [
    `${session.exerciseCount} exercise${session.exerciseCount === 1 ? '' : 's'}`,
    `${session.completedSetCount} of ${session.setCount} set${session.setCount === 1 ? '' : 's'} done`,
  ].join(' · ')

  return (
    <section className="mt-6 rounded-2xl border border-primary/50 bg-card p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        {/* Pulsing dot: the one place motion earns its keep on this screen —
            "live right now", not decoration. */}
        <span aria-hidden="true" className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        Workout in progress
      </p>

      <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
        {session.name ?? 'Unnamed session'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground tnum">{summary}</p>

      {/* Set-completion bar: state, not decoration — how deep into the
          session the last device got, readable before deciding to resume. */}
      {session.setCount > 0 && (
        <div
          role="progressbar"
          aria-label="Sets completed"
          aria-valuemin={0}
          aria-valuemax={session.setCount}
          aria-valuenow={session.completedSetCount}
          className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${(session.completedSetCount / session.setCount) * 100}%` }}
          />
        </div>
      )}

      <Link
        href={href}
        className={cn(
          buttonVariants({ size: 'lg' }),
          'mt-4 w-full font-semibold uppercase tracking-wide',
        )}
      >
        Resume workout
      </Link>
    </section>
  )
}
