import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { listNotes } from '@/db/notes'
import { getWeightUnit } from '@/db/preferences'
import {
  buildNoteView,
  collectTags,
  filterNoteViews,
  notesHref,
  parseNotesFilterParams,
} from '@/components/notes/note-view'
import { AppHeader } from '@/components/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { cn } from '@/lib/utils'
import { FacetSelect } from './facet-select'
import { NotesBrowser } from './notes-browser'

/**
 * The notes browser: one corpus, many lenses. The server renders everything —
 * rows via listNotes with their anchor breadcrumbs, filters read from the URL
 * (chips are links, the exercises-page precedent) — and the one client island
 * adds the transient search viewfinder over the already-rendered window.
 *
 * The window is listNotes' 200-row ceiling: at hundreds-of-notes scale the
 * whole corpus loads in one read and every filter is a client-side narrow —
 * real pagination (offset pages or infinite scroll) is the day-one-thousand
 * problem, deliberately deferred.
 */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const userId = await requireUserId()
  const params = parseNotesFilterParams(await searchParams)
  const [rows, unit] = await Promise.all([listNotes(userId), getWeightUnit(userId)])

  const now = new Date()
  const views = rows.map((row) => buildNoteView(row, unit, now))
  const filtered = filterNoteViews(views, params)

  // Facet options are corpus-derived: chips exist only when the data does.
  const tags = collectTags(rows.map((row) => row.body))
  const exercises = distinct(views.map((view) => view.exerciseName))
  const programs = distinct(views.map((view) => view.programName))
  const hasCoachNotes = views.some((view) => view.author === 'coach')

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title="Notes" leading={<NavDrawer />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-4">
        <NotesBrowser notes={filtered} corpusEmpty={views.length === 0}>
          {views.length > 0 && (
            /* The composing filter rail — every chip is a LINK to the next
               URL state; active chips link back to their cleared state.
               Edge-to-edge scroll on the page grid (exercises precedent). */
            <nav
              aria-label="Filter notes"
              className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
            >
              <FilterChip
                href={notesHref({ ...params, author: 'all' })}
                label="All"
                isActive={params.author === 'all'}
              />
              <FilterChip
                href={notesHref({ ...params, author: 'mine' })}
                label="Mine"
                isActive={params.author === 'mine'}
              />
              {/* The Coach lens appears once a coach has ever written — a
                  chip filtering to an impossible-yet corpus is noise. */}
              {hasCoachNotes && (
                <FilterChip
                  href={notesHref({ ...params, author: 'coach' })}
                  label="Coach"
                  isActive={params.author === 'coach'}
                />
              )}
              {tags.map((tag) => {
                const isActive = params.tag?.toLowerCase() === tag.toLowerCase()
                return (
                  <FilterChip
                    key={tag}
                    href={notesHref({ ...params, tag: isActive ? null : tag })}
                    label={tag}
                    isActive={isActive}
                  />
                )
              })}
              {exercises.length > 0 && (
                <FacetSelect
                  label="Exercise"
                  param="exercise"
                  params={params}
                  options={exercises}
                />
              )}
              {programs.length > 0 && (
                <FacetSelect label="Program" param="program" params={params} options={programs} />
              )}
            </nav>
          )}
        </NotesBrowser>
      </main>
    </div>
  )
}

/** Distinct non-null values, first-seen order (the corpus is the picker). */
function distinct(values: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (value === null || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** One filter chip — the exercises-page facet recipe; active = volt tint
 *  (selected state, the accent's sanctioned job). */
function FilterChip({
  href,
  label,
  isActive,
}: {
  href: string
  label: string
  isActive: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
        isActive
          ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground active:bg-muted/60',
      )}
    >
      {label}
    </Link>
  )
}
