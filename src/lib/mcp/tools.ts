import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { registerReadTools } from './read-tools'
import { registerWriteTools } from './write-tools'
import { registerPatchTools } from './patch-tools'
import { registerProgramTools } from './program-tools'
import { registerProgramPatchTools } from './program-patch-tools'
import { registerResources } from './resources'

/**
 * Registers the MCP tools on the given server.
 *
 * Extracted from the route handler so the tool set and each tool's behavior are
 * unit-testable without standing up the Streamable HTTP `initialize` handshake.
 * This registers the Phase 1 connectivity/identity tools (ping, whoami) inline,
 * delegates the Phase 2 read tools to `registerReadTools`, the Phase 3 write tools
 * to `registerWriteTools`, the partial-edit tools to `registerPatchTools`, the
 * program authoring/read tools to `registerProgramTools`, the granular program
 * patch tools to `registerProgramPatchTools`, and the `workout://{id}` /
 * `program://{id}` resources to `registerResources`.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Liveness check — returns "pong". Use to confirm the MCP endpoint is reachable.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  )

  server.registerTool(
    'whoami',
    {
      title: 'Who Am I',
      description:
        'Returns the resolved target userId — the authenticated OAuth user when signed in, else the `userId` argument or the MCP_DEV_USER_ID env default (dev). Confirm this before any write.',
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        return { content: [{ type: 'text', text: JSON.stringify({ userId: resolved }) }] }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to resolve userId'
        return { content: [{ type: 'text', text: message }], isError: true }
      }
    },
  )

  registerReadTools(server)
  registerWriteTools(server)
  registerPatchTools(server)
  registerProgramTools(server)
  registerProgramPatchTools(server)
  registerResources(server)
}
