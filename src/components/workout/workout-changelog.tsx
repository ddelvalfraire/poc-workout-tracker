'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Section } from '@/components/ui/section'
import { groupEventsByDay } from '@/app/programs/[id]/detail-view'
import { formatWorkoutDate } from '@/lib/format'
import type { Locale } from '@/i18n/config'
import { cn } from '@/lib/utils'
import {
  amendedMark,
  isAmendmentKind,
  type WorkoutChangelogEntry,
} from './workout-changelog-view'

/**
 * A completed session's paper trail: what was changed AFTER the workout was
 * recorded, who changed it, and when.
 *
 * Two-level disclosure, coarse first. The default view is amendments only,
 * because the `original` stream is not a log entry — it IS the workout, and
 * the set rows above already render it; repeating it as "logged 5 × 100 kg"
 * would bury the one thing this surface exists to say. "Show the full log"
 * opens the rest (the original persist, late entries, the app's own writes)
 * for a reader who asks.
 *
 * The whole section is ABSENT when nothing was amended — an untouched record
 * has no history to disclose, and an empty state here would be filler on the
 * common case (same rule the program change log follows).
 */

/**
 * Provenance as a RAIL, not a chip: a left hairline down the row, the shipped
 * treatment from NoteRow's coach presence. The volt marks the kind the reader
 * came for, and because the default view is amendments only it paints one
 * continuous edge down the zone rather than a per-item accent — the shape the
 * one-volt rule allows (a zone carries the accent; items do not).
 */
const RAIL_CLASSES: Record<WorkoutChangelogEntry['kind'], string> = {
  amendment: 'border-l-primary',
  late_entry: 'border-l-border',
  original: 'border-l-border',
  system: 'border-l-border/40',
}

/**
 * WHO changed it, as a WORD — chips are controls, words are labels. Your own
 * edits stay muted; an agent or coach edit reads in the foreground ink, so
 * "someone else touched this record" registers without a pill.
 */
const ACTOR_WORD_CLASSES: Record<WorkoutChangelogEntry['actor'], string> = {
  ui: 'text-muted-foreground',
  mcp: 'text-foreground',
  coach: 'text-foreground',
  system: 'text-muted-foreground',
}

function ChangeRow({ entry, now }: { entry: WorkoutChangelogEntry; now: Date }) {
  const t = useTranslations('WorkoutChangelog')
  const format = useFormatter()
  return (
    <li className={cn('space-y-0.5 border-l-2 pl-3', RAIL_CLASSES[entry.kind])}>
      <p className="flex items-baseline gap-2">
        <span
          className={cn(
            'shrink-0 text-[10px] font-semibold uppercase tracking-widest',
            ACTOR_WORD_CLASSES[entry.actor],
          )}
        >
          {t(`actor.${entry.actor}`)}
        </span>
        {/* A late entry is the one kind whose MEANING isn't carried by its
            actor: someone recorded work that had already happened. It says so
            in words, beside the actor. */}
        {entry.kind === 'late_entry' && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('lateEntryLabel')}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tnum">
          {format.relativeTime(entry.occurredAt, now)}
        </span>
      </p>
      {/* ONE row per intent: the write path already folded every field a
          single edit touched into this line. */}
      <p className="text-sm leading-snug">{entry.summary}</p>
    </li>
  )
}

interface WorkoutChangelogProps {
  /** The session's events, newest first — the FULL stream, unfiltered. The
   *  amendments-only default is this component's decision, made once here. */
  entries: readonly WorkoutChangelogEntry[]
  /** When the session itself happened — the baseline the amended mark
   *  measures against ("2 days after the session"). */
  sessionAt: Date
  /** "Now" for the relative timestamps, passed in so the surface renders
   *  deterministically in stories and tests. */
  now: Date
  /** The reader's locale, for the calendar-day group headers. */
  locale: Locale
}

export function WorkoutChangelog({ entries, sessionAt, now, locale }: WorkoutChangelogProps) {
  const t = useTranslations('WorkoutChangelog')
  const [showFullLog, setShowFullLog] = useState(false)

  const mark = amendedMark(entries, sessionAt)
  // Nothing was ever contradicted: this record needs no disclosure at all.
  if (mark === null) return null

  const amendments = entries.filter((entry) => isAmendmentKind(entry.kind))
  const visible = showFullLog ? entries : amendments
  const hasMore = entries.length > amendments.length

  return (
    <Section title={t('title')} className="border-t border-border pt-6">
      {/* The permanent amended mark. It is the point of the section: a reader
          must know the numbers above moved without opening anything. */}
      <p className="mt-2 text-sm">{t('amendedMark', { ...mark })}</p>
      <div className="mt-4 space-y-4">
        {groupEventsByDay(visible, (date) => formatWorkoutDate(date, locale)).map((group) => (
          <div key={group.label}>
            {/* The date leaves the row so summaries get the full width. */}
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
              {group.label}
            </p>
            <ul className="mt-1.5 space-y-2.5">
              {group.events.map((entry) => (
                <ChangeRow key={entry.id} entry={entry} now={now} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Level two. Absent when the amendments ARE the whole log — an
          affordance that reveals nothing is a lie. */}
      {hasMore && (
        <button
          type="button"
          aria-expanded={showFullLog}
          onClick={() => setShowFullLog((open) => !open)}
          className="mt-3 inline-flex min-h-11 items-center rounded-sm text-xs font-semibold uppercase tracking-widest text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          {showFullLog ? t('showAmendments') : t('showFull')}
        </button>
      )}
    </Section>
  )
}
