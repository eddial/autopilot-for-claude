import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
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

export const markdownFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .toSorted()
    : []

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

/** `~/code/product` as a person writes it. */
const optionalPath = (value: unknown): string | null => {
  const path = optionalString(value)
  return path?.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export const readWorkstreams = (home: string): Workstream[] =>
  markdownFiles(join(home, 'workstreams')).map((file) => {
    const { meta, body } = splitFrontmatter(readFileSync(join(home, 'workstreams', file), 'utf8'))
    const routing = section(body, 'Routing')
    // "Urgent:" runs to the next blank line, so it may wrap like the rest of the file.
    const urgentBlock = /^Urgent:[\s\S]*?(?=\n\s*\n|$(?![\s\S]))/m.exec(routing)?.[0] ?? ''
    const urgent = urgentBlock
      .replace(/^Urgent:/, '')
      .replace(/\s+/g, ' ')
      .trim()
    const autonomy = Number(meta.autonomy ?? 2)
    return {
      name: file.replace(/\.md$/, ''),
      routing: (urgentBlock ? routing.replace(urgentBlock, '') : routing).trim(),
      urgent,
      work: section(body, 'Work'),
      autonomy: autonomy >= 1 && autonomy <= 4 ? Math.trunc(autonomy) : 2,
      repo: optionalPath(meta.repo),
      folder: optionalPath(meta.folder),
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
  /** How far back a run may reach; a cron signal's first run covers all of it. */
  windowCap: string | null
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
      windowCap: optionalString(meta.window_cap),
      rules: body.trim(),
    }
  })
