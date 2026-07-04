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
// A 401 right after returning to a backgrounded tab usually means the Clerk
// session token expired while the tab was hidden; Clerk refreshes it moments
// after the tab becomes visible, so one delayed retry normally recovers.
const AUTH_RETRY_DELAY_MS = 1500
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
  // Bumped by the Retry button to re-run the catalog load after a failure.
  const [loadAttempt, setLoadAttempt] = useState(0)

  // Load the full catalog once per attempt. The list is small and changes
  // rarely, so all filtering then happens in-process — every keystroke is
  // instant, with no per-keystroke network round-trip.
  useEffect(() => {
    const controller = new AbortController()
    let retryTimer: number | undefined

    async function load(isAuthRetry: boolean) {
      try {
        const res = await fetch('/api/exercises?all=1', { signal: controller.signal })
        if (res.status === 401 && !isAuthRetry) {
          retryTimer = window.setTimeout(() => load(true), AUTH_RETRY_DELAY_MS)
          return
        }
        if (!res.ok) throw new Error(`request failed: ${res.status}`)
        const data: ExerciseResult[] = await res.json()
        setCatalog(data)
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
  }, [loadAttempt])

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
