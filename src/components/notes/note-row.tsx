import { cn } from '@/lib/utils'
import { tokenizeNoteBody, type NoteView } from './note-view'

/**
 * One note row in the de-card vocabulary: caps anchor breadcrumb with the
 * relative write-time right-aligned, plain-text body with inline #tags in
 * volt, and the micro-snapshot line beneath — hairlines come from the
 * DividerList the caller wraps rows in, never a shell. Server-renderable
 * (zero hooks) so every read surface shares it.
 *
 * Coach rows (author 'coach') wear the other-author presence from the screen
 * drafts: 17px avatar + name over the breadcrumb, volt LEFT hairline down
 * the row — presence, never a chat bubble. The write path can't produce
 * coach rows yet (gated behind the coach surface); the treatment ships
 * render-ready and is pinned by the fixture render test.
 */

/** A note body with #tags in the volt ink — the tokenizer is the grammar. */
export function NoteBody({ body, className }: { body: string; className?: string }) {
  return (
    <p className={cn('whitespace-pre-wrap text-sm', className)}>
      {tokenizeNoteBody(body).map((token, index) =>
        token.kind === 'tag' ? (
          <span key={index} className="font-medium text-primary">
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </p>
  )
}

export function NoteRow({ note }: { note: NoteView }) {
  const isCoach = note.author === 'coach'
  return (
    <li className={cn('space-y-1 py-3', isCoach && 'border-l-2 border-l-primary pl-3')}>
      {isCoach && (
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span
            aria-hidden="true"
            className="flex size-[17px] shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary"
          >
            C
          </span>
          Coach
        </p>
      )}
      <p className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-display text-xs uppercase tracking-widest text-muted-foreground">
          {note.breadcrumb}
        </span>
        {note.outdated && (
          // Chips are controls, words are labels: "outdated" is a fact, so
          // it renders as the quiet caps word (the "Skipped" treatment).
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Outdated
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tnum">
          {note.timeLabel}
        </span>
      </p>
      <NoteBody body={note.body} />
      {note.snapshotLine !== null && (
        <p className="text-xs text-muted-foreground tnum">
          {note.outdated
            ? // GitHub outdated-comment semantics: the frozen context is the
              // evidence — "was 35 lb × 8" — because the anchor was edited away.
              `was ${note.snapshotLine} — set edited after`
            : note.snapshotLine}
        </p>
      )}
    </li>
  )
}
