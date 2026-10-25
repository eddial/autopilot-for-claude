import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  writeFileSync(join(paths.home, 'signals', 'slack.md'), '---\nevery: 5m\ntools: [mcp__claude_ai_Slack__slack_read_thread]\n---\nDMs and mentions.\n')
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

describe('digest signals', () => {
  it('waits for the schedule, covers the whole cap the first time, and retries a failure every interval', async () => {
    const prompts: string[] = []
    let fail = false
    const { signals, advance, dir } = setup((prompt) => {
      prompts.push(prompt)
      return fail ? Promise.reject(new Error('down')) : Promise.resolve({ items: [] })
    })
    writeFileSync(join(dir, 'home', 'signals', 'slack.md'), '---\npaused: true\n---\n')
    writeFileSync(join(dir, 'home', 'signals', 'digest.md'), '---\ncron: 0 * * * *\nevery: 10m\nwindow_cap: 8d\n---\nWhat shipped.\n')
    await signals.tick()
    advance(30)
    await signals.tick()
    expect(prompts).toHaveLength(0)

    advance(30)
    await signals.tick()
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('from 2026-10-17T11:00:00.000Z up to 2026-10-25T11:00:00.000Z')

    advance(60)
    fail = true
    await signals.tick()
    advance(5)
    await signals.tick()
    advance(5)
    fail = false
    await signals.tick()
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
  writeFileSync(file, `#!/bin/sh\ncat > /dev/null\ncat <<'EOF'\n${events.map((e) => JSON.stringify(e)).join('\n')}\nEOF\n`)
  chmodSync(file, 0o755)
  return file
}
const options = (dir: string) => ({ tools: ['mcp__claude_ai_Slack__read'], model: 'haiku', schema: {}, mcpConfig: '/dev/null', cwd: dir })

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
