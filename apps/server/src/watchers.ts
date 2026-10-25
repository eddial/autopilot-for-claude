import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Link, Workstream } from '@autopilot/contracts'
import { z } from 'zod'
import { readSignals } from './home.ts'
import type { Paths } from './paths.ts'
import type { Service } from './service.ts'
import { durationMs, type RunClaude } from './signals.ts'

/** What one check returns. */
export const WatcherOutput = z.object({
  fingerprint: z.string(),
  changed: z.boolean(),
  summary: z.string(),
  sources: z.array(z.string()),
})

export type WatchersOptions = {
  service: Service
  paths: Paths
  workstreams: () => Workstream[]
  runClaude: RunClaude
  prompts: string
  owner: string
  model?: string
  log?: (message: string) => void
}

/**
 * Checks what a waiting task depends on (a thread, a PR, a reply) every `every` until `until`.
 * Watchers run while the task waits on others or on the owner's review; while a session works on
 * it, it sees for itself.
 */
export class Watchers {
  private readonly o: Required<WatchersOptions>
  private running = false

  constructor(options: WatchersOptions) {
    this.o = { model: 'haiku', log: () => {}, ...options }
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const { service } = this.o
      const now = service.now().getTime()
      for (const run of service.watcherRuns()) {
        const { watcher, task, band } = run
        if (now > Date.parse(watcher.until)) {
          service.watcherExpired(watcher.id)
          continue
        }
        const reviewing = band === 'your_turn' && service.getTask(task.id).updates.some((u) => u.open && u.kind === 'review')
        if (band !== 'waiting' && !reviewing) continue
        const last = watcher.lastCheckedAt ? Date.parse(watcher.lastCheckedAt) : 0
        if (now - last < durationMs(watcher.every)) continue
        await this.check(watcher.id).catch((error: unknown) => {
          // Try again at the next interval, not at every tick.
          service.watcherChecked(watcher.id, null)
          this.o.log(`watcher ${watcher.id} on ${task.id}: ${String(error)}`)
        })
      }
    } finally {
      this.running = false
    }
  }

  /** The tools a watcher reads with: its own, plus those of the signal that filed the task. */
  private tools(own: string[], signal: string | null): string[] {
    const fromSignal = signal ? (readSignals(this.o.paths.home).find((s) => s.name === signal)?.tools ?? []) : []
    return [...new Set([...own, ...fromSignal])]
  }

  async check(id: string): Promise<void> {
    const { service } = this.o
    const run = service.watcherRuns().find((r) => r.watcher.id === id)
    if (!run) return
    const { watcher, task, fingerprint } = run
    const tools = this.tools(watcher.tools, task.source.signal)
    if (tools.length === 0) {
      service.watcherChecked(id, null)
      this.o.log(`watcher ${id} on ${task.id} has no tools to read with`)
      return
    }
    const output = await this.o.runClaude(this.prompt(task.id, task.title, task.brief, watcher.what, fingerprint), {
      tools,
      model: this.o.model,
      schema: z.toJSONSchema(WatcherOutput),
      mcpConfig: this.mcpConfig(),
      cwd: this.o.paths.home,
    })
    const result = WatcherOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
    // The first run only sets the baseline.
    if (result.changed && fingerprint) {
      const autonomy = this.o.workstreams().find((w) => w.name === task.workstream)?.autonomy ?? 2
      const attachments: Link[] = result.sources
        .filter((url) => URL.canParse(url))
        .slice(0, 10)
        .map((url) => ({ url, title: new URL(url).hostname }))
      service.watcherNews(id, { body: `${watcher.what}: ${result.summary}`, attachments, wake: autonomy >= 3 })
    }
    service.watcherChecked(id, result.fingerprint)
  }

  private prompt(taskId: string, title: string, brief: string, what: string, fingerprint: string | null): string {
    const instructions = readFileSync(join(this.o.prompts, 'instructions.md'), 'utf8').replaceAll('{{owner}}', this.o.owner)
    return [
      instructions,
      `# Watcher for ${taskId}: ${title}\n\nWatch: ${what}\n\nTask (context only):\n\n${brief.slice(0, 3000)}`,
      [
        '# Task',
        'Read-only: look at the current state of what is watched with your tools. Create, change, send and comment on nothing.',
        `Previous fingerprint: ${fingerprint ?? 'none (first run)'}`,
        'Return:',
        '- fingerprint: a short, stable record of the latest activity by people (ids, timestamps, counts, open/closed/merged) for the next run to compare against. Leave out values that move on their own: CI or mergeable state still computing, view counts, relative times',
        '- changed: true only when a person did something since the previous fingerprint (a reply, a new commit or review, a status or decision); always false on the first run',
        '- summary: when changed, one to three sentences: what is new, who, when; else ""',
        '- sources: the URLs of what changed',
      ].join('\n\n'),
    ].join('\n\n---\n\n')
  }

  /** Watchers only read through connectors; they get no Autopilot tools. */
  private mcpConfig(): string {
    const dir = join(this.o.paths.data, 'watchers')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: {} }), { mode: 0o600 })
    return file
  }
}
