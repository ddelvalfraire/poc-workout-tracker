'use client'

import { useEffect, useState } from 'react'
import { useDebounce } from '@/hooks/use-debounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The subset of the `/api/exercises` result this picker surfaces. */
interface ExerciseResult {
  id: number
  name: string
  category: string
}

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 20

interface ExercisePickerProps {
  onAdd: (exercise: { wgerExerciseId: number; name: string; category: string }) => void
}

export function ExercisePicker({ onAdd }: ExercisePickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExerciseResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounced = useDebounce(query)
  const isActive = debounced.trim().length >= MIN_QUERY_LENGTH

  useEffect(() => {
    const term = debounced.trim()
    if (term.length < MIN_QUERY_LENGTH) return

    const controller = new AbortController()

    // All state updates live in promise callbacks (never synchronously in the
    // effect body) so React doesn't cascade-render on the search keystroke.
    Promise.resolve()
      .then(() => {
        setLoading(true)
        setError(null)
        return fetch(`/api/exercises?search=${encodeURIComponent(term)}&limit=${RESULT_LIMIT}`, {
          signal: controller.signal,
        })
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`)
        const data: ExerciseResult[] = await res.json()
        setResults(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Could not load exercises. Please try again.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [debounced])

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search exercises…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search exercises"
      />

      {/* Status/results gate on `isActive` so stale state never shows once the
          query falls back under the minimum length. */}
      {isActive && loading && <p className="text-sm text-muted-foreground">Searching…</p>}
      {isActive && !loading && error && <p className="text-sm text-destructive">{error}</p>}
      {isActive && !loading && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No exercises found.</p>
      )}

      {isActive && results.length > 0 && (
        <ul className="divide-y rounded-lg border border-input">
          {results.map((result) => (
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
                  setResults([])
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
