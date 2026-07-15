'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { exerciseHref } from './exercise-ref'
import type { ExerciseSource } from '@/lib/custom-exercise-input'

/**
 * The library list with its name filter — the page's one client island. The
 * server page fetches and pre-formats every entry (dates arrive as display
 * strings, not Dates); this component only narrows what's already rendered,
 * so filtering is instant and offline-safe. No URL state: the filter is a
 * transient viewfinder over a short list, not shareable navigation.
 */

export interface LibraryEntry {
  source: ExerciseSource
  wgerExerciseId: number
  name: string
  sessionCount: number
  /** Pre-formatted on the server ("Jun 14, 2026") — one locale, no hydration drift. */
  lastPerformedLabel: string
}

interface LibraryFilterProps {
  entries: LibraryEntry[]
}

export function LibraryFilter({ entries }: LibraryFilterProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible =
    needle === '' ? entries : entries.filter((e) => e.name.toLowerCase().includes(needle))

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
        inputMode="search"
        placeholder="Filter exercises"
        aria-label="Filter exercises by name"
      />

      {entries.length === 0 && (
        <p className="rounded-2xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
          Nothing here yet — finish a workout and your exercises show up with their stats.
        </p>
      )}

      {entries.length > 0 && visible.length === 0 && (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          No exercise matches “{query.trim()}”.
        </p>
      )}

      <ul className="space-y-3">
        {visible.map((entry) => (
          <li key={`${entry.source}:${entry.wgerExerciseId}`}>
            <Link
              href={exerciseHref(entry)}
              className="flex min-w-0 items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 transition-colors active:bg-muted/60"
            >
              <span className="min-w-0">
                <span className="block truncate text-base leading-tight">{entry.name}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {entry.sessionCount} {entry.sessionCount === 1 ? 'session' : 'sessions'} · last{' '}
                  {entry.lastPerformedLabel}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
