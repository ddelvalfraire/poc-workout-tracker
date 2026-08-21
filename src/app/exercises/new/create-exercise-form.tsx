'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { createCustomExerciseAction } from '@/app/exercises/actions'
import { EXERCISE_CATEGORIES, type ExerciseSource } from '@/lib/custom-exercise-input'
import { CATALOG_MUSCLE_NAMES } from '@/lib/muscle-groups'
import { markReplace, navigateBack } from '@/lib/back-navigation'
import { storePendingPick, type PendingPickExercise } from '@/app/workout/new/pending-pick'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The #218 create form: the picker's inline CreateCustomForm vocabulary
 * (name, required wger category, optional primary-muscle chips — exactly the
 * fields the create action schema exposes to the UI; equipment/secondary
 * muscles stay MCP/editor territory) at page scale, plus the return leg.
 *
 * De-carded: fields on the page background under Section caps headers,
 * closed by hairlines; the page's one volt is the primary save button.
 *
 * Duplicate guard: on submit, an existing exercise (wger or custom) whose
 * name matches case-insensitively raises an inline warning ONCE with a
 * "use existing instead" affordance that rides the same return leg with the
 * existing identity; submitting again creates anyway (homonyms are real —
 * the per-user unique constraint still hard-stops exact custom dupes
 * server-side).
 */

export type ReturnMode = 'swap' | 'add' | null

interface CreateExerciseFormProps {
  initialName: string
  returnMode: ReturnMode
  /** The draft exercise's stable client id being swapped; only in swap mode. */
  targetId: string | null
}

interface CatalogEntry {
  id: number
  source?: ExerciseSource
  name: string
  category: string
}

async function fetchExercises(url: string, signal: AbortSignal): Promise<CatalogEntry[]> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`request failed: ${res.status}`)
  return (await res.json()) as CatalogEntry[]
}

export function CreateExerciseForm({ initialName, returnMode, targetId }: CreateExerciseFormProps) {
  const t = useTranslations('CreateExerciseForm')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState<string>('')
  const [muscles, setMuscles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // The name the duplicate warning was ALREADY shown for (lowercased):
  // resubmitting the same name means "create anyway".
  const [dupWarnedFor, setDupWarnedFor] = useState<string | null>(null)

  // Same cache keys as the picker: a warm picker session costs this page
  // nothing, and the write-through below keeps any mounted picker fresh.
  const catalogQuery = useQuery({
    queryKey: ['exercises', 'catalog'],
    queryFn: ({ signal }) => fetchExercises('/api/exercises?all=1', signal),
    staleTime: 5 * 60_000,
  })
  const customsQuery = useQuery({
    queryKey: ['exercises', 'custom'],
    queryFn: ({ signal }) => fetchExercises('/api/exercises?custom=1', signal),
    staleTime: 30_000,
  })

  function toggleMuscle(muscle: string) {
    setMuscles((prev) =>
      prev.includes(muscle) ? prev.filter((m) => m !== muscle) : [...prev, muscle],
    )
  }

  /** Case-insensitive exact-name match across customs first, then catalog. */
  function findExisting(trimmed: string): CatalogEntry | undefined {
    const lower = trimmed.toLowerCase()
    return [...(customsQuery.data ?? []), ...(catalogQuery.data ?? [])].find(
      (exercise) => exercise.name.toLowerCase() === lower,
    )
  }

  /** The one exit for swap/add mode: store the instruction, pop back to the
   *  logger (cold entries replace to /workout/new — same reader). */
  function returnWith(exercise: PendingPickExercise) {
    if (returnMode === 'swap' && targetId !== null) {
      storePendingPick({ mode: 'swap', targetId, exercise })
    } else {
      storePendingPick({ mode: 'add', exercise })
    }
    navigateBack(router, '/workout/new')
  }

  function handleUseExisting(existing: CatalogEntry) {
    const identity: PendingPickExercise = {
      wgerExerciseId: existing.id,
      source: existing.source ?? 'wger',
      name: existing.name,
      category: existing.category,
    }
    if (returnMode !== null) {
      returnWith(identity)
      return
    }
    // Library mode: the existing exercise's own page IS the destination.
    markReplace()
    router.replace(`/exercises/${identity.source}/${identity.wgerExerciseId}`)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError(t('validationName'))
      return
    }
    if (category === '') {
      setError(t('validationCategory'))
      return
    }
    setError(null)
    // Duplicate guard: warn once per name, create on resubmit.
    if (dupWarnedFor !== trimmed.toLowerCase() && findExisting(trimmed)) {
      setDupWarnedFor(trimmed.toLowerCase())
      return
    }
    setIsSaving(true)
    try {
      const created = await createCustomExerciseAction({
        name: trimmed,
        category,
        ...(muscles.length > 0 ? { muscles } : {}),
      })
      // Write-through to the customs cache (the picker's handleCreated
      // contract): the logger's reopened picker sees it without a refetch.
      queryClient.setQueryData<CatalogEntry[]>(['exercises', 'custom'], (prev) => [
        { id: created.id, source: 'custom', name: created.name, category: created.category },
        ...(prev ?? []),
      ])
      if (returnMode !== null) {
        returnWith({
          wgerExerciseId: created.id,
          source: 'custom',
          name: created.name,
          category: created.category,
        })
        return
      }
      // Library entry: land on the new exercise's page. Replace, not push —
      // back must not resurrect a filled form for an exercise that exists.
      markReplace()
      router.replace(`/exercises/custom/${created.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('createError'))
      setIsSaving(false)
    }
  }

  const trimmedLower = name.trim().toLowerCase()
  const duplicate = dupWarnedFor === trimmedLower ? findExisting(name.trim()) : undefined

  return (
    <div className="space-y-3">
      <Input
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setDupWarnedFor(null) // a new name gets a fresh guard pass
        }}
        aria-label={t('nameLabel')}
        placeholder={t('namePlaceholder')}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label={t('categoryLabel')}
        // The Input field vocabulary (44px, 16px text, ring focus) on a raw
        // select — the picker form's exact recipe.
        className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <option value="" disabled>
          {t('categoryPlaceholder')}
        </option>
        {EXERCISE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <Section title={t('musclesTitle')} className="mt-6">
        <p className="mt-1 text-xs text-muted-foreground">{t('musclesHint')}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 border-b border-b-border/60 pb-4">
          {CATALOG_MUSCLE_NAMES.map((muscle) => (
            <button
              key={muscle}
              type="button"
              onClick={() => toggleMuscle(muscle)}
              aria-pressed={muscles.includes(muscle)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                // Muted selection (the picker form's precedent): the page's
                // one volt is the save button, not these toggles.
                muscles.includes(muscle)
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {muscle}
            </button>
          ))}
        </div>
      </Section>

      {duplicate && (
        // Inline near-match warning — words over a hairline, not a boxed
        // alert. The affordance rides the same return leg; the primary
        // button now reads as "create anyway".
        <div className="flex items-center justify-between gap-3 border-b border-b-border/60 pb-3">
          <p className="text-sm text-muted-foreground">
            {/* A whole sentence per case: English appends the WHERE clause,
                other languages will not. */}
            {(duplicate.source ?? 'wger') === 'custom'
              ? t('duplicateCustom', { name: duplicate.name })
              : t('duplicateCatalog', { name: duplicate.name })}
          </p>
          <Button size="sm" variant="outline" onClick={() => handleUseExisting(duplicate)}>
            {t('useExistingAction')}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className="mt-2 w-full" onClick={handleSave} disabled={isSaving}>
        {isSaving
          ? t('saving')
          : returnMode !== null
            ? // Keyed by return mode — the label map used to live at module
              // scope, where no locale exists yet.
              t(`primaryAction.${returnMode}`)
            : t('save')}
      </Button>
    </div>
  )
}
