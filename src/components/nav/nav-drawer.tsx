'use client'

import Link, { useLinkStatus } from 'next/link'
import {
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Drawer } from 'vaul'
import { SignOutButton } from '@/components/auth/sign-out-button'
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  History,
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
import { drawerPersister, pruneForeignDrawerSnapshots } from '@/lib/query-persister'
import { activeSessionHref } from '@/lib/workout/active-session'
import { scheduleAnchor } from '@/lib/home/schedule-anchor'
import {
  blockCompleteContextLine,
  bodyStatusLine,
  doneContextLine,
  drawerHeroState,
  exercisesStatusLine,
  isActiveRoute,
  programProgressPercent,
  programStatusLine,
  recentWorkoutLine,
  restContextLine,
  startContextLine,
  trophyStatusLine,
  volumeStatusLine,
  type DrawerData,
  type NavDrawerKey,
  type NavDrawerLine,
} from '@/lib/home/drawer-status'
import { renderLine, renderLines } from '@/lib/message'
import { buttonVariants } from '@/components/ui/button'
import { Ghost } from '@/components/ui/ghost'
import { Sparkbar } from '@/components/charts/sparkbar'
import { StreakChip } from '@/components/home/streak-chip'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The app's navigation drawer — the Claude-sidebar anatomy with the spike-§7
 * verdict applied: the drawer is a DASHBOARD, not a menu. Zones with distinct
 * jobs (the Arc principle): ACT (the hero — volt only when there is a workout
 * to resume or start, a quiet status otherwise; its second line IS the
 * context) / SURFACES (every row carries a live status line — Gentler
 * Streak's translate-stats-into-status) / RECENT / IDENTITY (pinned bottom).
 *
 * Vaul (Radix Dialog under the hood) owns the mechanics: focus trap, scrim,
 * esc, swipe-to-dismiss, left-edge slide. Status data arrives via TanStack
 * Query, fetched ONCE per session on the first mount (not on the first
 * open): the request races a tap the user almost never makes within the
 * first second, so the first open lands on data — the 150ms ghost delay
 * means a warm cache never shows a ghost at all. Later mounts serve the
 * cache (refetchOnMount off), and a reopen past staleTime revalidates in
 * the background while the cached rows stay put. A failed fetch degrades
 * every row to its label: the nav never breaks because a status read did.
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
  /** Stale (or missing) snapshot with no request in flight: revalidate in
   *  the background — cached rows stay rendered (openedPending false → no
   *  ghosts, no arrival replay); a failed cold fetch gets its retry here. */
  refetchInBackground: boolean
}

export function planDrawerOpen(args: {
  hasData: boolean
  isStale: boolean
  /** The mount-time fetch (or a revalidation) is already running — never
   *  stack a second request on top of it. */
  isFetching: boolean
}): DrawerOpenPlan {
  return {
    openedPending: !args.hasData,
    refetchInBackground: args.isStale && !args.isFetching,
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

/** What a tap on a drawer link must do — pure, so the keep-open contract is
 *  unit-testable. A tap on the CURRENT page closes the drawer without
 *  minting a duplicate history entry; a cross-page tap strips the drawer's
 *  own entry BEFORE the Link's push lands and leaves the drawer OPEN — the
 *  current page (drawer included) stays on screen until the next page is
 *  ready, whose own NavDrawer instance replaces this one. The tapped link
 *  is therefore where the wait shows (see DrawerLink), not a spinner. */
export function planLinkTap(args: { targetPathname: string; pathname: string }): {
  preventDefault: boolean
  close: boolean
  stripHistoryEntry: boolean
} {
  const sameRoute = args.targetPathname === args.pathname
  return { preventDefault: sameRoute, close: sameRoute, stripHistoryEntry: !sameRoute }
}

/** Renders a marker while the navigation its parent Link started is still
 *  pending; the parent's has-data-nav-pending: variant does the dimming.
 *  Nothing renders at all for a navigation that beats the 150ms delay. */
function PendingMark() {
  const { pending } = useLinkStatus()
  return pending ? <span data-nav-pending="" aria-hidden="true" hidden /> : null
}

/** Every navigating link in the drawer: a plain <Link> (prefetch, long-press
 *  previews keep working) that dims after 150ms while its navigation is
 *  pending — the app's ONLY pending signal on a route change (DESIGN.md
 *  § Pending states), shown only when the wait is real. */
function DrawerLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={cn(className, 'has-data-nav-pending:animate-pending-dim')}>
      {children}
      <PendingMark />
    </Link>
  )
}

/** The hero's one box geometry, shared by every variant: min-h-17 is the
 *  `nav-hero-height` token (src/design/tokens.ts, 68px — the volt button's
 *  own height), so pending → quiet → volt swaps never move the rows. */
const HERO_BOX = 'flex min-h-17 flex-col justify-center'

interface QuietHeroProps {
  title: string
  context: string | null
  href: string
  linkLabel: string
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void
}

/** The hero when there is NOTHING to start — done for today, a rest day, a
 *  finished block: a status pair plus one muted door, home's own quiet
 *  vocabulary (StatusHero's trained-today / rest-day / block-complete). No
 *  volt, no button skin: the day's work is done or not due, and a green CTA
 *  here would be a promise the data does not back. */
function QuietHero({ title, context, href, linkLabel, onNavigate }: QuietHeroProps) {
  return (
    <div className={HERO_BOX}>
      <p className="text-base font-semibold uppercase tracking-wide">{title}</p>
      {context !== null && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground tnum">{context}</p>
      )}
      <DrawerLink
        href={href}
        onClick={onNavigate}
        className="mt-1.5 flex w-fit items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors active:text-foreground"
      >
        {linkLabel}
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </DrawerLink>
    </div>
  )
}

export interface NavDrawerProps {
  /** The signed-in user — the persisted snapshot's key (lib/query-persister):
   *  a second account on the same device must never open on the first
   *  account's rows. Pages already hold it from requireUserId. */
  userId: string
}

export function NavDrawer({ userId }: NavDrawerProps) {
  const t = useTranslations('NavDrawer')
  // Same product name as the home heading and the document title.
  const tCommon = useTranslations('Common')
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // True while the CURRENT open began without data — the arrival animation
  // plays only for that open ('first successful load' semantics); a cached
  // reopen renders the status lines statically inside the rows' own rise-in.
  const [openedPending, setOpenedPending] = useState(true)
  const pathname = usePathname()
  const router = useRouter()

  // Mount-triggered, once per session: the first NavDrawer instance to mount
  // fetches; every page's instance after it serves the cache (refetchOnMount
  // off — a request per navigation is not a nav-open cost worth paying) and
  // the open-triggered plan below revalidates a stale snapshot. An error
  // leaves data undefined → the label-only degrade, and the next open (or
  // Query's focus revalidation) quietly recovers it.
  //
  // Persisted across launches (lib/query-persister): the first use restores
  // the last snapshot from localStorage — a cold launch opens on yesterday's
  // rows, and a snapshot past staleTime revalidates in the background while
  // they stay rendered. Any other account's snapshot on this device is
  // dropped before the query can restore it.
  useEffect(() => {
    pruneForeignDrawerSnapshots(userId)
  }, [userId])
  const {
    data: drawerData,
    isStale,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['drawer', userId],
    queryFn: ({ signal }) => fetchDrawerData(signal),
    staleTime: DRAWER_STALE_MS,
    refetchOnMount: false,
    persister: drawerPersister.persisterFn,
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
  // own header trigger) — and only then. There is no root loading.tsx, so
  // the current page stays on screen until the next one is ready; closing
  // the drawer eagerly would leave the user staring at the page they just
  // left with nothing happening. It stays open, and the tapped DrawerLink
  // dims after 150ms if the wait is real (planLinkTap has the contract).
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
    const plan = planLinkTap({ targetPathname, pathname })
    if (plan.preventDefault) event.preventDefault() // duplicate same-page entry: the one push the drawer must block
    if (plan.stripHistoryEntry) dismissForNavigation()
    if (plan.close) setIsOpen(false) // programmatic close → the hook pops the drawer's own entry
  }

  function handleOpenChange(open: boolean): void {
    setIsOpen(open)
    if (!open) return
    const plan = planDrawerOpen({ hasData: data !== null, isStale, isFetching })
    // Snapshot whether THIS open starts pending — the arrival animation's key.
    setOpenedPending(plan.openedPending)
    // Serve the cache instantly; only a stale snapshot (or a failed cold
    // fetch) revalidates, in the background, with the rendered rows staying
    // put. A fetch already in flight is left alone.
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

  // The hero's state — home's seven-state brain over the drawer payload, so
  // the two surfaces never disagree about whether there is a workout to do.
  // Null while pending: the hero shows NO CTA copy until the data has earned
  // one (a "Start Workout" before the facts arrive is a false promise to a
  // user who already trained today).
  const heroState = data === null ? null : drawerHeroState(data, now)
  // min-h-17 is the button's own natural height (see HERO_BOX) — stated so
  // the volt and quiet variants are provably the same box.
  const voltHero = cn(buttonVariants({ size: 'lg' }), 'h-auto min-h-17 w-full flex-col gap-0.5 py-3')

  function renderHero(): ReactNode {
    if (data === null || heroState === null) {
      // Ghost of the hero: two bars in the box's exact geometry, copy withheld.
      return (
        <div className={cn(HERO_BOX, 'items-center gap-2')}>
          <Ghost className="h-3 w-32" />
          <Ghost className="h-2 w-24" />
        </div>
      )
    }
    if (heroState === 'session-live' && data.resume) {
      return (
        <DrawerLink href={activeSessionHref(data.resume.key)} onClick={closeOnNavigate} className={voltHero}>
          <span className="text-base font-semibold uppercase tracking-wide">{t('resumeAction')}</span>
          <span className="text-xs font-medium normal-case opacity-80">
            {data.resume.name ?? t('resumeContext')}
          </span>
        </DrawerLink>
      )
    }
    // Drifting with a program mirrors home: the way back in is the next day.
    if ((heroState === 'program-due' || heroState === 'drifting') && data.upNext) {
      const upNext = data.upNext
      return (
        <button
          type="button"
          disabled={isStarting}
          onClick={() => void handleStartUpNext(upNext.dayId)}
          className={voltHero}
        >
          <span className="text-base font-semibold uppercase tracking-wide">
            {isStarting ? t('startingAction') : t('startAction')}
          </span>
          <span className="text-xs font-medium normal-case opacity-80">
            {line(startContextLine(upNext.dayName, upNext.week, scheduleAnchor(upNext.weekdays, now)))}
          </span>
        </button>
      )
    }
    if (heroState === 'trained-today' && data.lastCompleted) {
      return (
        <QuietHero
          title={t('hero.titleDone')}
          context={lines(doneContextLine(data.lastCompleted, data.unit))}
          href="/workout/new"
          linkLabel={t('hero.logMoreLink')}
          onNavigate={closeOnNavigate}
        />
      )
    }
    if (heroState === 'rest-day') {
      // rest-day only exists for a scheduled day that is not today, so the
      // anchor is never null here; if that invariant ever breaks the hero
      // stays QUIET (title, no context) rather than falling through to a
      // volt Start the state does not back.
      const anchor = data.upNext ? scheduleAnchor(data.upNext.weekdays, now) : null
      return (
        <QuietHero
          title={t('hero.titleRest')}
          context={
            anchor !== null && data.upNext ? line(restContextLine(data.upNext.dayName, anchor)) : null
          }
          href="/workout/new"
          linkLabel={t('hero.quickLogLink')}
          onNavigate={closeOnNavigate}
        />
      )
    }
    if (heroState === 'block-complete' && data.program) {
      return (
        <QuietHero
          title={t('hero.titleBlockComplete')}
          context={line(blockCompleteContextLine(data.program.name, data.program.mesocycleWeeks))}
          href={`/programs/${data.program.id}/stats`}
          linkLabel={t('hero.resultsLink')}
          onNavigate={closeOnNavigate}
        />
      )
    }
    // fresh, or drifting with no program: the open door (home's volt too).
    return (
      <DrawerLink href="/workout/new" onClick={closeOnNavigate} className={voltHero}>
        <span className="text-base font-semibold uppercase tracking-wide">{t('quickStartAction')}</span>
        <span className="text-xs font-medium normal-case opacity-80">{t('quickLogContext')}</span>
      </DrawerLink>
    )
  }

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
      // The full log's only nav entry: home no longer renders history, so the
      // drawer is how you reach it. Status reuses the newest recent already
      // in DrawerData — no new read for the row.
      href: '/history',
      label: t('label.history'),
      icon: History,
      status: data?.recents[0]
        ? lines(recentWorkoutLine(data.recents[0], data.unit, now))
        : null,
      invitation: t('invitation.history'),
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
              <DrawerLink
                href="/"
                onClick={closeOnNavigate}
                aria-current={pathname === '/' ? 'page' : undefined}
                className={cn(
                  'font-display text-lg font-semibold uppercase tracking-tight',
                  pathname === '/' && 'text-primary',
                )}
              >
                {tCommon('appName')}
              </DrawerLink>
            </div>

            {/* Zone ACT — the hero, keyed by its STATE so a change remounts
                it through animate-fade-in (a single 180ms opacity crossfade
                in place, instant under reduced motion). Volt only for
                resume/start; done-for-today, rest-day and block-complete are
                quiet. Every variant, the pending ghost included, fills the
                same HERO_BOX so the swap never moves a pixel. */}
            <div
              key={heroState ?? 'pending'}
              className="border-b border-border p-4 motion-safe:animate-fade-in"
            >
              {renderHero()}
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
                      <DrawerLink
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
                      </DrawerLink>
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
                      <DrawerLink
                        href={`/workout/${recent.id}`}
                        onClick={closeOnNavigate}
                        className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2 transition-colors active:bg-muted/60"
                      >
                        <span className="min-w-0 truncate text-sm">{recent.name ?? t('untitledWorkout')}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tnum">
                          {lines(recentWorkoutLine(recent, data.unit, now))}
                        </span>
                      </DrawerLink>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Zone IDENTITY — pinned bottom, Claude-style. */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 pb-safe">
            <DrawerLink
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
            </DrawerLink>
            <SignOutButton />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
