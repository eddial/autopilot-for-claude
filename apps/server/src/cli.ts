import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { QueueItem, TaskDetail } from '@autopilot/contracts'
import { ORPCError } from '@orpc/client'
import { activityOf } from './activity.ts'
import { connect } from './client.ts'
import { runMcpBridge } from './mcp-bridge.ts'
import { readOwnerToken } from './owner.ts'
import { resolvePaths } from './paths.ts'
import { installService, uninstallService } from './service-install.ts'

const HELP = `autopilot <command>

  serve                          run the server (the launchd agent runs this)
  service install|uninstall      keep the server running in the background on this Mac
  new "<title>" [--brief <text>] [--ws <workstream>] [--priority 1-4] [--save]
                                 create a task; starts a session unless --save
  ls [--band <band>]             the queue, ordered by whose turn it is
  show <task>                    a task with its updates
  start <task>                   start a session on a task saved in New
  close <task> [--cancel]        close a task (done, or not for you)
  answer <task> <option id | text>
                                 answer the task's open decision or question
  signal <name> [--dry <minutes>]
                                 run a signal now, or preview the last minutes without filing
  import <signal> [--dry]        once, file everything still open at a signal's source
                                 (moving from Linear: autopilot import linear --dry, then without)
  connectors                     the connectors Claude Code has here, and which signal reads each
  routing [accept|reject <id>]   the nightly routing review's proposals, or decide one
  status                         server, signals and queue at a glance
  token <name> <scope> [--task <task>]
                                 create a token for an agent (scope: owner, read, create)
  mcp                            MCP server on stdio for Claude Code and other agents
  hook <working|idle|notification|ended>
                                 used by sessions' Claude Code hooks`

const paths = resolvePaths()
const self = { node: process.execPath, script: realpathSync(join(import.meta.dirname, '..', 'bin', 'autopilot.js')) }
const key = () => randomUUID()

const client = () => {
  const token = process.env.AUTOPILOT_TOKEN ?? readOwnerToken(paths)
  if (!token) throw new Error(`No token: start the server once (autopilot serve) or set AUTOPILOT_TOKEN.`)
  return { api: connect(paths.socket, token), token }
}

const line = (item: QueueItem) => {
  const ask = item.openAsk ? ` · ${item.openAsk.kind}: ${item.openAsk.body.split('\n')[0]?.slice(0, 60)}` : ''
  return `${item.band.padEnd(9)} ${item.task.id.padEnd(8)} ${item.task.title}${ask}`
}

const showTask = (d: TaskDetail) =>
  [
    `${d.task.id} · ${d.task.workstream} · P${d.task.priority} · ${d.band}`,
    d.task.title,
    d.session ? `session ${d.session.state}${d.session.remoteControlUrl ? ` · ${d.session.remoteControlUrl}` : ''}` : '',
    d.task.brief ? `\n${d.task.brief}` : '',
    '',
    ...d.updates.map((u) => {
      const options = u.options.length ? `\n    options: ${u.options.map((o) => `${o.id} (${o.label})`).join(', ')}` : ''
      return `${u.createdAt.slice(0, 16)} ${u.author}/${u.kind}${u.open ? ' (open)' : ''}: ${u.body}${options}`
    }),
  ]
    .filter((l) => l !== '')
    .join('\n')

const main = async (argv: string[]): Promise<void> => {
  const [command, ...rest] = argv
  switch (command) {
    case 'serve': {
      const { startServer } = await import('./main.ts')
      const port = Number(process.env.AUTOPILOT_DEVICE_PORT)
      const handle = await startServer({
        paths,
        self,
        owner: process.env.AUTOPILOT_OWNER,
        ...(process.env.AUTOPILOT_CLAUDE ? { claude: process.env.AUTOPILOT_CLAUDE } : {}),
        ...(port ? { devicePort: port } : {}),
      })
      const stop = () => void handle.close().then(() => process.exit(0))
      process.on('SIGTERM', stop)
      process.on('SIGINT', stop)
      return
    }
    case 'service': {
      console.log(rest[0] === 'uninstall' ? uninstallService() : installService({ ...self, paths }))
      return
    }
    case 'new': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { brief: { type: 'string' }, ws: { type: 'string' }, priority: { type: 'string' }, save: { type: 'boolean' } },
      })
      const title = positionals.join(' ')
      const task = await client().api.tasks.create({
        idempotencyKey: key(),
        title,
        brief: values.brief ?? '',
        ...(values.ws ? { workstream: values.ws } : {}),
        ...(values.priority ? { priority: Number(values.priority) } : {}),
        start: !values.save,
      })
      console.log(`${task.id} ${task.title} (${task.state})`)
      return
    }
    case 'ls': {
      const { values } = parseArgs({ args: rest, options: { band: { type: 'string' } } })
      const band = values.band as QueueItem['band'] | undefined
      const queue = await client().api.queue.list(band ? { band } : {})
      console.log(queue.items.length ? queue.items.map(line).join('\n') : 'Nothing in the queue.')
      return
    }
    case 'show': {
      console.log(showTask(await client().api.tasks.get({ id: rest[0] ?? '' })))
      return
    }
    case 'start': {
      const task = await client().api.tasks.start({ idempotencyKey: key(), id: rest[0] ?? '' })
      console.log(`Starting ${task.id}: ${task.title}`)
      return
    }
    case 'close': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { cancel: { type: 'boolean' } } })
      const outcome = values.cancel ? 'canceled' : 'done'
      await client().api.tasks.close({ idempotencyKey: key(), id: positionals[0] ?? '', outcome })
      console.log(`Closed ${positionals[0] ?? ''} (${outcome}).`)
      return
    }
    case 'answer': {
      const [id = '', ...words] = rest
      const { api } = client()
      const detail = await api.tasks.get({ id })
      const ask = detail.updates.findLast((u) => u.open)
      if (!ask) throw new Error(`${id} has no open decision or question.`)
      const text = words.join(' ')
      const option = ask.options.find((o) => o.id === text || o.label.toLowerCase() === text.toLowerCase())
      await api.updates.answer({ idempotencyKey: key(), updateId: ask.id, ...(option ? { optionId: option.id } : { text }) })
      console.log(`Answered ${id}.`)
      return
    }
    case 'signal': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { dry: { type: 'string' } } })
      const decisions = await client().api.signals.run({
        idempotencyKey: key(),
        name: positionals[0] ?? '',
        ...(values.dry ? { dryMinutes: Number(values.dry) } : {}),
      })
      console.log(decisions.map((d) => `${d.action.padEnd(8)} ${d.taskId ?? '-'} ${d.reason}`).join('\n') || 'Nothing found.')
      return
    }
    case 'import': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { dry: { type: 'boolean' } } })
      const name = positionals[0] ?? ''
      if (!values.dry) console.log(`Importing what is still open in ${name}; this takes a minute or two…`)
      const decisions = await client().api.signals.import({ idempotencyKey: key(), name, dry: values.dry ?? false })
      console.log(
        decisions.map((d) => `${d.action.padEnd(8)} ${d.taskId ?? '-'} ${d.workstream ?? ''} ${d.reason}`).join('\n') || 'Nothing open.',
      )
      const filed = decisions.filter((d) => d.action === 'created').length
      console.log(values.dry ? `\nA preview: nothing was filed. Without --dry, ${filed} tasks would be.` : `\n${filed} tasks filed.`)
      return
    }
    case 'connectors': {
      const { connectors, github } = await client().api.connectors.detect()
      for (const c of connectors) {
        console.log(`${c.name}: ${c.status}, ${c.tools.length} tools${c.signal ? ` · signal ${c.signal}` : ''}`)
      }
      console.log(
        `GitHub CLI: ${github.cli ? (github.user ? `signed in as ${github.user} · signal github` : 'not signed in (gh auth login)') : 'not installed'}`,
      )
      return
    }
    case 'routing': {
      const { api } = client()
      const [verb, id = ''] = rest
      if (verb === 'accept' || verb === 'reject') {
        const decided = await api.routing.decide({ idempotencyKey: key(), proposalId: id, accept: verb === 'accept' })
        console.log(`${decided.state[0]?.toUpperCase()}${decided.state.slice(1)}: ${decided.reason}`)
        return
      }
      const open = (await api.routing.list()).filter((p) => p.state === 'open')
      console.log(
        open
          .map((p) => [`${p.id}  ${p.reason}`, ...p.changes.map((c) => `  ${c.file}\n  - ${c.before}\n  + ${c.after}`)].join('\n'))
          .join('\n\n') || 'No open proposals.',
      )
      return
    }
    case 'status': {
      const { api } = client()
      const [version, queue, signals] = await Promise.all([api.meta.version(), api.queue.list({}), api.signals.list()])
      const count = (band: string) => queue.items.filter((i) => i.band === band).length
      console.log(`Server API v${version.version} on ${paths.socket}`)
      console.log(`Queue: ${count('your_turn')} your turn, ${count('new')} new, ${count('running')} running, ${count('waiting')} waiting`)
      for (const s of signals) {
        console.log(
          `Signal ${s.name}: ${s.health.state}${s.health.message ? ` (${s.health.message})` : ''} · last run ${s.lastRunAt ?? 'never'}`,
        )
      }
      return
    }
    case 'token': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { task: { type: 'string' } } })
      const [name = '', scope = 'read'] = positionals
      const { secret } = await client().api.tokens.create({
        idempotencyKey: key(),
        name,
        scope: scope as 'owner',
        ...(values.task ? { taskId: values.task } : {}),
      })
      console.log(secret)
      return
    }
    case 'mcp': {
      const { api, token } = client()
      await runMcpBridge(api, token)
      return
    }
    case 'hook': {
      await hook(rest[0] ?? '')
      return
    }
    default:
      console.log(HELP)
  }
}

/** A hook's JSON on stdin; empty when there is none within a second. */
const readHookInput = async (): Promise<{
  notification_type?: string
  message?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
}> => {
  const input = await new Promise<string>((resolve) => {
    let data = ''
    process.stdin.on('data', (d: Buffer) => (data += d.toString()))
    process.stdin.on('end', () => resolve(data))
    setTimeout(() => resolve(data), 1000)
  })
  try {
    return JSON.parse(input) as Awaited<ReturnType<typeof readHookInput>>
  } catch {
    return {}
  }
}

/** Called by a session's Claude Code hooks. Never fails the session: errors are swallowed. */
const hook = async (event: string): Promise<void> => {
  const taskId = process.env.AUTOPILOT_TASK
  if (!taskId || !process.env.AUTOPILOT_TOKEN) return
  let state: 'working' | 'idle' | 'waiting_permission' | 'ended'
  // What it is doing, for the running task's line; cleared when it stops.
  let activity: string | null = null
  if (event === 'notification') {
    const payload = await readHookInput()
    if (payload.notification_type !== 'permission_prompt' && !/permission/i.test(payload.message ?? '')) return
    state = 'waiting_permission'
  } else if (event === 'tool') {
    const payload = await readHookInput()
    if (!payload.tool_name) return
    state = 'working'
    activity = activityOf(payload.tool_name, payload.tool_input ?? {})
  } else if (event === 'working') {
    state = 'working'
    activity = 'Reading your message'
  } else if (event === 'idle' || event === 'ended') {
    state = event
  } else {
    return
  }
  try {
    await client().api.sessions.report({ idempotencyKey: key(), taskId, state, ...(activity ? { activity } : {}) })
  } catch {
    // The server being down must not break the session.
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof ORPCError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
