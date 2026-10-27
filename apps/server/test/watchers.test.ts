import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Workstream } from '@autopilot/contracts'
import { CreateTask, WaitOn } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'
import type { RunClaude } from '../src/signals.ts'
import { Watchers } from '../src/watchers.ts'

const PROMPTS = join(import.meta.dirname, '..', '..', '..', 'prompts')

const workstream = (autonomy: number): Workstream => ({
  name: 'engineering',
  routing: 'Code.',
  urgent: 'prod down',
  work: '',
  autonomy,
  repo: null,
  folder: null,
  machineId: null,
})

const setup = (autonomy: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-watch-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(paths.home, { recursive: true })
  let clock = Date.parse('2026-10-25T10:00:00Z')
  const service = new Service({ db: openDatabase(':memory:'), now: () => new Date(clock) })
  const replies: { fingerprint: string; changed: boolean; summary: string }[] = []
  let calls = 0
  const runClaude: RunClaude = () => {
    calls++
    const next = replies.shift() ?? { fingerprint: 'same', changed: false, summary: '' }
    return Promise.resolve({ ...next, sources: ['https://github.com/acme/app/pull/7'] })
  }
  const watchers = new Watchers({ service, paths, workstreams: () => [workstream(autonomy)], runClaude, prompts: PROMPTS, owner: 'Badr' })
  const task = service.createTask(
    CreateTask.parse({ idempotencyKey: 'create-1', title: 'Ship the fix', workstream: 'engineering', start: false }),
    'owner',
  )
  service.waitOn(
    WaitOn.parse({
      idempotencyKey: 'wait-0001',
      id: task.id,
      on: 'Joris to review',
      watcher: { what: 'PR #7 review', every: '30m', until: '2026-10-26T10:00:00Z', tools: ['Bash(gh:*)'] },
    }),
    'session',
  )
  return { service, watchers, task, replies, calls: () => calls, advance: (minutes: number) => (clock += minutes * 60_000) }
}

describe('watchers', () => {
  it('sets a baseline, checks every interval, and wakes the session on news', async () => {
    const { service, watchers, task, replies, calls, advance } = setup(3)
    replies.push({ fingerprint: 'r0', changed: false, summary: '' })
    await watchers.tick()
    advance(10)
    await watchers.tick()
    expect(calls()).toBe(1)

    advance(30)
    replies.push({ fingerprint: 'r1', changed: true, summary: 'Joris approved.' })
    await watchers.tick()
    const detail = service.getTask(task.id)
    expect(detail.updates.at(-1)).toMatchObject({ author: 'watcher', kind: 'info', body: 'PR #7 review: Joris approved.' })
    expect(detail.band).toBe('running')
    expect(service.pendingOutbox().map((o) => o.kind)).toEqual(['start_session'])
  })

  it('puts news on your turn, in plain words, when the workstream may not start by itself', async () => {
    const { service, watchers, task, replies, advance } = setup(2)
    replies.push({ fingerprint: 'r0', changed: false, summary: '' }, { fingerprint: 'r1', changed: true, summary: 'Joris approved.' })
    await watchers.tick()
    advance(30)
    await watchers.tick()
    const detail = service.getTask(task.id)
    expect(detail).toMatchObject({ band: 'your_turn' })
    // What happened, first, in plain words; the watcher's own note stays out.
    expect(detail.updates.at(-1)?.body).toMatch(/^Joris approved\./)
    expect(service.pendingOutbox()).toEqual([])
  })

  it('expires into a question when nothing came back in time', async () => {
    const { service, watchers, task, advance } = setup(3)
    advance(25 * 60)
    await watchers.tick()
    const detail = service.getTask(task.id)
    expect(detail.watchers).toEqual([])
    expect(detail.band).toBe('your_turn')
    expect(detail.updates.at(-1)).toMatchObject({ author: 'system', kind: 'question', open: true })
  })
})
