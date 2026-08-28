import Link from 'next/link'
import type { ReactNode } from 'react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import { SHAPE_UNITS, type HomeSectionKind, type HomeSectionShape } from '@/lib/home/registry'
import type { HomeSectionConfig, ResolvedHomeSection } from '@/lib/home/layout'
import { HomeBento, type HomeBentoItem } from '@/components/home/home-bento'
import { DividerList } from '@/components/ui/divider-list'
import { BigThree, bigThreeContent } from './big-three'
import { CardioWeek, cardioWeekContent } from './cardio-week'
import { ClosestGoal, closestGoalContent } from './closest-goal'
import { LaggingGroup, laggingGroupContent } from './lagging-group'
import { LiftTrend, liftTrendContent } from './lift-trend'
import { MuscleBalance, muscleBalanceContent } from './muscle-balance'
import { PaceRecord, paceRecordContent } from './pace-record'
import { StreakCard, streakCardContent } from './streak-card'
import { TrophyCase, trophyCaseContent } from './trophy-case'
import { WeightTrend, weightTrendContent } from './weight-trend'
import { PlanAdherence, planAdherenceContent } from './plan-adherence'
import { StrengthRetention, strengthRetentionContent } from './strength-retention'
import { MomentumPanel, momentumContent } from './momentum-panel'
import { TodayRecap } from './today-recap'
import { HomeCellBoundary } from './home-cell-boundary'
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

/**
 * A section's TWO questions, answered together in one entry per kind: does
 * this widget have anything to say, and what does it render?
 *
 * They are one entry rather than two parallel maps because they must agree.
 * `hasContent` is asked BEFORE the grid packs anything, and a widget the grid
 * believes has content but which then renders nothing costs a reserved cell
 * with a closing hairline in it — the exact hole this pair exists to close.
 * So no `hasContent` below restates a widget's emptiness condition: each one
 * defers to the same `…Content` function the component itself awaits, which
 * is what makes the two impossible to drift apart.
 */
export interface HomeSectionWidget {
  /** Answered from `ctx` alone where the page already holds the fact, and
   *  otherwise from the widget's own request-memoized content read — which
   *  the component then awaits a second time for free. */
  hasContent: (
    ctx: HomeSectionContext,
    config: HomeSectionConfig | undefined,
  ) => boolean | Promise<boolean>
  render: HomeSectionRenderer
}

/** Every content function's own emptiness contract is `null`. */
const present = (content: unknown) => content !== null

export const HOME_SECTION_WIDGETS: Record<HomeSectionKind, HomeSectionWidget> = {
  momentum: {
    hasContent: (ctx) => momentumContent(ctx.userId).then(present),
    render: (ctx, shape) => (
      <MomentumPanel userId={ctx.userId} nowMs={ctx.nowMs} size={bodySizeForShape(shape)} />
    ),
  },
  'today-recap': {
    // The ONE widget whose emptiness the server cannot fully decide: TodayRecap
    // filters to the user's LOCAL calendar day, which is a client fact by the
    // local-day principle. What the server can decide is the one-way half — no
    // completions in the 48h window means none today in ANY timezone — and that
    // is the case this filter exists for (a brand-new account). A session
    // completed 30h ago but not today still reserves a cell; closing that needs
    // the cell itself to collapse client-side, which the grid's explicit
    // placement does not support today.
    hasContent: (ctx) => ctx.recentCompleted.length > 0,
    render: (ctx, shape) => (
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
  },
  unfinished: {
    hasContent: (ctx) => ctx.unfinished.length > 0,
    render: (ctx, shape) =>
      bodySizeForShape(shape) === 'sm' ? (
        <UnfinishedTile workouts={ctx.unfinished} />
      ) : (
        <UnfinishedSection workouts={ctx.unfinished} />
      ),
  },
  'cardio-week': {
    hasContent: (ctx) => cardioWeekContent(ctx.userId).then(present),
    render: (ctx, shape) => <CardioWeek userId={ctx.userId} shape={shape} />,
  },
  'big-three': {
    hasContent: (ctx) => bigThreeContent(ctx.userId).then(present),
    render: (ctx, shape) => <BigThree userId={ctx.userId} shape={shape} />,
  },
  'pace-record': {
    hasContent: (ctx) => paceRecordContent(ctx.userId).then(present),
    render: (ctx, shape) => <PaceRecord userId={ctx.userId} shape={shape} />,
  },
  'strength-retention': {
    hasContent: (ctx) => strengthRetentionContent(ctx.userId).then(present),
    render: (ctx, shape) => <StrengthRetention userId={ctx.userId} shape={shape} />,
  },
  'plan-adherence': {
    hasContent: (ctx) => planAdherenceContent(ctx.userId).then(present),
    render: (ctx, shape) => <PlanAdherence userId={ctx.userId} shape={shape} />,
  },
  'muscle-balance': {
    hasContent: (ctx) => muscleBalanceContent(ctx.userId).then(present),
    render: (ctx, shape) => <MuscleBalance userId={ctx.userId} shape={shape} />,
  },
  'lagging-group': {
    hasContent: (ctx) => laggingGroupContent(ctx.userId).then(present),
    render: (ctx) => <LaggingGroup userId={ctx.userId} />,
  },
  'weight-trend': {
    hasContent: (ctx) => weightTrendContent(ctx.userId).then(present),
    render: (ctx) => <WeightTrend userId={ctx.userId} />,
  },
  streak: {
    hasContent: (ctx) => streakCardContent(ctx.userId).then(present),
    render: (ctx) => <StreakCard userId={ctx.userId} />,
  },
  'closest-goal': {
    hasContent: (ctx) => closestGoalContent(ctx.userId).then(present),
    render: (ctx) => <ClosestGoal userId={ctx.userId} />,
  },
  'trophy-case': {
    hasContent: (ctx) => trophyCaseContent(ctx.userId).then(present),
    render: (ctx, shape) => <TrophyCase userId={ctx.userId} shape={shape} />,
  },
  'lift-trend': {
    // Passed as PARTS, matching the content function's cache key — handing it
    // `config.exercise` would key on object identity and read the trend twice.
    hasContent: (ctx, config) =>
      liftTrendContent(
        ctx.userId,
        ctx.nowMs,
        config?.exercise?.source ?? null,
        config?.exercise?.wgerExerciseId ?? null,
      ).then(present),
    render: (ctx, shape, config) => (
      <LiftTrend
        userId={ctx.userId}
        nowMs={ctx.nowMs}
        shape={shape}
        pinned={config?.exercise}
      />
    ),
  },
}

/**
 * Is this section worth a cell?
 *
 * A rejected `hasContent` KEEPS the section, and that is not a fallback — it
 * is the only honest answer. The read that just failed is the same
 * request-memoized promise the component is about to await, so the widget will
 * throw the identical error inside its own cell, where `HomeCellBoundary`
 * renders it as a failed tile. Dropping the section here instead would take a
 * database error and make it indistinguishable from "you have no trophies
 * yet": the tile would simply not be there, and nobody — user or log — would
 * ever learn a read had failed. The `catch` moves WHERE the error surfaces,
 * never whether it does.
 *
 * It is also LOGGED here, and that is not belt-and-braces. The re-throw story
 * above only holds when the thing that failed was the shared memoized read —
 * the component then awaits the same rejected promise and lands in its cell's
 * boundary. A predicate that fails for its OWN reasons has no such second
 * chance: the widget renders perfectly well, the section keeps its cell, and a
 * broken `hasContent` quietly stops answering — which reintroduces the very
 * reserved-hole bug this function exists to prevent, invisibly. So the one
 * path that can genuinely go unnoticed says so out loud.
 */
async function sectionHasContent(
  widget: HomeSectionWidget,
  ctx: HomeSectionContext,
  config: HomeSectionConfig | undefined,
  kind: string,
): Promise<boolean> {
  try {
    return await widget.hasContent(ctx, config)
  } catch (error: unknown) {
    console.error(`[home] emptiness check failed for ${kind}; keeping its cell`, error)
    return true
  }
}

/**
 * Maps the resolved layout to the bento shell's items.
 *
 * Three filters, in this order, and the order is the contract:
 *   1. HIDDEN sections go first, so a hidden section's renderer never runs and
 *      a hidden Momentum panel's queries never happen.
 *   2. UNKNOWN kinds — a future client's sections — are dropped just as
 *      silently, and never error.
 *   3. EMPTY sections are dropped, so they reserve no space — the cell shell
 *      paints a closing hairline, and an empty one leaves a stray rule in a
 *      gap every later cell was routed around.
 *
 * (3) IS ASKED BEFORE PACKING, WHICH IS WHY IT WORKS. A renderer returns an
 * ELEMENT, not rendered output: `<TrophyCase/>` is truthy whether or not the
 * async RSC behind it will render anything, so testing the element could only
 * ever catch the kinds that answer from `ctx` synchronously. The emptiness
 * decision is therefore hoisted OUT of the widgets and into `hasContent`,
 * which resolves the same memoized read the component awaits — and does it
 * for every section at once, so home still costs one round of queries rather
 * than thirteen in series.
 *
 * Each surviving body is wrapped in its own error boundary. Home fans out a
 * dozen independent database reads, and without a boundary between them any
 * one of them failing unwinds past every sibling to the route's error.tsx —
 * one bad trophy query, no home screen.
 *
 * Geometry lives in the shell (components/home/home-bento.tsx). This file
 * owns only the kind → widget map — the WEB half of the customization
 * contract, and the reason the shell may not import it.
 */
export async function renderHomeSections(
  sections: readonly ResolvedHomeSection[],
  ctx: HomeSectionContext,
  widgets: Partial<Record<string, HomeSectionWidget>> = HOME_SECTION_WIDGETS,
): Promise<ReactNode> {
  const candidates = sections.flatMap((section) => {
    if (section.hidden) return []
    const widget = widgets[section.kind]
    return widget === undefined ? [] : [{ section, widget }]
  })
  // In PARALLEL: these are a dozen independent reads, and awaiting them in the
  // loop below would turn one round trip into a dozen in series.
  const kept = await Promise.all(
    candidates.map(({ section, widget }) =>
      sectionHasContent(widget, ctx, section.config, section.kind),
    ),
  )

  const items: HomeBentoItem[] = []
  candidates.forEach(({ section, widget }, i) => {
    if (!kept[i]) return
    const body = widget.render(ctx, section.shape, section.config)
    // Belt and braces: `hasContent` has already answered for every kind, so a
    // renderer returning nothing here means the two have drifted apart. Drop
    // the cell rather than reserve a hole for it either way.
    if (body === null || body === undefined || body === false) return
    items.push({
      id: section.id,
      shape: section.shape,
      body: <HomeCellBoundary>{body}</HomeCellBoundary>,
    })
  })
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
