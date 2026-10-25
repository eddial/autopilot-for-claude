import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workstream } from '@autopilot/contracts'
import { parse as parseYaml } from 'yaml'

/**
 * A person's config lives in `home/` as Markdown with YAML frontmatter, the same format as
 * the Linear version, so files carry over: `workstreams/<name>.md` with `## Routing` (ending in
 * an `Urgent:` line) and `## Work`, and `signals/<name>.md` with `every:`/`cron:` and `tools:`.
 * Files starting with `_` are examples and are skipped.
 */

type Frontmatter = Record<string, unknown>

export const splitFrontmatter = (text: string): { meta: Frontmatter; body: string } => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta = (parseYaml(match[1] ?? '') ?? {}) as Frontmatter
  return { meta, body: match[2] ?? '' }
}

const section = (body: string, title: string): string => {
  const match = new RegExp(`^## ${title}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(body)
  return match?.[1]?.trim() ?? ''
}

const markdownFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .toSorted()
    : []

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

export const readWorkstreams = (home: string): Workstream[] =>
  markdownFiles(join(home, 'workstreams')).map((file) => {
    const { meta, body } = splitFrontmatter(readFileSync(join(home, 'workstreams', file), 'utf8'))
    const routing = section(body, 'Routing')
    const urgent = /^Urgent:\s*(.*)$/m.exec(routing)?.[1]?.trim() ?? ''
    const autonomy = Number(meta.autonomy ?? 2)
    return {
      name: file.replace(/\.md$/, ''),
      routing: routing.replace(/^Urgent:.*$/m, '').trim(),
      urgent,
      work: section(body, 'Work'),
      autonomy: autonomy >= 1 && autonomy <= 4 ? Math.trunc(autonomy) : 2,
      repo: optionalString(meta.repo),
      folder: optionalString(meta.folder),
      machineId: null,
    }
  })

export type SignalFile = {
  name: string
  every: string | null
  cron: string | null
  tools: string[]
  model: string
  paused: boolean
  /** What counts, in the person's own words. */
  rules: string
}

export const readSignals = (home: string): SignalFile[] =>
  markdownFiles(join(home, 'signals')).map((file) => {
    const { meta, body } = splitFrontmatter(readFileSync(join(home, 'signals', file), 'utf8'))
    return {
      name: file.replace(/\.md$/, ''),
      every: optionalString(meta.every),
      cron: optionalString(meta.cron),
      tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [],
      model: optionalString(meta.model) ?? 'haiku',
      paused: meta.paused === true,
      rules: body.trim(),
    }
  })
