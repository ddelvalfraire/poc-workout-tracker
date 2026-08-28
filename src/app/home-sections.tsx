import Link from 'next/link'
import type { ReactNode } from 'react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import { SHAPE_UNITS, type HomeSectionKind, type HomeSectionShape } from '@/lib/home/registry'
import type { HomeSectionConfig, ResolvedHomeSection } from '@/lib/home/layout'
import { HomeBento, type HomeBentoItem } from '@/components/home/home-bento'
import { DividerList } from '@/components/ui/divider-list'
import { BigThree } from './big-three'
import { CardioWeek } from './cardio-week'
import { ClosestGoal } from './closest-goal'
import { LaggingGroup } from './lagging-group'
import { LiftTrend } from './lift-trend'
import { MuscleBalance } from './muscle-balance'
import { PaceRecord } from './pace-record'
import { StreakCard } from './streak-card'
import { TrophyCase } from './trophy-case'
import { WeightTrend } from './weight-trend'
import { PlanAdherence } from './plan-adherence'
import { StrengthRetention } from './strength-retention'
import { MomentumPanel } from './momentum-panel'
import { TodayRecap } from './today-recap'
import { useTranslations } from 'next-intl'

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

export interface HomeSectionContext {
  userId: string
  /** The page's request "now" (epoch ms) — one instant for every section. */
  nowMs: number
  unit: WeightUnit
  /** Completed within the 48h gate window (TodayRecap filters to local today). */
  recentCompleted: WorkoutSummary[]
  /** Started-but-unfinished sessions (stale abandonments, not live state). */
  unfinished: WorkoutSummary[]
}

/** `config` is the section's own pinned subject — only kinds the registry
 *  marks with a `configKind` ever receive one, and they treat its absence as
 *  "derive a default" rather than as an error. */
type HomeSectionRenderer = (
  ctx: HomeSectionContext,
  shape: HomeSectionShape,
  config: HomeSectionConfig | undefined,
) => ReactNode

/**
 * Which body variant a tile of this shape can hold — compact for a one-row
 * tile, the full multi-row body above that.
 *
 * Keyed on the shape's ROW COUNT, not on a named shape. Testing `=== 'micro'`
 * looked equivalent and was not: `wide` is also one row tall, so the full
 * body went into a one-row tile where the only thing that could happen to it
 * was being clipped.
 */
export function bodySizeForShape(shape: HomeSectionShape): 'sm' | 'md' {
  return SHAPE_UNITS[shape].rows === 1 ? 'sm' : 'md'
}

const HOME_SECTION_RENDERERS: Record<HomeSectionKind, HomeSectionRenderer> = {
  momentum: (ctx, shape) => (
    <MomentumPanel userId={ctx.userId} nowMs={ctx.nowMs} size={bodySizeForShape(shape)} />
  ),
  'today-recap': (ctx, shape) => (
    <TodayRecap
      workouts={ctx.recentCompleted.map((w) => ({
        id: w.id,
        name: w.name,
        startedAtMs: w.startedAt.getTime(),
        completedAtMs: w.completedAt!.getTime(),
        volumeKg: w.volumeKg,
      }))}
      unit={ctx.unit}
      size={bodySizeForShape(shape)}
    />
  ),
  // Returns NOTHING rather than an empty section: a cell that renders nothing
  // is not invisible, it is a reserved hole with a closing hairline in it.
  unfinished: (ctx, shape) =>
    ctx.unfinished.length === 0 ? null : bodySizeForShape(shape) === 'sm' ? (
      <UnfinishedTile workouts={ctx.unfinished} />
    ) : (
      <UnfinishedSection workouts={ctx.unfinished} />
    ),
  'cardio-week': (ctx, shape) => <CardioWeek userId={ctx.userId} shape={shape} />,
  'big-three': (ctx, shape) => <BigThree userId={ctx.userId} shape={shape} />,
  'pace-record': (ctx, shape) => <PaceRecord userId={ctx.userId} shape={shape} />,
  'strength-retention': (ctx, shape) => <StrengthRetention userId={ctx.userId} shape={shape} />,
  'plan-adherence': (ctx, shape) => <PlanAdherence userId={ctx.userId} shape={shape} />,
  'muscle-balance': (ctx, shape) => <MuscleBalance userId={ctx.userId} shape={shape} />,
  'lagging-group': (ctx) => <LaggingGroup userId={ctx.userId} />,
  'weight-trend': (ctx) => <WeightTrend userId={ctx.userId} />,
  streak: (ctx) => <StreakCard userId={ctx.userId} />,
  'closest-goal': (ctx) => <ClosestGoal userId={ctx.userId} />,
  'trophy-case': (ctx, shape) => <TrophyCase userId={ctx.userId} shape={shape} />,
  'lift-trend': (ctx, shape, config) => (
    <LiftTrend
      userId={ctx.userId}
      nowMs={ctx.nowMs}
      shape={shape}
      pinned={config?.exercise}
    />
  ),
}

/**
 * Maps the resolved layout to the bento shell's items.
 *
 * Three filters, in this order, and the order is the contract:
 *   1. HIDDEN sections go first, so a hidden section's renderer never runs and
 *      a hidden Momentum panel's queries never happen.
 *   2. UNKNOWN kinds — a future client's sections — are dropped just as
 *      silently, and never error.
 *   3. EMPTY bodies are dropped AFTER rendering, because emptiness is
 *      something only the renderer knows (nothing unfinished, no goals yet).
 *
 * All three happen before packing, so a dropped section reserves no space:
 * the cell shell paints a closing hairline, which would otherwise leave a
 * stray rule floating in a gap every later cell was routed around.
 *
 * Geometry lives in the shell (components/home/home-bento.tsx). This file
 * owns only the kind → renderer map — the WEB half of the customization
 * contract, and the reason the shell may not import it.
 */
export function renderHomeSections(
  sections: readonly ResolvedHomeSection[],
  ctx: HomeSectionContext,
  renderers: Partial<Record<string, HomeSectionRenderer>> = HOME_SECTION_RENDERERS,
): ReactNode {
  const items: HomeBentoItem[] = []
  for (const section of sections) {
    if (section.hidden) continue
    const render = renderers[section.kind]
    if (render === undefined) continue
    const body = render(ctx, section.shape, section.config)
    if (body === null || body === undefined || body === false) continue
    items.push({ id: section.id, shape: section.shape, body })
  }
  return <HomeBento items={items} />
}

/** Newest first — the session you most recently walked away from. */
function byNewestStart(workouts: readonly WorkoutSummary[]): WorkoutSummary[] {
  return [...workouts].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
}

/**
 * Unfinished in a ONE-ROW tile: the queue head.
 *
 * A one-row cell has room for a heading and a list of nothing, so the list
 * body below could only ever be clipped there. This names the session you
 * stalled on, says how far in you got, and IS the resume — the tile is the
 * link, not a pointer to one. Showing a single session is therefore not a
 * teaser row (banned grammar: home never describes an action that lives
 * somewhere else). Handle this one and the next stalled session takes its
 * place, so there is no dead end. The full log lives at /history.
 */
function UnfinishedTile({ workouts }: { workouts: WorkoutSummary[] }) {
  const t = useTranslations('HomeSections')
  const newest = byNewestStart(workouts)[0]
  // Same guard as the list body below. The renderer already drops the empty
  // case, so this is unreachable today — but the two bodies are picked apart
  // by shape and must not disagree about their own precondition, and an
  // unguarded [0] is a crash rather than a blank tile.
  if (newest === undefined) return null
  return (
    <Link
      href={`/workout/${newest.id}/edit`}
      className="flex h-full flex-col transition-colors active:bg-muted/60"
    >
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('unfinishedTitle')}
      </span>
      <span className="mt-auto flex flex-col justify-end">
        <span className="flex items-baseline gap-1">
          {/* Sets logged, not a count of stalled sessions: how far in you got
              is what decides whether you pick it back up. */}
          <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
            {newest.completedSetCount}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">
            {t('unfinishedSetsUnit', { sets: newest.completedSetCount })}
          </span>
        </span>
        <span className="mt-1.5 block truncate text-[0.7rem] text-muted-foreground">
          {newest.name ?? t('untitledWorkout')}
        </span>
      </span>
    </Link>
  )
}

/** Unfinished with room for its rows (a two-row tile): every stalled session,
 *  each with its own action (resume or finish).
 *  Deliberately quiet — the live session owns the hero;
 *  anything here is a stale abandonment. Rows reopen the logger, never the
 *  read-only summary (which would present them as completed). */
function UnfinishedSection({ workouts }: { workouts: WorkoutSummary[] }) {
  const t = useTranslations('HomeSections')
  if (workouts.length === 0) return null
  return (
    <>
      {/* A tile heading in the shell's label voice, not the old page-section
          h2 — the bento's compartments come from the type-scale jump. */}
      <h2 className="mb-3 font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('unfinishedTitle')}
      </h2>
      <DividerList>
        {byNewestStart(workouts).map((w) => (
          <li key={w.id}>
            <Link
              href={`/workout/${w.id}/edit`}
              className="flex min-w-0 items-center gap-4 py-3.5 transition-colors active:bg-muted/60"
            >
              {/* A calendar anchor, muted — these dates mark where a session
                  stalled, not an achievement. */}
              <span className="flex w-9 shrink-0 flex-col items-center text-muted-foreground">
                <span className="font-display text-xl leading-none tnum">
                  {w.startedAt.getDate()}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest">
                  {monthFormat.format(w.startedAt)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.name ?? t('untitledWorkout')}</span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                  {t('startedSummary', { sets: w.completedSetCount })}
                </span>
              </span>
              {/* A quiet word instead of the chevron: "resume" says what
                  tapping does; a bare chevron would read like a detail
                  disclosure. */}
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('resumeLabel')}
              </span>
            </Link>
          </li>
        ))}
      </DividerList>
    </>
  )
}
