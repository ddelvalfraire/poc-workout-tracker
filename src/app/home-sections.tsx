import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import type { HomeSectionKind, HomeSectionShape } from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { packSections } from '@/lib/home/pack'
import { DividerList } from '@/components/ui/divider-list'
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

type HomeSectionRenderer = (ctx: HomeSectionContext, shape: HomeSectionShape) => ReactNode

const HOME_SECTION_RENDERERS: Record<HomeSectionKind, HomeSectionRenderer> = {
  momentum: (ctx, shape) => (
    <MomentumPanel userId={ctx.userId} nowMs={ctx.nowMs} size={shape === 'micro' ? 'sm' : 'md'} />
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
      size={shape === 'micro' ? 'sm' : 'md'}
    />
  ),
  unfinished: (ctx) => <UnfinishedSection workouts={ctx.unfinished} />,
}

/**
 * The bento grid. Columns widen with the viewport — 2 on the phone, 4 from
 * `md`, 6 from `xl` — and `packSections` places every cell for that column
 * count. Rows are a fixed unit (`--home-cell-row`) because a bento needs real
 * row spans: a tall cell that runs past its neighbour is the whole reason the
 * grid stops reading as a list.
 *
 * Placement is emitted as inline `grid-row` / `grid-column` rather than
 * Tailwind classes for two reasons: the values are computed per layout, so
 * they cannot be enumerated for the JIT compiler; and pinning them explicitly
 * means the browser never re-derives a placement of its own that could drift
 * from what a native client will compute from the same packer.
 */
/** The column count at each breakpoint. The packer runs once per tier and
 *  every cell carries all three placements; the stylesheet picks one. */
const COLUMN_TIERS = [
  { columns: 2, prefix: '2' },
  { columns: 4, prefix: '4' },
  { columns: 6, prefix: '6' },
] as const

/**
 * Maps the resolved layout to rendered sections inside ONE packed grid.
 * Hidden sections are filtered BEFORE packing (so they occupy no space) and
 * before any renderer runs; unknown kinds — a future client's sections — are
 * dropped just as silently, and never error.
 */
export function renderHomeSections(
  sections: readonly ResolvedHomeSection[],
  ctx: HomeSectionContext,
  renderers: Partial<Record<string, HomeSectionRenderer>> = HOME_SECTION_RENDERERS,
): ReactNode {
  // Filtering unknown kinds before packing matters: a section nothing can
  // render must not reserve a hole in the grid.
  const visible = sections.filter((s) => !s.hidden && renderers[s.kind] !== undefined)
  // One pass per breakpoint, keyed by section id so the three placements can
  // be attached to the same cell.
  const placements = new Map<string, Record<string, string>>()
  for (const { columns, prefix } of COLUMN_TIERS) {
    for (const cell of packSections(visible, columns).cells) {
      const vars = placements.get(cell.section.id) ?? {}
      vars[`--r${prefix}`] = `${cell.row + 1} / span ${cell.rowSpan}`
      vars[`--c${prefix}`] = `${cell.col + 1} / span ${cell.colSpan}`
      placements.set(cell.section.id, vars)
    }
  }
  return (
    <div className="home-bento">
      {visible.map((section) => {
        const render = renderers[section.kind]!
        return (
          <div key={section.id} style={placements.get(section.id) as CSSProperties}>
            <HomeCell>{render(ctx, section.shape)}</HomeCell>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The cell shell — every widget is a body, never a body plus hand-tuned
 * chrome. Frameless by default: no border, no fill, no radius. A bento gets
 * its compartments from the jump in type scale, the gutters, and the closing
 * hairline; drawing a box around each one is a card grid with the fill turned
 * off, which is what the de-card vocabulary in DESIGN.md already forbids.
 *
 * Every value it paints with is a token (globals.css `.home-cell`), so a
 * future theme can turn fills and radii back on without touching a widget.
 */
function HomeCell({ children }: { children: ReactNode }) {
  return <div className="home-cell">{children}</div>
}

/** Unfinished: rows that still need an action (resume or finish).
 *  Deliberately quiet — the live session owns the hero;
 *  anything here is a stale abandonment. Rows reopen the logger, never the
 *  read-only summary (which would present them as completed). */
function UnfinishedSection({ workouts }: { workouts: WorkoutSummary[] }) {
  const t = useTranslations('HomeSections')
  if (workouts.length === 0) return null
  return (
    <>
      <h2 className="mt-10 mb-3 text-lg">{t('unfinishedTitle')}</h2>
      <DividerList>
        {workouts.map((w) => (
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
