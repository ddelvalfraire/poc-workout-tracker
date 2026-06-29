import { ToolError } from './errors'

/** Matches a v4-ish UUID (the shape Postgres `uuid` columns accept). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Guards a workout id against the database. A malformed (non-UUID) id can't match
 * any row, and passing one to a `uuid` column makes Postgres raise an invalid-input
 * cast error — which `errorResult` would genericize to "MCP tool failed", hiding the
 * real problem from the agent. Throwing a `ToolError` here surfaces a clean
 * "not found" instead, before any DB call.
 */
export function assertWorkoutIdShape(id: string): void {
  if (!UUID_RE.test(id)) throw new ToolError(`Workout ${id} not found`)
}
