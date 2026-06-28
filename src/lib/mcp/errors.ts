/**
 * A user-facing MCP tool error whose message is safe to return to the client
 * verbatim — e.g. "no userId resolved" or "workout not found". These are
 * expected, actionable conditions the agent should see.
 *
 * `errorResult` surfaces a `ToolError`'s message but logs and genericizes any
 * other (unexpected/internal) error, so a leaked DB error string or stack never
 * crosses the wire. Throw a plain `Error` for genuinely internal failures and a
 * `ToolError` only when the message is meant for the caller.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}
