import type { NoteWithContext } from '@/db/notes'
import type { NoteAnchorKind, NoteAnchorSnapshot, NoteAuthor } from '@/lib/note-input'
import { quantizeDisplayLoad } from '@/lib/load-quantize'
import type { WeightUnit } from '@/lib/units'
import { formatDurationInput } from '@/lib/duration'
import { relativeDayLabel } from '@/lib/drawer-status'

/**
 * Pure view logic for notes-v2 read surfaces (the /notes browser, the
 * exercise reverse index, the workout-detail Notes section). Everything here
 * is serializable-in/serializable-out: the server pages build `NoteView`
 * rows (all display strings pre-formatted, the library-filter precedent) and
 * the client islands only narrow and render — filtering stays instant and
 * hydration can never disagree about a date.
 */

/* ------------------------------- tokenizer ------------------------------- */

/** One run of a note body: plain text, or a #tag that gets the volt ink. */
export interface NoteToken {
  kind: 'text' | 'tag'
  text: string
}

/**
 * The tiny tag tokenizer: a word starting with `#` (at the start or after
 * whitespace, with at least one character behind the hash) is a tag — that's
 * the whole grammar. No registry, no parsing dialect: the body carries its
 * metadata inline (capture-sheet contract).
 */
export function tokenizeNoteBody(body: string): NoteToken[] {
  const tokens: NoteToken[] = []
  const re = /#[^\s#]+/g
  let cursor = 0
  for (const match of body.matchAll(re)) {
    const start = match.index
    // Mid-word hashes ("c#", "issue#4") are text, not tags.
    if (start > 0 && !/\s/.test(body[start - 1])) continue
    if (start > cursor) tokens.push({ kind: 'text', text: body.slice(cursor, start) })
    tokens.push({ kind: 'tag', text: match[0] })
    cursor = start + match[0].length
  }
  if (cursor < body.length) tokens.push({ kind: 'text', text: body.slice(cursor) })
  return tokens
}

/** Distinct #tags across a corpus, first-seen order, case-insensitive dedupe
 *  (first casing wins) — the browser's tag filter chips exist only when the
 *  corpus does. */
export function collectTags(bodies: readonly string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const body of bodies) {
    for (const token of tokenizeNoteBody(body)) {
      if (token.kind !== 'tag') continue
      const key = token.text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      tags.push(token.text)
    }
  }
  return tags
}

/* ----------------------------- row anatomy ------------------------------- */

/**
 * The PR #247 invariant, read back: a workout-anchored row CARRYING an
 * anchor_snapshot is a fallback re-anchor — its set/exercise vanished in an
 * edit and note-sync parked it on the workout with the frozen context. A true
 * session note never has one. That's the whole "outdated" test.
 */
export function isOutdatedNote(note: {
  anchorKind: NoteAnchorKind
  anchorSnapshot: NoteAnchorSnapshot | null
}): boolean {
  return note.anchorKind === 'workout' && note.anchorSnapshot !== null
}

/** "185 lb × 6" / "12 reps" / "1:30" from the frozen snapshot, quantized to
 *  the display unit (quantizeDisplayLoad — never a raw kgToDisplay). Null
 *  when the snapshot holds no set facts (exercise-anchor snapshots). */
export function snapshotLine(
  snapshot: NoteAnchorSnapshot | null,
  unit: WeightUnit,
): string | null {
  if (snapshot === null) return null
  const { loadKg, reps, durationSec } = snapshot
  if (loadKg !== null && loadKg !== undefined && reps !== null && reps !== undefined) {
    return `${quantizeDisplayLoad(loadKg, unit)} ${unit} × ${reps}`
  }
  if (durationSec !== null && durationSec !== undefined) return formatDurationInput(durationSec)
  if (reps !== null && reps !== undefined) return `${reps} reps`
  return null
}

/**
 * The caps anchor breadcrumb: "Bench Press · Set 3" / "Bench Press ·
 * exercise" / "Workout" / "Program note". Outdated fallbacks read their
 * breadcrumb from the frozen snapshot (the live anchor is gone — that's the
 * point). `omitExercise` drops the redundant exercise segment on the
 * exercise page's reverse index.
 */
export function noteBreadcrumb(
  note: Pick<NoteWithContext, 'anchorKind' | 'anchorSnapshot' | 'exerciseName' | 'setNumber'>,
  opts: { omitExercise?: boolean } = {},
): string {
  const snap = note.anchorSnapshot
  switch (note.anchorKind) {
    case 'set': {
      const setNumber = note.setNumber ?? snap?.setNumber ?? null
      const setPart = setNumber !== null ? `Set ${setNumber}` : 'Set'
      if (opts.omitExercise) return setPart
      const name = note.exerciseName ?? snap?.exerciseName ?? null
      return name !== null ? `${name} · ${setPart}` : setPart
    }
    case 'workout_exercise': {
      if (opts.omitExercise) return 'Exercise'
      const name = note.exerciseName ?? snap?.exerciseName ?? null
      return name !== null ? `${name} · exercise` : 'Exercise'
    }
    case 'workout': {
      if (!isOutdatedNote(note)) return 'Workout'
      // Fallback re-anchor: the snapshot is the only surviving address.
      const name = snap?.exerciseName ?? null
      const setNumber = snap?.setNumber ?? null
      if (name !== null && setNumber !== null) return `${name} · Set ${setNumber}`
      if (name !== null) return name
      return 'Workout'
    }
    case 'program':
      return 'Program note'
  }
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Relative write-time for the row's right edge: "now" / "35m ago" /
 *  "3h ago", then the shared day vocabulary ("Yesterday" / "Aug 10"). */
export function noteTimeLabel(atMs: number, now: Date): string {
  const diff = now.getTime() - atMs
  if (diff < MINUTE_MS) return 'now'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`
  return relativeDayLabel(atMs, now)
}

/* ------------------------------ view rows -------------------------------- */

/** A fully pre-formatted note row — what server pages hand client islands. */
export interface NoteView {
  id: string
  author: NoteAuthor
  anchorKind: NoteAnchorKind
  outdated: boolean
  /** Caps anchor breadcrumb ("Bench Press · Set 3"). */
  breadcrumb: string
  /** Raw body — tokenized at render so tags stay volt everywhere. */
  body: string
  /** "185 lb × 6", quantized display units; null when there's nothing to show. */
  snapshotLine: string | null
  /** "3h ago" / "Yesterday" — relative, pre-formatted. */
  timeLabel: string
  /** SESSION-thread identity: the workout is the thread; program notes get a
   *  per-program thread. */
  threadKey: string
  /** The thread header: the workout's name (or "Program · name"). */
  threadTitle: string
  /** The thread header's right edge: relative session date. */
  threadDateLabel: string
  /** Filter facts (corpus-derived pickers match on display names — the
   *  loaded window is the corpus, so names are unambiguous enough for v1). */
  exerciseName: string | null
  programName: string | null
  workoutId: string | null
  tags: string[]
}

/** Builds one NoteView from a listNotes row. `omitExercise` for the exercise
 *  page's reverse index (the page IS the exercise — the segment is noise). */
export function buildNoteView(
  note: NoteWithContext,
  unit: WeightUnit,
  now: Date,
  opts: { omitExercise?: boolean } = {},
): NoteView {
  const outdated = isOutdatedNote(note)
  const threadKey =
    note.anchorKind === 'program' ? `p:${note.programId}` : `w:${note.workoutId ?? 'none'}`
  const threadDate = note.workoutStartedAt ?? note.createdAt
  return {
    id: note.id,
    author: note.author,
    anchorKind: note.anchorKind,
    outdated,
    breadcrumb: noteBreadcrumb(note, opts),
    body: note.body,
    // Set snapshots (live or fallback) carry the micro-context; exercise
    // snapshots hold only the name — snapshotLine handles both.
    snapshotLine:
      note.anchorKind === 'set' || outdated ? snapshotLine(note.anchorSnapshot, unit) : null,
    timeLabel: noteTimeLabel(note.createdAt.getTime(), now),
    threadKey,
    threadTitle:
      note.anchorKind === 'program'
        ? `Program · ${note.programName ?? 'Program'}`
        : (note.workoutName ?? 'Workout'),
    threadDateLabel: relativeDayLabel(threadDate.getTime(), now),
    exerciseName: note.exerciseName ?? note.anchorSnapshot?.exerciseName ?? null,
    programName: note.programName,
    workoutId: note.workoutId,
    tags: collectTags([note.body]),
  }
}

/** One SESSION header group ("the workout is the thread"). */
export interface NoteThread {
  key: string
  title: string
  dateLabel: string
  notes: NoteView[]
}

/** Buckets newest-first rows into threads; thread order = its newest note
 *  (input order is listNotes' createdAt desc — first-seen wins). */
export function groupNotesByThread(views: readonly NoteView[]): NoteThread[] {
  const threads = new Map<string, NoteThread>()
  for (const view of views) {
    const existing = threads.get(view.threadKey)
    if (existing) {
      existing.notes.push(view)
      continue
    }
    threads.set(view.threadKey, {
      key: view.threadKey,
      title: view.threadTitle,
      dateLabel: view.threadDateLabel,
      notes: [view],
    })
  }
  return [...threads.values()]
}

/* ------------------------------- filtering ------------------------------- */

/** The browser's composing filters — all URL state (?author=&tag=&exercise=
 *  &program=), ANDed together. */
export interface NotesFilterParams {
  author: 'all' | 'mine' | 'coach'
  tag: string | null
  exercise: string | null
  program: string | null
}

/** Applies the chip filters (AND-composed). Tag matching is case-insensitive
 *  (collectTags dedupes the same way). */
export function filterNoteViews(
  views: readonly NoteView[],
  params: NotesFilterParams,
): NoteView[] {
  const tagNeedle = params.tag?.toLowerCase() ?? null
  return views.filter((view) => {
    if (params.author === 'mine' && view.author !== 'user') return false
    if (params.author === 'coach' && view.author !== 'coach') return false
    if (tagNeedle !== null && !view.tags.some((t) => t.toLowerCase() === tagNeedle)) return false
    if (params.exercise !== null && view.exerciseName !== params.exercise) return false
    if (params.program !== null && view.programName !== params.program) return false
    return true
  })
}

/** One raw searchParams value → first string (house rule: repeated keys,
 *  first one wins), else null. */
function firstParam(value: string | string[] | undefined): string | null {
  if (value === undefined) return null
  const raw = Array.isArray(value) ? value[0] : value
  return raw !== undefined && raw !== '' ? raw : null
}

/** Parses the browser's ?author=&tag=&exercise=&program= — unknown values
 *  quietly read as their defaults (a mistyped query never 404s a list). */
export function parseNotesFilterParams(
  searchParams: Record<string, string | string[] | undefined>,
): NotesFilterParams {
  const author = firstParam(searchParams.author)
  return {
    author: author === 'mine' || author === 'coach' ? author : 'all',
    tag: firstParam(searchParams.tag),
    exercise: firstParam(searchParams.exercise),
    program: firstParam(searchParams.program),
  }
}

/** /notes href for a filter state — defaults drop out so All is plain /notes
 *  (URL as state: every chip is a link to the next state). */
export function notesHref(params: NotesFilterParams): string {
  const query = new URLSearchParams()
  if (params.author !== 'all') query.set('author', params.author)
  if (params.tag !== null) query.set('tag', params.tag)
  if (params.exercise !== null) query.set('exercise', params.exercise)
  if (params.program !== null) query.set('program', params.program)
  const qs = query.toString()
  return qs === '' ? '/notes' : `/notes?${qs}`
}

/** The search predicate (the client island's transient viewfinder): body,
 *  breadcrumb, and thread title, case-insensitive substring. */
export function matchesNoteSearch(view: NoteView, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (q === '') return true
  return (
    view.body.toLowerCase().includes(q) ||
    view.breadcrumb.toLowerCase().includes(q) ||
    view.threadTitle.toLowerCase().includes(q)
  )
}
