import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools'

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

/**
 * Minimal stand-in for an McpServer that records registerTool(name, _config, handler)
 * and registerResource(name, template, ...) calls, so a test can assert the registered
 * tool/resource set and invoke each handler directly — exercising real registration
 * logic without the Streamable HTTP initialize handshake.
 */
function fakeServer(): {
  server: McpServer
  tools: Map<string, ToolHandler>
  resources: Map<string, unknown>
} {
  const tools = new Map<string, ToolHandler>()
  const resources = new Map<string, unknown>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
    registerResource: (name: string, template: unknown) => {
      resources.set(name, template)
    },
  }
  return { server: server as unknown as McpServer, tools, resources }
}

describe('registerTools', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    delete process.env.MCP_DEV_USER_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('registers the connectivity, read, and write tools', () => {
    // Arrange + Act
    const { server, tools } = fakeServer()
    registerTools(server)

    // Assert
    expect([...tools.keys()].sort()).toEqual([
      'create_workout',
      'delete_workout',
      'get_last_performance',
      'get_weight_unit',
      'get_workout',
      'list_workouts',
      'ping',
      'search_exercises',
      'set_weight_unit',
      'update_workout',
      'whoami',
    ])
  })

  it('registers the workout resource', () => {
    // Arrange + Act
    const { server, resources } = fakeServer()
    registerTools(server)

    // Assert
    expect([...resources.keys()]).toContain('workout')
  })

  it('ping returns "pong"', async () => {
    // Arrange
    const { server, tools } = fakeServer()
    registerTools(server)

    // Act
    const result = await tools.get('ping')!({})

    // Assert
    expect(result.content[0]?.text).toBe('pong')
    expect(result.isError).toBeFalsy()
  })

  it('whoami echoes the explicit userId argument', async () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'
    const { server, tools } = fakeServer()
    registerTools(server)

    // Act
    const result = await tools.get('whoami')!({ userId: 'user_arg' })

    // Assert
    expect(JSON.parse(result.content[0]!.text)).toEqual({ userId: 'user_arg' })
    expect(result.isError).toBeFalsy()
  })

  it('whoami falls back to MCP_DEV_USER_ID when no argument is given', async () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'
    const { server, tools } = fakeServer()
    registerTools(server)

    // Act
    const result = await tools.get('whoami')!({})

    // Assert
    expect(JSON.parse(result.content[0]!.text)).toEqual({ userId: 'user_env' })
    expect(result.isError).toBeFalsy()
  })

  it('whoami returns an MCP error (isError) when no userId can be resolved', async () => {
    // Arrange — neither argument nor env is set
    const { server, tools } = fakeServer()
    registerTools(server)

    // Act
    const result = await tools.get('whoami')!({})

    // Assert
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/userId/)
  })
})
