import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMCPClient, type MCPClient, type MCPTransport } from '@ai-sdk/mcp'
import { registerTools } from '@/lib/mcp/tools'

/**
 * In-memory MCP bridge for the AI coach.
 *
 * Instead of dialing our own /api/mcp endpoint over HTTP (extra hop, and the
 * OAuth handshake is built for external clients), the chat route builds the
 * SAME McpServer in-process via the existing `registerTools` and links it to
 * the AI SDK's MCP client with `InMemoryTransport.createLinkedPair()`.
 *
 * Auth: the HTTP route's `withMcpAuth` stashes the Clerk user in
 * `AuthInfo.extra.userId`, which `resolveUserId` reads with top precedence.
 * We replicate exactly that in-process: the client-side transport's `send` is
 * wrapped so every message crosses the pair with
 * `{ authInfo: { extra: { userId } } }`, which the SDK's protocol layer hands
 * to every tool handler as `extra.authInfo`. The model can therefore never
 * target another user — a model-supplied `userId` argument is outranked.
 */
export async function createCoachMcpClient(userId: string): Promise<MCPClient> {
  const server = new McpServer({ name: 'workout-tracker-coach', version: '0.1.0' })
  registerTools(server)

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  // Not a real OAuth token — token/clientId/scopes are required by the AuthInfo
  // shape; only `extra.userId` is read (by resolveUserId). The id comes from
  // the route's Clerk session, never from the model.
  const authInfo: AuthInfo = {
    token: 'in-memory',
    clientId: 'coach-chat',
    scopes: [],
    extra: { userId },
  }

  const send = clientTransport.send.bind(clientTransport)
  clientTransport.send = (message, options) => send(message, { ...options, authInfo })

  await server.connect(serverTransport)

  return createMCPClient({
    clientName: 'coach-chat',
    // Same MCP SDK on both ends; the AI SDK just declares its own structural
    // MCPTransport type, hence the cast.
    transport: clientTransport as unknown as MCPTransport,
  })
}
