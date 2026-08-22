import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { getTemplate } from '@/db/templates'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { TemplatePreview } from '@/components/template-preview/template-preview'
import { UseTemplateButton } from '../use-template-button'
import { getTranslations } from 'next-intl/server'

/**
 * Detail surface for one CURATED system template — the uuid branch of
 * /programs/templates/[id] (numeric ids stay the wger flow). The body is the
 * shared TemplatePreview (fact strip, block map, day-1-expanded plan, sticky
 * adopt bar) — this file only fetches, adapts, and hangs the branch-specific
 * pieces (adopt island, attribution) on its slots. Set lines ride the same
 * `planned-set-format` grammar — a stored program set row carries every field
 * a planned shape reads, so what you see is exactly what adoption copies.
 */
export async function SystemTemplateDetail({
  templateId,
  userId,
}: {
  templateId: string
  userId: string
}) {
  const t = await getTranslations('SystemTemplateDetail')
  const [detail, unit] = await Promise.all([
    getTemplate(userId, templateId),
    getWeightUnit(userId),
  ])
  if (!detail) notFound()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={detail.name} leading={<BackLink fallback="/programs/templates" />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <TemplatePreview
          name={detail.name}
          icon={detail.icon}
          description={detail.description}
          mesocycleWeeks={detail.mesocycleWeeks}
          deloadWeek={detail.deloadWeek}
          unit={unit}
          days={detail.days.map((day) => ({
            key: day.id,
            name: day.name,
            exercises: day.exercises.map((exercise) => ({
              key: exercise.id,
              name: exercise.name,
              supersetGroup: exercise.supersetGroup,
              sets: exercise.sets,
            })),
          }))}
          cta={<UseTemplateButton templateId={detail.id} />}
          footer={
            detail.sourceUrl !== null ? (
              <p className="mt-6 text-xs text-muted-foreground">
                {/* One message, not a sentence beside a link: where the link
                    sits in the line is a translator's decision. */}
                {t.rich('attribution', {
                  source: (chunks) => (
                    <a
                      href={detail.sourceUrl as string}
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
            ) : undefined
          }
        />
      </main>
    </div>
  )
}
