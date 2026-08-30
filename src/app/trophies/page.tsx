import {
  CalendarCheck,
  Dumbbell,
  Flag,
  Flame,
  Lock,
  Medal,
  Weight,
  type LucideIcon,
} from 'lucide-react'
import { requireUserId } from '@/lib/auth/auth'
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
} from '@/lib/goals/trophies'
import { TROPHY_DEFS, type TrophyDef, type TrophyKind } from '@/lib/goals/trophy-kinds'
import { formatWorkoutDate } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'
import { AppHeader } from '@/components/nav/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { ShareCardButton } from '@/components/ui/share-card-button'
import { DividerList } from '@/components/ui/divider-list'
import { EmptyWords } from '@/components/ui/empty-words'
import { getTranslations } from 'next-intl/server'
import { useFormatter, useTranslations } from 'next-intl'

/**
 * The hero numeral is a NUMBER, not copy: "1,000" and "1M" are both
 * `Intl.NumberFormat` output, so the reader's locale picks the separator and
 * the compact suffix. Grouping stays off below the sum-club thresholds,
 * matching the plain "315" the club medals have always shown.
 */
const GLYPH_FORMATS = {
  standard: { useGrouping: false },
  grouped: {},
  compact: { notation: 'compact' },
} as const satisfies Record<string, Intl.NumberFormatOptions>

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
  const t = await getTranslations('Trophies')
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
        title={t('title')}
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-8 px-5 pb-safe pt-6">
        {earned.length === 0 && (
          <EmptyWords>
            {t('empty')}
          </EmptyWords>
        )}

        {closest.length > 0 && (
          <section aria-label={t('closest.groupLabel')}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('closest.title')}
            </h2>
            <DividerList className="mt-2">
              {closest.map((kind) => (
                <LockedTrophyRow key={kind} kind={kind} evidence={evidence} unit={unit} />
              ))}
            </DividerList>
          </section>
        )}

        {zones.map((zone) => (
          <section key={zone.family} aria-label={t(`family.${zone.family}`)}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t(`family.${zone.family}`)}
            </h2>

            {zone.earned.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                {zone.earned.map((row, i) => (
                  <EarnedMedal key={row.id} row={row} unit={unit} index={i} />
                ))}
              </div>
            )}

            {zone.locked.length > 0 && (
              <DividerList className="mt-2">
                {zone.locked.map((kind) => (
                  <LockedTrophyRow key={kind} kind={kind} evidence={evidence} unit={unit} />
                ))}
              </DividerList>
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
  const t = useTranslations('Trophies')
  const format = useFormatter()
  const Icon = FAMILY_ICONS[TROPHY_DEFS[row.kind].family]
  const context = trophyContextLine(row, unit)
  const label = trophyLabel(row.kind)
  const name = t(label.key, label.values)
  const glyph = trophyHeroGlyph(row.kind)
  const isNew = isNewTrophy(row.achievedAt)

  return (
    <article
      className="motion-safe:animate-rise-in"
      style={{
        animationDelay: `${Math.min(index, STAGGER_MAX_STEPS) * STAGGER_MS}ms`,
        // Backwards fill so a delayed cell doesn't flash before its rise.
        animationFillMode: 'backwards',
      }}
    >
      <div className="flex items-start justify-between">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        <div className="flex items-center gap-1">
          {isNew && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              {t('badge')}
            </span>
          )}
          {/* Ships the rendered PNG via the OS sheet — never a URL. */}
          <ShareCardButton
            cardUrl={`/api/cards/trophy/${row.kind}`}
            shareTitle={name}
            size="icon-xs"
            className="-mr-2 -mt-2"
          />
        </div>
      </div>
      {/* The threshold number IS the trophy — poster type, plain foreground:
          a volt numeral per grid cell would stack volt on a revisit surface
          (#163 rule), so the NEW chip alone carries volt; block (no number)
          leans on its icon + name alone. */}
      {glyph !== null && (
        <p className="mt-2 font-display text-5xl leading-none tnum">
          {format.number(glyph.value, GLYPH_FORMATS[glyph.notation])}
        </p>
      )}
      <h3 className={`${glyph !== null ? 'mt-1' : 'mt-2'} font-display text-lg uppercase leading-tight tracking-wide`}>
        {name}
      </h3>
      {context !== null && (
        <p className="mt-1 text-xs text-muted-foreground tnum">
          {t(context.key, context.values)}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{formatWorkoutDate(row.achievedAt)}</p>
    </article>
  )
}

// Exported for tests: the locked row owns the only interpolated copy on
// this surface (the progress bar’s accessible name).
export function LockedTrophyRow({
  kind,
  evidence,
  unit,
}: {
  kind: TrophyKind
  evidence: TrophyEvidence
  unit: WeightUnit
}) {
  const t = useTranslations('Trophies')
  const Icon = FAMILY_ICONS[TROPHY_DEFS[kind].family]
  const fraction = trophyFraction(kind, evidence)
  const label = trophyLabel(kind)
  const name = t(label.key, label.values)
  const hint = trophyHint(kind, evidence, unit)

  return (
    <li className="flex items-center gap-3 py-4">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/80 tnum">{t(hint.key, hint.values)}</p>
        {fraction !== null && fraction.percent > 0 && (
          <div
            role="progressbar"
            aria-valuenow={fraction.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('progressLabel', { percent: fraction.percent, trophy: name })}
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-muted-foreground/60"
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

/** One icon per kind family — markers, not decoration (matches /goals). A
 *  static map rather than a function: a call that RETURNS a component reads
 *  to react-hooks/static-components as a component created during render. */
const FAMILY_ICONS: Record<TrophyDef['family'], LucideIcon> = {
  club: Dumbbell,
  sum_club: Medal,
  count: CalendarCheck,
  streak: Flame,
  block: Flag,
  tonnage: Weight,
}
