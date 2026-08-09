import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import type { HomeSectionKind } from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
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

const HOME_SECTION_RENDERERS: Record<HomeSectionKind, (ctx: HomeSectionContext) => ReactNode> = {
  momentum: (ctx) => <MomentumPanel userId={ctx.userId} nowMs={ctx.nowMs} />,
  'today-recap': (ctx) => (
    <TodayRecap
      workouts={ctx.recentCompleted.map((w) => ({
        id: w.id,
        name: w.name,
        startedAtMs: w.startedAt.getTime(),
        completedAtMs: w.completedAt!.getTime(),
        volumeKg: w.volumeKg,
      }))}
      unit={ctx.unit}
    />
  ),
  unfinished: (ctx) => <UnfinishedSection workouts={ctx.unfinished} />,
  history: (ctx) => (
    <HistorySection workouts={ctx.completed} unit={ctx.unit} guardSession={ctx.guardSession} />
  ),
}

/**
 * Maps the resolved layout to rendered sections. Hidden sections are filtered
 * BEFORE any renderer runs; unknown kinds (a future client's sections) are
 * silently skipped — never an error.
 */
export function renderHomeSections(
  sections: readonly ResolvedHomeSection[],
  ctx: HomeSectionContext,
  renderers: Partial<Record<string, (ctx: HomeSectionContext) => ReactNode>> = HOME_SECTION_RENDERERS,
): ReactNode {
  return sections
    .filter((s) => !s.hidden)
    .map((s) => {
      const render = renderers[s.kind]
      return render ? <Fragment key={s.kind}>{render(ctx)}</Fragment> : null
    })
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
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {workouts.map((w) => (
          <li key={w.id}>
            <Link
              href={`/workout/${w.id}/edit`}
              className="flex min-w-0 items-center gap-4 px-4 py-3.5 transition-colors active:bg-muted/60"
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
      </ul>
    </>
  )
}

/** History, demoted (WHOOP tier discipline): the last few compact rows; the
 *  full log lives on /history. No empty-state card — with nothing completed,
 *  the fresh hero already owns the invite. */
function HistorySection({
  workouts,
  unit,
  guardSession,
}: {
  workouts: WorkoutSummary[]
  unit: WeightUnit
  guardSession: SessionSummary | null
}) {
  if (workouts.length === 0) return null
  return (
    <>
      <div className="mt-10 mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg">History</h2>
        {workouts.length > HOME_HISTORY_LIMIT && (
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
        workouts={workouts.slice(0, HOME_HISTORY_LIMIT)}
        unit={unit}
        guardSession={guardSession}
      />
    </>
  )
}
