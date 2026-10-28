import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Link, Workstream } from '@autopilot/contracts'
import { z } from 'zod'
import { readSignals } from './home.ts'
import type { Paths } from './paths.ts'
import type { Service } from './service.ts'
import { durationMs, type RunClaude } from './signals.ts'

/** Where a watched pull request stands, when what is watched is one; "" otherwise. */
export const PullRequestNews = z.enum(['', 'merged', 'closed', 'ready', 'stuck'])
export type PullRequestNews = z.infer<typeof PullRequestNews>

/** What one check returns. */
export const WatcherOutput = z.object({
  fingerprint: z.string(),
  changed: z.boolean(),
  summary: z.string(),
  sources: z.array(z.string()),
  pr: PullRequestNews,
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
 * Read tools that belong together, by their name after the connector's `mcp__<server>__`. A
 * watcher given one of them gets the rest from the same connector: one that can list a thread but
 * not open what is new in it sees that something moved and cannot say what. A long email thread
 * outgrows `get_thread`, and only `get_message` reads its newest mail.
 */
const READ_TOGETHER = [
  ['search_threads', 'get_thread', 'get_message'],
  ['slack_read_thread', 'slack_read_channel'],
  ['get_issue', 'list_comments'],
]

/** The tools given, with the rest of each connector read set one of them belongs to. */
export const withReadCompanions = (tools: string[]): string[] => {
  const added = tools.flatMap((tool) => {
    const [, server, name] = /^(mcp__.+?__)(.+)$/.exec(tool) ?? []
    if (!server || !name) return []
    return (READ_TOGETHER.find((set) => set.includes(name)) ?? []).map((n) => `${server}${n}`)
  })
  return [...new Set([...tools, ...added])]
}

/** A source's name on its chip: what kind of place it is, numbered when there are several. */
const sourceTitle = (url: string, n: number | null): string => {
  const host = new URL(url).hostname
  const name =
    (
      [
        [/slack\.com$/, 'Slack thread'],
        [/^mail\.google\.com$/, 'Email'],
        [/github\.com$/, 'GitHub'],
        [/linear\.app$/, 'Linear issue'],
        [/^docs\.google\.com$/, 'Google Doc'],
      ] as const
    ).find(([pattern]) => pattern.test(host))?.[1] ?? host
  return n ? `${name} ${n}` : name
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

  /**
   * The tools a watcher reads with: its own, plus those of the signal that filed the task; with
   * neither (a task you made, a watcher set without tools), every tool the signals read with.
   * Either way with the read tools that come with them (`withReadCompanions`).
   */
  private tools(own: string[], signal: string | null): string[] {
    const signals = readSignals(this.o.paths.home)
    const fromSignal = signal ? (signals.find((s) => s.name === signal)?.tools ?? []) : []
    const chosen = [...own, ...fromSignal]
    return withReadCompanions(chosen.length > 0 ? chosen : signals.flatMap((s) => s.tools))
  }

  async check(id: string): Promise<void> {
    const { service } = this.o
    const run = service.watcherRuns().find((r) => r.watcher.id === id)
    if (!run) return
    const { watcher, task, fingerprint } = run
    const tools = this.tools(watcher.tools, task.source.signal)
    if (tools.length === 0) {
      service.watcherChecked(id, null)
      // Said once where the owner sees it: a watcher that cannot read is no watcher at all.
      service.openHealth(
        'watchers-blind',
        'Watchers have nothing to read with',
        'No signal reads with any tools, so watchers cannot look at threads, emails or pull requests. Add a signal for each source your connectors reach (Settings → Signals).',
      )
      return
    }
    service.closeHealth('watchers-blind', 'Watchers can read again.')
    // A first run also says whether what it watches for is already there: what was set to wait for
    // an email can be set after the email came in. The task's latest updates say what is known.
    const known = fingerprint
      ? []
      : service
          .getTask(task.id)
          .updates.slice(-6)
          .map((u) => `- ${u.author} (${u.kind}): ${u.body.slice(0, 400)}`)
    const output = await this.o.runClaude(this.prompt(task.id, task.title, task.brief, watcher.what, fingerprint, known), {
      tools,
      model: this.o.model,
      schema: z.toJSONSchema(WatcherOutput),
      mcpConfig: this.mcpConfig(),
      cwd: this.o.paths.home,
    })
    const result = WatcherOutput.parse(typeof output === 'string' ? JSON.parse(output) : output)
    if (result.changed) {
      const autonomy = this.o.workstreams().find((w) => w.name === task.workstream)?.autonomy ?? 2
      const attachments: Link[] = result.sources
        .filter((url) => URL.canParse(url))
        .slice(0, 10)
        .map((url, i, all) => ({ url, title: sourceTitle(url, all.length > 1 ? i + 1 : null) }))
      // To you, what happened alone; to a session it wakes, also what it was watching for (its own
      // note, ids and all), to know where to look.
      // A pull request stuck where Auto-fix does not reach goes to its session whatever the
      // autonomy: that is the session's work, not a question for the owner.
      const wake = result.pr === 'stuck' || (result.pr === '' && autonomy >= 3)
      service.watcherNews(id, { body: wake ? `${watcher.what}: ${result.summary}` : result.summary, attachments, wake, pr: result.pr })
    }
    service.watcherChecked(id, result.fingerprint)
  }

  private prompt(taskId: string, title: string, brief: string, what: string, fingerprint: string | null, known: string[]): string {
    const instructions = readFileSync(join(this.o.prompts, 'instructions.md'), 'utf8').replaceAll('{{owner}}', this.o.owner)
    return [
      instructions,
      `# Watcher for ${taskId}: ${title}\n\nWatch: ${what}\n\nTask (context only):\n\n${brief.slice(0, 3000)}`,
      [
        '# Task',
        'Read-only: look at the current state of what is watched with your tools. Create, change, send and comment on nothing.',
        'A thread too long to read whole: list it without bodies, then read only the messages that are new since the previous fingerprint, one at a time.',
        `Previous fingerprint: ${fingerprint ?? 'none (first run)'}`,
        ...(known.length > 0 ? [`The task's latest updates (what is already known):\n\n${known.join('\n')}`] : []),
        'Return:',
        '- fingerprint: a short, stable record of the latest activity by people (ids, timestamps, counts, open/closed/merged) for the next run to compare against. Leave out values that move on their own: CI or mergeable state still computing, view counts, relative times',
        '- changed: true when what is watched for happened since the previous fingerprint (a reply, an email that arrived, a new commit or review, a status or decision). On the first run there is no previous fingerprint: true only when what is watched for is already there and the latest updates above do not mention it yet, else false',
        '- summary: when changed, one to three plain sentences for the owner: who did what, and when; say what it means for the task if that is clear. Names, not ids: no channel, user or message ids or timestamps. Else ""',
        '- sources: the URLs of what changed',
        [
          '- pr: when what is watched is a pull request, where it stands now, else "". Claude Code Auto-fix already fixes failing checks and answers review comments on it, so do not report those as stuck.',
          '"merged"; "closed" (closed without merging); "ready" (approved and every check green: only the merge is left);',
          '"stuck" (it cannot move without work: merge conflicts, no reviewer requested and nobody reviewing, changes requested that nobody has answered for a day, checks failing for over an hour with no new commit);',
          '"" when none of these, or when nothing changed.',
        ].join(' '),
        `Never count ${this.o.owner}'s own messages, comments or reviews as news: they already know what they said.`,
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
