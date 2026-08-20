import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listImportBatches } from '@/db/import'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ImportFlow } from './import-flow'
import { RemoveImportButton } from './remove-import-button'
import { getTranslations } from 'next-intl/server'

/**
 * /settings/import — bring Strong/Hevy history in as first-class training
 * history (PRs, e1RM trends, Prev chips light up on day one), plus the list
 * of past imports with the batch-scoped undo.
 */
export default async function ImportPage() {
  const t = await getTranslations('Import')
  const userId = await requireUserId()
  const [unit, batches] = await Promise.all([getWeightUnit(userId), listImportBatches(userId)])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('headerTitle')}
        leading={
          <BackLink fallback="/settings" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <ImportFlow defaultUnit={unit} />

        <section aria-label={t('historyGroupLabel')} className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground">{t('title')}</h2>
          {batches.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
              {batches.map((batch) => {
                const scopeLabel = t('batch.scope', { count: batch.workoutCount })
                return (
                  <li key={batch.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {batch.source === 'strong' ? t('source.strong') : t('source.hevy')}
                        {batch.fileName && (
                          <span className="font-normal text-muted-foreground">
                            {t('batch.fileNameSuffix', { fileName: batch.fileName })}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {t('batch.meta', {
                          scope: scopeLabel,
                          sets: batch.setCount,
                          date: formatWorkoutDate(batch.createdAt),
                        })}
                      </p>
                    </div>
                    <RemoveImportButton batchId={batch.id} scopeLabel={scopeLabel} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
