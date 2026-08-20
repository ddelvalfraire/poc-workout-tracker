'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyWords } from '@/components/ui/empty-words'
import { rankAlternatives } from '@/lib/exercise-alternatives'
import { createCustomExerciseAction } from '@/app/exercises/actions'
import { EXERCISE_CATEGORIES, type ExerciseSource } from '@/lib/custom-exercise-input'
import { CATALOG_MUSCLE_NAMES } from '@/lib/muscle-groups'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/** The subset of the `/api/exercises` result this picker surfaces. The
 *  optional muscle/equipment fields are already present in the payload
 *  (the route returns full wger Exercise objects) and feed the
 *  replace-mode suggestions rail. */
interface ExerciseResult {
  id: number
  /** Absent on wger catalog rows (the shared cached payload predates the
   *  field); the user's customs arrive labeled from `?custom=1`. */
  source?: ExerciseSource
  name: string
  category: string
  equipment?: string[]
  muscles?: string[]
  musclesSecondary?: string[]
}

/** What a pick hands the host — identity is the composite (source, id). */
export interface PickedExercise {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  category: string
}

const RESULT_LIMIT = 20
// A 401 right after returning to a backgrounded tab usually means the Clerk
// session token expired while the tab was hidden; Clerk refreshes it moments
// after the tab becomes visible, so one delayed retry normally recovers.
const AUTH_RETRY_DELAY_MS = 1500
const LISTBOX_ID = 'exercise-search-results'
// Composite in the DOM id/key too: a custom's id can collide with a wger id.
const sourceOf = (result: { source?: ExerciseSource }) => result.source ?? 'wger'
const optionId = (result: { id: number; source?: ExerciseSource }) =>
  `exercise-option-${sourceOf(result)}-${result.id}`
const resultKey = (result: { id: number; source?: ExerciseSource }) =>
  `${sourceOf(result)}:${result.id}`

/** The shared cached catalog barely changes — hold it fresh across pickers. */
const CATALOG_STALE_MS = 5 * 60_000
/** Customs change via the create flow, so revalidate sooner. */
const CUSTOMS_STALE_MS = 30_000

/** Error carrying the HTTP status so the 401 retry policy can key off it. */
class RequestError extends Error {
  constructor(readonly status: number) {
    super(`request failed: ${status}`)
  }
}

async function fetchExercises(url: string, signal: AbortSignal): Promise<ExerciseResult[]> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new RequestError(res.status)
  return (await res.json()) as ExerciseResult[]
}

/** One delayed retry on 401 only — the Clerk token-refresh window (see
 *  AUTH_RETRY_DELAY_MS above); any other failure surfaces immediately. */
const retryOn401 = (failureCount: number, error: Error) =>
  failureCount === 0 && error instanceof RequestError && error.status === 401

interface ExercisePickerProps {
  onAdd: (exercise: PickedExercise) => void
  /** Fill the parent column: the result list grows to the available space
   *  (instead of the inline max-h cap) so it — not the surrounding dialog —
   *  owns the scroll. Used by the full-height exercise sheet; the program
   *  builder keeps the inline default. */
  fill?: boolean
  /** The exercise being REPLACED (wger id) — its presence is what makes this
   *  a replace-mode picker: muscle-matched alternatives rank against it from
   *  the same loaded catalog and render as a rail while the query is empty. */
  suggestFor?: number
  /** Merge the user's custom exercises into search AND offer the "Create …"
   *  escape hatch at the bottom of results. OFF by default so read-only or
   *  wger-scoped hosts opt in explicitly. */
  includeCustom?: boolean
  /** #218: when set, the create row NAVIGATES (the host pushes the full-page
   *  `/exercises/new` form and owns the return leg) instead of opening the
   *  inline CreateCustomForm. The logger passes this; the program builder and
   *  goal picker keep the inline form — their drafts have no return-leg
   *  channel, and a sheet-local create is still correct there. */
  onCreateNavigate?: (query: string) => void
}

export function ExercisePicker({
  onAdd,
  fill = false,
  suggestFor,
  includeCustom = false,
  onCreateNavigate,
}: ExercisePickerProps) {
  const t = useTranslations('ExercisePicker')
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const queryClient = useQueryClient()

  // The full catalog, once per staleTime. The list is small and changes
  // rarely, so all filtering then happens in-process — every keystroke is
  // instant, with no per-keystroke network round-trip. A warm cache makes a
  // later picker mount (sheet reopen, another surface) instant too.
  const catalogQuery = useQuery({
    queryKey: ['exercises', 'catalog'],
    queryFn: ({ signal }) => fetchExercises('/api/exercises?all=1', signal),
    staleTime: CATALOG_STALE_MS,
    retry: retryOn401,
    retryDelay: AUTH_RETRY_DELAY_MS,
  })

  // The user's customs ride a separate uncached request (per-user, changed by
  // the create flow); its failure is non-fatal — search degrades to
  // catalog-only, exactly the pre-Query contract.
  const customsQuery = useQuery({
    queryKey: ['exercises', 'custom'],
    queryFn: ({ signal }) => fetchExercises('/api/exercises?custom=1', signal),
    staleTime: CUSTOMS_STALE_MS,
    retry: retryOn401,
    retryDelay: AUTH_RETRY_DELAY_MS,
    enabled: includeCustom,
  })

  // Pending covers the 401 retry window (Query keeps status pending across
  // retries), the Retry button's refetch, AND the initial customs load when
  // enabled — the old Promise.all gated readiness on both requests, and
  // creating a custom before `?custom=1` resolves would let the late response
  // clobber the optimistic cache write. A background revalidate of a warm
  // cache never disables the input.
  const loading =
    catalogQuery.isPending ||
    (catalogQuery.isError && catalogQuery.isFetching) ||
    (includeCustom && customsQuery.isPending)
  const error =
    catalogQuery.isError && !catalogQuery.isFetching ? t('loadError') : null

  const term = query.trim().toLowerCase()

  // Customs first: the user's own movements outrank catalog homonyms.
  const merged = useMemo(
    () => [...(customsQuery.data ?? []), ...(catalogQuery.data ?? [])],
    [customsQuery.data, catalogQuery.data],
  )

  // Results appear only while searching, so the field stays collapsed by
  // default and never buries the exercises already added below it.
  const matches = useMemo(() => {
    if (!term) return []
    return merged
      .filter((exercise) => exercise.name.toLowerCase().includes(term))
      .slice(0, RESULT_LIMIT)
  }, [term, merged])

  // Replace mode's zero-typing path: alternatives to the outgoing exercise,
  // shown only while the query is empty — typing anything collapses to plain
  // search. Empty when the current id is unknown or has no muscle data (the
  // sheet then degrades to Phase-1 search-only, by design). Customs join the
  // pool via their muscle tags. (suggestFor is a bare wger id — a composite
  // ref rides with the Phase-4 source work.)
  const suggestions = useMemo(
    () => (suggestFor === undefined || term ? [] : rankAlternatives(suggestFor, merged)),
    [suggestFor, term, merged],
  )

  const isOpen = matches.length > 0
  // Clamp so the highlight stays valid as the result set shrinks.
  const active = isOpen ? Math.min(activeIndex, matches.length - 1) : -1

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(matches[active]))?.scrollIntoView({ block: 'nearest' })
  }, [active, matches])

  function addExercise(result: ExerciseResult) {
    onAdd({
      wgerExerciseId: result.id,
      source: sourceOf(result),
      name: result.name,
      category: result.category,
    })
    // Clear the search so it collapses, ready for the next add.
    setQuery('')
    setActiveIndex(0)
  }

  function handleCreated(created: ExerciseResult) {
    // Write-through to the customs cache: keeps THIS session's list (and any
    // other mounted picker) consistent without a round-trip; the next
    // staleTime expiry re-fetches `?custom=1` anyway.
    queryClient.setQueryData<ExerciseResult[]>(['exercises', 'custom'], (prev) => [
      created,
      ...(prev ?? []),
    ])
    setIsCreating(false)
    addExercise(created)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('')
      setActiveIndex(0)
      return
    }
    if (!isOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0) addExercise(matches[active])
    }
  }

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'relative space-y-2'}>
      <Input
        type="search"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(matches[active]) : undefined}
        placeholder={loading ? t('placeholderLoading') : t('placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        aria-label={t('searchAriaLabel')}
        disabled={loading || !!error}
      />

      {error && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void catalogQuery.refetch()
              if (includeCustom) void customsQuery.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {/* Muscle-matched alternatives to the exercise being replaced — a plain
          labeled list, deliberately OUTSIDE the search combobox's a11y model
          (no role=option, no aria-activedescendant coupling): arrows/Enter
          keep driving the search listbox only. The whole row is the control
          (tap = the swap) — no per-row Add affordance. */}
      {!loading && !error && !isCreating && suggestions.length > 0 && (
        <div>
          <p className="px-1 pb-2 pt-1 font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
            {t('suggestionsTitle')}
          </p>
          <ul
            aria-label={t('suggestionsAriaLabel')}
            className="divide-y divide-border/60 border-b border-b-border/60"
          >
            {suggestions.map((result) => (
              <li key={resultKey(result)}>
                <button
                  type="button"
                  onClick={() => addExercise(result)}
                  className="flex w-full items-center gap-4 py-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  <ResultWords result={result} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isCreating ? (
        <CreateCustomForm
          initialName={query.trim()}
          onCancel={() => setIsCreating(false)}
          onCreated={handleCreated}
        />
      ) : (
        <>
          {term.length > 0 &&
            (matches.length > 0 ? (
              <ul
                id={LISTBOX_ID}
                role="listbox"
                aria-label={t('resultsAriaLabel')}
                // In fill mode the list takes all remaining sheet height and owns
                // the scroll (the input above stays pinned); inline keeps the cap.
                // Hairline divider list, not a card shell (DESIGN.md de-card
                // vocabulary) — the recipe is applied to the existing combobox
                // option markup, not DividerRow (which renders li > Link).
                className={`divide-y divide-border/60 overflow-y-auto overscroll-contain border-b border-b-border/60 ${
                  fill ? 'min-h-0 flex-1' : 'max-h-72'
                }`}
              >
                {matches.map((result, index) => (
                  // The row IS the control: tapping an option performs the
                  // pick (add-mode append or replace-mode swap) — no per-row
                  // Add button. Keyboard picks stay on the input via
                  // aria-activedescendant + Enter; options are never tabbable.
                  <li
                    key={resultKey(result)}
                    id={optionId(result)}
                    role="option"
                    aria-selected={index === active}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => addExercise(result)}
                    className={cn(
                      'flex cursor-pointer items-center gap-4 py-4 transition-colors',
                      index === active && 'bg-muted/50',
                    )}
                  >
                    <ResultWords result={result} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWords>{t('empty')}</EmptyWords>
            ))}
          {/* The dedup-at-source escape hatch, creatable-select style: the
              final row under whatever is above it — the catalog's best
              matches (a near-duplicate is staring at the existing entry
              first), the plain-words empty state, or the collapsed/rail
              resting state (persistent generic label). #218: with
              onCreateNavigate the row pushes the full-page form; otherwise
              the inline CreateCustomForm opens here. */}
          {includeCustom && !loading && !error && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() =>
                onCreateNavigate ? onCreateNavigate(query.trim()) : setIsCreating(true)
              }
            >
              {term.length > 0 ? t('createQueryAction', { query: query.trim() }) : t('createAction')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

/** Shared row anatomy for results and suggestions: name over a muted
 *  metadata line (the library-filter row shape). */
function ResultWords({ result }: { result: ExerciseResult }) {
  const t = useTranslations('ExercisePicker')
  return (
    <span className="min-w-0">
      <span className="block truncate text-base leading-tight">{result.name}</span>
      <span className="mt-1 block truncate text-sm text-muted-foreground">
        {sourceOf(result) === 'custom' ? t('customSource') : result.category}
      </span>
    </span>
  )
}

/**
 * Inline creation form: name (prefilled from the search), a required wger
 * category (keeps merged filtering coherent), and optional primary-muscle
 * chips from the catalog vocabulary (they feed muscle-volume and the
 * replacement suggestions). Secondary muscles are schema-supported but
 * deliberately not in this form — MCP can set them.
 */
function CreateCustomForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string
  onCancel: () => void
  onCreated: (created: ExerciseResult) => void
}) {
  const t = useTranslations('ExercisePicker')
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState<string>('')
  const [muscles, setMuscles] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function toggleMuscle(muscle: string) {
    setMuscles((prev) =>
      prev.includes(muscle) ? prev.filter((m) => m !== muscle) : [...prev, muscle],
    )
  }

  async function handleCreate() {
    if (name.trim().length === 0) {
      setFormError(t('create.validationName'))
      return
    }
    if (category === '') {
      setFormError(t('create.validationCategory'))
      return
    }
    setFormError(null)
    setIsSaving(true)
    try {
      const created = await createCustomExerciseAction({
        name: name.trim(),
        category,
        ...(muscles.length > 0 ? { muscles } : {}),
      })
      onCreated({
        id: created.id,
        source: 'custom',
        name: created.name,
        category: created.category,
        ...(created.muscles.length > 0 ? { muscles: created.muscles } : {}),
      })
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('create.error'))
      setIsSaving(false)
    }
  }

  return (
    // De-carded: fields sit on the sheet background under a caps header,
    // closed by a hairline — no shell.
    <div className="space-y-3 border-b border-b-border/60 pb-4">
      <p className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
        {t('create.title')}
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={t('create.nameAriaLabel')}
        placeholder={t('create.namePlaceholder')}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label={t('create.categoryAriaLabel')}
        // The Input field vocabulary (44px, 16px text, ring focus) on a raw
        // select — bg stays transparent (bg-card is the keep-listed field
        // primitive's own skin).
        className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="" disabled>
          {t('create.categoryPlaceholder')}
        </option>
        {EXERCISE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div>
        <p className="text-xs text-muted-foreground">{t('create.musclesLabel')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CATALOG_MUSCLE_NAMES.map((muscle) => (
            <button
              key={muscle}
              type="button"
              onClick={() => toggleMuscle(muscle)}
              aria-pressed={muscles.includes(muscle)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                // Muted selection (effort-chips precedent): the sheet's one
                // volt is the primary commit action, not these toggles.
                muscles.includes(muscle)
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {muscle}
            </button>
          ))}
        </div>
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onCancel}>
          {t('create.cancel')}
        </Button>
        <Button size="sm" className="flex-1" onClick={handleCreate} disabled={isSaving}>
          {isSaving ? t('create.submitPending') : t('create.submit')}
        </Button>
      </div>
    </div>
  )
}
