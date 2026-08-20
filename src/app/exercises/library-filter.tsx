'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { DividerList, DividerRow } from '@/components/ui/divider-list'
import { EmptyWords } from '@/components/ui/empty-words'
import { ZONE_ORDER, type ExerciseZone } from '@/lib/exercise-library'
import { cn } from '@/lib/utils'
import { exerciseHref } from './exercise-ref'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { useTranslations } from 'next-intl'

/**
 * The library list with its name filter — the page's one client island. The
 * server page fetches, zones, and pre-formats every entry (status/recency
 * arrive as display strings, not Dates); this component only narrows what's
 * already rendered, so filtering is instant and offline-safe. The name
 * filter stays transient component state (a viewfinder, not navigation) —
 * the SHAREABLE facets (?muscle=, ?sort=) live in the URL, owned by the
 * server page. Zone headers render from the pre-sorted entries: the server
 * guarantees zone-major order, so grouping here is a partition, not a sort.
 */

export interface LibraryEntry {
  source: ExerciseSource
  wgerExerciseId: number
  name: string
  zone: ExerciseZone
  /** "142 kg e1RM" or the session-count fallback — pre-formatted, unit-aware. */
  statusBase: string
  /** "↑ +5 this month" / "↓ −5 this month", or null (no provable delta). */
  deltaText: string | null
  /** Volt-accents the up case only; down renders quiet. */
  deltaDirection: 'up' | 'down' | null
  /** "Today" / "Jul 12" / "5 wks ago" — pre-formatted on the server. */
  recencyLabel: string
}

interface LibraryFilterProps {
  entries: LibraryEntry[]
}

export function LibraryFilter({ entries }: LibraryFilterProps) {
  const t = useTranslations('LibraryFilter')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible =
    needle === '' ? entries : entries.filter((e) => e.name.toLowerCase().includes(needle))

  const zones = ZONE_ORDER.map((zone) => ({
    zone,
    items: visible.filter((e) => e.zone === zone),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
        inputMode="search"
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
      />

      {entries.length === 0 && (
        <EmptyWords className="px-5 py-12">{t('empty')}</EmptyWords>
      )}

      {entries.length > 0 && visible.length === 0 && (
        <EmptyWords>{t('emptyQuery', { query: query.trim() })}</EmptyWords>
      )}

      {zones.map(({ zone, items }) => (
        <section key={zone} aria-label={t(`zone.${zone}`)}>
          <h2
            className={cn(
              'px-1 pb-2 pt-1 font-display text-sm uppercase tracking-widest',
              zone === 'moving' ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {t(`zone.${zone}`)}
          </h2>
          {/* De-carded: divider rows on the page background, full-bleed
              hairlines — the shell did nothing the divider doesn't. */}
          <DividerList>
            {items.map((entry) => (
              <DividerRow
                key={`${entry.source}:${entry.wgerExerciseId}`}
                href={exerciseHref(entry)}
                className="min-w-0 active:bg-muted/60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base leading-tight">{entry.name}</span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {entry.statusBase}
                    {entry.deltaText !== null && (
                      <>
                        {' '}
                        <span
                          className={cn(
                            // Volt on the delta ONLY — achievement accent,
                            // never the whole line, never a decline.
                            entry.deltaDirection === 'up' && 'font-semibold text-primary',
                          )}
                        >
                          {entry.deltaText}
                        </span>
                      </>
                    )}
                    {' · '}
                    {entry.recencyLabel}
                  </span>
                </span>
              </DividerRow>
            ))}
          </DividerList>
        </section>
      ))}
    </div>
  )
}
