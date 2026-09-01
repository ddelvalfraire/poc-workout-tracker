import Link from 'next/link'
import { requireUserId } from '@/lib/auth/auth'
import { listNotes } from '@/db/notes'
import { getWeightUnit } from '@/db/preferences'
import {
  buildNoteView,
  collectTags,
  filterNoteViews,
  notesHref,
  parseNotesFilterParams,
} from '@/components/notes/note-view'
import { AppHeader } from '@/components/nav/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { cn } from '@/lib/utils'
import { FacetSelect } from './facet-select'
import { NotesBrowser } from './notes-browser'
import { getTranslations } from 'next-intl/server'

/** Facet identifiers, not copy — the select's own labels come from the
 *  catalog inside FacetSelect. */
const EXERCISE_FACET = 'exercise'
const PROGRAM_FACET = 'program'

/** ARIA token values are part of the HTML vocabulary, never copy. */
const ARIA_CURRENT_PAGE = 'page'

/** listNotes' row ceiling — the window the page can honestly claim to show. */
const NOTES_WINDOW = 200

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
  const t = await getTranslations('Notes')
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
      <AppHeader title={t('title')} leading={<NavDrawer userId={userId} />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-4">
        <NotesBrowser notes={filtered} corpusEmpty={views.length === 0}>
          {views.length > 0 && (
            /* The composing filter rail — every chip is a LINK to the next
               URL state; active chips link back to their cleared state.
               Edge-to-edge scroll on the page grid (exercises precedent). */
            <nav
              aria-label={t('filters.ariaLabel')}
              className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
            >
              <FilterChip
                href={notesHref({ ...params, author: 'all' })}
                label={t('filters.all')}
                isActive={params.author === 'all'}
              />
              <FilterChip
                href={notesHref({ ...params, author: 'mine' })}
                label={t('filters.mine')}
                isActive={params.author === 'mine'}
              />
              {/* The Coach lens appears once a coach has ever written — a
                  chip filtering to an impossible-yet corpus is noise. */}
              {hasCoachNotes && (
                <FilterChip
                  href={notesHref({ ...params, author: 'coach' })}
                  label={t('filters.coach')}
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
                <FacetSelect param={EXERCISE_FACET} params={params} options={exercises} />
              )}
              {programs.length > 0 && (
                <FacetSelect param={PROGRAM_FACET} params={params} options={programs} />
              )}
            </nav>
          )}
        </NotesBrowser>
        {/* No silent caps: listNotes windows at 200 — when the window is
            full, older notes exist beyond it and the reader must know. */}
        {rows.length >= NOTES_WINDOW && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {t('windowNotice', { count: NOTES_WINDOW })}
          </p>
        )}
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
      aria-current={isActive ? ARIA_CURRENT_PAGE : undefined}
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
