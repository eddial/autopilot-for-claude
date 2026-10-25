import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { FileItem, type Decision, type Signal, type Workstream } from '@autopilot/contracts'
import { z } from 'zod'
import { lastCronMatch } from './cron.ts'
import { scoutJob } from './scout.ts'
import { readSignals, type SignalFile } from './home.ts'
import type { Paths } from './paths.ts'
import { DomainError, type Service } from './service.ts'

/** What a signal run returns: every item it looked at, with the decision for each. */
export const SignalOutput = z.object({
  items: z.array(
    z.object({
      action: z.enum(['create', 'update', 'drop']),
      url: z.string(),
      title: z.string(),
      sender: z.string(),
      channel: z.string(),
      at: z.string(),
      summary: z.string(),
      workstream: z.string().optional(),
      priority: z.int().min(1).max(4).optional(),
      taskId: z.string().optional(),
      note: z.string().optional(),
      ticket: z.object({ id: z.string(), closed: z.boolean() }).optional(),
      reason: z.string(),
      searches: z.array(z.string()),
      gated: z.boolean(),
    }),
  ),
})
export type SignalOutput = z.infer<typeof SignalOutput>

export type RunClaude = (
  prompt: string,
  options: { tools: string[]; model: string; schema: object; mcpConfig: string; cwd: string },
) => Promise<unknown>

/** Subagents and wake-ups would end the run in several results and lose the structured output. */
const NEVER = ['Agent', 'Task', 'ScheduleWakeup', 'CronCreate', 'Monitor', 'Workflow', 'RemoteTrigger', 'SendMessage']

/**
 * One unattended `claude -p` call. Tools not listed are denied. claude.ai connectors connect in the
 * background, so the call waits for them, and a run whose MCP tools are missing is retried once
 * after a minute before it fails (a slow connector usually passes on its own).
 */
export const claudeHeadless =
  (claude = 'claude', wait: (ms: number) => Promise<unknown> = sleep): RunClaude =>
  async (prompt, options) => {
    const once = async (): Promise<{ events: Record<string, unknown>[]; missing: string[] }> => {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        options.tools.join(','),
        '--disallowedTools',
        NEVER.join(','),
        '--model',
        options.model,
        '--json-schema',
        JSON.stringify(options.schema),
        '--mcp-config',
        options.mcpConfig,
      ]
      const env = {
        ...process.env,
        MCP_CONNECTION_NONBLOCKING: '0',
        CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '30000',
        MAX_MCP_OUTPUT_TOKENS: '60000',
      }
      const raw = await new Promise<string>((resolve, reject) => {
        const child = spawn(claude, args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', (d: Buffer) => (out += d.toString()))
        child.stderr.on('data', (d: Buffer) => (err += d.toString()))
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-1500)}`)),
        )
        child.stdin.end(prompt)
      })
      const events = raw.split('\n').flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          return []
        }
      })
      const init = events.find((e) => e.type === 'system' && e.subtype === 'init') as { tools?: string[] } | undefined
      const missing = options.tools.filter((t) => t.startsWith('mcp__') && !init?.tools?.includes(t))
      return { events, missing }
    }

    let run = await once()
    if (run.missing.length > 0) {
      await wait(60_000)
      run = await once()
    }
    if (run.missing.length > 0) {
      const detail = `Tools not available (connector not connected?): ${run.missing.join(', ')}`
      throw new DomainError('SERVICE_UNAVAILABLE', { what: 'connector', detail }, detail)
    }
    const results = run.events.filter((e) => e.type === 'result')
    const out = results.findLast((e) => e.structured_output !== undefined) ?? results.at(-1)
    if (!out) throw new Error('claude: no result event')
    if (out.is_error === true) throw new Error(`claude: ${String(out.result ?? out.subtype)}`)
    return out.structured_output ?? out.result
  }

const DURATION = /^(\d+)([mhd])$/
export const durationMs = (text: string): number => {
  const match = DURATION.exec(text)
  if (!match) throw new Error(`Not a duration: ${text}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd']
  return Number(match[1]) * unit
}

const WINDOW_CAP = 72 * 3_600_000
const WINDOW_OVERLAP = 2 * 60_000

type State = {
  lastCheckedAt: string | null
  lastRunAt: string | null
  failingSince: string | null
  failures: number
  message: string | null
  paused: boolean
}

/** A signal is reported once it has failed for an hour and at least three runs. */
const HEALTH_AFTER = 60 * 60_000
const HEALTH_RUNS = 3
/** A longer gap between ticks means the Mac slept; that time does not count as failing. */
const WAKE_GAP = 5 * 60_000

export type SignalsOptions = {
  service: Service
  paths: Paths
  workstreams: () => Workstream[]
  runClaude: RunClaude
  /** Where the prompts are: the repository's `prompts/`. */
  prompts: string
  owner: string
  /** How to run `autopilot` itself, for the MCP config. */
  self: { node: string; script: string }
  log?: (message: string) => void
}

/** Runs the signals in `home/signals/` on their schedule and files what they find. */
export class Signals {
  private readonly o: Required<SignalsOptions>
  private running = false
  private lastTick: number | null = null

  constructor(options: SignalsOptions) {
    this.o = { log: () => {}, ...options }
  }

  private files(): SignalFile[] {
    return readSignals(this.o.paths.home)
  }

  private file(name: string): SignalFile {
    const file = this.files().find((f) => f.name === name)
    if (!file) throw new DomainError('NOT_FOUND', { entity: 'signal', id: name })
    return file
  }

  private state(name: string): State {
    const row = this.o.service.db.prepare('select * from signal_state where name = ?').get(name) as
      Record<string, string | number | null> | undefined
    return {
      lastCheckedAt: (row?.last_checked_at as string | null) ?? null,
      lastRunAt: (row?.last_run_at as string | null) ?? null,
      failingSince: (row?.failing_since as string | null) ?? null,
      failures: Number(row?.failures ?? 0),
      message: (row?.message as string | null) ?? null,
      paused: Number(row?.paused ?? 0) === 1,
    }
  }

  private save(name: string, state: State): void {
    this.o.service.db
      .prepare(
        `insert into signal_state (name, last_checked_at, last_run_at, failing_since, failures, message, paused) values (?, ?, ?, ?, ?, ?, ?)
         on conflict(name) do update set last_checked_at = excluded.last_checked_at, last_run_at = excluded.last_run_at,
         failing_since = excluded.failing_since, failures = excluded.failures, message = excluded.message, paused = excluded.paused`,
      )
      .run(name, state.lastCheckedAt, state.lastRunAt, state.failingSince, state.failures, state.message, state.paused ? 1 : 0)
  }

  private toSignal(file: SignalFile): Signal {
    const state = this.state(file.name)
    const since = new Date(this.o.service.now().getTime() - 86_400_000).toISOString()
    const counts = this.o.service.db
      .prepare('select action, count(*) as n from decisions where signal = ? and at > ? group by action')
      .all(file.name, since) as { action: string; n: number }[]
    const count = (action: string) => Number(counts.find((c) => c.action === action)?.n ?? 0)
    const paused = file.paused || state.paused
    return {
      name: file.name,
      schedule: file.cron ? { cron: file.cron } : { every: file.every ?? '15m' },
      tools: file.tools,
      model: file.model,
      paused,
      health: {
        state: paused ? 'paused' : state.failingSince ? 'failing' : 'ok',
        since: state.failingSince,
        message: state.message,
      },
      lastRunAt: state.lastRunAt,
      last24h: { filed: count('created'), updated: count('updated'), dropped: count('dropped') },
    }
  }

  list(): Signal[] {
    return this.files().map((f) => this.toSignal(f))
  }

  pause(name: string, paused: boolean): Signal {
    let file = this.file(name)
    // An example added through onboarding starts `paused: true` in its file; resuming takes that out.
    if (!paused && file.paused) {
      const path = join(this.o.paths.home, 'signals', `${name}.md`)
      writeFileSync(path, readFileSync(path, 'utf8').replace(/^paused: true.*\n/m, ''))
      file = this.file(name)
    }
    this.save(name, { ...this.state(name), paused })
    return this.toSignal(file)
  }

  /**
   * Runs every signal that is due, one at a time. A rolling signal runs `every`; a cron signal (a
   * digest) runs at its scheduled minutes over everything since its last good run, and a failed
   * cron run is retried `every` until it succeeds.
   */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = this.o.service.now()
      const slept = this.lastTick !== null && now.getTime() - this.lastTick > WAKE_GAP
      this.lastTick = now.getTime()
      for (const file of this.files()) {
        if (slept) {
          // Restart the failing clocks: the network and connectors need a moment after a wake.
          const state = this.state(file.name)
          if (state.failingSince) this.save(file.name, { ...state, failingSince: now.toISOString() })
          continue
        }
        const state = this.state(file.name)
        if (file.paused || state.paused) continue
        // A new digest waits for its first scheduled minute rather than running on sight.
        if (file.cron && state.lastRunAt === null) {
          this.save(file.name, { ...state, lastRunAt: now.toISOString() })
          continue
        }
        if (!this.due(file, state, now)) continue
        await this.run(file.name).catch((error: unknown) => this.o.log(`signal ${file.name}: ${String(error)}`))
      }
    } finally {
      this.running = false
    }
  }

  private due(file: SignalFile, state: State, now: Date): boolean {
    const last = state.lastRunAt ? Date.parse(state.lastRunAt) : 0
    if (file.cron) {
      if (state.failingSince && file.every) return now.getTime() - last >= durationMs(file.every)
      const scheduled = lastCronMatch(file.cron, now)
      return scheduled !== null && scheduled.getTime() > last
    }
    return file.every !== null && now.getTime() - last >= durationMs(file.every)
  }

  /** One run over the window since the last one. `dryMinutes` previews that many minutes and files nothing. */
  async run(name: string, dryMinutes?: number): Promise<Decision[]> {
    const { service } = this.o
    const file = this.file(name)
    const state = this.state(name)
    const end = service.now()
    const dry = dryMinutes !== undefined

    const cap = file.windowCap ? durationMs(file.windowCap) : WINDOW_CAP
    // A rolling signal's first run only marks where to start (no backfill); a digest's covers its cap.
    if (!dry && state.lastCheckedAt === null && !file.cron) {
      this.save(name, { ...state, lastCheckedAt: end.toISOString(), lastRunAt: end.toISOString() })
      return []
    }
    const last = dry ? end.getTime() - dryMinutes * 60_000 : state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0
    const from = new Date(Math.max(last - WINDOW_OVERLAP, end.getTime() - cap))
    const missed = !dry && !file.cron && last - WINDOW_OVERLAP < from.getTime() ? new Date(last) : null

    const { secret, token } = service.issueToken(`signal ${name}`, 'signal', null)
    try {
      const output = await this.o.runClaude(this.prompt(file, from, end, dry), {
        tools: [...file.tools, 'mcp__autopilot__match_items', 'mcp__autopilot__list_workstreams'],
        model: file.model,
        schema: z.toJSONSchema(SignalOutput),
        mcpConfig: this.mcpConfig(name, secret),
        cwd: this.o.paths.home,
      })
      const parsed = SignalOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
      const decisions = dry ? parsed.items.map((i) => this.preview(name, i)) : parsed.items.map((i) => this.apply(name, i))
      if (!dry) {
        this.save(name, {
          ...state,
          lastCheckedAt: end.toISOString(),
          lastRunAt: end.toISOString(),
          failingSince: null,
          failures: 0,
          message: null,
        })
        service.closeHealth(`signal:${name}`, `The ${name} signal runs again.`)
        if (missed) {
          service.systemTask(
            `Check what the ${name} signal missed`,
            `The ${name} signal did not run from ${missed.toISOString()} to ${from.toISOString()}, longer than it reaches back. Preview that time with a dry run, or close this.`,
          )
        }
      }
      return decisions
    } catch (error) {
      if (!dry) {
        // Keep lastCheckedAt, so the next run covers the same window again.
        const message = error instanceof Error ? error.message : String(error)
        const failing = {
          ...state,
          lastRunAt: end.toISOString(),
          failingSince: state.failingSince ?? end.toISOString(),
          failures: state.failures + 1,
          message: message.slice(0, 500),
        }
        this.save(name, failing)
        if (failing.failures >= HEALTH_RUNS && end.getTime() - Date.parse(failing.failingSince) >= HEALTH_AFTER) {
          service.openHealth(
            `signal:${name}`,
            `The ${name} signal is failing`,
            `The ${name} signal has failed since ${failing.failingSince} (${failing.failures} runs). Last error: ${failing.message}\n\nNothing from ${name} is filed until it runs again; it catches up on the missed time by itself.`,
          )
        }
      }
      throw error
    } finally {
      service.db.prepare('update tokens set revoked_at = ? where id = ?').run(end.toISOString(), token.id)
    }
  }

  /**
   * Everything still open at a signal's source, once, regardless of its window: how a move from
   * Linear starts with the open tickets already in the queue. What an active task already mirrors
   * is left alone, so running it again changes nothing. Imported tasks get no first look (they
   * bring their own context); the signal's own schedule is untouched.
   */
  async importOpen(name: string, dry = false): Promise<Decision[]> {
    const { service } = this.o
    const file = this.file(name)
    const { secret, token } = service.issueToken(`signal ${name}`, 'signal', null)
    try {
      const output = await this.o.runClaude(this.prompt(file, null, service.now(), dry), {
        tools: [...file.tools, 'mcp__autopilot__match_items', 'mcp__autopilot__list_workstreams'],
        model: file.model,
        schema: z.toJSONSchema(SignalOutput),
        mcpConfig: this.mcpConfig(name, secret),
        cwd: this.o.paths.home,
      })
      const parsed = SignalOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
      const active = service.queue().items.map((i) => i.task)
      return parsed.items
        .filter((item) => item.action === 'create' && !item.ticket?.closed)
        .map((item) => {
          const there = active.find((t) => (item.ticket ? t.source.mirrors === item.ticket.id : t.source.url === item.url))
          if (there)
            return {
              ...this.preview(name, item),
              action: 'dropped' as const,
              taskId: there.id,
              reason: `${item.title}: already in the queue`,
            }
          if (dry) return this.preview(name, item)
          const decision = this.apply(name, item)
          if (decision.taskId) service.jobRan(scoutJob(decision.taskId), service.now().toISOString())
          return decision
        })
    } finally {
      service.db.prepare('update tokens set revoked_at = ? where id = ?').run(service.now().toISOString(), token.id)
    }
  }

  private apply(name: string, item: SignalOutput['items'][number]): Decision {
    // The same item seen again in an overlapping window applies once.
    const key = createHash('sha256').update(`${name}|${item.url}|${item.at}|${item.action}`).digest('hex')
    return this.o.service.fileItem(
      FileItem.parse({
        idempotencyKey: `signal-${key.slice(0, 40)}`,
        item: {
          signal: name,
          url: item.url,
          sender: item.sender,
          channel: item.channel,
          at: item.at,
          title: item.title.slice(0, 120),
          summary: item.summary.slice(0, 2000),
          ticket: item.ticket,
        },
        action: item.action,
        taskId: item.taskId,
        workstream: item.workstream,
        priority: item.priority,
        note: item.note ?? '',
        reason: item.reason.slice(0, 500),
        searches: item.searches,
        gated: item.gated,
      }),
    )
  }

  private preview(name: string, item: SignalOutput['items'][number]): Decision {
    return {
      id: 'dry-run',
      signal: name,
      at: this.o.service.now().toISOString(),
      action: item.action === 'create' ? 'created' : item.action === 'update' ? 'updated' : 'dropped',
      taskId: item.taskId ?? null,
      reason: `${item.title}: ${item.reason}`,
      searches: item.searches,
      gated: item.gated,
      title: item.title,
      ...(item.workstream ? { workstream: item.workstream } : {}),
    }
  }

  private mcpConfig(name: string, secret: string): string {
    const dir = join(this.o.paths.data, 'signals', name)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'mcp.json')
    const { node, script } = this.o.self
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          autopilot: {
            type: 'stdio',
            command: node,
            args: [script, 'mcp'],
            env: { AUTOPILOT_TOKEN: secret, AUTOPILOT_SOCKET: this.o.paths.socket },
          },
        },
      }),
      { mode: 0o600 },
    )
    return file
  }

  /** With no `from`, an import: everything still open, whatever its date. */
  private prompt(file: SignalFile, from: Date | null, end: Date, dry: boolean): string {
    const read = (f: string) => readFileSync(join(this.o.prompts, f), 'utf8').replaceAll('{{owner}}', this.o.owner)
    const workstreams = this.o
      .workstreams()
      .map((w) => `## ${w.name}\n${w.routing}\nUrgent: ${w.urgent}`)
      .join('\n\n')
    const active = this.o.service
      .queue()
      .items.map(
        (i) => `- ${i.task.id} · ${i.band} · ${i.task.workstream} · ${i.task.title}${i.task.source.url ? ` · ${i.task.source.url}` : ''}`,
      )
      .join('\n')
    return [
      read('instructions.md'),
      read('filing.md'),
      `# Signal: ${file.name}\n\n${file.rules}`,
      `# Workstreams\n\n${workstreams || '(none yet: use "inbox")'}`,
      `# Active tasks\n\n${active || '(none)'}`,
      from
        ? `# Window\n\nFetch items with activity from ${from.toISOString()} up to ${end.toISOString()} (Unix seconds ${Math.floor(from.getTime() / 1000)} to ${Math.floor(end.getTime() / 1000)}). Ignore anything outside it.`
        : `# Import\n\nThis is a one-time import into a new queue, not a window. Ignore the window and dates: return every item at this source that is still open and still ${this.o.owner}'s to act on (for tickets: every open ticket assigned to ${this.o.owner}, whatever its status short of done or cancelled), each as action "create" with its ticket set, routed to a workstream. Leave out what is done, cancelled, or someone else's.`,
      dry ? '# Dry run\n\nDecide as usual; nothing you return will be filed.' : '',
    ]
      .filter(Boolean)
      .join('\n\n---\n\n')
  }
}
