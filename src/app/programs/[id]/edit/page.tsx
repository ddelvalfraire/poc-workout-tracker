import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getProgramDetail } from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { getExerciseHistoryBefore } from '@/db/workouts'
import { bestSet } from '@/lib/one-rep-max'
import { detailToProgramDraft, e1rmKey } from '@/app/programs/new/program-draft'
import { ProgramBuilder } from '@/app/programs/new/program-builder'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getTranslations } from 'next-intl/server'

export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('ProgramEdit')
  const tCommon = await getTranslations('Common')
  const userId = await requireUserId()
  const { id } = await params
  const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
  if (!program) notFound()

  // e1RM prefill (TM lifecycle §1): only TM-bearing exercises whose stored TM
  // is 0 (an authored sketch) need history — one batched read; absolute-load
  // history only (weight_reps), mirroring the derive path's e1RM discipline.
  const sketches = program.days
    .flatMap((day) => day.exercises)
    .filter(
      (exercise) =>
        (exercise.progression?.scheme === 'percent-1rm' ||
          exercise.progression?.scheme === 'amrap-cycle') &&
        exercise.progression.trainingMaxKg === 0,
    )
  let e1rms: Map<string, number> | undefined
  if (sketches.length > 0) {
    const rows = await getExerciseHistoryBefore(
      userId,
      [...new Set(sketches.map((exercise) => exercise.wgerExerciseId))],
      new Date(),
    )
    e1rms = new Map()
    for (const exercise of sketches) {
      const key = e1rmKey(exercise.source, exercise.wgerExerciseId)
      if (e1rms.has(key)) continue
      const best = bestSet(
        rows.filter(
          (row) =>
            row.source === exercise.source &&
            row.wgerExerciseId === exercise.wgerExerciseId &&
            row.loggingType === 'weight_reps',
        ),
      )
      if (best) e1rms.set(key, best.e1rm)
    }
  }

  // Pass-through fields (progression/technique JSONB, status, notes) ride the
  // draft untouched so this full-replace edit doesn't lose agent-authored data.
  const draft = detailToProgramDraft(program, unit, e1rms)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        trailing={
          <Link
            href={`/programs/${id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            {tCommon('close')}
          </Link>
        }
      />
      {/* Same column as /programs/new: it widens at the editor-pane
          breakpoint (840px, tokens.ts) without becoming a second layout. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5 min-[840px]:max-w-2xl">
        <ProgramBuilder programId={id} initialDraft={draft} unit={unit} />
      </main>
    </div>
  )
}
