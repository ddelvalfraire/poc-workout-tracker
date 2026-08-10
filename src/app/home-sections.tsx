import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import type { HomeSectionKind, HomeSectionSize } from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { DividerList } from '@/components/ui/divider-list'
import { HistoryList } from './history-list'
import { MomentumPanel } from './momentum-panel'
import { TodayRecap } from './today-recap'

/**
 * The WEB side of the home customization contract: kind → section renderer.
 * The registry (lib/home/registry.ts) stays data-only by law — this file is
 * where React enters. Native clients will ship their own map over the same
 * registry and layout document.
 *
 * Renderers close over a context of facts the page already computed (its
 * queries run regardless — StatusHero needs them); MomentumPanel stays a
 * self-fetching async RSC. A HIDDEN section's renderer is never invoked
 * (renderHomeSections filters first), so a hidden Momentum panel's own
 * queries never run — the visible-only query win, by construction.
 */

// en-US matches formatWorkoutDate — one locale for all date display.
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' })

/** Home keeps the freshest handful; the full log lives on /history (WHOOP
 *  tier discipline — history is tier-3 data on tier-1 real estate). */
const HOME_HISTORY_LIMIT = 5

export interface HomeSectionContext {
  userId: string
  /** The page's request "now" (epoch ms) — one instant for every section. */
  nowMs: number
  unit: WeightUnit
  /** Completed within the 48h gate window (TodayRecap filters to local today). */
  recentCompleted: WorkoutSummary[]
  /** All completed sessions, newest-first slice rendered by History. */
  completed: WorkoutSummary[]
  /** Started-but-unfinished sessions (stale abandonments, not live state). */
  unfinished: WorkoutSummary[]
  /** Single-active-session guard for Repeat starts. */
  guardSession: SessionSummary | null
}

type HomeSectionRenderer = (ctx: HomeSectionContext, size: HomeSectionSize) => ReactNode

const HOME_SECTION_RENDERERS: Record<HomeSectionKind, HomeSectionRenderer> = {
  momentum: (ctx, size) => <MomentumPanel userId={ctx.userId} nowMs={ctx.nowMs} size={size} />,
  'today-recap': (ctx, size) => (
    <TodayRecap
      workouts={ctx.recentCompleted.map((w) => ({
        id: w.id,
        name: w.name,
        startedAtMs: w.startedAt.getTime(),
        completedAtMs: w.completedAt!.getTime(),
        volumeKg: w.volumeKg,
      }))}
      unit={ctx.unit}
      size={size === 'sm' ? 'sm' : 'md'}
    />
  ),
  unfinished: (ctx) => <UnfinishedSection workouts={ctx.unfinished} />,
  history: (ctx, size) => (
    <HistorySection
      workouts={ctx.completed}
      unit={ctx.unit}
      guardSession={ctx.guardSession}
      size={size}
    />
  ),
}

/** The web mapping of the abstract 4-unit row: on the phone column a 2-col
 *  grid (sm = half width, md/lg = full width); from the md breakpoint the
 *  full 4-unit row renders literally (sm=1, md=2, lg=4 of 4 columns) — the
 *  desktop bento, same layout document. Flow is row-major with NO dense
 *  back-fill — a gap left by a lone sm before a full-width section stays
 *  visible (predictability over density). */
const SIZE_SPAN: Record<HomeSectionSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-2 md:col-span-4',
}

/**
 * Maps the resolved layout to rendered sections inside ONE flow grid. Hidden
 * sections are filtered BEFORE any renderer runs; unknown kinds (a future
 * client's sections) are silently skipped — never an error.
 *
 * gap-x only, deliberately: vertical rhythm stays owned by each section's own
 * mt-* margins (grid items don't collapse margins, but nothing here used
 * collapsing — every section spaces itself with a single top margin), so the
 * all-md default renders byte-identical to the pre-grid stacked home.
 */
export function renderHomeSections(
  sections: readonly ResolvedHomeSection[],
  ctx: HomeSectionContext,
  renderers: Partial<Record<string, HomeSectionRenderer>> = HOME_SECTION_RENDERERS,
): ReactNode {
  return (
    <div className="grid grid-cols-2 gap-x-3 md:grid-cols-4 md:gap-x-6">
      {sections
        .filter((s) => !s.hidden)
        .map((s) => {
          const render = renderers[s.kind]
          return render ? (
            <div key={s.kind} className={SIZE_SPAN[s.size]}>
              {render(ctx, s.size)}
            </div>
          ) : null
        })}
    </div>
  )
}

/** Unfinished sits above History by default: these rows still need an action
 *  (resume or finish). Deliberately quiet — the live session owns the hero;
 *  anything here is a stale abandonment. Rows reopen the logger, never the
 *  read-only summary (which would present them as completed). */
function UnfinishedSection({ workouts }: { workouts: WorkoutSummary[] }) {
  if (workouts.length === 0) return null
  return (
    <>
      <h2 className="mt-10 mb-3 text-lg">Unfinished</h2>
      <DividerList>
        {workouts.map((w) => (
          <li key={w.id}>
            <Link
              href={`/workout/${w.id}/edit`}
              className="flex min-w-0 items-center gap-4 py-3.5 transition-colors active:bg-muted/60"
            >
              {/* Same calendar anchor as History for scan continuity, but
                  muted — these dates mark where a session stalled, not an
                  achievement. */}
              <span className="flex w-9 shrink-0 flex-col items-center text-muted-foreground">
                <span className="font-display text-xl leading-none tnum">
                  {w.startedAt.getDate()}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest">
                  {monthFormat.format(w.startedAt)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.name ?? 'Workout'}</span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                  {`started · ${w.completedSetCount} set${w.completedSetCount === 1 ? '' : 's'} logged`}
                </span>
              </span>
              {/* A quiet word instead of the chevron: "resume" says what
                  tapping does; a bare chevron would read like a detail
                  disclosure. */}
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Resume
              </span>
            </Link>
          </li>
        ))}
      </DividerList>
    </>
  )
}

/** Rows shown at md — the demoted middle size; lg keeps the classic
 *  HOME_HISTORY_LIMIT handful. */
const HISTORY_MD_LIMIT = 3

/** History, demoted (WHOOP tier discipline): the last few compact rows; the
 *  full log lives on /history. No empty-state card — with nothing completed,
 *  the fresh hero already owns the invite.
 *
 *  Sizes: sm is one line (count + latest name/date) linking to /history;
 *  md shows 3 rows; lg the classic 5. The "All history" link appears whenever
 *  the size's slice leaves rows unseen. */
function HistorySection({
  workouts,
  unit,
  guardSession,
  size = 'md',
}: {
  workouts: WorkoutSummary[]
  unit: WeightUnit
  guardSession: SessionSummary | null
  size?: HomeSectionSize
}) {
  if (workouts.length === 0) return null

  if (size === 'sm') {
    const latest = workouts[0]
    return (
      <>
        <h2 className="mt-10 mb-3 text-lg">History</h2>
        <Link
          href="/history"
          className="flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors active:bg-muted/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium tnum">
              {`${workouts.length} workout${workouts.length === 1 ? '' : 's'}`}
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
              {`${latest.name ?? 'Workout'} · ${latest.startedAt.getDate()} ${monthFormat.format(latest.startedAt)}`}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        </Link>
      </>
    )
  }

  const limit = size === 'lg' ? HOME_HISTORY_LIMIT : HISTORY_MD_LIMIT
  return (
    <>
      <div className="mt-10 mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg">History</h2>
        {workouts.length > limit && (
          <Link
            href="/history"
            className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            All history
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        )}
      </div>
      <HistoryList
        workouts={workouts.slice(0, limit)}
        unit={unit}
        guardSession={guardSession}
      />
    </>
  )
}
