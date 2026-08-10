/**
 * Pure helpers for the coach chat UI (/coach).
 *
 * Everything here is presentation logic with no React in it, so it can be
 * unit-tested directly: tool-name humanization, the one-line status labels
 * for auto-running reads, server-error parsing, context-param handling,
 * follow-up chips, and day-separator labeling.
 */

import type { UIMessage } from 'ai'
import { COACH_APPROVAL_TOOLS } from './tool-policy'

/** Mirrors the server bound in /api/chat — no point sending more. */
const MAX_CONTEXT_LENGTH = 500

/** 'add_program_exercise' → 'Add program exercise'. */
export function humanizeToolName(toolName: string): string {
  const words = toolName.split('_').filter(Boolean)
  if (words.length === 0) return toolName
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/**
 * Friendly labels for the auto-running tools (reads plus the drafting tool),
 * keyed by MCP tool name: present-progressive while the call runs, past
 * tense once it lands ("the coach did X"). Anything unknown falls back to
 * the humanized name so a newly allowlisted tool degrades gracefully instead
 * of rendering raw snake_case.
 */
const AUTO_TOOL_LABELS: Record<string, { running: string; done: string }> = {
  whoami: { running: 'Checking your account', done: 'Checked your account' },
  list_workouts: { running: 'Looking through your workouts', done: 'Looked through your workouts' },
  get_workout: { running: 'Reading a workout', done: 'Read a workout' },
  search_exercises: { running: 'Searching exercises', done: 'Searched exercises' },
  get_last_performance: { running: 'Checking your last numbers', done: 'Checked your last numbers' },
  get_weight_unit: { running: 'Checking your units', done: 'Checked your units' },
  get_program: { running: 'Reading your program', done: 'Read your program' },
  list_programs: { running: 'Listing your programs', done: 'Listed your programs' },
  get_program_stats: { running: 'Crunching program stats', done: 'Crunched program stats' },
  list_custom_exercises: {
    running: 'Checking your custom exercises',
    done: 'Checked your custom exercises',
  },
  preview_program_week: { running: 'Previewing the week', done: 'Previewed the week' },
  list_proposals: {
    running: 'Checking outstanding proposals',
    done: 'Checked outstanding proposals',
  },
  upsert_program: { running: 'Drafting your program', done: 'Drafted a program' },
  propose_program_patches: { running: 'Proposing plan changes', done: 'Proposed plan changes' },
}

export type ToolPhase = 'running' | 'done' | 'failed'

/** One-line status chip text for a tool call ("Reading your program…" while
 *  running, "Read your program" once done). Failed calls use the neutral
 *  humanized name — "Searching exercises — failed" reads wrong in either
 *  tense. */
export function toolStatusLabel(toolName: string, phase: ToolPhase = 'running'): string {
  if (phase === 'failed') return humanizeToolName(toolName)
  return AUTO_TOOL_LABELS[toolName]?.[phase] ?? humanizeToolName(toolName)
}

/** Longest input detail worth appending to a one-line chip. */
const DETAIL_MAX_LENGTH = 40

/**
 * Compact, safe input detail for the status chip ("Searched exercises ·
 * 'incline press'"). Only whitelisted string fields ever surface — tool
 * inputs are model-authored, so nothing is rendered wholesale.
 */
export function toolInputDetail(toolName: string, input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const args = input as Record<string, unknown>
  const value =
    toolName === 'search_exercises' ? args.search : toolName === 'upsert_program' ? args.name : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > DETAIL_MAX_LENGTH ? `${trimmed.slice(0, DETAIL_MAX_LENGTH - 1)}…` : trimmed
}

/** How close to the bottom (px) still counts as "following the stream". */
export const PIN_THRESHOLD_PX = 120

/**
 * Whether a scroll position is pinned to the bottom of the page — the chat
 * auto-scrolls on new content only while pinned, so a user who scrolled up
 * to re-read is never yanked back down.
 */
export function isPinnedToBottom(
  scrollHeight: number,
  viewportHeight: number,
  scrollY: number,
): boolean {
  return scrollHeight - viewportHeight - scrollY <= PIN_THRESHOLD_PX
}

export interface CoachError {
  kind: 'offline' | 'server'
  message: string
}

const OFFLINE_MESSAGE = 'Coach needs a connection.'

/**
 * Network-level fetch failures (no HTTP response at all). The transport
 * rethrows the browser's TypeError, whose message varies by engine:
 * Chromium "Failed to fetch", WebKit "Load failed", Gecko "NetworkError…".
 */
const NETWORK_ERROR_PATTERNS = ['failed to fetch', 'load failed', 'networkerror']

/**
 * Maps the error thrown by the chat transport to something showable.
 *
 * The server responds to non-2xx with JSON `{ error }` and the transport
 * throws `new Error(await response.text())`, so the body arrives verbatim in
 * `error.message` — surface the server's own message (the 429 daily-cap copy
 * especially). Network failures become the offline state instead.
 */
export function parseCoachError(error: unknown): CoachError {
  const message = error instanceof Error ? error.message : ''
  const lowered = message.toLowerCase()
  if (NETWORK_ERROR_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { kind: 'offline', message: OFFLINE_MESSAGE }
  }
  try {
    const parsed: unknown = JSON.parse(message)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'string'
    ) {
      return { kind: 'server', message: (parsed as { error: string }).error }
    }
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return { kind: 'server', message: 'Something went wrong. Try again.' }
}

/**
 * Compact one-value-per-line rendering of a tool call's input args for the
 * approval card. Objects flatten one level to `key: value`; scalars and
 * anything unexpected stringify as-is.
 */
export function formatToolInput(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object' || Array.isArray(input)) return JSON.stringify(input)
  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n')
}

/** What the chat proposal card renders for a coach-drafted program. */
export interface ProgramProposal {
  programId: string
  name: string
  icon: string | null
  description: string | null
  dayCount: number
  weekCount: number | null
}

/** Same UUID shape assertProgramIdShape guards server-side — duplicated here
 *  (client bundle) so tool output can never smuggle an arbitrary string into
 *  the card's /programs/{id} href. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * Digs the tool's JSON payload out of whatever shape the transport delivered:
 * the raw MCP CallToolResult envelope (`{ content: [{ type:'text', text }] }`),
 * an already-parsed payload object, or a bare JSON string. `isError` results
 * and anything unrecognizable collapse to null — the caller degrades to the
 * plain status chip.
 */
function parseToolOutputPayload(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'string') return tryParseJson(output)
  const record = asRecord(output)
  if (!record || record.isError === true) return null
  if (Array.isArray(record.content)) {
    const text = record.content.map(asRecord).find((item) => item?.type === 'text')?.text
    return typeof text === 'string' ? tryParseJson(text) : null
  }
  return record
}

/**
 * Builds the chat proposal card's data from a completed `upsert_program` tool
 * part: identity (programId, status 'proposed') from the tool OUTPUT — the
 * server's word on what was actually saved — and presentation (name, icon,
 * description, day/week counts) from the tool INPUT the model drafted.
 * Null for anything that isn't a verified proposal (owner-path upserts,
 * errors, malformed output), which falls back to the generic tool chip.
 */
export function extractProgramProposal(input: unknown, output: unknown): ProgramProposal | null {
  const payload = parseToolOutputPayload(output)
  if (!payload || payload.status !== 'proposed') return null
  const { programId } = payload
  if (typeof programId !== 'string' || !UUID_RE.test(programId)) return null

  const args = asRecord(input) ?? {}
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'New program'
  const icon = typeof args.icon === 'string' && args.icon.trim() ? args.icon.trim() : null
  const description =
    typeof args.description === 'string' && args.description.trim()
      ? args.description.trim()
      : null
  const dayCount = Array.isArray(args.days) ? args.days.length : 0
  const weekCount =
    typeof args.mesocycleWeeks === 'number' &&
    Number.isInteger(args.mesocycleWeeks) &&
    args.mesocycleWeeks > 0
      ? args.mesocycleWeeks
      : null
  return { programId, name, icon, description, dayCount, weekCount }
}

/**
 * Normalizes the `?context=` search param into the request-body context
 * string. Arrays (repeated params) take the first value; blank or missing
 * collapses to undefined; length is capped to the server's own bound.
 */
export function parseContextParam(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value
  // Control characters collapse to spaces: ?context= is a shareable URL, and
  // embedded newlines in a crafted link could fabricate extra lines inside
  // the system prompt. (The server strips them too — this is not the boundary.)
  const trimmed = single?.replace(/[\u0000-\u001F\u007F]+/g, " ").trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, MAX_CONTEXT_LENGTH)
}

/**
 * Extracts the program id from a "program:<uuid>" context string. UUID-shape
 * checked (same guard as the proposal card's href) because the context param
 * rides a shareable URL — an arbitrary string must never reach a db lookup.
 */
export function programIdFromContext(context: string | undefined): string | null {
  if (!context?.startsWith('program:')) return null
  const id = context.slice('program:'.length).trim()
  return UUID_RE.test(id) ? id : null
}

/** The generic empty-state starters (no app context). */
export const DEFAULT_STARTERS = [
  'What did I train this week?',
  "Swap tomorrow's pressing for more volume",
  'Preview next week',
] as const

/**
 * Empty-state starter prompts, seeded from app context when the entry point
 * carried one: arriving from a program page ("program:<id>") makes the
 * starters about THAT program by name; otherwise the generic examples.
 */
export function starterPrompts(programName: string | null | undefined): string[] {
  const name = programName?.trim()
  if (!name) return [...DEFAULT_STARTERS]
  return [`How's ${name} going?`, 'Plan my next block', 'Preview next week']
}

/** Structural view of a tool part — enough for the chip heuristics without
 *  re-deriving the AI SDK's full ToolUIPart union. */
interface ToolPartShape {
  type: string
  state?: string
  toolName?: string
}

const APPROVAL_TOOL_SET: ReadonlySet<string> = new Set(COACH_APPROVAL_TOOLS)

function completedToolNames(message: UIMessage): string[] {
  const names: string[] = []
  for (const part of message.parts) {
    const shape = part as ToolPartShape
    const isTool = shape.type === 'dynamic-tool' || shape.type.startsWith('tool-')
    if (!isTool || shape.state !== 'output-available') continue
    names.push(shape.type === 'dynamic-tool' ? (shape.toolName ?? '') : shape.type.slice('tool-'.length))
  }
  return names
}

/**
 * Follow-up suggestion chips for a completed assistant turn. Static
 * heuristics on what the turn actually did, most-specific first:
 * drafted a proposal → route the user into reviewing it; applied a program
 * change → surface the audit trail; otherwise generic coaching openers.
 * Empty when the last turn isn't a finished assistant message — the caller
 * additionally gates on stream status and pending approvals.
 */
export function chipsFor(lastTurn: UIMessage | undefined): string[] {
  if (!lastTurn || lastTurn.role !== 'assistant') return []
  const completed = completedToolNames(lastTurn)
  if (completed.includes('upsert_program')) return ['Preview week 1', 'Why these numbers?']
  if (completed.some((name) => APPROVAL_TOOL_SET.has(name))) {
    return ['Show the change log', 'Preview next week']
  }
  return ['What should I focus on?', 'Any signs of stalling?']
}

/** Narrows a message's metadata to the createdAt epoch-ms stamp, if present.
 *  Messages persisted before timestamps existed simply have none — the
 *  separator logic treats that as "unknown day" and stays silent. */
export function messageTimestamp(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const createdAt = (metadata as Record<string, unknown>).createdAt
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : null
}

/** Fixed English month labels — deterministic across machine locales. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Local-calendar-day equality (the separators are about the user's wall clock). */
function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * The divider label to render ABOVE a message, or null for none.
 * Rules:
 * - no timestamp on the current message → null (honest fallback: threads
 *   persisted before timestamps existed get no separators);
 * - consecutive messages on the same local calendar day → null;
 * - first stamped message → labeled only when it's from a day before today
 *   (a "Today" header over a fresh chat is noise);
 * - label relative to `now`: "Today", "Yesterday", else "Jul 12" (with the
 *   year appended when it differs from now's).
 */
export function daySeparatorLabel(
  previousTs: number | null,
  currentTs: number | null,
  now: number,
): string | null {
  if (currentTs === null) return null
  const current = new Date(currentTs)
  const today = new Date(now)
  if (previousTs !== null) {
    if (sameLocalDay(new Date(previousTs), current)) return null
  } else if (sameLocalDay(current, today)) {
    return null
  }
  if (sameLocalDay(current, today)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameLocalDay(current, yesterday)) return 'Yesterday'
  const base = `${MONTHS[current.getMonth()]} ${current.getDate()}`
  return current.getFullYear() === today.getFullYear()
    ? base
    : `${base}, ${current.getFullYear()}`
}
