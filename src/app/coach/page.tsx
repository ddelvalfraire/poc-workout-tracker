import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { getProgramName } from '@/db/programs'
import { isCoachEnabled } from '@/lib/coach/access'
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
  // Gate: env allowlist OR the 'coach-access' PostHog flag (fail-closed).
  // 404, not 403 — the page simply doesn't exist for everyone else.
  if (!(await isCoachEnabled(userId))) notFound()
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
        leading={<NavDrawer />}
        programName={programName}
        initialMessages={initialMessages}
        clearAction={clearCoachChatAction}
      />
    </div>
  )
}
