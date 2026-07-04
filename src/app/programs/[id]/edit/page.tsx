import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getProgramDetail } from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { detailToProgramDraft } from '@/app/programs/new/program-draft'
import { ProgramBuilder } from '@/app/programs/new/program-builder'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
  if (!program) notFound()

  // Pass-through fields (progression/technique JSONB, status, notes) ride the
  // draft untouched so this full-replace edit doesn't lose agent-authored data.
  const draft = detailToProgramDraft(program, unit)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Edit Program"
        trailing={
          <Link
            href={`/programs/${id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Cancel
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <ProgramBuilder programId={id} initialDraft={draft} unit={unit} />
      </main>
    </div>
  )
}
