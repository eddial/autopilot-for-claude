// Writes the contract as JSON Schema to packages/contracts/schema/, for agents
// and tools that do not use TypeScript. CI fails when the files are stale.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

write('version.json', { version: c.API_VERSION })
console.log(`Wrote ${Object.keys(entities).length + 2} files to ${out}`)
