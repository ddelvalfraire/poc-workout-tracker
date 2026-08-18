/**
 * Server-side tool policy for the AI coach (/api/chat).
 *
 * The coach reuses the full MCP tool registry (src/lib/mcp/tools.ts) over an
 * in-process bridge, so this allowlist is the ONLY thing standing between the
 * model and the write surface. Filtering happens server-side, before the tool
 * set is handed to the model — an excluded tool is never even visible to it.
 *
 * Four tiers:
 *  - reads: auto-execute, no approval;
 *  - program patch tools: allowed, but every call requires explicit user
 *    approval via the AI SDK approval flow;
 *  - drafting tools: auto-execute WITHOUT chat approval, because the db layer
 *    forces every coach-bridge create into a 'proposed' program the owner must
 *    explicitly Adopt/Decline on the program page — that banner IS the forced
 *    confirm ("we always force the user to confirm"), and an in-chat approval
 *    on top would be a double confirm;
 *  - everything else (workout writes, deletes, lifecycle moves, settings,
 *    custom-exercise writes): excluded entirely.
 *
 * Fifth shape, documented honestly: reads with an embedded DRAFT-TIER side
 * effect — currently only `get_volume_status`, whose weekly check can RAISE
 * a batch-patch proposal. It rides the read tier because the side effect is
 * inert by construction (db-layer inertness: a pending proposal changes no
 * plan until the owner's explicit confirm on the program page — the same
 * forced-confirm rationale as the drafting tier), so the coach still cannot
 * change anything by calling it.
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
  // Read tool with one deliberate side path: it runs the weekly volume check,
  // which can RAISE a batch proposal — but a proposal is inert until the
  // owner's confirm, so the coach still can't change anything.
  'get_volume_status',
  'list_custom_exercises',
  'preview_program_week',
  // Read-only by construction (the log has no write tool): the coach can
  // answer "what changed on my program?" without any approval gate.
  'list_program_changes',
  // Read-only by construction too — goals have no MCP write tools in v1, so
  // the coach can reference targets/streaks freely, never set them.
  'list_goals',
  // The curated library index — read-only. adopt_template stays EXCLUDED:
  // it lands a draft directly (no 'proposed' gate), so the coach's route to
  // a template remains upsert_program → proposed → the owner's adopt.
  'list_templates',
  // Read-only by construction: adopt/confirm/decline are owner-only server
  // actions, so listing outstanding proposals can never resolve one.
  'list_proposals',
  // Notes-v2 browser read — the coach's window into the user's notes across
  // every anchor. The note WRITE tools stay excluded (see below).
  'list_notes',
] as const

/** Granular program patch tools — allowed, but gated behind user approval. */
export const COACH_APPROVAL_TOOLS = [
  'add_program_day',
  'update_program_day',
  'remove_program_day',
  'move_program_day',
  'add_program_exercise',
  'update_program_exercise',
  // The load-stripping movement swap — approval-gated like every patch op;
  // the swap itself clears the old movement's loads server-side.
  'substitute_program_exercise',
  'remove_program_exercise',
  'move_program_exercise',
  'add_program_set',
  'update_program_set',
  'remove_program_set',
  'move_program_set',
  'set_program_set_override',
  'remove_program_set_override',
  'set_program_autoregulation',
  'set_program_deload_policy',
  // The diet phase reframes stall verdicts and gates the auto-backoff into
  // a proposal — a behavior change the owner must approve like any policy.
  'set_program_diet_phase',
  // The overshoot policy changes how goals are scored across the whole
  // program — a behavior change the owner must approve like any policy.
  'set_program_overshoot_policy',
  'set_program_plan_sync',
  // A TM change rewrites every derived load on the exercise — a mutation the
  // owner must approve like any other patch op.
  'set_training_max',
] as const

/**
 * Program-drafting tools — allowed WITHOUT the chat approval gate. Safe by
 * construction, not by trust: when the caller is the coach bridge (clientId
 * 'coach-chat'), the db layer forces creates to status='proposed' +
 * authorActor='coach' and scopes replaces to the coach's own still-proposed
 * drafts (src/db/programs.ts). Adoption stays owner-only on the program page.
 */
export const COACH_DRAFT_TOOLS = [
  'upsert_program',
  // Same safe-by-construction rationale: the db layer stores a batch of
  // patch ops as an INERT pending proposal (db/patch-proposals.ts) — nothing
  // applies until the owner's single combined confirm on the program page,
  // so an in-chat approval on top would be a double confirm.
  'propose_program_patches',
] as const

/**
 * Tools the coach must never see. Kept as an explicit list (not just "whatever
 * isn't allowed") so the policy test can assert every one of these is excluded
 * by `filterCoachTools` and absent from the allowlists. A tool added to the
 * MCP registry later is excluded by default either way, because filtering is
 * allowlist-based. Adopt/decline are deliberately not even MCP tools — they
 * are owner-only server actions, so there is nothing here to exclude.
 */
export const COACH_EXCLUDED_TOOLS = [
  'ping',
  'delete_program',
  'restart_program',
  'set_program_status',
  'instantiate_program_day',
  'create_workout',
  'update_workout',
  'delete_workout',
  'set_workout_meta',
  'set_exercise_meta',
  // Identity notes are the LIFTER's own setup memory ("seat pin 4") — a
  // coach silently rewriting them would be imposing, not proposing. External
  // MCP agents keep the tool; the coach reads notes via the read tools.
  'set_exercise_note',
  // Notes-v2 writes: same reasoning as set_exercise_note — the user's notes
  // are their own words, and these tools stamp author='user' unconditionally
  // (no author arg), so a coach-actor call would FORGE user authorship. The
  // coach's write path is the future coach-author arm (avatar comments),
  // gated behind the coach surface — never these tools. External MCP agents
  // keep them (they act as the user).
  'create_note',
  'update_note',
  'delete_note',
  'update_set',
  'add_set',
  'remove_set',
  'create_custom_exercise',
  'update_custom_exercise',
  'set_weight_unit',
  // Lands a DRAFT directly (no 'proposed' gate) — the coach's route to a
  // template is upsert_program → proposed → the owner's adopt.
  'adopt_template',
] as const

export const COACH_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...COACH_READ_TOOLS,
  ...COACH_APPROVAL_TOOLS,
  ...COACH_DRAFT_TOOLS,
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
