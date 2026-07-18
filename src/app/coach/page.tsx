import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseContextParam } from '@/lib/coach/chat-ui'
import { CoachChat } from './coach-chat'

/**
 * /coach — the AI coach chat. Entry points pass app context via
 * `?context=` (e.g. "program:<id>" from a program detail page); the client
 * forwards it in the POST body so the model knows where the user came from.
 */
export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string | string[] }>
}) {
  await requireUserId() // middleware also guards; this is defense-in-depth
  const sp = await searchParams
  const context = parseContextParam(sp.context)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Coach"
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <CoachChat context={context} />
    </div>
  )
}
