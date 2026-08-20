'use client'

import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { DividerList } from '@/components/ui/divider-list'
import { EmptyWords } from '@/components/ui/empty-words'
import {
  groupNotesByThread,
  matchesNoteSearch,
  type NoteView,
} from '@/components/notes/note-view'
import { NoteRow } from '@/components/notes/note-row'
import { useTranslations } from 'next-intl'

/**
 * The browser's one client island (the library-filter recipe): the server
 * page fetches, chip-filters, and pre-formats every row; this component only
 * narrows what's already rendered with the transient search viewfinder and
 * groups the survivors under their SESSION headers — the workout is the
 * thread. Search stays component state (a viewfinder, not navigation); the
 * shareable filter chips live in the URL, owned by the server page, and
 * arrive here pre-applied (`notes`) alongside their rendered rail
 * (`children`).
 */
export function NotesBrowser({
  notes,
  corpusEmpty,
  children,
}: {
  /** Chip-filtered, newest-first NoteViews (the server page's output). */
  notes: NoteView[]
  /** True when the user has NO notes at all (vs. filters matching none). */
  corpusEmpty: boolean
  /** The server-rendered filter-chip rail, slotted under the search field. */
  children?: ReactNode
}) {
  const t = useTranslations('NotesBrowser')
  const [query, setQuery] = useState('')
  const visible = notes.filter((note) => matchesNoteSearch(note, query))
  const threads = groupNotesByThread(visible)

  return (
    <div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        type="search"
        inputMode="search"
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
      />

      {children}

      {corpusEmpty ? (
        <EmptyWords className="py-12">{t('empty')}</EmptyWords>
      ) : visible.length === 0 ? (
        <EmptyWords>
          {/* One whole ICU message per case, never a fragment beside an
              expression: the quoted needle sits mid-sentence in English and
              will not in every language. */}
          {query.trim() !== '' ? t('emptyQuery', { query: query.trim() }) : t('emptyFiltered')}
        </EmptyWords>
      ) : (
        threads.map((thread) => (
          <section key={thread.key} aria-label={thread.title}>
            {/* SESSION header: the caps Section recipe with the relative
                session date on the right edge — the thread's byline. */}
            <div className="flex items-baseline justify-between gap-3 pb-2 pt-6">
              <h2 className="min-w-0 truncate font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
                {thread.title}
              </h2>
              <span className="shrink-0 text-xs text-muted-foreground tnum">
                {thread.dateLabel}
              </span>
            </div>
            <DividerList>
              {thread.notes.map((note) => (
                <NoteRow key={note.id} note={note} />
              ))}
            </DividerList>
          </section>
        ))
      )}
    </div>
  )
}
