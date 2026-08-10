import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listImportBatches } from '@/db/import'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ImportFlow } from './import-flow'
import { RemoveImportButton } from './remove-import-button'

/**
 * /settings/import — bring Strong/Hevy history in as first-class training
 * history (PRs, e1RM trends, Prev chips light up on day one), plus the list
 * of past imports with the batch-scoped undo.
 */
export default async function ImportPage() {
  const userId = await requireUserId()
  const [unit, batches] = await Promise.all([getWeightUnit(userId), listImportBatches(userId)])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Import history"
        leading={
          <BackLink fallback="/settings" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <ImportFlow defaultUnit={unit} />

        <section aria-label="Past imports" className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground">Past imports</h2>
          {batches.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing imported yet. Imports you confirm will be listed here, each removable in
              one tap.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
              {batches.map((batch) => {
                const scopeLabel = `${batch.workoutCount} workout${batch.workoutCount === 1 ? '' : 's'}`
                return (
                  <li key={batch.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {batch.source === 'strong' ? 'Strong' : 'Hevy'}
                        {batch.fileName && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            — {batch.fileName}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {scopeLabel}, {batch.setCount} set{batch.setCount === 1 ? '' : 's'} ·{' '}
                        {formatWorkoutDate(batch.createdAt)}
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
