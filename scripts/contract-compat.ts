// The contract stays compatible with apps already installed, or API_VERSION says it does not.
// Compares packages/contracts/schema/contract.json with the same file at a base commit:
//   node scripts/contract-compat.ts <base ref>
// A phone that has not updated, or a Mac on the previous release, calls the server with the old
// shapes and reads the new ones (decision 2 and version.ts); these are the changes that break that.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[] }
type Procedure = { meta: { scopes: string[] }; input: Schema | null | 'stream'; output: Schema | null | 'stream' }

const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null

/** Changes to a shape that break the side that has not updated: the client for outputs, the server for inputs. */
const compare = (base: unknown, now: unknown, at: string, io: 'input' | 'output', found: string[]): void => {
  if (!isSchema(base) || !isSchema(now)) return
  if (base.type !== undefined && now.type !== undefined && JSON.stringify(base.type) !== JSON.stringify(now.type)) {
    found.push(`${at}: type ${JSON.stringify(base.type)} became ${JSON.stringify(now.type)}`)
    return
  }
  if (base.enum && now.enum) {
    // Inputs: an old client may still send a value that went. Outputs: an old client meets a value it does not know.
    const gone = io === 'input' ? base.enum.filter((v) => !now.enum?.includes(v)) : now.enum.filter((v) => !base.enum?.includes(v))
    if (gone.length > 0)
      found.push(`${at}: ${io === 'input' ? 'no longer accepts' : 'can now return'} ${gone.map((v) => JSON.stringify(v)).join(', ')}`)
  }
  const baseRequired = new Set(base.required ?? [])
  const nowRequired = new Set(now.required ?? [])
  for (const name of Object.keys(now.properties ?? {})) {
    if (io === 'input' && nowRequired.has(name) && !baseRequired.has(name)) found.push(`${at}.${name}: newly required input`)
  }
  for (const [name, schema] of Object.entries(base.properties ?? {})) {
    const next = now.properties?.[name]
    if (io === 'output' && !next) found.push(`${at}.${name}: no longer returned`)
    else if (io === 'output' && baseRequired.has(name) && !nowRequired.has(name)) found.push(`${at}.${name}: may now be missing`)
    if (next) compare(schema, next, `${at}.${name}`, io, found)
  }
  if (base.items) compare(base.items, now.items, `${at}[]`, io, found)
}

export const breakingChanges = (base: Record<string, Procedure>, now: Record<string, Procedure>): string[] => {
  const found: string[] = []
  for (const [path, before] of Object.entries(base)) {
    const after = now[path]
    if (!after) {
      found.push(`${path}: removed`)
      continue
    }
    const lost = before.meta.scopes.filter((s) => !after.meta.scopes.includes(s))
    if (lost.length > 0) found.push(`${path}: no longer open to ${lost.join(', ')}`)
    compare(before.input, after.input, `${path} input`, 'input', found)
    compare(before.output, after.output, `${path} output`, 'output', found)
  }
  return found
}

if (import.meta.main) {
  const base = process.argv[2]
  const root = join(import.meta.dirname, '..')
  const file = 'packages/contracts/schema'
  const atBase = (name: string): string | null => {
    if (!base || /^0+$/.test(base)) return null
    try {
      return execFileSync('git', ['show', `${base}:${file}/${name}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  }
  const baseContract = atBase('contract.json')
  if (!baseContract) {
    console.log(`No contract at ${base ?? '(no base)'} to compare with.`)
  } else {
    const found = breakingChanges(
      JSON.parse(baseContract) as Record<string, Procedure>,
      JSON.parse(readFileSync(join(root, file, 'contract.json'), 'utf8')) as Record<string, Procedure>,
    )
    const versionBefore = (JSON.parse(atBase('version.json') ?? '{"version":0}') as { version: number }).version
    const versionNow = (JSON.parse(readFileSync(join(root, file, 'version.json'), 'utf8')) as { version: number }).version
    if (found.length === 0) console.log('The contract is compatible with the previous version.')
    else if (versionNow > versionBefore)
      console.log(`Breaking changes, with API_VERSION ${versionBefore} → ${versionNow}:\n${found.map((f) => `- ${f}`).join('\n')}`)
    else {
      console.log(`Breaking changes without a new API_VERSION (still ${versionNow}):\n${found.map((f) => `- ${f}`).join('\n')}`)
      console.log('Make the change compatible (optional inputs, keep outputs), or raise API_VERSION in packages/contracts/src/version.ts.')
      process.exitCode = 1
    }
  }
}
