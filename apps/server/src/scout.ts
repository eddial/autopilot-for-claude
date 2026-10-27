import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Link, Task, Workstream } from '@autopilot/contracts'
import { z } from 'zod'
import { readSignals } from './home.ts'
import type { Paths } from './paths.ts'
import type { Service } from './service.ts'
import type { RunClaude } from './signals.ts'

/** What a scout returns: a first look at one new task. */
export const ScoutOutput = z.object({
  summary: z.string(),
  related: z.array(z.object({ url: z.string(), title: z.string() })),
  approach: z.array(z.string()),
  questions: z.array(z.string()),
  /** Where it belongs, when it came without one of the owner's workstreams; "" otherwise. */
  workstream: z.string(),
})
export type ScoutOutput = z.infer<typeof ScoutOutput>

/** Where a task started without a workstream belongs, from the routing alone. */
const Placement = z.object({ workstream: z.string() })

export type ScoutOptions = {
  service: Service
  paths: Paths
  workstreams: () => Workstream[]
  runClaude: RunClaude
  prompts: string
  owner: string
  model?: string
  log?: (message: string) => void
}

/** The job that records a task had its first look (or should not get one, like an import). */
export const scoutJob = (taskId: string): string => `scout:${taskId}`

/** Tasks older than this when first seen are left as they are: no scouting a backlog. */
const FRESH_MS = 2 * 86_400_000
/** Reading files in the workstream's repository or folder; never writing or running anything. */
const FILE_TOOLS = ['Read', 'Grep', 'Glob']

const expand = (path: string): string => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

/**
 * Gives every new task a first look before anyone looks at it: one read-only `claude -p`
 * over the owner's connectors and the workstream's code, posted as an update. A started task does
 * this itself in its session, so only tasks waiting in New are scouted, once each.
 */
export class Scout {
  private readonly o: Required<ScoutOptions>
  private running = false

  constructor(options: ScoutOptions) {
    this.o = { model: 'sonnet', log: () => {}, ...options }
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const { service } = this.o
      const now = service.now().getTime()
      const waiting = service
        .queue({ band: 'triage' })
        .items.map((i) => i.task)
        .filter((t) => t.createdBy !== 'system' && t.workstream !== 'autopilot' && !service.jobRanAt(scoutJob(t.id)))
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const task of waiting) {
        // Recorded first: a run that fails is not retried at every tick.
        service.jobRan(scoutJob(task.id), service.now().toISOString())
        if (now - Date.parse(task.createdAt) > FRESH_MS) continue
        await this.scout(task).catch((error: unknown) => this.o.log(`scout ${task.id}: ${String(error)}`))
      }
    } finally {
      this.running = false
    }
  }

  async scout(task: Task): Promise<void> {
    const workstream = this.o.workstreams().find((w) => w.name === task.workstream)
    const place = [workstream?.repo, workstream?.folder].map((p) => (p ? expand(p) : null)).find((p) => p && existsSync(p)) ?? null
    // Every connector the signals read with, and the code when the workstream has some.
    const connectors = [...new Set(readSignals(this.o.paths.home).flatMap((s) => s.tools))]
    const tools = [...connectors, ...(place ? FILE_TOOLS : [])]
    if (tools.length === 0) return
    const workstreams = this.o.workstreams()
    const unplaced = workstream === undefined && workstreams.length > 0
    const output = await this.o.runClaude(this.prompt(task, workstream, place, unplaced ? workstreams : []), {
      label: `first look ${task.id}`,
      tools,
      model: this.o.model,
      schema: z.toJSONSchema(ScoutOutput),
      mcpConfig: this.mcpConfig(),
      cwd: place ?? this.o.paths.home,
    })
    const result = ScoutOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
    const { service } = this.o
    // Started, closed or answered meanwhile: the session or the owner already has it.
    if (service.queue({ band: 'triage' }).items.every((i) => i.task.id !== task.id)) return
    if (unplaced && workstreams.some((w) => w.name === result.workstream)) service.placeTask(task.id, result.workstream)
    service.systemUpdate(task.id, 'info', scoutBody(result), scoutLinks(result), 'scout')
  }

  /**
   * A task started without one of the owner's workstreams (New left on Automatic): picks where it
   * belongs before its session opens, from the title, brief and each workstream's routing, so the
   * session starts in that workstream's folder. Reads nothing else; a quick call.
   */
  async place(taskId: string): Promise<void> {
    const { service } = this.o
    const task = service.task(taskId)
    const choices = this.o.workstreams().filter((w) => w.name !== 'autopilot')
    if (choices.length === 0 || choices.some((w) => w.name === task.workstream)) return
    const prompt = [
      `# Task ${task.id}: ${task.title}`,
      `Brief:\n\n${task.brief.slice(0, 4000) || '(none)'}`,
      `The workstreams, each with what lands in it:\n\n${choices.map((w) => `- ${w.name}: ${w.routing.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}`,
      `Return workstream: the name of the one this task belongs in, or "" when none fits.`,
    ].join('\n\n')
    const output = await this.o.runClaude(prompt, {
      label: `place ${task.id}`,
      tools: [],
      model: this.o.model,
      schema: z.toJSONSchema(Placement),
      mcpConfig: this.mcpConfig(),
      cwd: this.o.paths.home,
    })
    const { workstream } = Placement.parse(typeof output === 'string' ? JSON.parse(output) : output)
    if (choices.some((w) => w.name === workstream)) service.placeTask(task.id, workstream)
  }

  private prompt(task: Task, workstream: Workstream | undefined, place: string | null, choices: Workstream[]): string {
    const instructions = readFileSync(join(this.o.prompts, 'instructions.md'), 'utf8').replaceAll('{{owner}}', this.o.owner)
    const links = task.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')
    return [
      instructions,
      [
        `# New task ${task.id}: ${task.title}`,
        `Workstream: ${task.workstream}${workstream ? `\nWhat lands here: ${workstream.routing}\nHow the work is done: ${workstream.work || 'not written down'}` : ''}`,
        `Brief (context only):\n\n${task.brief.slice(0, 4000) || '(none)'}`,
        links ? `Links:\n${links}` : '',
        place ? `The workstream's code is in this folder: ${place}` : '',
        choices.length > 0
          ? `It came without a workstream. Pick the one it belongs in:\n\n${choices.map((w) => `- ${w.name}: ${w.routing.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        '# Task',
        `Take a first look so that ${this.o.owner}, or the session that later takes this on, does not start from a bare title.`,
        'Read-only: search the connectors for the source thread or ticket, earlier conversations, tickets and pull requests about the same thing, and the people involved; look through the code when there is a folder. Create, change, send and comment on nothing. Spend a few minutes at most.',
        'Return:',
        '- summary: two to four sentences: what this really is, where it stands, and anything that changes how big or urgent it is',
        '- related: up to 8 links that matter (thread, ticket, PR, document, file as file:///), each with a short title saying what and where',
        '- approach: one to four short steps the work would likely take',
        '- questions: up to 3 things only the owner can answer before work starts; [] when none',
        `- workstream: ${choices.length > 0 ? 'the name of the workstream above it belongs in' : '""'}`,
      ].join('\n\n'),
    ].join('\n\n---\n\n')
  }

  /** Scouts read through the claude.ai connectors only; they get no Autopilot tools. */
  private mcpConfig(): string {
    const dir = join(this.o.paths.data, 'scout')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: {} }), { mode: 0o600 })
    return file
  }
}

/** The update as the owner reads it on a phone. */
export const scoutBody = (r: Omit<ScoutOutput, 'workstream'>): string =>
  [
    r.summary.trim(),
    r.approach.length > 0 ? `Likely approach:\n${r.approach.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    r.questions.length > 0 ? `Before starting:\n${r.questions.map((q) => `- ${q}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4000)

const scoutLinks = (r: ScoutOutput): Link[] =>
  r.related
    .filter((l) => URL.canParse(l.url))
    .slice(0, 8)
    .map((l) => ({ url: l.url, title: l.title.slice(0, 200) || new URL(l.url).hostname }))
