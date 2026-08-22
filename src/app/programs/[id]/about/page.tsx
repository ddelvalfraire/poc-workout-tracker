import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { requireUserId } from '@/lib/auth'
import { getProgramDetail, programWeekState } from '@/db/programs'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { MarkdownView } from '@/components/markdown-view'
import { EmptyWords } from '@/components/ui/empty-words'
import { DescriptionEdit } from '../description-edit'

/**
 * The program article, as its own route.
 *
 * It used to be a collapsed `<details>` on the program page, which cost it
 * three things: a URL (so it could not be linked, shared, or reached from
 * anywhere else), a back stack, and any typography of its own — authored
 * prose rendered at the app's dense 14px UI step. A route fixes all three,
 * and retires a real defect on the way: the fold used a RIGHT chevron with
 * `group-open:rotate-90`, sitting directly above two navigation rows that
 * also carried right chevrons. Same glyph, one expanding in place and one
 * navigating — the inert-twin shape DESIGN.md bans. Now every right chevron
 * on that page navigates.
 *
 * A reading surface, not a UI surface. The condensed display face stays on
 * the title and out of the body: it costs measurable reading speed at long
 * measure. Body steps up from the app's `text-sm` to `text-lg` and sits a
 * shade under the full foreground, because near-white on near-black haloes at
 * paragraph length.
 *
 * Rendered by default with one owner-gated edit control — the GitHub README
 * model. Inline-live prose is for products where every viewer is a
 * collaborator; a program can be shared, so a reader who is not the author
 * must never be one stray tap from rewriting it.
 */
export default async function ProgramAboutPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('ProgramAbout')
  const userId = await requireUserId()
  const { id } = await params
  const program = await getProgramDetail(userId, id)
  if (!program) notFound()

  const { currentWeek } = await programWeekState(userId, program.id, program.mesocycleWeeks)
  // A proposal has no owner yet, so it has no authoring path either — the
  // same gate the description editor carried on the program page.
  const isProposed = program.status === 'proposed'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={program.name}
        leading={<BackLink fallback={`/programs/${program.id}`} />}
        trailing={
          isProposed ? undefined : (
            <DescriptionEdit
              programId={program.id}
              programName={program.name}
              description={program.description}
            />
          )
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <header className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('eyebrow')}
          </p>
          {/* A <p>, not a second <h1>: AppHeader already renders the page's
              h1 from the same name. */}
          <p className="mt-2 text-balance font-display text-3xl uppercase leading-9 tracking-wide">
            {program.name}
          </p>
          <p className="tnum mt-2 text-sm text-muted-foreground">
            {t('meta', { weeks: program.mesocycleWeeks, days: program.days.length })}
          </p>
        </header>

        {program.heroImageUrl !== null && (
          // Plain <img>: remote hosts aren't in the next/image allowlist, and
          // the URL is validated http(s) at the input boundary. Decorative —
          // the title above carries the name.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={program.heroImageUrl}
            alt=""
            className="-mx-5 mt-6 h-48 w-[calc(100%+2.5rem)] object-cover sm:mx-0 sm:w-full"
          />
        )}

        {program.description === null ? (
          <EmptyWords className="mt-10">{t('empty')}</EmptyWords>
        ) : (
          // The reading step: 18px over a 28px line box, one notch under the
          // full foreground. `max-w-prose` is a no-op inside max-w-md today —
          // it is here so the measure stays capped if this surface ever
          // widens, rather than the line length growing with it.
          <MarkdownView
            markdown={program.description}
            className="mt-8 max-w-prose text-lg leading-7 text-foreground/90"
          />
        )}

        {/* The program DOCUMENT note: authored once via upsert_program, plain
            text ≤2000 with no markdown contract — hence no MarkdownView. It
            closes the article as an aside, on the muted quote rail. */}
        {program.notes !== null && (
          <section aria-label={t('notesLabel')} className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t('notesLabel')}
            </p>
            <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-4 text-base leading-6 text-muted-foreground">
              {program.notes}
            </p>
          </section>
        )}

        {program.sourceUrl !== null && (
          <p className="mt-8 text-xs text-muted-foreground">
            <a
              href={program.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {t('sourceLinkLabel')}
            </a>
          </p>
        )}

        {/* A reader who reaches the bottom should not have to scroll back up
            to leave. The header's back affordance stays for everyone else. */}
        <div className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-5">
          <Link
            href={`/programs/${program.id}`}
            className="flex items-center gap-2 text-sm font-medium transition-colors outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t('backLink')}
          </Link>
          <p className="tnum shrink-0 text-sm text-muted-foreground">
            {t('weekMeta', { week: currentWeek, total: program.mesocycleWeeks })}
          </p>
        </div>
      </main>
    </div>
  )
}
