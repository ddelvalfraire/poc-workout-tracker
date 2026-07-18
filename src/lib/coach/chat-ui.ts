/**
 * Pure helpers for the coach chat UI (/coach).
 *
 * Everything here is presentation logic with no React in it, so it can be
 * unit-tested directly: tool-name humanization, the one-line status labels
 * for auto-running reads, server-error parsing, and context-param handling.
 */

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
 * Friendly present-progressive labels for the auto-running read tools, keyed
 * by MCP tool name. Anything unknown falls back to the humanized name so a
 * newly allowlisted tool degrades gracefully instead of rendering raw
 * snake_case.
 */
const READ_TOOL_LABELS: Record<string, string> = {
  whoami: 'Checking your account',
  list_workouts: 'Looking through your workouts',
  get_workout: 'Reading a workout',
  search_exercises: 'Searching exercises',
  get_last_performance: 'Checking your last numbers',
  get_weight_unit: 'Checking your units',
  get_program: 'Reading your program',
  list_programs: 'Listing your programs',
  get_program_stats: 'Crunching program stats',
  list_custom_exercises: 'Checking your custom exercises',
  preview_program_week: 'Previewing the week',
}

/** One-line status chip text for a tool call ("Reading your program…"). */
export function toolStatusLabel(toolName: string): string {
  return READ_TOOL_LABELS[toolName] ?? humanizeToolName(toolName)
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
