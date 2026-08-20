import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
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
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <ProgramBuilder unit={unit} />
      </main>
    </div>
  )
}
