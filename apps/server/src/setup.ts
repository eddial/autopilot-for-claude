import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SetupStatus, SignalExample, Workstream } from '@autopilot/contracts'
import { stringify } from 'yaml'
import { loadWorkspace, saveWorkspace } from './checkouts.ts'
import { isGitCheckout } from './git.ts'
import { markdownFiles, readSignals, readWorkstreams, splitFrontmatter } from './home.ts'
import type { Paths } from './paths.ts'
import { DomainError } from './service.ts'

const PLACEHOLDER = /YOUR_[A-Z_]+/g

const workOf = (text: string) => `## Work\n${text.trim()}\n`

/** Placeholders the server fills in itself: the connector knows the answer, so nobody types it. */
const LOOKUPS: Record<string, { tool: string; ask: string; answer: RegExp; what: string }> = {
  YOUR_SLACK_USER_ID: {
    tool: 'mcp__claude_ai_Slack__slack_read_user_profile',
    ask: 'Call slack_read_user_profile with no user_id; it returns the signed-in user. Reply with only their user id.',
    answer: /\b[UW][A-Z0-9]{6,}\b/,
    what: 'your Slack user id',
  },
}

/** Finds a placeholder's value, or null when the connector cannot say. */
export type Lookup = (field: string) => Promise<string | null>

/** One short `claude -p` with only the tool that knows the answer. */
export const lookupWithClaude =
  (claude: string): Lookup =>
  (field) =>
    new Promise((resolve) => {
      const lookup = LOOKUPS[field]
      if (!lookup) return resolve(null)
      const child = spawn(claude, ['-p', '--model', 'haiku', '--permission-mode', 'dontAsk', '--allowedTools', lookup.tool], {
        stdio: ['pipe', 'pipe', 'ignore'],
      })
      const timer = setTimeout(() => child.kill(), 90_000)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('error', () => resolve(null))
      child.on('close', () => {
        clearTimeout(timer)
        resolve(lookup.answer.exec(out)?.[0] ?? null)
      })
      child.stdin.end(lookup.ask)
    })

export type SetupOptions = {
  paths: Paths
  /** The repository's `examples/home/`. */
  examples: string
  claude: string
  lookup?: Lookup
}

/** What onboarding reads and writes in the person's home. */
export class Setup {
  private readonly o: SetupOptions

  constructor(options: SetupOptions) {
    this.o = options
  }

  /** Moves where tasks with no repository work; tasks already under way keep their folder. */
  setWorkspace(path: string): void {
    try {
      saveWorkspace(this.o.paths.home, path)
    } catch (e) {
      throw new DomainError('BAD_REQUEST', { field: 'path' }, e instanceof Error ? e.message : String(e))
    }
  }

  async status(): Promise<SetupStatus> {
    const version = await new Promise<string | null>((resolve) => {
      execFile(this.o.claude, ['--version'], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null))
    })
    return {
      claude: { installed: version !== null, version },
      service: existsSync(join(homedir(), 'Library', 'LaunchAgents', 'autopilot.server.plist')),
      home: this.o.paths.home,
      workspace: loadWorkspace(this.o.paths.home, this.o.paths.workspace),
      signals: readSignals(this.o.paths.home).length,
      workstreams: readWorkstreams(this.o.paths.home).length,
    }
  }

  signalExamples(): SignalExample[] {
    const dir = join(this.o.examples, 'signals')
    return markdownFiles(dir).map((file) => {
      const text = readFileSync(join(dir, file), 'utf8')
      const { meta, body } = splitFrontmatter(text)
      const name = file.replace(/\.md$/, '')
      return {
        name,
        summary:
          body
            .trim()
            .split(/\n\s*\n/)[0]
            ?.replace(/\s+/g, ' ') ?? '',
        tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [],
        fields: [...new Set(text.match(PLACEHOLDER) ?? [])].filter((field) => !(field in LOOKUPS)),
        added: existsSync(join(this.o.paths.home, 'signals', file)),
      }
    })
  }

  /**
   * Copies an example in, placeholders filled, paused until the person switches it on. What a
   * connector can tell (your own Slack user id) is looked up rather than asked for.
   */
  async addSignal(name: string, given: Record<string, string>): Promise<void> {
    const example = join(this.o.examples, 'signals', `${name}.md`)
    if (!existsSync(example)) throw new DomainError('NOT_FOUND', { entity: 'signal example', id: name })
    const target = join(this.o.paths.home, 'signals', `${name}.md`)
    if (existsSync(target)) return
    let text = readFileSync(example, 'utf8')
    const values = { ...given }
    const lookup = this.o.lookup ?? lookupWithClaude(this.o.claude)
    for (const field of new Set(text.match(PLACEHOLDER) ?? [])) {
      const known = LOOKUPS[field]
      if (!known || values[field]?.trim()) continue
      const found = await lookup(field)
      if (!found)
        throw new DomainError('BAD_REQUEST', { field }, `Could not find ${known.what} through the connector. Is it connected in Claude?`)
      values[field] = found
    }
    const missing = [...new Set(text.match(PLACEHOLDER) ?? [])].filter((field) => !values[field]?.trim())
    if (missing.length > 0) throw new DomainError('BAD_REQUEST', { field: missing[0] }, `Fill in ${missing.join(', ')}`)
    for (const [field, value] of Object.entries(values)) text = text.replaceAll(field, value.trim())
    // The example's comment explains what to edit; added through onboarding, that is done.
    text = text.replace(/^paused: true.*$/m, 'paused: true')
    mkdirSync(join(this.o.paths.home, 'signals'), { recursive: true })
    writeFileSync(target, text)
    this.ensureAutopilotWorkstream()
  }

  workstreamExamples(): Workstream[] {
    return readWorkstreams(this.o.examples).filter((w) => w.name !== 'autopilot')
  }

  saveWorkstream(input: {
    name: string
    routing: string
    urgent: string
    repo?: string | undefined
    work?: string | undefined
    autonomy?: number | undefined
  }): Workstream {
    // Sessions work in a worktree of it; a folder that is not a checkout would fail every start.
    if (input.repo && input.repo !== 'default' && !isGitCheckout(input.repo.replace(/^~(?=\/|$)/, homedir())))
      throw new DomainError('BAD_REQUEST', { field: 'repo' }, `${input.repo} is not a git checkout on this Mac`)
    const dir = join(this.o.paths.home, 'workstreams')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${input.name}.md`)
    const routing = `## Routing\n${input.routing.trim()}\n${input.urgent.trim() ? `Urgent: ${input.urgent.replace(/\s+/g, ' ').trim()}\n` : ''}`
    const existing = existsSync(file) ? splitFrontmatter(readFileSync(file, 'utf8')) : null
    const meta: Record<string, unknown> = { ...existing?.meta }
    // An empty repo takes it away; left out, it stays.
    if (input.repo !== undefined) {
      if (input.repo.trim()) meta.repo = input.repo.trim()
      else delete meta.repo
    }
    if (input.autonomy !== undefined) meta.autonomy = input.autonomy
    let rest: string
    if (existing) {
      rest = existing.body.replace(/^## Routing\s*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '').trimStart()
      if (input.work !== undefined) {
        const withoutWork = rest.replace(/^## Work\s*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim()
        rest = `${workOf(input.work)}${withoutWork ? `\n${withoutWork}\n` : ''}`
      }
    } else {
      const example = join(this.o.examples, 'workstreams', `${input.name}.md`)
      rest =
        input.work !== undefined
          ? workOf(input.work)
          : existsSync(example)
            ? (/^## Work\s*\n[\s\S]*$/m.exec(readFileSync(example, 'utf8'))?.[0] ?? '')
            : '## Work\nPrepare the work: drafts, branches, documents. Send, merge and publish nothing without asking.\n'
    }
    writeFileSync(file, `${Object.keys(meta).length ? `---\n${stringify(meta)}---\n` : ''}${routing}\n${rest}`)
    this.ensureAutopilotWorkstream()
    const saved = readWorkstreams(this.o.paths.home).find((w) => w.name === input.name)
    if (!saved) throw new Error(`Could not read back ${file}`)
    return saved
  }

  /** Sets a workstream's file aside in `home/retired/`, where it can be brought back by hand. */
  removeWorkstream(name: string, openTasks: number): Workstream[] {
    if (name === 'autopilot')
      throw new DomainError('BAD_REQUEST', { field: 'name' }, 'Autopilot reports its own health in this workstream; it stays.')
    if (openTasks > 0)
      throw new DomainError('BAD_REQUEST', { field: 'name' }, `${name} still has ${openTasks} open tasks; move or close them first.`)
    const file = join(this.o.paths.home, 'workstreams', `${name}.md`)
    if (!existsSync(file)) throw new DomainError('NOT_FOUND', { entity: 'workstream', id: name })
    const retired = join(this.o.paths.home, 'retired')
    mkdirSync(retired, { recursive: true })
    renameSync(file, join(retired, `${name}.md`))
    return readWorkstreams(this.o.paths.home)
  }

  /** Health problems and routing proposals land in `autopilot`; every home needs it. */
  private ensureAutopilotWorkstream(): void {
    const file = join(this.o.paths.home, 'workstreams', 'autopilot.md')
    const example = join(this.o.examples, 'workstreams', 'autopilot.md')
    if (existsSync(file) || !existsSync(example)) return
    mkdirSync(join(this.o.paths.home, 'workstreams'), { recursive: true })
    writeFileSync(file, readFileSync(example, 'utf8'))
  }
}
