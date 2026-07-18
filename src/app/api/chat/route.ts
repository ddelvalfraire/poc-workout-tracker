import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import { getWeightUnit } from '@/db/preferences'
import { MAX_BODY_BYTES, parseChatMessages } from '@/lib/coach/chat-request'
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

  // Bound the raw UTF-8 body BEFORE parsing: request.json() would buffer an
  // arbitrarily large payload first, and a characters-only check undercounts
  // multi-byte Unicode and ignores fields outside `messages`.
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request payload too large' }, { status: 413 })
  }
  let body: { messages?: unknown; context?: unknown }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    body = parsed as { messages?: unknown; context?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsedMessages = parseChatMessages(body.messages)
  if (!parsedMessages.ok) {
    return NextResponse.json({ error: parsedMessages.error }, { status: 400 })
  }
  const messages = parsedMessages.messages

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
