import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { listLoggedExercises } from '@/db/exercise-stats'
import { buildMuscleResolver } from '@/db/muscle-volume'
import { getWeightUnit } from '@/db/preferences'
import { MUSCLE_GROUPS, muscleGroupFor, type MuscleGroup } from '@/lib/muscle-groups'
import {
  compareLibraryEntries,
  e1rmDeltaChip,
  e1rmStatusBase,
  exerciseZone,
  libraryHref,
  parseLibraryParams,
  recencyLabel,
  sessionCountLine,
  type LibraryParams,
} from '@/lib/exercise-library'
import { AppHeader } from '@/components/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { cn } from '@/lib/utils'
import { LibraryFilter, type LibraryEntry } from './library-filter'
import { getTranslations } from 'next-intl/server'
import { useTranslations } from 'next-intl'

/**
 * The exercise library: every movement the user has trained in a completed
 * workout — rows carry live status (best e1RM + trend delta, relative
 * recency), zoned MOVING / TRAINING / DORMANT, not bookkeeping. History-first
 * by design: catalog discovery (wger search) already lives in the logger's
 * picker, so this list only shows exercises that HAVE a story to tell.
 * Facets are URL state (?muscle=, ?sort=) resolved server-side; the client
 * island only narrows by name over what the server already sent.
 *
 * Muscle facts come from the catalog resolver muscle-volume already builds
 * (cached wger map + the user's custom exercises) — in-memory, no join.
 * PRIMARY muscles only: a facet should find the movements that TARGET a
 * group, not everything that grazes it.
 */
export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ muscle?: string | string[]; sort?: string | string[] }>
}) {
  const t = await getTranslations('Exercises')
  const userId = await requireUserId()
  const params = parseLibraryParams(await searchParams)
  const [exercises, resolveMuscles, unit] = await Promise.all([
    listLoggedExercises(userId),
    buildMuscleResolver(userId),
    getWeightUnit(userId),
  ])
  const now = new Date()

  // Everything becomes display strings HERE — one server locale, no
  // hydration drift (the page's standing rule).
  const all = exercises.map((e) => {
    const muscles = resolveMuscles(e.source, e.wgerExerciseId)
    const groups = new Set<MuscleGroup>()
    for (const name of muscles?.primary ?? []) {
      const group = muscleGroupFor(name)
      if (group !== null) groups.add(group)
    }
    const delta = e1rmDeltaChip(e.trendDeltaKg, unit)
    return {
      entry: {
        source: e.source,
        wgerExerciseId: e.wgerExerciseId,
        name: e.name,
        zone: exerciseZone(e, now),
        statusBase: e1rmStatusBase(e.bestE1rmKg, unit) ?? sessionCountLine(e.sessionCount),
        deltaText: delta?.text ?? null,
        deltaDirection: delta?.direction ?? null,
        recencyLabel: recencyLabel(e.lastPerformedAt, now),
      } satisfies LibraryEntry,
      sessionCount: e.sessionCount,
      lastPerformedAtMs: e.lastPerformedAt.getTime(),
      muscleGroups: groups,
    }
  })

  // Chips only for groups the library can actually show — an empty facet is
  // a dead end, not a filter. Derived BEFORE the muscle filter applies.
  const facetGroups = MUSCLE_GROUPS.filter((group) =>
    all.some((e) => e.muscleGroups.has(group)),
  )

  const entries = all
    .filter((e) => params.muscle === null || e.muscleGroups.has(params.muscle))
    .sort((a, b) =>
      compareLibraryEntries(
        { zone: a.entry.zone, sessionCount: a.sessionCount, lastPerformedAtMs: a.lastPerformedAtMs },
        { zone: b.entry.zone, sessionCount: b.sessionCount, lastPerformedAtMs: b.lastPerformedAtMs },
        params.sort,
      ),
    )
    .map((e) => e.entry)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-6">
        {facetGroups.length > 0 && (
          <div className="space-y-2">
            {/* -mx-5/px-5: the chip row scrolls edge-to-edge while the rail
                stays on the page grid. Links, not buttons — URL as state. */}
            <nav
              aria-label={t('facets.ariaLabel')}
              className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
            >
              <FacetChip
                href={libraryHref({ ...params, muscle: null })}
                label={t('facets.all')}
                isActive={params.muscle === null}
              />
              {facetGroups.map((group) => (
                <FacetChip
                  key={group}
                  href={libraryHref({ ...params, muscle: group })}
                  label={group}
                  isActive={params.muscle === group}
                />
              ))}
            </nav>
            <nav aria-label={t('sort.ariaLabel')} className="flex gap-4 px-1">
              {SORT_OPTIONS.map((sort) => (
                <SortLink key={sort} params={params} sort={sort} />
              ))}
            </nav>
          </div>
        )}

        <div className={cn(facetGroups.length > 0 && 'mt-4')}>
          <LibraryFilter entries={entries} />
        </div>
      </main>
    </div>
  )
}

/** ARIA token values are part of the HTML vocabulary, never copy. */
const ARIA_CURRENT_PAGE = 'page'

/** The sort toggle's two sides, in render order. */
const SORT_OPTIONS = ['recent', 'trained'] as const

/** One muscle facet chip — the app's pill vocabulary; active = volt tint. */
function FacetChip({
  href,
  label,
  isActive,
}: {
  href: string
  label: string
  isActive: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? ARIA_CURRENT_PAGE : undefined}
      className={cn(
        'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
        isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground active:bg-muted/60',
      )}
    >
      {label}
    </Link>
  )
}

/** One side of the sort toggle — quiet text links, the active one lit.
 *  Keyed by the sort VALUE, so the label resolves from the catalog at render
 *  rather than travelling as a prop the parent had to spell in English. */
function SortLink({ params, sort }: { params: LibraryParams; sort: LibraryParams['sort'] }) {
  const t = useTranslations('Exercises')
  const isActive = params.sort === sort
  return (
    <Link
      href={libraryHref({ ...params, sort })}
      aria-current={isActive ? ARIA_CURRENT_PAGE : undefined}
      className={cn(
        'text-xs font-semibold uppercase tracking-widest transition-colors',
        isActive ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {t(`sort.${sort}`)}
    </Link>
  )
}
