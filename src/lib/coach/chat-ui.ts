/**
 * Pure helpers for the coach chat UI (/coach).
 *
 * Everything here is presentation logic with no React in it, so it can be
 * unit-tested directly: tool-name humanization, the one-line status labels
 * for auto-running reads, server-error parsing, context-param handling,
 * follow-up chips, and day-separator labeling.
 */

import type { UIMessage } from 'ai'
import type { Message } from '@/lib/message'
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
 * The auto-running tools (reads plus the drafting tools) that have a friendly
 * phrase pair in the catalog: present-progressive while the call runs, past
 * tense once it lands ("the coach did X").
 *
 * The MCP tool NAMES stay here as protocol identifiers — they are not copy
 * and never enter the catalog; only the phrases do, under
 * `CoachChat.toolRunning.*` / `CoachChat.toolDone.*`.
 */
export const LABELED_TOOLS = [
  'whoami',
  'list_workouts',
  'get_workout',
  'search_exercises',
  'get_last_performance',
  'get_weight_unit',
  'get_program',
  'list_programs',
  'get_program_stats',
  'list_custom_exercises',
  'preview_program_week',
  'list_proposals',
  'upsert_program',
  'propose_program_patches',
] as const

type LabeledTool = (typeof LABELED_TOOLS)[number]

const LABELED_TOOL_SET: ReadonlySet<string> = new Set(LABELED_TOOLS)

export type ToolStatusKey = `toolRunning.${LabeledTool}` | `toolDone.${LabeledTool}`

export type ToolPhase = 'running' | 'done' | 'failed'

/**
 * The status chip's phrase for a tool call ("Reading your program…" while
 * running, "Read your program" once done), or NULL when there is no phrase to
 * render: an unrecognised tool, or a failed call — "Searching exercises —
 * failed" reads wrong in either tense. Null is the graceful-degradation
 * signal, and the caller falls back to `humanizeToolName`, which turns the
 * protocol identifier into something readable without inventing copy.
 */
export function toolStatusMessage(
  toolName: string,
  phase: ToolPhase = 'running',
): Message<ToolStatusKey> | null {
  if (phase === 'failed' || !LABELED_TOOL_SET.has(toolName)) return null
  const tool = toolName as LabeledTool
  return { key: phase === 'running' ? `toolRunning.${tool}` : `toolDone.${tool}` }
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

/**
 * What went wrong, as a decision rather than a sentence. `server` carries the
 * server's OWN message verbatim (the 429 daily-cap copy especially) — that
 * text is produced elsewhere and is not a catalog key; `offline` and
 * `unknown` name a catalog message the caller renders.
 */
export type CoachError =
  | { kind: 'offline' }
  | { kind: 'server'; message: string }
  | { kind: 'paywall'; message: string; upgrade: string }
  | { kind: 'unknown' }

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
    return { kind: 'offline' }
  }
  try {
    const parsed: unknown = JSON.parse(message)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'string'
    ) {
      const obj = parsed as { error: string; upgrade?: unknown; quotaExhausted?: unknown }
      // The free-quota wall (402): carries an upgrade path so the UI shows a
      // plan CTA rather than a generic error banner.
      if (obj.quotaExhausted === true && typeof obj.upgrade === 'string') {
        return { kind: 'paywall', message: obj.error, upgrade: obj.upgrade }
      }
      return { kind: 'server', message: obj.error }
    }
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return { kind: 'unknown' }
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
  /** The drafted name, or null when the model sent none — the card renders
   *  its own untitled fallback rather than this module inventing one. */
  name: string | null
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
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null
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

/** Catalog keys for the empty-state starters and the follow-up chips. Both
 *  are copy the user SENDS, so they are translated like any other line — the
 *  model reads whatever language the user is shown. */
export type StarterKey =
  | 'starter.recap'
  | 'starter.swap'
  | 'starter.preview'
  | 'starter.program'
  | 'starter.nextBlock'

export type ChipKey =
  | 'chip.previewFirstWeek'
  | 'chip.whyNumbers'
  | 'chip.changeLog'
  | 'chip.nextWeek'
  | 'chip.focus'
  | 'chip.stalling'

/** The generic empty-state starters (no app context). */
export const DEFAULT_STARTERS: readonly Message<StarterKey>[] = [
  { key: 'starter.recap' },
  { key: 'starter.swap' },
  { key: 'starter.preview' },
]

/**
 * Empty-state starter prompts, seeded from app context when the entry point
 * carried one: arriving from a program page ("program:<id>") makes the
 * starters about THAT program by name; otherwise the generic examples.
 */
export function starterPrompts(programName: string | null | undefined): Message<StarterKey>[] {
  const name = programName?.trim()
  if (!name) return [...DEFAULT_STARTERS]
  return [
    { key: 'starter.program', values: { name } },
    { key: 'starter.nextBlock' },
    { key: 'starter.preview' },
  ]
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
export function chipsFor(lastTurn: UIMessage | undefined): Message<ChipKey>[] {
  if (!lastTurn || lastTurn.role !== 'assistant') return []
  const completed = completedToolNames(lastTurn)
  if (completed.includes('upsert_program')) {
    return [{ key: 'chip.previewFirstWeek' }, { key: 'chip.whyNumbers' }]
  }
  if (completed.some((name) => APPROVAL_TOOL_SET.has(name))) {
    return [{ key: 'chip.changeLog' }, { key: 'chip.nextWeek' }]
  }
  return [{ key: 'chip.focus' }, { key: 'chip.stalling' }]
}

/** Narrows a message's metadata to the createdAt epoch-ms stamp, if present.
 *  Messages persisted before timestamps existed simply have none — the
 *  separator logic treats that as "unknown day" and stays silent. */
export function messageTimestamp(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const createdAt = (metadata as Record<string, unknown>).createdAt
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : null
}

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
 *
 * The dated branches carry the Date itself and are formatted by ICU under the
 * reader's locale — a month name is not a catalog entry, and the fixed
 * English month table this used to keep was the localization bug.
 */
export type DaySeparatorKey = 'day.today' | 'day.yesterday' | 'day.date' | 'day.dateWithYear'

export function daySeparatorMessage(
  previousTs: number | null,
  currentTs: number | null,
  now: number,
): Message<DaySeparatorKey> | null {
  if (currentTs === null) return null
  const current = new Date(currentTs)
  const today = new Date(now)
  if (previousTs !== null) {
    if (sameLocalDay(new Date(previousTs), current)) return null
  } else if (sameLocalDay(current, today)) {
    return null
  }
  if (sameLocalDay(current, today)) return { key: 'day.today' }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameLocalDay(current, yesterday)) return { key: 'day.yesterday' }
  return {
    key: current.getFullYear() === today.getFullYear() ? 'day.date' : 'day.dateWithYear',
    values: { date: current },
  }
}
