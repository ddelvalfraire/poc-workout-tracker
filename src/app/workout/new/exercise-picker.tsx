'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { rankAlternatives } from '@/lib/exercise-alternatives'
import { createCustomExerciseAction } from '@/app/exercises/actions'
import { EXERCISE_CATEGORIES, type ExerciseSource } from '@/lib/custom-exercise-input'
import { CATALOG_MUSCLE_NAMES } from '@/lib/muscle-groups'
import { cn } from '@/lib/utils'

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
}

export function ExercisePicker({
  onAdd,
  fill = false,
  suggestFor,
  includeCustom = false,
}: ExercisePickerProps) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<ExerciseResult[]>([])
  const [customs, setCustoms] = useState<ExerciseResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Bumped by the Retry button to re-run the catalog load after a failure.
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isCreating, setIsCreating] = useState(false)

  // Load the full catalog once per attempt. The list is small and changes
  // rarely, so all filtering then happens in-process — every keystroke is
  // instant, with no per-keystroke network round-trip. The user's customs
  // ride a separate uncached request (per-user, changed by the create flow);
  // its failure is non-fatal — search degrades to catalog-only.
  useEffect(() => {
    const controller = new AbortController()
    let retryTimer: number | undefined

    async function load(isAuthRetry: boolean) {
      try {
        const [res, customRes] = await Promise.all([
          fetch('/api/exercises?all=1', { signal: controller.signal }),
          includeCustom
            ? fetch('/api/exercises?custom=1', { signal: controller.signal })
            : Promise.resolve(null),
        ])
        if (res.status === 401 && !isAuthRetry) {
          retryTimer = window.setTimeout(() => load(true), AUTH_RETRY_DELAY_MS)
          return
        }
        if (!res.ok) throw new Error(`request failed: ${res.status}`)
        const data: ExerciseResult[] = await res.json()
        setCatalog(data)
        if (customRes?.ok) {
          const customData: ExerciseResult[] = await customRes.json()
          setCustoms(customData)
        }
        setLoading(false)
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Could not load exercises.')
        setLoading(false)
      }
    }

    load(false)

    return () => {
      controller.abort()
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [loadAttempt, includeCustom])

  const term = query.trim().toLowerCase()

  // Customs first: the user's own movements outrank catalog homonyms.
  const merged = useMemo(() => [...customs, ...catalog], [customs, catalog])

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
    // The next mount re-fetches `?custom=1`; this keeps THIS session's list
    // consistent without a round-trip.
    setCustoms((prev) => [created, ...prev])
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
        placeholder={loading ? 'Loading exercises…' : 'Add an exercise…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        aria-label="Search exercises"
        disabled={loading || !!error}
      />

      {error && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoading(true)
              setError(null)
              setLoadAttempt((n) => n + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Muscle-matched alternatives to the exercise being replaced — a plain
          labeled list, deliberately OUTSIDE the search combobox's a11y model
          (no role=option, no aria-activedescendant coupling): arrows/Enter
          keep driving the search listbox only. Same row anatomy as results. */}
      {!loading && !error && !isCreating && suggestions.length > 0 && (
        <div>
          <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Suggested
          </p>
          <ul
            aria-label="Suggested replacements"
            className="mt-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
          >
            {suggestions.map((result) => (
              <li
                key={resultKey(result)}
                className="flex items-center justify-between gap-2 px-3 py-2.5"
              >
                <span className="min-w-0 truncate text-sm">
                  {result.name}
                  <span className="text-muted-foreground">
                    {' '}
                    · {sourceOf(result) === 'custom' ? 'Custom' : result.category}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => addExercise(result)}>
                  Add
                </Button>
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
        term.length > 0 && (
          <>
            {matches.length > 0 ? (
              <ul
                id={LISTBOX_ID}
                role="listbox"
                aria-label="Exercise results"
                // In fill mode the list takes all remaining sheet height and owns
                // the scroll (the input above stays pinned); inline keeps the cap.
                className={`divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border bg-card shadow-lg ${
                  fill ? 'min-h-0 flex-1' : 'max-h-72'
                }`}
              >
                {matches.map((result, index) => (
                  <li
                    key={resultKey(result)}
                    id={optionId(result)}
                    role="option"
                    aria-selected={index === active}
                    onPointerMove={() => setActiveIndex(index)}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
                      index === active ? 'bg-muted' : ''
                    }`}
                  >
                    <span className="min-w-0 truncate text-sm">
                      {result.name}
                      <span className="text-muted-foreground">
                        {' '}
                        · {sourceOf(result) === 'custom' ? 'Custom' : result.category}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => addExercise(result)}>
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 text-sm text-muted-foreground">No exercises found.</p>
            )}
            {/* The dedup-at-source escape hatch: creation sits BELOW the
                catalog's best matches, so a near-duplicate is staring at the
                existing entry before the button. */}
            {includeCustom && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start text-muted-foreground"
                onClick={() => setIsCreating(true)}
              >
                + Create “{query.trim()}” as a custom exercise
              </Button>
            )}
          </>
        )
      )}
    </div>
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
      setFormError('Give it a name.')
      return
    }
    if (category === '') {
      setFormError('Pick a category.')
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
      setFormError(err instanceof Error ? err.message : 'Could not create the exercise.')
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        New custom exercise
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Custom exercise name"
        placeholder="Name"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Category"
        className="h-9 w-full rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="" disabled>
          Category…
        </option>
        {EXERCISE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div>
        <p className="text-xs text-muted-foreground">Primary muscles (optional)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CATALOG_MUSCLE_NAMES.map((muscle) => (
            <button
              key={muscle}
              type="button"
              onClick={() => toggleMuscle(muscle)}
              aria-pressed={muscles.includes(muscle)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                muscles.includes(muscle)
                  ? 'border-primary bg-primary text-primary-foreground'
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
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={handleCreate} disabled={isSaving}>
          {isSaving ? 'Creating…' : 'Create & add'}
        </Button>
      </div>
    </div>
  )
}
