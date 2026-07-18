/**
 * Server-side tool policy for the AI coach (/api/chat).
 *
 * The coach reuses the full MCP tool registry (src/lib/mcp/tools.ts) over an
 * in-process bridge, so this allowlist is the ONLY thing standing between the
 * model and the write surface. Filtering happens server-side, before the tool
 * set is handed to the model — an excluded tool is never even visible to it.
 *
 * Three tiers:
 *  - reads: auto-execute, no approval;
 *  - program patch tools: allowed, but every call requires explicit user
 *    approval via the AI SDK approval flow;
 *  - everything else (bulk program writes, workout writes, settings,
 *    custom-exercise writes): excluded entirely.
 */

/** Read-only tools the coach may call freely. */
export const COACH_READ_TOOLS = [
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
  // Read-only by construction (the log has no write tool): the coach can
  // answer "what changed on my program?" without any approval gate.
  'list_program_changes',
] as const

/** Granular program patch tools — allowed, but gated behind user approval. */
export const COACH_APPROVAL_TOOLS = [
  'add_program_day',
  'update_program_day',
  'remove_program_day',
  'move_program_day',
  'add_program_exercise',
  'update_program_exercise',
  'remove_program_exercise',
  'move_program_exercise',
  'add_program_set',
  'update_program_set',
  'remove_program_set',
  'move_program_set',
  'set_program_set_override',
  'remove_program_set_override',
] as const

/**
 * Tools the coach must never see. Kept as an explicit list (not just "whatever
 * isn't allowed") so the policy test can assert every one of these is excluded
 * by `filterCoachTools` and absent from the allowlists. A tool added to the
 * MCP registry later is excluded by default either way, because filtering is
 * allowlist-based.
 */
export const COACH_EXCLUDED_TOOLS = [
  'ping',
  'upsert_program',
  'delete_program',
  'restart_program',
  'set_program_status',
  'instantiate_program_day',
  'create_workout',
  'update_workout',
  'delete_workout',
  'set_workout_meta',
  'update_set',
  'add_set',
  'remove_set',
  'create_custom_exercise',
  'update_custom_exercise',
  'set_weight_unit',
] as const

export const COACH_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...COACH_READ_TOOLS,
  ...COACH_APPROVAL_TOOLS,
])

const APPROVAL_SET: ReadonlySet<string> = new Set(COACH_APPROVAL_TOOLS)

/** Whether a tool call must go through the user-approval flow. */
export function requiresApproval(toolName: string): boolean {
  return APPROVAL_SET.has(toolName)
}

/**
 * Filters an MCP tool set down to the coach allowlist. Allowlist-based on
 * purpose: tools added to the registry later are excluded until explicitly
 * admitted here.
 */
export function filterCoachTools<T>(tools: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => COACH_ALLOWED_TOOLS.has(name)))
}
