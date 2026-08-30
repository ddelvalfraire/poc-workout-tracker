'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Section } from '@/components/ui/section'
import { groupEventsByDay } from '@/app/programs/[id]/detail-view'
import { formatWorkoutDate } from '@/lib/format'
import type { Locale } from '@/i18n/config'
import { cn } from '@/lib/utils'
import {
  amendedMark,
  formatClockTime,
  isAmendmentKind,
  splitSummary,
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

/** Where `WorkoutAmendedMark` points, and what the section answers to. */
export const WORKOUT_CHANGELOG_ANCHOR = 'workout-change-log'

/**
 * Provenance as a RAIL, not a chip: a left hairline down the row, the shipped
 * treatment from NoteRow's coach presence. Three kinds, three rails, ranked
 * by how much they contradict the record — an amendment reads strongest, a
 * late entry a step back because it adds rather than contradicts, and the
 * app's own writes fall to the ordinary hairline.
 *
 * The ranking is NEUTRAL INK, never the volt. The rail used to be volt on the
 * defence that "amendments-only means every visible rail is volt, so it is
 * one continuous zone edge rather than a per-item accent" — and that defence
 * fails on this component's own rendering: `groupEventsByDay` splits the
 * entries into a separate <ul> under each date header, so a correction set
 * spanning three days paints three volt segments, not one line. Opened to the
 * full log it is worse still — volt rails interleaved with two neutral ones,
 * which is per-item volt distinguishing items in a scannable list, exactly
 * the shape DESIGN.md precedent #163 bans. The accent this surface is allowed
 * lives once, on `WorkoutAmendedMark`: the single element whose whole job is
 * to assert that the record was changed.
 */
const RAIL_CLASSES: Record<WorkoutChangelogEntry['kind'], string> = {
  amendment: 'border-l-foreground/40',
  late_entry: 'border-l-foreground/20',
  original: 'border-l-border',
  system: 'border-l-border',
}

/**
 * WHO changed it, as a WORD — chips are controls, words are labels. Your own
 * edits stay muted; an agent or coach edit reads in the foreground ink, so
 * "someone else touched this record" registers without a pill.
 */
const ACTOR_WORD_CLASSES: Record<WorkoutChangelogEntry['actor'], string> = {
  ui: '',
  mcp: 'text-foreground',
  coach: 'text-foreground',
  system: '',
  // Never rendered as a word (see the `!== 'seed'` guard below) — Persona
  // Foundry's writes are dev-only tooling, in the same "no actor word" voice
  // as 'system'. Present only so this Record stays exhaustive.
  seed: '',
}

function ChangeRow({ entry, locale }: { entry: WorkoutChangelogEntry; locale: Locale }) {
  const t = useTranslations('WorkoutChangelog')
  // ONE row per intent: the write path already folded every field a single
  // edit touched into this line, and the subject/delta split is where the
  // sentence divides — the numbers ride muted behind what they belong to.
  const { subject, detail } = splitSummary(entry.summary)
  return (
    <li className={cn('border-b border-b-border/60 border-l-2 py-2.5 pl-3', RAIL_CLASSES[entry.kind])}>
      <p
        className={cn(
          'text-sm leading-snug',
          // The app's own writes speak in the system voice, one step back.
          entry.kind === 'system' && 'text-muted-foreground',
        )}
      >
        {subject}
        {detail !== null && (
          <span className="text-muted-foreground tnum">{` — ${detail}`}</span>
        )}
      </p>
      {/* WHAT it was · WHO did it · WHEN. The kind is a word, not only a
          rail: a late entry adds where an amendment contradicts, and that
          distinction has to survive being read aloud. */}
      {/* `muted-foreground` is the FLOOR for secondary ink, not a starting
          point to fade from: DESIGN.md verifies it at ≥4.5:1 on the page
          background, and a `/70` step back lands at 4.35:1 (#767676) — a
          real contrast failure, not a quieter voice. The system register is
          already carried by the subject line's ink above. */}
      <p className="mt-0.5 text-xs text-muted-foreground">
        <span>{t(`kind.${entry.kind}`)}</span>
        {entry.actor !== 'system' && entry.actor !== 'seed' && (
          <>
            <span aria-hidden="true">{' · '}</span>
            <span className={ACTOR_WORD_CLASSES[entry.actor]}>{t(`actor.${entry.actor}`)}</span>
          </>
        )}
        <span aria-hidden="true">{' · '}</span>
        <span className="tnum">{formatClockTime(entry.occurredAt, locale)}</span>
      </p>
    </li>
  )
}

interface WorkoutAmendedMarkProps {
  /** The session's events, newest first — the FULL stream, unfiltered. */
  entries: readonly WorkoutChangelogEntry[]
  /** When the session itself happened — the baseline the mark measures
   *  against ("2 days after the session"). */
  sessionAt: Date
  className?: string
}

/**
 * THE AMENDED MARK. Permanent, on the record, and up beside the session's own
 * numbers rather than buried in a log nobody opens: the clinical rule is that
 * a reader must always know they are looking at something that was changed.
 *
 * Absent entirely on an untouched session — silence over noise — and its
 * presence is the same fact that decides whether the change log below exists
 * at all, so the two can never disagree.
 *
 * This mark also holds the summary's ONE volt for the correction story, on
 * the pencil: the glyph that says "changed". Everything downstream of it —
 * the log's rails, the full-log toggle, the per-set pencils on the record —
 * renders in neutral ink, because those are all per-item marks in scannable
 * lists and per-item volt is what DESIGN.md #163 bans. The way in beside it
 * is a link in the reading ink, not a second accent.
 */
export function WorkoutAmendedMark({ entries, sessionAt, className }: WorkoutAmendedMarkProps) {
  const t = useTranslations('WorkoutChangelog')
  const mark = amendedMark(entries, sessionAt)
  if (mark === null) return null
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-y border-border border-b-border/60 py-3',
        className,
      )}
    >
      <Pencil aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {t('amendedMark', { ...mark })}
      </p>
      {/* The way in. A link, not a button: it moves the reader to something
          already on the page. Reading ink + the standing underline — the
          pencil beside it is already this zone's accent, and two volt items
          in one row is the stacking the rule exists to prevent. */}
      <a
        href={`#${WORKOUT_CHANGELOG_ANCHOR}`}
        className="-my-3 shrink-0 rounded-sm py-3 text-sm text-foreground underline underline-offset-[3px] outline-none transition-colors hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        {t('markLink')}
      </a>
    </div>
  )
}

interface WorkoutChangelogProps {
  /** The session's events, newest first — the FULL stream, unfiltered. The
   *  amendments-only default is this component's decision, made once here. */
  entries: readonly WorkoutChangelogEntry[]
  /** When the session itself happened — the baseline that decides whether
   *  there is anything to disclose. */
  sessionAt: Date
  /** The reader's locale, for the calendar-day headers and the clock times. */
  locale: Locale
}

export function WorkoutChangelog({ entries, sessionAt, locale }: WorkoutChangelogProps) {
  const t = useTranslations('WorkoutChangelog')
  const [showFullLog, setShowFullLog] = useState(false)

  // Nothing was ever contradicted: this record needs no disclosure at all.
  if (amendedMark(entries, sessionAt) === null) return null

  const amendments = entries.filter((entry) => isAmendmentKind(entry.kind))
  const visible = showFullLog ? entries : amendments
  const hasMore = entries.length > amendments.length

  return (
    <Section
      id={WORKOUT_CHANGELOG_ANCHOR}
      title={t('title')}
      className="scroll-mt-20 border-t border-border pt-6"
    >
      <div className="mt-3 space-y-4">
        {groupEventsByDay(visible, (date) => formatWorkoutDate(date, locale)).map((group) => (
          <div key={group.label}>
            {/* The date leaves the row so summaries get the full width. */}
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
              {group.label}
            </p>
            <ul className="mt-1.5">
              {group.events.map((entry) => (
                <ChangeRow key={entry.id} entry={entry} locale={locale} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Level two, and it says what it opens — an affordance whose payload
          is a surprise is a worse affordance. Absent when the amendments ARE
          the whole log: revealing nothing would be a lie. */}
      {hasMore && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          <button
            type="button"
            aria-expanded={showFullLog}
            onClick={() => setShowFullLog((open) => !open)}
            className="-my-3 inline-flex min-h-11 items-center rounded-sm py-3 text-foreground underline underline-offset-[3px] outline-none transition-colors hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
          >
            {showFullLog ? t('showAmendments') : t('showFull')}
          </button>
          {!showFullLog && <span>{t('showFullHint')}</span>}
        </p>
      )}
      {/* The promise the whole append-only design exists to keep, said once
          at the bottom in the quietest register the contrast floor allows —
          smallest type and secondary ink, below its own hairline. */}
      <p className="mt-6 border-t border-t-border/60 pt-3.5 text-xs leading-relaxed text-muted-foreground">
        {t('footnote')}
      </p>
    </Section>
  )
}
