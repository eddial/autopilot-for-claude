import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SetupStatus, SignalExample, Workstream } from '@autopilot/contracts'
import { stringify } from 'yaml'
import { markdownFiles, readSignals, readWorkstreams, splitFrontmatter } from './home.ts'
import type { Paths } from './paths.ts'
import { DomainError } from './service.ts'

const PLACEHOLDER = /YOUR_[A-Z_]+/g

export type SetupOptions = {
  paths: Paths
  /** The repository's `examples/home/`. */
  examples: string
  claude: string
}

/** What onboarding reads and writes in the person's home. */
export class Setup {
  private readonly o: SetupOptions

  constructor(options: SetupOptions) {
    this.o = options
  }

  async status(): Promise<SetupStatus> {
    const version = await new Promise<string | null>((resolve) => {
      execFile(this.o.claude, ['--version'], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null))
    })
    return {
      claude: { installed: version !== null, version },
      service: existsSync(join(homedir(), 'Library', 'LaunchAgents', 'autopilot.server.plist')),
      home: this.o.paths.home,
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
        summary: body.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ') ?? '',
        tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [],
        fields: [...new Set(text.match(PLACEHOLDER) ?? [])],
        added: existsSync(join(this.o.paths.home, 'signals', file)),
      }
    })
  }

  /** Copies an example in, placeholders filled, paused until the person switches it on. */
  addSignal(name: string, values: Record<string, string>): void {
    const example = join(this.o.examples, 'signals', `${name}.md`)
    if (!existsSync(example)) throw new DomainError('NOT_FOUND', { entity: 'signal example', id: name })
    const target = join(this.o.paths.home, 'signals', `${name}.md`)
    if (existsSync(target)) return
    let text = readFileSync(example, 'utf8')
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

  saveWorkstream(input: { name: string; routing: string; urgent: string; repo?: string | undefined }): Workstream {
    const dir = join(this.o.paths.home, 'workstreams')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${input.name}.md`)
    const routing = `## Routing\n${input.routing.trim()}\n${input.urgent.trim() ? `Urgent: ${input.urgent.trim()}\n` : ''}`
    if (existsSync(file)) {
      const { meta, body } = splitFrontmatter(readFileSync(file, 'utf8'))
      const next = { ...meta, ...(input.repo ? { repo: input.repo } : {}) }
      const rest = body.replace(/^## Routing\s*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '')
      writeFileSync(file, `${Object.keys(next).length ? `---\n${stringify(next)}---\n` : ''}${routing}\n${rest.trimStart()}`)
    } else {
      const example = join(this.o.examples, 'workstreams', `${input.name}.md`)
      const work = existsSync(example)
        ? (/^## Work\s*\n[\s\S]*$/m.exec(readFileSync(example, 'utf8'))?.[0] ?? '')
        : '## Work\nPrepare the work: drafts, branches, documents. Send, merge and publish nothing without asking.\n'
      writeFileSync(file, `${input.repo ? `---\nrepo: ${input.repo}\n---\n` : ''}${routing}\n${work}`)
    }
    this.ensureAutopilotWorkstream()
    const saved = readWorkstreams(this.o.paths.home).find((w) => w.name === input.name)
    if (!saved) throw new Error(`Could not read back ${file}`)
    return saved
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
