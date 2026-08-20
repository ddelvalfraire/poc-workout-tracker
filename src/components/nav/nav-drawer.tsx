'use client'

import Link from 'next/link'
import { useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Drawer } from 'vaul'
import { SignOutButton } from '@/components/auth/sign-out-button'
import {
  BarChart3,
  ClipboardList,
  Dumbbell,
  LayoutTemplate,
  Menu,
  MessageCircle,
  NotebookPen,
  Scale,
  Settings,
  Target,
  Trophy,
} from 'lucide-react'
import { startProgramDayAction } from '@/app/programs/actions'
import { useHistoryDismissable } from '@/lib/use-history-dismissable'
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
  type NavDrawerKey,
  type NavDrawerLine,
} from '@/lib/drawer-status'
import { renderLine, renderLines } from '@/lib/message'
import { buttonVariants } from '@/components/ui/button'
import { Ghost } from '@/components/ghost'
import { Sparkbar } from '@/components/sparkbar'
import { StreakChip } from '@/components/streak-chip'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The app's navigation drawer — the Claude-sidebar anatomy with the spike-§7
 * verdict applied: the drawer is a DASHBOARD, not a menu. Zones with distinct
 * jobs (the Arc principle): ACT (volt hero whose copy IS the context) /
 * SURFACES (every row carries a live status line — Gentler Streak's
 * translate-stats-into-status) / RECENT / IDENTITY (pinned bottom).
 *
 * Vaul (Radix Dialog under the hood) owns the mechanics: focus trap, scrim,
 * esc, swipe-to-dismiss, left-edge slide. Status data arrives via TanStack
 * Query, enabled on the drawer's first open — a warm cache renders instantly
 * on later opens/pages (no ghosts, no arrival replay), and a reopen past
 * staleTime revalidates in the background while the cached rows stay put.
 * A failed fetch degrades every row to its label: the nav never breaks
 * because a status read did.
 */

/** How long a fetched drawer snapshot counts as fresh on reopen. Mirrors the
 *  provider-wide default in app/providers.tsx — stated here explicitly so the
 *  drawer's reopen contract survives a provider retune. */
const DRAWER_STALE_MS = 30_000

/** What an open (or reopen) of the drawer must do — pure so the reopen
 *  contract is unit-testable without a DOM. */
export interface DrawerOpenPlan {
  /** This open began without data → ghosts now, arrival animation on load. */
  openedPending: boolean
  /** First open ever: enable the query (the open-triggered cold fetch). */
  enableQuery: boolean
  /** Reopen past staleTime: revalidate in the background — the cached rows
   *  stay rendered (openedPending false → no ghosts, no arrival replay). */
  refetchInBackground: boolean
}

export function planDrawerOpen(args: {
  hasOpened: boolean
  hasData: boolean
  isStale: boolean
}): DrawerOpenPlan {
  return {
    openedPending: !args.hasData,
    enableQuery: !args.hasOpened,
    refetchInBackground: args.hasOpened && args.isStale,
  }
}

/** The status line's arrival treatment: rise-in (staggered with its row) only
 *  when the data landed DURING this open — a cached reopen renders statically
 *  so the arrival never replays. Exported for the keying tests. */
export function statusArrival(
  openedPending: boolean,
  index: number,
): { className: string; style?: React.CSSProperties } {
  if (!openedPending) return { className: 'block' }
  return {
    className: 'block motion-safe:animate-rise-in',
    style: {
      animationDelay: `${index * ROW_STAGGER_MS}ms`,
      animationFillMode: 'backwards',
    },
  }
}

async function fetchDrawerData(signal: AbortSignal): Promise<DrawerData> {
  const res = await fetch('/api/drawer', { signal })
  if (!res.ok) throw new Error(`drawer fetch failed: ${res.status}`)
  return (await res.json()) as DrawerData
}

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
  const t = useTranslations('NavDrawer')
  // Same product name as the home heading and the document title.
  const tCommon = useTranslations('Common')
  const [isOpen, setIsOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // True while the CURRENT open began without data — the arrival animation
  // plays only for that open ('first successful load' semantics); a cached
  // reopen renders the status lines statically inside the rows' own rise-in.
  const [openedPending, setOpenedPending] = useState(true)
  const pathname = usePathname()
  const router = useRouter()

  // Open-triggered (enabled flips on first open, as the raw fetch did); an
  // error leaves data undefined → the same label-only degrade as before, and
  // Query's focus/reopen revalidation quietly recovers it later.
  const {
    data: drawerData,
    isStale,
    refetch,
  } = useQuery({
    queryKey: ['drawer'],
    queryFn: ({ signal }) => fetchDrawerData(signal),
    staleTime: DRAWER_STALE_MS,
    enabled: hasOpened,
  })
  // data === null IS the pending state — the ghost/arrival contract below
  // (and the static-render test) key off it exactly as the useState days.
  const data = drawerData ?? null

  // The drawer is a history entry (spike §3d-bis): open pushes a same-URL
  // state entry, so the iOS edge-swipe / system back CLOSES the drawer
  // instead of leaving the page; tap-close and swipe-dismiss consume the
  // entry via the hook's programmatic path.
  const { dismissForNavigation } = useHistoryDismissable(isOpen, () => setIsOpen(false))

  // Navigation to a NEW route unmounts this instance (each page renders its
  // own header trigger); the eager close covers same-route taps and makes
  // cross-route exits feel immediate. Links stay plain <Link>s so prefetch
  // and long-press previews keep working.
  //
  // Two history duties on the way out (spike §3d): a tap on the CURRENT
  // page must close the drawer WITHOUT minting a duplicate entry, and a
  // cross-page tap must strip the drawer's history entry BEFORE the Link's
  // push lands (dismissForNavigation — a history.back() here would race
  // the router's own pushState).
  function closeOnNavigate(event: React.MouseEvent<HTMLAnchorElement>): void {
    // The anchor's own resolved URL, so every call site stays a plain
    // onClick={closeOnNavigate} — no per-link href plumbing to drift.
    const targetPathname = new URL(event.currentTarget.href, window.location.href).pathname
    if (targetPathname === pathname) {
      event.preventDefault() // duplicate same-page entry: the one push the drawer must block
      setIsOpen(false) // programmatic close → the hook pops the drawer's own entry
      return
    }
    dismissForNavigation()
    setIsOpen(false)
  }

  function handleOpenChange(open: boolean): void {
    setIsOpen(open)
    if (!open) return
    const plan = planDrawerOpen({ hasOpened, hasData: data !== null, isStale })
    // Snapshot whether THIS open starts pending — the arrival animation's key.
    setOpenedPending(plan.openedPending)
    if (plan.enableQuery) setHasOpened(true) // first open: cold fetch → ghosts
    // Reopen: serve the cache instantly; only a stale snapshot revalidates,
    // in the background, with the rendered rows staying put.
    if (plan.refetchInBackground) void refetch()
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
      // Same strip-before-push contract as closeOnNavigate: the drawer's
      // history entry must not linger beneath the logger's entry.
      dismissForNavigation()
      setIsOpen(false)
      router.push(`/workout/${workoutId}/edit`)
    } catch {
      setStartError(t('startError'))
      setIsStarting(false)
    }
  }

  const settingsActive = isActiveRoute(pathname, '/settings')

  // Client-side on purpose: the anchor ("today"/"tomorrow"/weekday) and the
  // recents' relative days are LOCAL-calendar words (lib/local-day.ts). The
  // drawer's content only mounts on open — post-hydration — so new Date()
  // here can never cause a hydration mismatch.
  const now = new Date()

  // The drawer's status language is decided in lib/drawer-status.ts as
  // descriptors (docs/I18N-KEYS.md §9) and rendered here, where the
  // translator lives. `lines` joins a segment list with the row's " · ".
  const line = (l: NavDrawerLine | null) => (l === null ? null : renderLine<NavDrawerKey>(t, l))
  const lines = (l: NavDrawerLine[]) => (l.length > 0 ? renderLines<NavDrawerKey>(t, l) : null)

  const surfaces: SurfaceRow[] = [
    {
      href: '/programs',
      label: t('label.programs'),
      icon: ClipboardList,
      status: data?.program
        ? line(programStatusLine(data.program.name, data.program.week, data.program.mesocycleWeeks))
        : null,
      invitation: t('invitation.programs'),
      visual: data?.program ? (
        <ThinBar percent={programProgressPercent(data.program.week, data.program.mesocycleWeeks)} />
      ) : undefined,
    },
    {
      // Static line v1 (the Coach-row precedent): /api/drawer carries no
      // template fact today, and a count would mean a new read on every
      // drawer open — not a nav-open cost for a static promise.
      href: '/templates',
      label: t('label.templates'),
      icon: LayoutTemplate,
      status: t('invitation.templates'),
      invitation: t('invitation.templates'),
    },
    {
      href: '/stats',
      label: t('label.stats'),
      icon: BarChart3,
      status: data?.stats ? line(volumeStatusLine(data.stats.weekSets)) : null,
      invitation: t('invitation.stats'),
      visual:
        data?.stats && data.stats.weekSets > 0 && data.stats.daySets.length > 0 ? (
          <Sparkbar daySets={data.stats.daySets} className="mt-1.5" />
        ) : undefined,
    },
    {
      href: '/goals',
      label: t('label.goals'),
      icon: Target,
      status: data?.goals ? data.goals.topGoalLabel : null,
      invitation: t('invitation.goals'),
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
      label: t('label.trophies'),
      icon: Trophy,
      status: data?.trophies
        ? line(trophyStatusLine(data.trophies.earned, data.trophies.newestLabel))
        : null,
      invitation: t('invitation.trophies'),
    },
    {
      href: '/body',
      label: t('label.body'),
      icon: Scale,
      status: data?.body ? lines(bodyStatusLine(data.body, data.unit)) : null,
      invitation: t('invitation.body'),
    },
    {
      href: '/exercises',
      label: t('label.exercises'),
      icon: Dumbbell,
      status: data?.exercises
        ? line(exercisesStatusLine(data.exercises.lastPrLabel, data.exercises.loggedCount))
        : null,
      invitation: t('invitation.exercises'),
    },
    {
      // Static line v1 (the Templates-row precedent): /api/drawer carries no
      // note fact today, and a count would cost a new read per drawer open.
      href: '/notes',
      label: t('label.notes'),
      icon: NotebookPen,
      status: t('invitation.notes'),
      invitation: t('invitation.notes'),
    },
    ...(data?.coach
      ? [
          {
            href: '/coach',
            label: t('label.coach'),
            icon: MessageCircle,
            status: t('invitation.coach'),
            invitation: t('invitation.coach'),
          } satisfies SurfaceRow,
        ]
      : []),
  ]

  return (
    <Drawer.Root direction="left" open={isOpen} onOpenChange={handleOpenChange}>
      <Drawer.Trigger
        aria-label={t('triggerLabel')}
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
          <Drawer.Title className="sr-only">{t('title')}</Drawer.Title>

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
                {tCommon('appName')}
              </Link>
            </div>

            {/* Zone ACT — the volt hero; its second line IS the context. The
                key swaps only when the VARIANT changes (pending → resume /
                up-next / quick), remounting the hero through animate-fade-in:
                a single 180ms opacity crossfade in place, instant under
                reduced motion. While data is pending the quick-log hero shows
                with its context line ghosted — same h-4 line box as the
                text-xs copy, so the swap never moves a pixel. */}
            <div
              key={
                data === null
                  ? 'pending'
                  : data.resume
                    ? 'resume'
                    : data.upNext
                      ? 'up-next'
                      : 'quick'
              }
              className="border-b border-border p-4 motion-safe:animate-fade-in"
            >
              {data?.resume ? (
                <Link
                  href={activeSessionHref(data.resume.key)}
                  onClick={closeOnNavigate}
                  className={cn(
                    buttonVariants({ size: 'lg' }),
                    'h-auto w-full flex-col gap-0.5 py-3',
                  )}
                >
                  <span className="text-base font-semibold uppercase tracking-wide">{t('resumeAction')}</span>
                  <span className="text-xs font-medium normal-case opacity-80">
                    {data.resume.name ?? t('resumeContext')}
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
                    {isStarting ? t('startingAction') : t('startAction')}
                  </span>
                  <span className="text-xs font-medium normal-case opacity-80">
                    {line(
                      startContextLine(
                        data.upNext.dayName,
                        data.upNext.week,
                        scheduleAnchor(data.upNext.weekdays, now),
                      ),
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
                    {t('quickStartAction')}
                  </span>
                  {data === null ? (
                    // Ghost of the context line: h-4 = the text-xs line box,
                    // so pending and resolved heroes are pixel-identical.
                    <span className="flex h-4 items-center justify-center">
                      <Ghost className="h-2 w-20" />
                    </span>
                  ) : (
                    <span className="text-xs font-medium normal-case opacity-80">{t('quickLogContext')}</span>
                  )}
                </Link>
              )}
              {startError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {startError}
                </p>
              )}
            </div>

            {/* Zone SURFACES — every row alive: icon + label + live status. */}
            <nav aria-label={t('navLabel')} className="border-b border-border px-2 py-2">
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
                          {data === null ? (
                            // Ghost where the status line will land — the
                            // h-4 line box IS the text-xs line height, so
                            // the row's height never changes on arrival.
                            <span className="mt-0.5 flex h-4 items-center">
                              <Ghost className="h-2 w-28" />
                            </span>
                          ) : (
                            // Arrival: status + micro-visual rise in IN
                            // PLACE, reusing the rows' own stagger — but only
                            // when the data landed DURING this open. A cached
                            // reopen renders statically (no arrival replay).
                            <span {...statusArrival(openedPending, index)}>
                              {statusLine !== null && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground tnum">
                                  {statusLine}
                                </span>
                              )}
                              {row.visual}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            {/* Zone RECENT — the anatomy's soul: last 3 completed sessions. */}
            {data !== null && data.recents.length > 0 && (
              // Mounts with the data (no ghost — its existence is itself
              // data); the rise-in lands it after the rows' stagger instead
              // of snapping in.
              <section
                className="px-2 py-2 motion-safe:animate-rise-in"
                style={{
                  animationDelay: `${surfaces.length * ROW_STAGGER_MS}ms`,
                  animationFillMode: 'backwards',
                }}
              >
                <h2 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('recentTitle')}
                </h2>
                <ul>
                  {data.recents.map((recent) => (
                    <li key={recent.id}>
                      <Link
                        href={`/workout/${recent.id}`}
                        onClick={closeOnNavigate}
                        className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2 transition-colors active:bg-muted/60"
                      >
                        <span className="min-w-0 truncate text-sm">{recent.name ?? t('untitledWorkout')}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tnum">
                          {lines(recentWorkoutLine(recent, data.unit, now))}
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
              aria-current={settingsActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold uppercase tracking-wide transition-colors active:bg-muted/60',
                settingsActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Settings aria-hidden="true" className="size-5" />
              {t('settingsLink')}
            </Link>
            <SignOutButton />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
