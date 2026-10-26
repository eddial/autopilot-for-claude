import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openDatabase } from '../src/db.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'
import { claudeHeadless, Signals, type RunClaude, type SignalOutput } from '../src/signals.ts'

const PROMPTS = join(import.meta.dirname, '..', '..', '..', 'prompts')

const setup = (runClaude: RunClaude) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-sig-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'signals'), { recursive: true })
  mkdirSync(paths.data, { recursive: true })
  writeFileSync(
    join(paths.home, 'signals', 'slack.md'),
    '---\nevery: 5m\ntools: [mcp__claude_ai_Slack__slack_read_thread]\n---\nDMs and mentions.\n',
  )
  let clock = Date.parse('2026-10-25T10:00:00Z')
  const service = new Service({ db: openDatabase(':memory:'), now: () => new Date(clock) })
  const signals = new Signals({
    service,
    paths,
    workstreams: () => [],
    runClaude,
    prompts: PROMPTS,
    owner: 'Badr',
    self: { node: process.execPath, script: 'autopilot.js' },
  })
  return { service, signals, advance: (minutes: number) => (clock += minutes * 60_000), dir }
}

const item = (over: Partial<SignalOutput['items'][number]> = {}): SignalOutput['items'][number] => ({
  action: 'create',
  url: 'https://example.slack.com/archives/D1/p1',
  title: 'Answer Joris about the 3.14 release',
  sender: 'Joris',
  channel: 'DM',
  at: '2026-10-25T10:03:00Z',
  summary: 'Joris asks when 3.14 ships.',
  workstream: 'customers',
  reason: 'asks you',
  searches: ['3.14'],
  gated: false,
  ...over,
})

describe('signal runs', () => {
  it('starts from now on the first run, then files each new window once', async () => {
    let calls = 0
    const { service, signals, advance } = setup(() => {
      calls++
      return Promise.resolve({ items: [item(), item({ action: 'drop', url: 'https://example.slack.com/x', reason: 'FYI' })] })
    })
    expect(await signals.run('slack')).toEqual([])
    expect(calls).toBe(0)

    advance(5)
    const decisions = await signals.run('slack')
    expect(decisions.map((d) => d.action)).toEqual(['created', 'dropped'])

    // An overlapping window sees the same item again: it is applied once.
    advance(5)
    await signals.run('slack')
    expect(service.queue().items).toHaveLength(1)
    expect(signals.list()[0]).toMatchObject({ health: { state: 'ok' }, last24h: { filed: 1 } })
  })

  it('files nothing on a dry run', async () => {
    const { service, signals } = setup(() => Promise.resolve({ items: [item()] }))
    const preview = await signals.run('slack', 60)
    expect(preview.map((d) => d.action)).toEqual(['created'])
    expect(service.queue().items).toEqual([])
  })

  it('files the rest of a run when one item has a link that is not a URL', async () => {
    const { service, signals, advance } = setup(() =>
      Promise.resolve({ items: [item({ url: '#devs', title: 'No link' }), item({ url: 'https://example.slack.com/y', title: 'Good' })] }),
    )
    await signals.run('slack')
    // The first run starts from now; the next one files.
    advance(5)
    const decisions = await signals.run('slack')
    expect(decisions.map((d) => d.action)).toEqual(['dropped', 'created'])
    expect(service.queue().items.map((i) => i.task.title)).toEqual(['Good'])
    expect(signals.list()[0]?.health.state).toBe('ok')
  })

  it('keeps the window and reports failing when a run fails', async () => {
    let fail = false
    const { signals, advance } = setup(() => (fail ? Promise.reject(new Error('Slack unreachable')) : Promise.resolve({ items: [] })))
    await signals.run('slack')
    const started = signals.list()[0]?.lastRunAt
    advance(5)
    fail = true
    await expect(signals.run('slack')).rejects.toThrow('Slack unreachable')
    expect(signals.list()[0]?.health).toMatchObject({ state: 'failing', message: 'Slack unreachable' })
    expect(started).not.toBeNull()
  })
})

const ticket = (id: string, closed = false) =>
  item({ url: `https://linear.app/acme/issue/${id}`, title: `Ticket ${id}`, ticket: { id, closed } })

describe('importing what is still open', () => {
  it('files each open ticket once, without a first look, and leaves the rest alone', async () => {
    const { service, signals } = setup(() => Promise.resolve({ items: [ticket('ENG-1'), ticket('ENG-2'), ticket('ENG-3', true)] }))

    expect((await signals.importOpen('slack', true)).map((d) => d.action)).toEqual(['created', 'created'])
    expect(service.queue().items).toEqual([])

    const filed = await signals.importOpen('slack')
    expect(filed.map((d) => d.action)).toEqual(['created', 'created'])
    const tasks = service.queue().items.map((i) => i.task)
    expect(tasks.map((t) => t.source.mirrors).toSorted()).toEqual(['ENG-1', 'ENG-2'])
    expect(tasks.every((t) => service.jobRanAt(`scout:${t.id}`) !== null)).toBe(true)

    // Again: everything is already there, and nothing is added to it.
    expect((await signals.importOpen('slack')).map((d) => d.action)).toEqual(['dropped', 'dropped'])
    expect(tasks.map((t) => service.getTask(t.id).updates.length)).toEqual([0, 0])
  })
})

describe('the onboarding sweep', () => {
  it('reads the sources over the days asked, with their own tools, and files nothing', async () => {
    let asked = { prompt: '', tools: [] as string[] }
    const suggestion = { name: 'customers', routing: 'Questions from customers.', urgent: '', evidence: ['Acme asks about SSO'], count: 4 }
    const { service, signals } = setup((prompt, options) => {
      asked = { prompt, tools: options.tools }
      return Promise.resolve({ workstreams: [suggestion] })
    })
    expect(await signals.sweep(['slack'], 14)).toEqual([suggestion])
    expect(asked.tools).toEqual(['mcp__claude_ai_Slack__slack_read_thread'])
    expect(asked.prompt).toContain('# Source: slack')
    expect(asked.prompt).toContain('from 2026-10-11T10:00:00.000Z')
    expect(service.queue().items).toEqual([])
  })
})

describe('switching a signal on', () => {
  it('takes the paused line out of a signal file that starts paused', () => {
    const { signals, dir } = setup(() => Promise.resolve({ items: [] }))
    writeFileSync(join(dir, 'home', 'signals', 'slack.md'), '---\npaused: true\nevery: 5m\n---\nDMs.\n')
    expect(signals.list()[0]?.paused).toBe(true)
    expect(signals.pause('slack', false).paused).toBe(false)
    expect(readFileSync(join(dir, 'home', 'signals', 'slack.md'), 'utf8')).toBe('---\nevery: 5m\n---\nDMs.\n')
  })
})

describe('describing a signal', () => {
  it('rewrites what it picks up and keeps its settings', () => {
    const { signals, dir } = setup(() => Promise.resolve({ items: [] }))
    writeFileSync(join(dir, 'home', 'signals', 'slack.md'), '---\nevery: 5m\n---\nDMs.\n')
    expect(signals.describe('slack', 'DMs and mentions.').rules).toBe('DMs and mentions.')
    expect(readFileSync(join(dir, 'home', 'signals', 'slack.md'), 'utf8')).toBe('---\nevery: 5m\n---\nDMs and mentions.\n')
  })
})

describe('removing a signal', () => {
  it('moves its file to retired, where it can be put back', () => {
    const { signals, dir } = setup(() => Promise.resolve({ items: [] }))
    writeFileSync(join(dir, 'home', 'signals', 'slack.md'), '---\nevery: 5m\n---\nDMs.\n')
    expect(signals.remove('slack')).toEqual([])
    expect(readFileSync(join(dir, 'home', 'retired', 'signals', 'slack.md'), 'utf8')).toBe('---\nevery: 5m\n---\nDMs.\n')
  })
})

describe('signal health', () => {
  it('reports a signal failing for an hour and three runs once, and closes it when it runs again', async () => {
    let fail = true
    const { service, signals, advance } = setup(() =>
      fail ? Promise.reject(new Error('Slack unreachable')) : Promise.resolve({ items: [] }),
    )
    await signals.run('slack')
    for (let i = 0; i < 4; i++) {
      advance(25)
      await signals.run('slack').catch(() => {})
    }
    const reported = service.queue({ workstream: 'autopilot' }).items
    expect(reported.map((i) => [i.task.title, i.band])).toEqual([['The slack signal is failing', 'your_turn']])

    fail = false
    advance(5)
    await signals.run('slack')
    expect(service.getTask(reported[0]?.task.id ?? '').band).toBe('done')
  })

  it('asks about the time a run could not reach back to', async () => {
    const { service, signals, advance } = setup(() => Promise.resolve({ items: [] }))
    await signals.run('slack')
    advance(4 * 24 * 60)
    await signals.run('slack')
    expect(service.queue({ workstream: 'autopilot' }).items.map((i) => i.task.title)).toEqual(['Check what the slack signal missed'])
  })
})

describe('digest signals', () => {
  it('waits for the schedule, covers the whole cap the first time, and retries a failure every interval', async () => {
    const prompts: string[] = []
    let fail = false
    const { signals, advance, dir } = setup((prompt) => {
      prompts.push(prompt)
      return fail ? Promise.reject(new Error('down')) : Promise.resolve({ items: [] })
    })
    writeFileSync(join(dir, 'home', 'signals', 'slack.md'), '---\npaused: true\n---\n')
    // Ticks come every 30 seconds; a longer gap reads as a wake from sleep, which only resets clocks.
    const tick = async () => {
      await signals.tick()
      await signals.tick()
    }
    writeFileSync(join(dir, 'home', 'signals', 'digest.md'), '---\ncron: 0 * * * *\nevery: 10m\nwindow_cap: 8d\n---\nWhat shipped.\n')
    await tick()
    advance(30)
    await tick()
    expect(prompts).toHaveLength(0)

    advance(30)
    await tick()
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('from 2026-10-17T11:00:00.000Z up to 2026-10-25T11:00:00.000Z')

    advance(60)
    fail = true
    await tick()
    advance(5)
    await tick()
    advance(5)
    fail = false
    await tick()
    expect(prompts).toHaveLength(3)
    expect(prompts[2]).toContain('from 2026-10-25T10:58:00.000Z')
  })
})

const fakeClaude = (dir: string, initTools: string[]) => {
  const file = join(dir, 'claude')
  const events = [
    { type: 'system', subtype: 'init', tools: initTools },
    { type: 'result', is_error: false, structured_output: { items: [] } },
  ]
  // Like Claude Code, it refuses a schema that names its draft.
  const refuse = `case "$*" in *'"$schema"'*) echo 'Error: --json-schema is not a valid JSON Schema' >&2; exit 1;; esac`
  writeFileSync(file, `#!/bin/sh\n${refuse}\ncat > /dev/null\ncat <<'EOF'\n${events.map((e) => JSON.stringify(e)).join('\n')}\nEOF\n`)
  chmodSync(file, 0o755)
  return file
}
const options = (dir: string) => ({
  tools: ['mcp__claude_ai_Slack__read'],
  model: 'haiku',
  schema: z.toJSONSchema(z.object({ items: z.array(z.string()) })),
  mcpConfig: '/dev/null',
  cwd: dir,
})

describe('claudeHeadless', () => {
  it('returns the structured output when the connector tools are there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-cl-'))
    const run = claudeHeadless(fakeClaude(dir, ['mcp__claude_ai_Slack__read']), () => Promise.resolve())
    expect(await run('prompt', options(dir))).toEqual({ items: [] })
  })

  it('retries once, then fails, when a connector tool is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-cl-'))
    let waited = 0
    const run = claudeHeadless(fakeClaude(dir, []), () => Promise.resolve(waited++))
    await expect(run('prompt', options(dir))).rejects.toThrow('Tools not available')
    expect(waited).toBe(1)
  })
})
