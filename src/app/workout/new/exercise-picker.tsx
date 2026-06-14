'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The subset of the `/api/exercises` result this picker surfaces. */
interface ExerciseResult {
  id: number
  name: string
  category: string
}

const RESULT_LIMIT = 20

interface ExercisePickerProps {
  onAdd: (exercise: { wgerExerciseId: number; name: string; category: string }) => void
}

export function ExercisePicker({ onAdd }: ExercisePickerProps) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<ExerciseResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the full catalog ONCE. The list is small and changes rarely, so all
  // filtering then happens in-process — every keystroke is instant, with no
  // per-keystroke network round-trip.
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/exercises?all=1', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`)
        const data: ExerciseResult[] = await res.json()
        setCatalog(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Could not load exercises. Please try again.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  // Filter client-side. With no query, show the first page so the list is
  // browsable immediately; otherwise match by case-insensitive name substring.
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered = term
      ? catalog.filter((exercise) => exercise.name.toLowerCase().includes(term))
      : catalog
    return filtered.slice(0, RESULT_LIMIT)
  }, [query, catalog])

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search exercises…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search exercises"
        disabled={loading || !!error}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading exercises…</p>}
      {!loading && error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && matches.length === 0 && (
        <p className="text-sm text-muted-foreground">No exercises found.</p>
      )}

      {!loading && !error && matches.length > 0 && (
        <ul className="divide-y rounded-lg border border-input">
          {matches.map((result) => (
            <li key={result.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="min-w-0 truncate text-sm">
                {result.name}
                <span className="text-muted-foreground"> · {result.category}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onAdd({ wgerExerciseId: result.id, name: result.name, category: result.category })
                  // Clear the search so the picker is ready for the next exercise.
                  setQuery('')
                }}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
