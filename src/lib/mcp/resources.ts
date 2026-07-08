import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveUserId } from './resolve-user'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { assertProgramIdShape } from './program-id'
import { buildWorkoutPayload } from './read-tools'
import { buildProgramPayload } from './program-tools'
import { getWorkoutDetail } from '@/db/workouts'
import { getProgramDetail, getProgramDayDetail } from '@/db/programs'
import { getWeightUnit, getBodyweightKg } from '@/db/preferences'

/**
 * Registers read-only MCP resources — the addressable, URI-referenced surface of
 * the agent server.
 *
 * `workout://{id}` is the resource twin of the `get_workout` tool: it returns the
 * exact same payload (via the shared `buildWorkoutPayload`), just fetched by URI
 * instead of a tool call. A resource URI carries no `userId`, so the user is the
 * env default (`MCP_DEV_USER_ID`) resolved through `resolveUserId`.
 *
 * Resources have no `isError` envelope, so the read callback signals failure by
 * *throwing*. We mirror the tools' leak-safe split: a `ToolError` (not-found, no
 * user) propagates verbatim because its message is meant for the caller; any
 * other (internal/DB) error is logged server-side and replaced with a generic
 * message so internals never cross the wire.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    'workout',
    new ResourceTemplate('workout://{id}', { list: undefined }),
    {
      title: 'Workout',
      description:
        "A single workout (env-default user) with its exercises, sets in the user's unit, and a per-exercise estimated 1RM. Same shape as the get_workout tool.",
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      // URI template variables arrive as string | string[]; `{id}` is single.
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      try {
        if (!id) throw new ToolError('workout id is required')
        // A resource URI carries no userId arg, so the authenticated user (from
        // the token, via extra) decides whose workout this is; dev falls back to
        // MCP_DEV_USER_ID inside resolveUserId.
        const resolved = resolveUserId(extra)
        assertWorkoutIdShape(id)
        const workout = await getWorkoutDetail(resolved, id)
        if (!workout) {
          throw new ToolError(`Workout ${id} not found for user ${resolved}`)
        }
        // Bodyweight fetched once per request, like the unit — the load basis
        // for bodyweight-type exercises' estimated 1RM (same as get_workout).
        const [unit, bodyweightKg] = await Promise.all([
          getWeightUnit(resolved),
          getBodyweightKg(resolved),
        ])
        // Overlay the program day prescription when this workout was instantiated.
        const programDay = workout.programDayId
          ? await getProgramDayDetail(resolved, workout.programDayId)
          : null
        const payload = buildWorkoutPayload(
          workout,
          resolved,
          unit,
          bodyweightKg,
          programDay ?? undefined,
        )
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) }],
        }
      } catch (error: unknown) {
        if (error instanceof ToolError) throw error // actionable message, safe to surface
        console.error('MCP resource error:', error)
        throw new Error('MCP resource read failed') // genericize internals
      }
    },
  )

  server.registerResource(
    'program',
    new ResourceTemplate('program://{id}', { list: undefined }),
    {
      title: 'Program',
      description:
        "A single training program (env-default user) with its days, exercises, and sets — suggested loads in the user's unit, technique/progression JSONB in kg. Same shape as the get_program tool.",
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      // URI template variables arrive as string | string[]; `{id}` is single.
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      try {
        if (!id) throw new ToolError('program id is required')
        const resolved = resolveUserId(extra)
        assertProgramIdShape(id)
        const program = await getProgramDetail(resolved, id)
        if (!program) {
          throw new ToolError(`Program ${id} not found for user ${resolved}`)
        }
        const unit = await getWeightUnit(resolved)
        const payload = buildProgramPayload(program, resolved, unit)
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) }],
        }
      } catch (error: unknown) {
        if (error instanceof ToolError) throw error // actionable message, safe to surface
        console.error('MCP resource error:', error)
        throw new Error('MCP resource read failed') // genericize internals
      }
    },
  )
}
