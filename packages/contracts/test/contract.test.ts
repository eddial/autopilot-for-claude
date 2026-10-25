import type { AnyContractProcedure } from '@orpc/contract'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AnswerUpdate, CreateTask, PostUpdate } from '../src/commands.ts'
import { contract, type Meta } from '../src/contract.ts'
import { mcpTools, metaOf, toolsFor } from '../src/mcp.ts'
import { isCompatible } from '../src/version.ts'

const procedures = Object.entries(contract).flatMap(([group, procs]) =>
  Object.entries(procs as Record<string, AnyContractProcedure>).map(([name, p]) => ({
    path: `${group}.${name}`,
    meta: p['~orpc'].meta as Meta,
    input: p['~orpc'].inputSchema as z.ZodType | undefined,
  })),
)

const keyless = (tool: (typeof mcpTools)[number]) => {
  const schema = z.toJSONSchema(tool.input, { io: 'input' }) as { properties?: Record<string, unknown> }
  return !('idempotencyKey' in (schema.properties ?? {}))
}

describe('contract', () => {
  it('gives every procedure an access rule', () => {
    const open = procedures.filter((proc) => proc.meta.public !== true && proc.meta.scopes.length === 0)
    expect(open.map((proc) => proc.path)).toEqual([])
  })

  it('requires an idempotency key on every write', () => {
    const reads =
      /^(meta\.|queue\.|changes\.|tasks\.get|items\.match|links\.preview|connectors\.detect|setup\.status|.*\.examples$|.*\.list$)/
    const writes = procedures.filter((proc) => !reads.test(proc.path))
    const withoutKey = writes.filter((proc) => !(proc.input instanceof z.ZodObject && 'idempotencyKey' in proc.input.shape))
    expect(writes.length).toBeGreaterThan(20)
    expect(withoutKey.map((proc) => proc.path)).toEqual([])
  })

  it('limits session tokens to their own task on every procedure a session may write through', () => {
    const sessionWrites = procedures.filter((proc) => proc.meta.scopes.includes('session') && proc.path !== 'tasks.create')
    expect(sessionWrites.filter((proc) => proc.meta.ownTask !== true).map((proc) => proc.path)).toEqual([])
  })
})

describe('commands', () => {
  it('starts a new task by default', () => {
    expect(CreateTask.parse({ idempotencyKey: 'k-12345678', title: 'Draft the note' }).start).toBe(true)
  })

  it('accepts options on a decision and nowhere else', () => {
    const base = { idempotencyKey: 'k-12345678', taskId: 'AP-1', body: 'Which?' }
    expect(PostUpdate.safeParse({ ...base, kind: 'decision' }).success).toBe(false)
    expect(PostUpdate.safeParse({ ...base, kind: 'decision', options: [{ id: 'a', label: 'A' }] }).success).toBe(true)
    expect(PostUpdate.safeParse({ ...base, kind: 'info', options: [{ id: 'a', label: 'A' }] }).success).toBe(false)
  })

  it('needs an option or text to answer', () => {
    expect(AnswerUpdate.safeParse({ idempotencyKey: 'k-12345678', updateId: 'u1' }).success).toBe(false)
    expect(AnswerUpdate.safeParse({ idempotencyKey: 'k-12345678', updateId: 'u1', text: 'Yes' }).success).toBe(true)
  })
})

describe('MCP tools', () => {
  it('map onto procedures and leave the idempotency key to the bridge', () => {
    expect(mcpTools.filter((tool) => metaOf(tool).scopes.length === 0).map((tool) => tool.name)).toEqual([])
    expect(mcpTools.filter((tool) => !keyless(tool)).map((tool) => tool.name)).toEqual([])
  })

  it('give a session only what it needs for its own task', () => {
    expect(toolsFor('session').map((t) => t.name)).toEqual([
      'get_task',
      'create_task',
      'post_update',
      'attach_link',
      'add_watcher',
      'wait_on',
    ])
    expect(toolsFor('signal').map((t) => t.name)).toEqual(['list_workstreams', 'match_items', 'file_item'])
  })
})

describe('version', () => {
  it('serves the previous client version too', () => {
    expect(isCompatible(3, 3)).toBe(true)
    expect(isCompatible(3, 2)).toBe(true)
    expect(isCompatible(3, 1)).toBe(false)
    expect(isCompatible(3, 4)).toBe(false)
  })
})
