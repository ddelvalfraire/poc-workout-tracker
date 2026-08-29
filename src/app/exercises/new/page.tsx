import { requireUserId } from '@/lib/auth'
import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { CreateExerciseForm, type ReturnMode } from './create-exercise-form'
import { getTranslations } from 'next-intl/server'

/**
 * Full-page custom exercise creation (#218) — the picker's create row lands
 * here (NN/g: multi-field forms are pages, not sheets), and the page also
 * stands alone as the library's create entry.
 *
 * The return leg is query-param declared: `?return=swap&target={draft client
 * id}` (or `return=add`) makes the primary action contextual ("Save &
 * replace" / "Save & add") and routes the result back into the logger via
 * the pending-pick instruction; no params = plain "Save" to the library.
 */

/** Longest name the schema accepts (mirrors customExerciseInputSchema). */
const MAX_NAME = 200

const one = (value?: string | string[]) => (typeof value === 'string' ? value : undefined)

export default async function NewExercisePage({
  searchParams,
}: {
  // Repeated params arrive as arrays at runtime; only single strings count.
  searchParams: Promise<{
    name?: string | string[]
    return?: string | string[]
    target?: string | string[]
  }>
}) {
  const t = await getTranslations('NewExercise')
  await requireUserId() // middleware also guards; defense-in-depth
  const params = await searchParams
  const name = (one(params.name) ?? '').slice(0, MAX_NAME)
  const rawReturn = one(params.return)
  const target = one(params.target)
  // A swap without a target has nowhere to land — degrade to library mode
  // rather than minting an instruction the logger would drop.
  const returnMode: ReturnMode =
    rawReturn === 'add' ? 'add' : rawReturn === 'swap' && target ? 'swap' : null

  // A route, not copy: hoisted so the strict i18n gate does not read it as
  // a translatable string inside the markup.
  const backFallback = returnMode !== null ? '/workout/new' : '/exercises'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        // Warm entries pop back to the logger (or library) with state intact;
        // the fallback only fires on a cold deep link.
        leading={<BackLink fallback={backFallback} />}
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-6">
        <CreateExerciseForm
          initialName={name}
          returnMode={returnMode}
          targetId={returnMode === 'swap' ? (target ?? null) : null}
        />
      </main>
    </div>
  )
}
