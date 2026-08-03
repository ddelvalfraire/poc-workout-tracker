'use client'

import Link from 'next/link'
import { useRef, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Drawer } from 'vaul'
import { UserButton } from '@clerk/nextjs'
import {
  BarChart3,
  ClipboardList,
  Dumbbell,
  Menu,
  MessageCircle,
  Scale,
  Settings,
  Target,
  Trophy,
} from 'lucide-react'
import { startProgramDayAction } from '@/app/programs/actions'
import { activeSessionHref } from '@/lib/active-session'
import { scheduleAnchor } from '@/lib/schedule-anchor'
import {
  bodyStatusLine,
  exercisesStatusLine,
  isActiveRoute,
  programProgressPercent,
  programStatusLine,
  recentWorkoutLine,
  startContextLine,
  trophyStatusLine,
  volumeStatusLine,
  type DrawerData,
} from '@/lib/drawer-status'
import { buttonVariants } from '@/components/ui/button'
import { Sparkbar } from '@/components/sparkbar'
import { StreakChip } from '@/components/streak-chip'
import { cn } from '@/lib/utils'

/**
 * The app's navigation drawer — the Claude-sidebar anatomy with the spike-§7
 * verdict applied: the drawer is a DASHBOARD, not a menu. Zones with distinct
 * jobs (the Arc principle): ACT (volt hero whose copy IS the context) /
 * SURFACES (every row carries a live status line — Gentler Streak's
 * translate-stats-into-status) / RECENT / IDENTITY (pinned bottom).
 *
 * Vaul (Radix Dialog under the hood) owns the mechanics: focus trap, scrim,
 * esc, swipe-to-dismiss, left-edge slide. Status data arrives from ONE authed
 * fetch on the drawer's first open per mount, cached in state — navigation
 * remounts the trigger on the next page, so data refreshes per surface, not
 * per open. A failed fetch degrades every row to its label: the nav never
 * breaks because a status read did.
 */

/** Stagger step for the rows' motion-safe rise-in. */
const ROW_STAGGER_MS = 25

interface SurfaceRow {
  href: string
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** Live status line, or null (degrade → label-only / invitation). */
  status: string | null
  /** Empty-state invitation — shown only once data arrived (spike: empty
   *  states are invitations, which kills the teaser-as-only-entry bug). */
  invitation: string
  /** Optional micro-visual under the status (progress bar, sparkbar). */
  visual?: ReactNode
  /** Optional trailing ornament (the goals streak flame). */
  trailing?: ReactNode
}

/** Thin progress bar (program week / goal percent). Presentational only —
 *  the row's status line carries the accessible fact. */
function ThinBar({ percent }: { percent: number }) {
  return (
    <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </span>
  )
}

export function NavDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [data, setData] = useState<DrawerData | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const hasFetchedRef = useRef(false)
  const pathname = usePathname()
  const router = useRouter()

  // Navigation to a NEW route unmounts this instance (each page renders its
  // own header trigger); the eager close covers same-route taps and makes
  // cross-route exits feel immediate. Links stay plain <Link>s so prefetch
  // and long-press previews keep working.
  function closeOnNavigate(): void {
    setIsOpen(false)
  }

  function handleOpenChange(open: boolean): void {
    setIsOpen(open)
    if (!open || hasFetchedRef.current) return
    hasFetchedRef.current = true
    void fetch('/api/drawer')
      .then(async (res) => {
        if (!res.ok) return
        setData((await res.json()) as DrawerData)
      })
      .catch(() => {
        // Degrade contract: no status data → every row renders label-only.
      })
  }

  // Same instantiate-then-navigate discipline as StartDayButton: await the
  // action, then push — never navigate inside a transition. No conflict
  // dialog needed: a live session replaces this CTA with RESUME entirely.
  async function handleStartUpNext(dayId: string): Promise<void> {
    if (isStarting) return
    setIsStarting(true)
    setStartError(null)
    try {
      const { workoutId } = await startProgramDayAction(dayId)
      router.push(`/workout/${workoutId}/edit`)
    } catch {
      setStartError('Could not start — try again.')
      setIsStarting(false)
    }
  }

  // Client-side on purpose: the anchor ("today"/"tomorrow"/weekday) and the
  // recents' relative days are LOCAL-calendar words (lib/local-day.ts). The
  // drawer's content only mounts on open — post-hydration — so new Date()
  // here can never cause a hydration mismatch.
  const now = new Date()

  const surfaces: SurfaceRow[] = [
    {
      href: '/programs',
      label: 'Programs',
      icon: ClipboardList,
      status: data?.program
        ? programStatusLine(data.program.name, data.program.week, data.program.mesocycleWeeks)
        : null,
      invitation: 'Start a plan',
      visual: data?.program ? (
        <ThinBar percent={programProgressPercent(data.program.week, data.program.mesocycleWeeks)} />
      ) : undefined,
    },
    {
      href: '/stats',
      label: 'Stats',
      icon: BarChart3,
      status: data?.stats ? volumeStatusLine(data.stats.weekSets) : null,
      invitation: 'Log a session to see volume',
      visual:
        data?.stats && data.stats.weekSets > 0 && data.stats.daySets.length > 0 ? (
          <Sparkbar daySets={data.stats.daySets} className="mt-1.5" />
        ) : undefined,
    },
    {
      href: '/goals',
      label: 'Goals',
      icon: Target,
      status: data?.goals ? data.goals.topGoalLabel : null,
      invitation: 'Set your first target',
      visual:
        data?.goals && data.goals.percent !== null ? (
          <ThinBar percent={data.goals.percent} />
        ) : undefined,
      trailing: data?.goals?.streak ? (
        <StreakChip
          completedAtTimes={data.goals.streak.completedAtTimes}
          scheduledWeekdays={data.goals.streak.scheduledWeekdays}
          allowedMissesPerWeek={data.goals.streak.allowedMissesPerWeek}
        />
      ) : undefined,
    },
    {
      href: '/trophies',
      label: 'Trophies',
      icon: Trophy,
      status: data?.trophies
        ? trophyStatusLine(data.trophies.earned, data.trophies.newestLabel)
        : null,
      invitation: 'Your first is one session away',
    },
    {
      href: '/body',
      label: 'Body',
      icon: Scale,
      status: data?.body ? bodyStatusLine(data.body, data.unit) : null,
      invitation: 'Log a weigh-in',
    },
    {
      href: '/exercises',
      label: 'Exercises',
      icon: Dumbbell,
      status: data?.exercises
        ? exercisesStatusLine(data.exercises.lastPrLabel, data.exercises.loggedCount)
        : null,
      invitation: 'Browse the catalog',
    },
    ...(data?.coach
      ? [
          {
            href: '/coach',
            label: 'Coach',
            icon: MessageCircle,
            status: 'Ask about your training',
            invitation: 'Ask about your training',
          } satisfies SurfaceRow,
        ]
      : []),
  ]

  return (
    <Drawer.Root direction="left" open={isOpen} onOpenChange={handleOpenChange}>
      <Drawer.Trigger
        aria-label="Open navigation"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'relative -ml-2 text-muted-foreground before:absolute before:-inset-1',
        )}
      >
        <Menu aria-hidden="true" className="size-5" />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex h-full w-[85%] max-w-[320px] flex-col border-r border-border bg-background outline-none"
        >
          <Drawer.Title className="sr-only">Navigation</Drawer.Title>

          <div className="flex-1 overflow-y-auto pt-safe pb-4">
            {/* Wordmark = the Home row (Claude-style drawer header): with the
                top-level back chevrons gone, this is the path home. */}
            <div className="border-b border-border px-5 py-4">
              <Link
                href="/"
                onClick={closeOnNavigate}
                aria-current={pathname === '/' ? 'page' : undefined}
                className={cn(
                  'font-display text-lg font-semibold uppercase tracking-tight',
                  pathname === '/' && 'text-primary',
                )}
              >
                Workout Tracker
              </Link>
            </div>

            {/* Zone ACT — the volt hero; its second line IS the context. */}
            <div className="border-b border-border p-4">
              {data?.resume ? (
                <Link
                  href={activeSessionHref(data.resume.key)}
                  onClick={closeOnNavigate}
                  className={cn(
                    buttonVariants({ size: 'lg' }),
                    'h-auto w-full flex-col gap-0.5 py-3',
                  )}
                >
                  <span className="text-base font-semibold uppercase tracking-wide">Resume</span>
                  <span className="text-xs font-medium normal-case opacity-80">
                    {data.resume.name ?? 'Workout in progress'}
                  </span>
                </Link>
              ) : data?.upNext ? (
                <button
                  type="button"
                  disabled={isStarting}
                  onClick={() => data.upNext && void handleStartUpNext(data.upNext.dayId)}
                  className={cn(
                    buttonVariants({ size: 'lg' }),
                    'h-auto w-full flex-col gap-0.5 py-3',
                  )}
                >
                  <span className="text-base font-semibold uppercase tracking-wide">
                    {isStarting ? 'Starting…' : 'Start Workout'}
                  </span>
                  <span className="text-xs font-medium normal-case opacity-80">
                    {startContextLine(
                      data.upNext.dayName,
                      data.upNext.week,
                      scheduleAnchor(data.upNext.weekdays, now),
                    )}
                  </span>
                </button>
              ) : (
                <Link
                  href="/workout/new"
                  onClick={closeOnNavigate}
                  className={cn(
                    buttonVariants({ size: 'lg' }),
                    'h-auto w-full flex-col gap-0.5 py-3',
                  )}
                >
                  <span className="text-base font-semibold uppercase tracking-wide">
                    Start Workout
                  </span>
                  <span className="text-xs font-medium normal-case opacity-80">Quick log</span>
                </Link>
              )}
              {startError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {startError}
                </p>
              )}
            </div>

            {/* Zone SURFACES — every row alive: icon + label + live status. */}
            <nav aria-label="Main navigation" className="border-b border-border px-2 py-2">
              <ul>
                {surfaces.map((row, index) => {
                  const active = isActiveRoute(pathname, row.href)
                  const statusLine = row.status ?? (data !== null ? row.invitation : null)
                  return (
                    <li
                      key={row.href}
                      className="motion-safe:animate-rise-in"
                      style={{
                        animationDelay: `${index * ROW_STAGGER_MS}ms`,
                        animationFillMode: 'backwards',
                      }}
                    >
                      <Link
                        href={row.href}
                        onClick={closeOnNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors active:bg-muted/60',
                          active && 'bg-primary/10',
                        )}
                      >
                        <row.icon
                          aria-hidden={true}
                          className={cn(
                            'mt-0.5 size-5 shrink-0',
                            active ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'text-sm font-semibold uppercase tracking-wide',
                                active && 'text-primary',
                              )}
                            >
                              {row.label}
                            </span>
                            {row.trailing}
                          </span>
                          {statusLine !== null && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground tnum">
                              {statusLine}
                            </span>
                          )}
                          {row.visual}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            {/* Zone RECENT — the anatomy's soul: last 3 completed sessions. */}
            {data !== null && data.recents.length > 0 && (
              <section className="px-2 py-2">
                <h2 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Recent
                </h2>
                <ul>
                  {data.recents.map((recent) => (
                    <li key={recent.id}>
                      <Link
                        href={`/workout/${recent.id}`}
                        onClick={closeOnNavigate}
                        className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2 transition-colors active:bg-muted/60"
                      >
                        <span className="min-w-0 truncate text-sm">{recent.name ?? 'Workout'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tnum">
                          {recentWorkoutLine(recent, data.unit, now)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Zone IDENTITY — pinned bottom, Claude-style. */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 pb-safe">
            <Link
              href="/settings"
              onClick={closeOnNavigate}
              aria-current={isActiveRoute(pathname, '/settings') ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold uppercase tracking-wide transition-colors active:bg-muted/60',
                isActiveRoute(pathname, '/settings') ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Settings aria-hidden="true" className="size-5" />
              Settings
            </Link>
            <UserButton />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
