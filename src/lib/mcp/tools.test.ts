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

  it('registers the connectivity, read, write, patch, and program tools', () => {
    // Arrange + Act
    const { server, tools } = fakeServer()
    registerTools(server)

    // Assert
    expect([...tools.keys()].sort()).toEqual([
      'add_program_day',
      'add_program_exercise',
      'add_program_set',
      'add_set',
      'create_custom_exercise',
      'create_workout',
      'delete_program',
      'delete_workout',
      'get_last_performance',
      'get_program',
      'get_program_stats',
      'get_weight_unit',
      'get_workout',
      'instantiate_program_day',
      'list_custom_exercises',
      'list_program_changes',
      'list_programs',
      'list_workouts',
      'move_program_day',
      'move_program_exercise',
      'move_program_set',
      'ping',
      'preview_program_week',
      'remove_program_day',
      'remove_program_exercise',
      'remove_program_set',
      'remove_program_set_override',
      'remove_set',
      'restart_program',
      'search_exercises',
      'set_program_autoregulation',
      'set_program_set_override',
      'set_program_status',
      'set_weight_unit',
      'set_workout_meta',
      'update_custom_exercise',
      'update_program_day',
      'update_program_exercise',
      'update_program_set',
      'update_set',
      'update_workout',
      'upsert_program',
      'whoami',
    ])
  })

  it('registers the workout and program resources', () => {
    // Arrange + Act
    const { server, resources } = fakeServer()
    registerTools(server)

    // Assert
    expect([...resources.keys()]).toContain('workout')
    expect([...resources.keys()]).toContain('program')
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
