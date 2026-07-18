import { describe, it, expect } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from '@/lib/mcp/tools'
import {
  COACH_READ_TOOLS,
  COACH_APPROVAL_TOOLS,
  COACH_EXCLUDED_TOOLS,
  COACH_ALLOWED_TOOLS,
  filterCoachTools,
  requiresApproval,
} from './tool-policy'

/** Collects the real registered tool names without the HTTP handshake. */
function registeredToolNames(): string[] {
  const names: string[] = []
  const server = {
    registerTool: (name: string) => {
      names.push(name)
    },
    registerResource: () => {},
  }
  registerTools(server as unknown as McpServer)
  return names
}

describe('coach tool policy', () => {
  it('partitions the full MCP registry: every tool is either allowed or excluded, never both', () => {
    // Arrange
    const registry = registeredToolNames()
    const excluded = new Set<string>(COACH_EXCLUDED_TOOLS)

    // Assert — exhaustive: a tool added to the registry later must be triaged here.
    for (const name of registry) {
      expect(
        COACH_ALLOWED_TOOLS.has(name) !== excluded.has(name),
        `${name} must be in exactly one of allowed/excluded`,
      ).toBe(true)
    }
    expect(registry.length).toBe(COACH_ALLOWED_TOOLS.size + excluded.size)
  })

  it('excludes every destructive / out-of-scope tool from the filtered set', () => {
    // Arrange — a fake tool set covering the whole registry.
    const all = Object.fromEntries(registeredToolNames().map((name) => [name, { name }]))

    // Act
    const filtered = filterCoachTools(all)

    // Assert
    for (const name of COACH_EXCLUDED_TOOLS) {
      expect(filtered, `${name} must be filtered out`).not.toHaveProperty(name)
    }
    // Spot-check the highest-risk exclusions explicitly.
    expect(filtered).not.toHaveProperty('upsert_program')
    expect(filtered).not.toHaveProperty('delete_program')
    expect(filtered).not.toHaveProperty('delete_workout')
    expect(filtered).not.toHaveProperty('set_weight_unit')
  })

  it('retains all allowed tools and drops unknown ones', () => {
    // Arrange
    const input = {
      list_workouts: 1,
      add_program_set: 2,
      totally_new_tool: 3,
    }

    // Act
    const filtered = filterCoachTools(input)

    // Assert — allowlist-based: unknown tools are excluded by default.
    expect(Object.keys(filtered).sort()).toEqual(['add_program_set', 'list_workouts'])
  })

  it('requires approval for every mutating allowed tool and none of the reads', () => {
    for (const name of COACH_APPROVAL_TOOLS) {
      expect(requiresApproval(name), `${name} must require approval`).toBe(true)
    }
    for (const name of COACH_READ_TOOLS) {
      expect(requiresApproval(name), `${name} must not require approval`).toBe(false)
    }
  })
})
