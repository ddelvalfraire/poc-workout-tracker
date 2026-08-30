import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/nav/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ProgramBuilder } from './program-builder'
import { getTranslations } from 'next-intl/server'

export default async function NewProgramPage() {
  const t = await getTranslations('ProgramNew')
  const tCommon = await getTranslations('Common')
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const unit = await getWeightUnit(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        trailing={
          <Link href="/programs" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            {tCommon('close')}
          </Link>
        }
      />
      {/* The editor widens at the editor-pane breakpoint (840px, tokens.ts):
          a comfortable centred column, not the three-pane editor — that is
          later work.

          `flex flex-col` is load-bearing, not cosmetic: it is what lets the
          builder's sticky Save bar take `mt-auto` and sit flush with the
          bottom on short content. See workout-logger.tsx's <main> comment —
          `sticky bottom-0` alone only ever pulls a box UP off the fold. The
          empty create state is the shortest content this screen ever has. */}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 min-[840px]:max-w-2xl">
        <ProgramBuilder unit={unit} />
      </main>
    </div>
  )
}
