import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getWeightUnit } from '@/db/preferences'
import { isCoachUser } from '@/lib/coach/access'
import {
  MAX_BODY_BYTES,
  MAX_MESSAGES,
  parseChatMessage,
  parseChatMessages,
} from '@/lib/coach/chat-request'
import { reconcileThread } from '@/lib/coach/chat-thread'
import { loadCoachChat, saveCoachChat } from '@/lib/coach/chat-store'
import { COACH_MODEL_SETUP_HINT, resolveCoachModel } from '@/lib/coach/model'
import { createCoachMcpClient } from '@/lib/coach/mcp-bridge'
import { checkCoachRateLimit } from '@/lib/coach/rate-limit'
import { filterCoachTools, requiresApproval } from '@/lib/coach/tool-policy'

// Tool loops (up to 10 steps, each a model round trip) need more than the
// default function budget.
export const maxDuration = 60

// Bound the optional client-supplied context so it can't balloon the prompt.
const MAX_CONTEXT_LENGTH = 500

function buildSystemPrompt(weightUnit: string, context?: string): string {
  const lines = [
    'You are the in-app strength coach for this workout tracker.',
    `The user logs weights in ${weightUnit}; always use that unit.`,
    'Keep answers terse — a few sentences, no filler.',
    'Ground every claim in tool results and cite the actual numbers you fetched.',
    'Program edits require user approval in the UI; before anything destructive-looking (removing days, exercises, or sets), state what you are about to change and ask the user to confirm.',
    'You can draft a NEW program with upsert_program. First gather: goal, experience level, days per week, available equipment, and session length. Use search_exercises to find real exercise ids before referencing them. Draft the complete program in one call: name, a short description, an icon emoji, days with exercises, sets, rep ranges, and a progression scheme.',
    'Anything you draft is saved as a PROPOSAL: always tell the user it is a proposal they must review and adopt on the program page before it does anything. Never claim a drafted program is active or applied. You can revise your own still-proposed draft by calling upsert_program again with its id.',
    'You cannot log workouts, delete programs, activate or adopt programs, or change settings — say so if asked.',
  ]
  if (context) lines.push(`Current app context: ${context}`)
  return lines.join('\n')
}

/**
 * POST /api/chat — the AI coach.
 *
 * Streams a UI-message response from a gateway model that can call the app's
 * MCP tools through an in-memory bridge (see @/lib/coach/mcp-bridge). The tool
 * set is filtered server-side to the coach allowlist (@/lib/coach/tool-policy);
 * allowed program mutations additionally go through the AI SDK user-approval
 * flow. Clerk-gated like the other API routes (middleware + explicit check).
 */
export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Dev gate: the coach is allowlist-only while in development. Server-side
  // like every other guard — hiding the UI entry points is cosmetics.
  if (!isCoachUser(userId)) {
    return NextResponse.json({ error: 'The coach is not enabled for this account.' }, { status: 403 })
  }

  // Provider selection lives entirely in @/lib/coach/model — this route does
  // not know or care which vendor serves the tokens. Checked at request time
  // so a misconfigured deploy fails loudly, not mid-stream.
  const coachModel = resolveCoachModel()
  if (!coachModel) {
    return NextResponse.json({ error: COACH_MODEL_SETUP_HINT }, { status: 503 })
  }

  // Bound the raw UTF-8 body BEFORE parsing: request.json() would buffer an
  // arbitrarily large payload first, and a characters-only check undercounts
  // multi-byte Unicode and ignores fields outside `messages`.
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request payload too large' }, { status: 413 })
  }
  let body: { messages?: unknown; message?: unknown; context?: unknown }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    body = parsed as { messages?: unknown; message?: unknown; context?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Two accepted payload shapes:
  // - `{ message }` (current): the client sends only the tail message and the
  //   server reconciles it against the stored thread — full threads carry
  //   every tool input/output and outgrow the body caps after tool-heavy turns.
  // - `{ messages }` (DEPRECATED): the full-thread payload of pre-deploy
  //   clients (an open tab from before the change); validated and used as-is.
  //   Remove once those tabs have cycled.
  let messages: UIMessage[]
  if (Array.isArray(body.messages)) {
    const parsedMessages = parseChatMessages(body.messages)
    if (!parsedMessages.ok) {
      return NextResponse.json({ error: parsedMessages.error }, { status: 400 })
    }
    messages = parsedMessages.messages
  } else {
    const parsedTail = parseChatMessage(body.message)
    if (!parsedTail.ok) {
      return NextResponse.json({ error: parsedTail.error }, { status: 400 })
    }
    const reconciled = reconcileThread(await loadCoachChat(userId), parsedTail.message)
    if (!reconciled.ok) {
      return NextResponse.json({ error: reconciled.error }, { status: 400 })
    }
    messages = reconciled.messages
  }

  // Quota is charged LAST among the guards: a rejected request must never
  // consume the user's daily allowance.
  const rate = await checkCoachRateLimit(userId)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Daily coach limit reached (${rate.limit} messages). Try again tomorrow.` },
      { status: 429 },
    )
  }
  const context =
    typeof body.context === 'string' && body.context.trim()
      ? body.context.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, MAX_CONTEXT_LENGTH)
      : undefined

  const weightUnit = await getWeightUnit(userId)
  const client = await createCoachMcpClient(userId)
  const closeClient = () =>
    client.close().catch((error: unknown) => console.error('[coach] MCP close failed', error))

  try {
    const tools = filterCoachTools(await client.tools())

    const result = streamText({
      model: coachModel.model,
      system: buildSystemPrompt(weightUnit, context),
      // Model window: clamp by slicing, not rejecting — the thread is the
      // server's own store plus one message, so "too long" is not user error.
      messages: await convertToModelMessages(messages.slice(-MAX_MESSAGES), { tools }),
      tools,
      toolApproval: ({ toolCall }) =>
        requiresApproval(toolCall.toolName) ? 'user-approval' : undefined,
      stopWhen: stepCountIs(10),
      onFinish: closeClient,
      onAbort: closeClient,
      onError: (error) => {
        console.error('[coach] stream error', error)
        void closeClient()
      },
    })

    // Persist the completed turn (original messages + the assistant's reply)
    // so /coach can reload the thread; fire-and-forget, fails soft in-store.
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: ({ messages: finalMessages }) => {
        void saveCoachChat(userId, finalMessages)
      },
    })
  } catch (error: unknown) {
    await closeClient()
    console.error('POST /api/chat failed', error)
    return NextResponse.json({ error: 'Coach request failed' }, { status: 500 })
  }
}
