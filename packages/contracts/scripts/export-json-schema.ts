// Writes the contract as JSON Schema to packages/contracts/schema/, for agents
// and tools that do not use TypeScript. CI fails when the files are stale.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnyContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import * as c from '../src/index.ts'

const out = join(import.meta.dirname, '..', 'schema')

const entities = {
  Task: c.Task,
  Update: c.Update,
  Session: c.Session,
  QueueItem: c.QueueItem,
  Signal: c.Signal,
  Decision: c.Decision,
  Watcher: c.Watcher,
  Workstream: c.Workstream,
  Machine: c.Machine,
  Device: c.Device,
  Token: c.Token,
  RoutingProposal: c.RoutingProposal,
  Change: c.Change,
  QueueSnapshot: c.QueueSnapshot,
}

const write = (file: string, value: unknown) => writeFileSync(join(out, file), `${JSON.stringify(value, null, 2)}\n`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const [name, schema] of Object.entries(entities)) {
  write(`${name}.json`, z.toJSONSchema(schema, { io: 'output' }))
}

write(
  'mcp-tools.json',
  c.mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    scopes: c.metaOf(tool).scopes,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
  })),
)

// Every procedure's access and shapes: what scripts/contract-compat.ts compares between versions.
const shape = (schema: unknown, io: 'input' | 'output') => {
  if (!(schema instanceof z.ZodType)) return null
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'any' })
  } catch {
    // A live stream (queue.subscribe): its events are in Change.json.
    return 'stream'
  }
}
write(
  'contract.json',
  Object.fromEntries(
    Object.entries(c.contract).flatMap(([group, procedures]) =>
      Object.entries(procedures as Record<string, AnyContractProcedure>).map(([name, p]) => [
        `${group}.${name}`,
        { meta: p['~orpc'].meta, input: shape(p['~orpc'].inputSchema, 'input'), output: shape(p['~orpc'].outputSchema, 'output') },
      ]),
    ),
  ),
)

write('version.json', { version: c.API_VERSION })
console.log(`Wrote ${Object.keys(entities).length + 3} files to ${out}`)
