import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isCoachUser } from '@/lib/coach/access'
import { loadCoachChat } from '@/lib/coach/chat-store'
import { parseContextParam } from '@/lib/coach/chat-ui'
import { clearCoachChatAction } from './actions'
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
  const userId = await requireUserId() // middleware also guards; this is defense-in-depth
  // Dev gate: allowlist-only while the coach is in development. 404, not
  // 403 — the page simply doesn't exist for everyone else.
  if (!isCoachUser(userId)) notFound()
  const sp = await searchParams
  const context = parseContextParam(sp.context)
  const initialMessages = await loadCoachChat(userId)

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
      <CoachChat
        context={context}
        initialMessages={initialMessages}
        clearAction={clearCoachChatAction}
      />
    </div>
  )
}
