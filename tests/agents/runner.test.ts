import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod/v4'
import { agentRegistry, invokeAgent, listAgentRuns, clearAgentRuns } from '@/server/agents'
import type { AgentDefinition } from '@/server/agents'

const prefix = 'test.runner'

const childAgent: AgentDefinition = {
  name: `${prefix}.child`,
  description: 'Child test agent',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  run: async (_ctx, input) => ({ value: (input as { value: number }).value + 1 }),
}

const parentAgent: AgentDefinition = {
  name: `${prefix}.parent`,
  description: 'Parent test agent',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  allowedCalls: [`${prefix}.child`],
  run: async (ctx, input) => {
    const child = await ctx.invokeAgent<{ value: number }, { value: number }>(`${prefix}.child`, { value: (input as { value: number }).value })
    return { value: child.value + 1 }
  },
}

const disallowedParentAgent: AgentDefinition = {
  name: `${prefix}.disallowedParent`,
  description: 'Disallowed caller',
  inputSchema: z.object({}),
  allowedCalls: [],
  run: async (ctx) => {
    await ctx.invokeAgent(`${prefix}.child`, { value: 1 })
    return { ok: true }
  },
}

const cycleAgentA: AgentDefinition = {
  name: `${prefix}.cycleA`,
  description: 'Cycle A',
  inputSchema: z.object({}),
  allowedCalls: [`${prefix}.cycleB`],
  run: async (ctx) => ctx.invokeAgent(`${prefix}.cycleB`, {}),
}

const cycleAgentB: AgentDefinition = {
  name: `${prefix}.cycleB`,
  description: 'Cycle B',
  inputSchema: z.object({}),
  allowedCalls: [`${prefix}.cycleA`],
  run: async (ctx) => ctx.invokeAgent(`${prefix}.cycleA`, {}),
}

describe('agent runner', () => {
  beforeEach(() => {
    clearAgentRuns()
    agentRegistry.register(childAgent)
    agentRegistry.register(parentAgent)
    agentRegistry.register(disallowedParentAgent)
    agentRegistry.register(cycleAgentA)
    agentRegistry.register(cycleAgentB)
  })

  it('executes nested agent calls and returns trace', async () => {
    const result = await invokeAgent<{ value: number }>({
      dataDir: '/tmp',
      storyId: 'story-test',
      agentName: `${prefix}.parent`,
      input: { value: 2 },
    })

    expect(result.output.value).toBe(4)
    expect(result.trace.length).toBe(2)
    expect(result.trace[0].agentName).toBe(`${prefix}.child`)
    expect(result.trace[1].agentName).toBe(`${prefix}.parent`)

    const runs = listAgentRuns('story-test')
    expect(runs).toHaveLength(1)
    expect(runs[0].agentName).toBe(`${prefix}.parent`)
    expect(runs[0].trace).toHaveLength(2)
    expect(runs[0].trace.some((entry) => entry.agentName === `${prefix}.child`)).toBe(true)
    expect(runs[0].trace.some((entry) => entry.agentName === `${prefix}.parent`)).toBe(true)
  })

  it('enforces allowedCalls policy', async () => {
    await expect(invokeAgent({
      dataDir: '/tmp',
      storyId: 'story-test',
      agentName: `${prefix}.disallowedParent`,
      input: {},
    })).rejects.toThrow('cannot call')
  })

  it('detects cycle between agents', async () => {
    await expect(invokeAgent({
      dataDir: '/tmp',
      storyId: 'story-test',
      agentName: `${prefix}.cycleA`,
      input: {},
    })).rejects.toThrow('cycle detected')
  })
})
