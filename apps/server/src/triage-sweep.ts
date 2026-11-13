import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '@autopilot/contracts'
import { z } from 'zod'
import { readSignals } from './home.ts'
import type { Paths } from './paths.ts'
import type { Service } from './service.ts'
import type { RunClaude } from './signals.ts'

/** What one sweep returns: a verdict for each task it was shown. */
export const SweepOutput = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      resolved: z.boolean(),
      /** One line on who resolved it, how and when; "" when it is not resolved. */
      note: z.string(),
      /** The message, ticket or pull request that shows it; "" when there is none. */
      url: z.string().default(''),
    }),
  ),
})
export type SweepOutput = z.infer<typeof SweepOutput>

export type TriageSweepOptions = {
  service: Service
  paths: Paths
  runClaude: RunClaude
  owner: string
  model?: string
  log?: (message: string) => void
}

/** The job that records when the sweep last ran, so a restart does not run it again early. */
export const SWEEP_JOB = 'triage-sweep'
const EVERY_MS = 3_600_000
/** One run looks at this many at most, the longest waiting first; the rest go next hour. */
const BATCH = 30

/**
 * Once an hour, looks again at what waits in Triage from a signal and the owner has not touched:
 * a ticket closed, a question answered or a pull request merged meanwhile needs nothing more, so
 * the task closes as done with one line saying how. One read-only `claude -p` over the connectors
 * the signals use, for all of them at once. When unsure, it leaves the task where it is.
 */
export class TriageSweep {
  private readonly o: Required<TriageSweepOptions>
  private running = false

  constructor(options: TriageSweepOptions) {
    this.o = { model: 'sonnet', log: () => {}, ...options }
  }

  async tick(): Promise<void> {
    if (this.running) return
    const { service } = this.o
    const last = service.jobRanAt(SWEEP_JOB)
    if (last && service.now().getTime() - Date.parse(last) < EVERY_MS) return
    this.running = true
    try {
      // Recorded first: a run that fails waits for the next hour rather than the next tick.
      service.jobRan(SWEEP_JOB, service.now().toISOString())
      await this.sweep()
    } catch (error: unknown) {
      this.o.log(`triage sweep: ${String(error)}`)
    } finally {
      this.running = false
    }
  }

  async sweep(): Promise<string[]> {
    const { service } = this.o
    const tasks = service
      .queue({ band: 'triage' })
      .items.map((i) => i.task)
      .filter((t) => service.untouchedTriage(t.id))
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, BATCH)
    if (tasks.length === 0) return []
    const tools = [...new Set(readSignals(this.o.paths.home).flatMap((s) => s.tools))]
    if (tools.length === 0) return []
    const output = await this.o.runClaude(this.prompt(tasks), {
      label: `triage sweep (${tasks.length})`,
      tools,
      model: this.o.model,
      schema: z.toJSONSchema(SweepOutput),
      mcpConfig: this.mcpConfig(),
      cwd: this.o.paths.home,
    })
    const result = SweepOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
    const shown = new Set(tasks.map((t) => t.id))
    const closed: string[] = []
    for (const verdict of result.tasks) {
      const note = verdict.note.trim()
      if (!verdict.resolved || !note || !shown.has(verdict.id)) continue
      const proof = URL.canParse(verdict.url) ? [{ url: verdict.url, title: new URL(verdict.url).hostname }] : []
      // Started, answered or closed while it looked: the owner or a session has it now.
      if (service.closeResolved(verdict.id, note.slice(0, 500), proof)) closed.push(verdict.id)
    }
    if (closed.length > 0) this.o.log(`triage sweep closed ${closed.join(', ')}`)
    return closed
  }

  private prompt(tasks: Task[]): string {
    const owner = this.o.owner
    const list = tasks
      .map((t) =>
        [
          `## ${t.id}: ${t.title}`,
          `Filed ${t.createdAt} from ${t.source.signal ?? 'a signal'}: ${t.source.url ?? ''}`,
          ...t.links.slice(0, 5).map((l) => `- ${l.title}: ${l.url}`),
          t.brief ? `Brief (context only):\n${t.brief.slice(0, 1500)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n')
    return [
      `These tasks wait in ${owner}'s Triage: things filed for ${owner} from email, Slack, tickets and pull requests that ${owner} has not looked at yet. Some were dealt with somewhere else since. Find those, so ${owner} does not spend time on them.`,
      list,
      [
        '# Task',
        'For each task, open its source with the connectors and check where it stands now. Read-only: create, change, send and comment on nothing.',
        `Resolved means nothing is left for ${owner} to do or decide:`,
        '- the ticket is done, cancelled, a duplicate or closed;',
        '- the pull request is merged or closed;',
        `- the question or request in the thread was answered or handled, by ${owner} outside Autopilot or by someone else, and nothing new was asked of ${owner} since;`,
        '- the sender said it is no longer needed, or the meeting or deadline it was about has passed with nothing to follow up.',
        `Not resolved: anything still open, anything that still asks ${owner} something, or anything you could not open or are unsure about. When in doubt, it is not resolved.`,
        'Return tasks: one entry per task above, with:',
        '- id: the task id',
        '- resolved: true or false',
        `- note: when resolved, one line for ${owner} on who resolved it, how and when ("Tom closed LLE-16513 as done on 12 Nov.", "Sofie answered Gabriel in the thread on 12 Nov at 14:10."). Else ""`,
        '- url: when resolved, the message, ticket or pull request that shows it. Else ""',
      ].join('\n'),
    ].join('\n\n---\n\n')
  }

  /** The sweep reads through the claude.ai connectors only; it gets no Autopilot tools. */
  private mcpConfig(): string {
    const dir = join(this.o.paths.data, 'triage-sweep')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: {} }), { mode: 0o600 })
    return file
  }
}
