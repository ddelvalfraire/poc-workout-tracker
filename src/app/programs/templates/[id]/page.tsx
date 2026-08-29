import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getAllExercises } from '@/lib/wger'
import { listPublicTemplates } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram } from '@/lib/wger-template-map'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { TemplatePreview } from '@/components/template-preview/template-preview'
import { ImportTemplateButton } from '../import-button'
import { TemplatesUnavailable } from '../unavailable'
import { SystemTemplateDetail } from './system-template-detail'
import { getTranslations } from 'next-intl/server'

/** wger routine ids are small positive integers; anything else is a bad URL. */
const TEMPLATE_ID_PATTERN = /^\d{1,9}$/
/** Curated system templates are programs rows — uuids. The two id shapes are
 *  disjoint, so one route serves both shelves. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * In-app detail for one wger public template — the browse card's missing
 * second half: the full program is readable here without navigating to wger.
 * The page renders the MAPPED shape, not wger's raw structure: exactly what
 * "Add to my programs" would create, so what you read is what you import
 * (same display-truth rule as the browse cards, one mapper for both). The
 * routine comes from the same daily-cached catalog pass the browse list uses;
 * a template outside that catalog — or one with nothing mappable — is a 404,
 * while an unreachable catalog degrades to the browse page's explanatory card.
 */
export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('ProgramTemplateDetail')
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const { id } = await params
  // Curated branch: a uuid is a system template (db-backed detail + adopt).
  if (UUID_PATTERN.test(id)) return <SystemTemplateDetail templateId={id} userId={userId} />
  if (!TEMPLATE_ID_PATTERN.test(id)) notFound()
  const wgerId = Number(id)

  const result = await listPublicTemplates()
  if (!result.ok) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <AppHeader
          title={t('fallbackTitle')}
          leading={
            <BackLink fallback="/programs/templates" />
          }
        />
        <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
          <TemplatesUnavailable reason={result.reason} />
        </main>
      </div>
    )
  }

  const routine = result.templates.find((t) => t.id === wgerId)
  if (!routine) notFound()

  const [exercises, unit] = await Promise.all([getAllExercises(), getWeightUnit(userId)])
  const catalog = new Map(exercises.map((e) => [e.id, e.name]))
  const mapped = mapWgerRoutineToProgram(routine, catalog)
  if (!mapped) notFound()

  const { input, skipped } = mapped

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={input.name}
        leading={
          <BackLink fallback="/programs/templates" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5">
        {/* Shared preview body (fact strip, block map, day-1-expanded plan,
            sticky adopt bar) — the MAPPED shape, so what you read is what
            "Add to my programs" creates. Branch-specific pieces ride the
            slots: the import island, and a footer of the mapper's honesty
            ledger plus the CC attribution wger requires. */}
        <TemplatePreview
          name={input.name}
          icon={typeof input.icon === 'string' ? input.icon : null}
          description={typeof input.description === 'string' ? input.description : null}
          /* Unparsed input types mesocycleWeeks as optional; the mapper
             always sets it, and 1 is the schema's own default. */
          mesocycleWeeks={input.mesocycleWeeks ?? 1}
          deloadWeek={null}
          unit={unit}
          days={input.days.map((day, dayIndex) => ({
            key: String(dayIndex),
            name: day.name,
            exercises: day.exercises.map((exercise, exerciseIndex) => ({
              key: String(exerciseIndex),
              name: exercise.name,
              supersetGroup: exercise.supersetGroup,
              sets: exercise.sets,
            })),
          }))}
          cta={<ImportTemplateButton templateId={wgerId} />}
          footer={
            <>
              {/* The mapper's honesty ledger: what an import would drop and
                  why. Quiet — a skipped accessory must not read like an
                  error. */}
              {skipped.length > 0 && (
                <section aria-label={t('skipped.ariaLabel')} className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('skipped.title')}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {skipped.map((note) => (
                      <li key={note} className="text-sm text-muted-foreground">
                        {note}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {typeof input.sourceUrl === 'string' && (
                <p className="mt-6 text-xs text-muted-foreground">
                  {/* One message, not a sentence beside a link: where the
                      link sits in the line is a translator's decision. */}
                  {t.rich('attribution', {
                    source: (chunks) => (
                      <a
                        href={input.sourceUrl as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
                      >
                        {chunks}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    ),
                  })}
                </p>
              )}
            </>
          }
        />
      </main>
    </div>
  )
}
