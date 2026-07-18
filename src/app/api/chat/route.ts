import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getWeightUnit } from '@/db/preferences'
import { COACH_MODEL_SETUP_HINT, resolveCoachModel } from '@/lib/coach/model'
import { createCoachMcpClient } from '@/lib/coach/mcp-bridge'
import { checkCoachRateLimit } from '@/lib/coach/rate-limit'
import { filterCoachTools, requiresApproval } from '@/lib/coach/tool-policy'

// Tool loops (up to 10 steps, each a model round trip) need more than the
// default function budget.
export const maxDuration = 60

// Bound the optional client-supplied context so it can't balloon the prompt.
const MAX_CONTEXT_LENGTH = 500

// Payload bounds: the step cap limits loop iterations, not input volume —
// without these, the daily request cap still admits 40 arbitrarily large
// gateway calls per user. Sized generously above real chat usage.
const MAX_MESSAGES = 60
const MAX_MESSAGES_BYTES = 120_000

function buildSystemPrompt(weightUnit: string, context?: string): string {
  const lines = [
    'You are the in-app strength coach for this workout tracker.',
    `The user logs weights in ${weightUnit}; always use that unit.`,
    'Keep answers terse — a few sentences, no filler.',
    'Ground every claim in tool results and cite the actual numbers you fetched.',
    'Program edits require user approval in the UI; before anything destructive-looking (removing days, exercises, or sets), state what you are about to change and ask the user to confirm.',
    'You cannot log workouts, delete programs, or change settings — say so if asked.',
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

  // Provider selection lives entirely in @/lib/coach/model — this route does
  // not know or care which vendor serves the tokens. Checked at request time
  // so a misconfigured deploy fails loudly, not mid-stream.
  const coachModel = resolveCoachModel()
  if (!coachModel) {
    return NextResponse.json({ error: COACH_MODEL_SETUP_HINT }, { status: 503 })
  }

  const rate = await checkCoachRateLimit(userId)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Daily coach limit reached (${rate.limit} messages). Try again tomorrow.` },
      { status: 429 },
    )
  }

  let body: { messages?: unknown; context?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: '`messages` must be a non-empty array' }, { status: 400 })
  }
  if (body.messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `Conversation too long — send at most the last ${MAX_MESSAGES} messages` },
      { status: 400 },
    )
  }
  if (JSON.stringify(body.messages).length > MAX_MESSAGES_BYTES) {
    return NextResponse.json({ error: 'Message payload too large' }, { status: 413 })
  }
  const messages = body.messages as UIMessage[]
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
      messages: await convertToModelMessages(messages, { tools }),
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

    return result.toUIMessageStreamResponse()
  } catch (error: unknown) {
    await closeClient()
    console.error('POST /api/chat failed', error)
    return NextResponse.json({ error: 'Coach request failed' }, { status: 500 })
  }
}
