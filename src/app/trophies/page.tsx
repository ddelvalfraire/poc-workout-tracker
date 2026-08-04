import {
  CalendarCheck,
  Dumbbell,
  Flag,
  Flame,
  Lock,
  Medal,
  Weight,
} from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import type { TrophyRow } from '@/db/trophies'
import {
  closestTrophies,
  evaluateTrophies,
  groupTrophiesByFamily,
  trophyContextLine,
  trophyFraction,
  trophyHeroGlyph,
  trophyHint,
  trophyLabel,
  type TrophyEvidence,
} from '@/lib/trophies'
import { TROPHY_DEFS, type TrophyDef, type TrophyKind } from '@/lib/trophy-kinds'
import { formatWorkoutDate } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'
import { AppHeader } from '@/components/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { ShareCardButton } from '@/components/share-card-button'

// A stamp this fresh still carries the NEW tag — one week, then it's history.
const NEW_TAG_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000
// Stagger step for the medal reveal; capped so a full case doesn't crawl.
const STAGGER_MS = 40
const STAGGER_MAX_STEPS = 8

/**
 * /trophies — fact-derived milestones only (the honesty brand), laid out as
 * a trophy CASE: the CLOSEST rail up top (the locked kinds nearest their
 * line), then editorial family zones (PLATE CLUBS / TOTALS / SHOWING UP /
 * STREAKS / BLOCKS / TONNAGE). Earned kinds get the medal treatment — the
 * threshold number IS the trophy — newest first; locked kinds keep honest
 * progress from the SAME evidence the hints read, never invented.
 */
export default async function TrophiesPage() {
  const userId = await requireUserId()
  const [{ earned, locked, evidence }, unit] = await Promise.all([
    evaluateTrophies(userId),
    getWeightUnit(userId),
  ])
  const zones = groupTrophiesByFamily(earned, locked)
  const closest = closestTrophies(locked, evidence)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Trophies"
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-8 px-5 pb-safe pt-6">
        {earned.length === 0 && (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
            <p className="font-medium">No trophies yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every trophy is a lifting fact — plate clubs, workout counts, streaks. Train and
              they stamp themselves.
            </p>
          </div>
        )}

        {closest.length > 0 && (
          <section aria-label="Closest trophies">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-primary">
              Closest
            </h2>
            <ul className="mt-2 space-y-2">
              {closest.map((kind) => (
                <LockedTrophyRow key={kind} kind={kind} evidence={evidence} unit={unit} />
              ))}
            </ul>
          </section>
        )}

        {zones.map((zone) => (
          <section key={zone.family} aria-label={zone.label}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {zone.label}
            </h2>

            {zone.earned.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                {zone.earned.map((row, i) => (
                  <EarnedMedal key={row.id} row={row} unit={unit} index={i} />
                ))}
              </div>
            )}

            {zone.locked.length > 0 && (
              <ul className="mt-2 space-y-2">
                {zone.locked.map((kind) => (
                  <LockedTrophyRow key={kind} kind={kind} evidence={evidence} unit={unit} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>
    </div>
  )
}

function EarnedMedal({
  row,
  unit,
  index,
}: {
  row: TrophyRow
  unit: WeightUnit
  index: number
}) {
  const Icon = familyIcon(TROPHY_DEFS[row.kind])
  const context = trophyContextLine(row, unit)
  const glyph = trophyHeroGlyph(row.kind)
  const isNew = isNewTrophy(row.achievedAt)

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-primary/50 bg-card p-4 ring-1 ring-inset ring-primary/15 motion-safe:animate-rise-in"
      style={{
        animationDelay: `${Math.min(index, STAGGER_MAX_STEPS) * STAGGER_MS}ms`,
        // Backwards fill so a delayed card doesn't flash before its rise.
        animationFillMode: 'backwards',
      }}
    >
      {/* The medal glow — layered volt radial, decoration only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 20% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <Icon aria-hidden="true" className="size-4 text-primary" />
          <div className="flex items-center gap-1">
            {isNew && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                New
              </span>
            )}
            {/* Ships the rendered PNG via the OS sheet — never a URL. */}
            <ShareCardButton
              cardUrl={`/api/cards/trophy/${row.kind}`}
              shareTitle={trophyLabel(row.kind)}
              size="icon-xs"
              className="-mr-2 -mt-2"
            />
          </div>
        </div>
        {/* The threshold number IS the trophy; block (no number) leans on
            its icon + name alone. */}
        {glyph !== null && (
          <p className="mt-2 font-display text-4xl leading-none tnum">{glyph}</p>
        )}
        <h3 className={`${glyph !== null ? 'mt-1' : 'mt-2'} font-display text-lg uppercase leading-tight tracking-wide`}>
          {trophyLabel(row.kind)}
        </h3>
        {context !== null && (
          <p className="mt-1 text-xs text-muted-foreground tnum">{context}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{formatWorkoutDate(row.achievedAt)}</p>
      </div>
    </article>
  )
}

function LockedTrophyRow({
  kind,
  evidence,
  unit,
}: {
  kind: TrophyKind
  evidence: TrophyEvidence
  unit: WeightUnit
}) {
  const Icon = familyIcon(TROPHY_DEFS[kind])
  const fraction = trophyFraction(kind, evidence)

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">{trophyLabel(kind)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/80 tnum">
          {trophyHint(kind, evidence, unit)}
        </p>
        {fraction !== null && fraction.percent > 0 && (
          <div
            role="progressbar"
            aria-valuenow={fraction.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${fraction.percent}% toward ${trophyLabel(kind)}`}
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${fraction.percent}%` }}
            />
          </div>
        )}
      </div>
      <Lock aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />
    </li>
  )
}

/** A stamp fresher than the NEW window, read outside component render (the
 *  lib convention — clock reads live in helpers, not JSX). */
function isNewTrophy(achievedAt: Date, nowMs: number = Date.now()): boolean {
  return nowMs - achievedAt.getTime() < NEW_TAG_DAYS * MS_PER_DAY
}

/** One icon per kind family — markers, not decoration (matches /goals). */
function familyIcon(def: TrophyDef) {
  switch (def.family) {
    case 'club':
      return Dumbbell
    case 'sum_club':
      return Medal
    case 'count':
      return CalendarCheck
    case 'streak':
      return Flame
    case 'block':
      return Flag
    case 'tonnage':
      return Weight
  }
}
