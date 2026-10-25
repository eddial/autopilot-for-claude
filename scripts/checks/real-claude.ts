// A real Claude Code session, end to end: started by the launcher, it asks through the Autopilot MCP
// tools, takes the answer once idle, and hands over. Run by scripts/mac-check.sh.
import { checkServer, key, run, waitFor } from './lib.ts'

const { api } = checkServer()

const BRIEF = `This is an automated check of Autopilot, not real work. Do exactly this and nothing else:
1. Call post_update with kind "decision", body "Which colour should the check use?", and options [{"id":"red","label":"Red"},{"id":"blue","label":"Blue"}].
2. Stop and wait for the answer. Do not do anything else.
3. When the owner's answer arrives, call post_update with kind "done" and body "The check used <the colour>." Then stop.`

let id = ''
let asked = ''
let answeredAt = ''
let choice = { id: '', label: '' }

await run('A real Claude Code session', [
  [
    'Create a task and start its session',
    async () => {
      const task = await api.tasks.create({ idempotencyKey: key(), title: 'Autopilot check: pick a colour', brief: BRIEF, start: true })
      id = task.id
      return id
    },
  ],
  [
    'The session starts and reports through its hooks',
    async () => {
      const session = await waitFor('the session to report working or idle', 120, async () => {
        const s = (await api.tasks.get({ id })).session
        return s && s.state !== 'starting' ? s : null
      })
      return `state ${session.state}, cwd ${session.cwd}`
    },
  ],
  [
    'The session posts a decision through the Autopilot MCP tools',
    async () => {
      const ask = await waitFor('a decision', 300, async () => (await api.tasks.get({ id })).updates.find((u) => u.kind === 'decision' && u.open))
      asked = ask.id
      // Blue if Claude offered it as asked, else whatever it offered first.
      choice = ask.options.find((o) => /blue/i.test(`${o.id} ${o.label}`)) ?? ask.options[0] ?? choice
      if (!choice.id) throw new Error('The decision came without options')
      return `${ask.body} [${ask.options.map((o) => o.id).join(', ')}]`
    },
  ],
  [
    'Remote Control gave the session a claude.ai link',
    async () => {
      const session = await waitFor('the Remote Control link', 60, async () => (await api.tasks.get({ id })).session?.remoteControlUrl)
      return session.replace(/session_[A-Za-z0-9]+/, 'session_…')
    },
  ],
  [
    'The answer is delivered once the session is idle, and it hands over',
    async () => {
      answeredAt = new Date().toISOString()
      await api.updates.answer({ idempotencyKey: key(), updateId: asked, optionId: choice.id })
      const done = await waitFor('the done update', 300, async () =>
        (await api.tasks.get({ id })).updates.find((u) => u.kind === 'done' && u.createdAt > answeredAt),
      )
      const words = choice.label.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      if (!words.some((w) => done.body.toLowerCase().includes(w))) throw new Error(`The session handed over without the answer (${choice.label}): ${done.body}`)
      return done.body
    },
  ],
  [
    'Closing the task ends the session',
    async () => {
      await api.tasks.close({ idempotencyKey: key(), id, outcome: 'done' })
      const ended = await waitFor('the session to end', 60, async () => ((await api.tasks.get({ id })).session?.state === 'ended' ? true : null))
      return String(ended)
    },
  ],
])

// The whole conversation, for the report.
if (id) {
  const detail = await api.tasks.get({ id }).catch(() => null)
  console.log('Updates:')
  for (const u of detail?.updates ?? []) console.log(`- ${u.author}/${u.kind}: ${u.body.slice(0, 160).replace(/\n/g, ' ')}`)
  console.log('')
}
