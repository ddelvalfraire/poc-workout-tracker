import { requireUserId } from '@/lib/auth'
import { getMuscleVolume } from '@/db/muscle-volume'
import { getPlannedWeeklyVolume } from '@/db/planned-volume'
import { volumeWindows, type VolumeWindowMode } from '@/lib/volume-window'
import { AppHeader } from '@/components/app-header'
import { StatTile } from '@/components/stat-tile'
import { VolumeBarChart } from '@/components/charts/volume-bar-chart'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { WindowToggle } from './window-toggle'
import {
  lowVolumeGroups,
  LOW_VOLUME_FLOOR,
  overPlanGroups,
  setsDeltaLabel,
  underPlanGroups,
  withPlanned,
} from './volume-view'

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

  const hasAnyVolume = volume.totals.currentSets > 0 || volume.totals.previousSets > 0
  // The plan replaces the generic floor as the shortfall yardstick.
  const low = planned ? [] : lowVolumeGroups(volume.groups)
  const under = planned ? underPlanGroups(volume.groups, planned) : []
  const over = planned ? overPlanGroups(volume.groups, planned) : []
  const chartGroups = planned ? withPlanned(volume.groups, planned) : volume.groups
  const delta = setsDeltaLabel(volume.totals.currentSets, volume.totals.previousSets)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="This Week"
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        <WindowToggle mode={mode} />

        {!hasAnyVolume ? (
          <p className="rounded-2xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
            No completed sets in the last two weeks — finish a workout and the balance picture
            builds itself.
          </p>
        ) : (
          <>
            <section aria-label="Weekly totals">
              <dl className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Sets"
                  value={String(volume.totals.currentSets)}
                  delta={delta ? { text: delta, tone: 'neutral' } : undefined}
                />
                <StatTile label="Sessions" value={String(volume.totals.currentSessions)} />
              </dl>
            </section>

            {low.length > 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Low this week (&lt;{LOW_VOLUME_FLOOR} sets):
                </span>{' '}
                {low.map((g) => g.group).join(', ')}
              </p>
            )}

            {under.length > 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Under plan:</span>{' '}
                {under.map((e) => `${e.group} ${e.performedSets} / ${e.plannedSets}`).join(', ')}
              </p>
            )}

            {over.length > 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                Well over plan:{' '}
                {over.map((e) => `${e.group} ${e.performedSets} / ${e.plannedSets}`).join(', ')}
              </p>
            )}

            <section aria-label="Sets per muscle group">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Sets per muscle group
              </h2>
              <div className="mt-2 rounded-2xl border border-border bg-card p-4">
                <VolumeBarChart groups={chartGroups} />
              </div>
              <p className="mt-2 px-1 text-xs text-muted-foreground">
                Primary muscles count a full set, secondaries half.
                {planned &&
                  ` Planned / week is one full pass through ${planned.programName}'s days; both window views compare against that same weekly figure.`}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
