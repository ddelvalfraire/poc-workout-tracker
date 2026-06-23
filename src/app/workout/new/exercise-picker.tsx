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
const LISTBOX_ID = 'exercise-search-results'
const optionId = (id: number) => `exercise-option-${id}`

interface ExercisePickerProps {
  onAdd: (exercise: { wgerExerciseId: number; name: string; category: string }) => void
}

export function ExercisePicker({ onAdd }: ExercisePickerProps) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<ExerciseResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

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

  const term = query.trim().toLowerCase()

  // Results appear only while searching, so the field stays collapsed by
  // default and never buries the exercises already added below it.
  const matches = useMemo(() => {
    if (!term) return []
    return catalog
      .filter((exercise) => exercise.name.toLowerCase().includes(term))
      .slice(0, RESULT_LIMIT)
  }, [term, catalog])

  const isOpen = matches.length > 0
  // Clamp so the highlight stays valid as the result set shrinks.
  const active = isOpen ? Math.min(activeIndex, matches.length - 1) : -1

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(matches[active].id))?.scrollIntoView({ block: 'nearest' })
  }, [active, matches])

  function addExercise(result: ExerciseResult) {
    onAdd({ wgerExerciseId: result.id, name: result.name, category: result.category })
    // Clear the search so it collapses, ready for the next add.
    setQuery('')
    setActiveIndex(0)
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
    <div className="relative space-y-2">
      <Input
        type="search"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(matches[active].id) : undefined}
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      {term.length > 0 &&
        (matches.length > 0 ? (
          <ul
            id={LISTBOX_ID}
            role="listbox"
            aria-label="Exercise results"
            className="max-h-72 divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border bg-card shadow-lg"
          >
            {matches.map((result, index) => (
              <li
                key={result.id}
                id={optionId(result.id)}
                role="option"
                aria-selected={index === active}
                onPointerMove={() => setActiveIndex(index)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
                  index === active ? 'bg-muted' : ''
                }`}
              >
                <span className="min-w-0 truncate text-sm">
                  {result.name}
                  <span className="text-muted-foreground"> · {result.category}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => addExercise(result)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">No exercises found.</p>
        ))}
    </div>
  )
}
