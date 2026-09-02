import { requireUserId } from '@/lib/auth/auth'
import { getMuscleVolume } from '@/db/muscle-volume'
import { getPlannedWeeklyVolume } from '@/db/planned-volume'
import {
  daysLeftInCalendarWeek,
  volumeWindows,
  type VolumeWindowMode,
} from '@/lib/stats/volume-window'
import { AppHeader } from '@/components/nav/app-header'
import { StatTile, type StatDelta } from '@/components/charts/stat-tile'
import { VolumeBarChart } from '@/components/charts/volume-bar-chart'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { WindowToggle } from './window-toggle'
import { PlanBulletList } from './plan-bullet-list'
import {
  lowVolumeGroups,
  LOW_VOLUME_FLOOR,
  overPlanGroups,
  setsDelta,
  sortGroupsForDisplay,
  underPlanGroups,
  verdictForStats,
  withPlanned,
  type StatsVerdict,
} from './volume-view'
import { getTranslations } from 'next-intl/server'

/** getTimezoneOffset is bounded by real-world zones (±14h); clamp to ±16h so
 *  a forged tz param can't fling week boundaries around. */
const MAX_TZ_OFFSET_MINUTES = 16 * 60

/**
 * The weekly training-balance check: sets per muscle group (primary 1.0 /
 * secondary 0.5) for this week vs last, with active-but-under-floor flags.
 * Window is URL state — rolling 7d by default, `?window=calendar&tz=…` for
 * client-local Monday weeks (the toggle island supplies the offset; the
 * server can't know it). Bad params degrade to defaults, never 404: the path
 * is the identity, the query is preference.
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string | string[]; tz?: string | string[] }>
}) {
  const t = await getTranslations('Stats')
  const userId = await requireUserId()
  const params = await searchParams
  const rawWindow = Array.isArray(params.window) ? params.window[0] : params.window
  const rawTz = Array.isArray(params.tz) ? params.tz[0] : params.tz

  const mode: VolumeWindowMode = rawWindow === 'calendar' ? 'calendar' : 'rolling'
  const parsedTz = /^-?\d+$/.test(rawTz ?? '') ? parseInt(rawTz!, 10) : 0
  const tzOffset = Math.max(-MAX_TZ_OFFSET_MINUTES, Math.min(MAX_TZ_OFFSET_MINUTES, parsedTz))

  const windows = volumeWindows(mode, new Date(), tzOffset)
  // Planned targets exist only for users with an active program (null
  // otherwise — the page then renders exactly as before targets existed).
  const [volume, planned] = await Promise.all([
    getMuscleVolume(userId, windows),
    getPlannedWeeklyVolume(userId),
  ])

  // Cardio minutes (this week / last) ride the same fetch — a cardio-only
  // week is training, not an empty page.
  const cardioMinutes = Math.round(volume.totals.currentCardioSec / 60)
  const previousCardioMinutes = Math.round(volume.totals.previousCardioSec / 60)
  const hasAnyVolume =
    volume.totals.currentSets > 0 ||
    volume.totals.previousSets > 0 ||
    cardioMinutes > 0 ||
    previousCardioMinutes > 0
  // The plan replaces the generic floor as the shortfall yardstick.
  const low = planned ? [] : lowVolumeGroups(volume.groups)
  const under = planned ? underPlanGroups(volume.groups, planned) : []
  const over = planned ? overPlanGroups(volume.groups, planned) : []
  // Shortfall-first with a plan, most-trained-first without. Bullet rows with
  // nothing planned AND nothing performed teach nothing — dropped, not
  // zero-barred.
  const planRows = planned
    ? sortGroupsForDisplay(withPlanned(volume.groups, planned), true).filter(
        (g) => g.plannedSets > 0 || g.currentSets > 0 || g.previousSets > 0,
      )
    : null
  const chartGroups = sortGroupsForDisplay(volume.groups, false)
  const delta = setsDelta(volume.totals.currentSets, volume.totals.previousSets)
  // Tile deltas built here rather than inline: `tone` is a design token name,
  // not copy, and the strict i18n gate reads bare strings inside JSX as copy.
  const setsTileDelta: StatDelta | undefined =
    delta !== null
      ? {
          // Two whole messages rather than a sign glued onto a number: the
          // sign leads the phrase in English and need not lead it elsewhere.
          text:
            delta > 0
              ? t('totals.setsDeltaUp', { amount: delta })
              : t('totals.setsDeltaDown', { amount: Math.abs(delta) }),
          tone: 'neutral',
        }
      : undefined
  const cardioTileDelta: StatDelta | undefined =
    previousCardioMinutes > 0
      ? { text: t('totals.cardioDelta', { minutes: previousCardioMinutes }), tone: 'neutral' }
      : undefined
  // Days-left is only meaningful against a fixed week end — calendar mode.
  const verdict = verdictForStats({
    planned,
    under,
    currentSets: volume.totals.currentSets,
    previousSets: volume.totals.previousSets,
    daysLeft: mode === 'calendar' ? daysLeftInCalendarWeek(new Date(), tzOffset) : null,
  })

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={<NavDrawer userId={userId} />}
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        {/* The verdict zone leads (the drawer/home language): status in
            words before any chart. The window toggle is demoted below it —
            a preference, not the page's opening move. */}
        {hasAnyVolume && (
          <section aria-label={t('verdict.ariaLabel')}>
            <h2 className="font-display text-4xl uppercase leading-none tracking-wide">
              {verdict.kind === 'behind'
                ? // The muscle group is CATALOG data, not copy — it arrives as
                  // an argument, never as part of the message.
                  t('verdict.behindTitle', { group: verdict.group })
                : verdict.kind === 'onPlan'
                  ? t('verdict.onPlanTitle')
                  : t('verdict.noPlanTitle')}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground tnum">
              {verdictContext(t, verdict)}
            </p>
          </section>
        )}

        <WindowToggle mode={mode} />

        {!hasAnyVolume ? (
          // De-carded teach state: plain muted words (the program-stats
          // empty-state voice), no shell.
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <section aria-label={t('totals.ariaLabel')}>
              <dl className="grid grid-cols-2 gap-3">
                <StatTile
                  label={t('totals.setsLabel')}
                  value={String(volume.totals.currentSets)}
                  delta={setsTileDelta}
                />
                <StatTile
                  label={t('totals.sessionsLabel')}
                  value={String(volume.totals.currentSessions)}
                />
                {/* Weekly cardio minutes (cardio v1): rendered only when a
                    window has any — lifting-only weeks keep the two-tile
                    grid byte-identical. */}
                {(cardioMinutes > 0 || previousCardioMinutes > 0) && (
                  <StatTile
                    label={t('totals.cardioLabel')}
                    value={String(cardioMinutes)}
                    unit={t('totals.cardioUnit')}
                    delta={cardioTileDelta}
                  />
                )}
              </dl>
            </section>

            {low.length > 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                {t.rich('lowNotice', {
                  floor: LOW_VOLUME_FLOOR,
                  groups: low.map((g) => g.group).join(', '),
                  lead: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
                })}
              </p>
            )}

            {/* The old "Under plan:" listing is gone: the verdict names the
                worst gap and every bullet row below shows its own. */}
            {over.length > 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                {t('overPlanNotice', {
                  groups: over
                    .map((e) => `${e.group} ${e.performedSets} / ${e.plannedSets}`)
                    .join(', '),
                })}
              </p>
            )}

            {/* De-carded: condensed-caps header over open content, closed by
                a muted hairline — the shell card is gone (settings-zone
                shape); chart/bullet internals untouched. */}
            <section aria-label={t('groups.ariaLabel')}>
              <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
                {t('groups.title')}
              </h2>
              <div className="mt-3 border-b border-b-border/60 pb-4">
                {planRows !== null ? (
                  // Plan mode: bullet rows — performed inside the planned
                  // track (see plan-bullet-list.tsx).
                  <PlanBulletList rows={planRows} />
                ) : (
                  <VolumeBarChart groups={chartGroups} />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {/* A whole message per case — the plan sentence is not appended
                    to the base one, because a translator needs to move it. */}
                {planned
                  ? t('groups.hintPlanned', { program: planned.programName })
                  : t('groups.hint')}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

/** The verdict's second line: one whole ICU message per case, with the
 *  days-left variants spelled out rather than suffixed onto a shorter one. */
function verdictContext(
  t: Awaited<ReturnType<typeof getTranslations<'Stats'>>>,
  verdict: StatsVerdict,
): string {
  if (verdict.kind === 'noPlan') {
    return verdict.delta === null
      ? t('verdict.noPlanContext', { sets: verdict.currentSets })
      : verdict.delta > 0
        ? t('verdict.noPlanContextUp', { sets: verdict.currentSets, amount: verdict.delta })
        : t('verdict.noPlanContextDown', {
            sets: verdict.currentSets,
            amount: Math.abs(verdict.delta),
          })
  }
  if (verdict.kind === 'onPlan') {
    return verdict.daysLeft === null
      ? t('verdict.onPlanContext')
      : t('verdict.onPlanContextDays', { days: verdict.daysLeft })
  }
  return verdict.daysLeft === null
    ? t('verdict.behindContext', {
        performed: verdict.performedSets,
        planned: verdict.plannedSets,
      })
    : t('verdict.behindContextDays', {
        performed: verdict.performedSets,
        planned: verdict.plannedSets,
        days: verdict.daysLeft,
      })
}
