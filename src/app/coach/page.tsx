import { redirect } from 'next/navigation'
import { requireUserId } from '@/lib/auth/auth'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { getProgramName } from '@/db/programs'
import { coachAccess } from '@/lib/coach/access'
import { freeCoachMessagesUsed, FREE_COACH_MESSAGE_QUOTA } from '@/lib/coach/quota'
import { loadCoachChat } from '@/lib/coach/chat-store'
import { parseContextParam, programIdFromContext } from '@/lib/coach/chat-ui'
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
  // The coach is released. Entitled users are unlimited (no counter);
  // unentitled users get a free taste (FREE_COACH_MESSAGE_QUOTA messages) and
  // are sent to the paywall only once it is used up — so the taste is
  // reachable. Access is enforced server-side in /api/chat regardless.
  const entitled = (await coachAccess(userId)) === 'available'
  let freeMessagesRemaining: number | null = null
  if (!entitled) {
    const used = await freeCoachMessagesUsed(userId)
    if (used >= FREE_COACH_MESSAGE_QUOTA) redirect('/settings/plan')
    freeMessagesRemaining = FREE_COACH_MESSAGE_QUOTA - used
  }
  const sp = await searchParams
  const context = parseContextParam(sp.context)
  // Program context personalizes the empty-state starters. Deliberately a
  // cheap name-only read (single indexed row), not getProgramDetail — the
  // starters need a title, nothing else; missing/foreign ids fall back to
  // the generic examples.
  const contextProgramId = programIdFromContext(context)
  const programName = contextProgramId
    ? ((await getProgramName(userId, contextProgramId)) ?? undefined)
    : undefined
  const initialMessages = await loadCoachChat(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* CoachChat owns the AppHeader so "New chat" can live in the trailing
          slot (it needs the client-side message state to clear). */}
      <CoachChat
        context={context}
        leading={<NavDrawer userId={userId} />}
        programName={programName}
        initialMessages={initialMessages}
        clearAction={clearCoachChatAction}
        freeMessagesRemaining={freeMessagesRemaining}
      />
    </div>
  )
}
