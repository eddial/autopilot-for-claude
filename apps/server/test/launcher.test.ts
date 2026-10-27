import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachLink, CreateTask, PostUpdate, ReportSession } from '@autopilot/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/db.ts'
import { Launcher, trustFolder, type Pty } from '../src/launcher.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('starting Claude Code', () => {
  it('records the launcher’s folders as trusted and keeps the rest of Claude Code’s settings', () => {
    const config = join(mkdtempSync(join(tmpdir(), 'ap-trust-')), '.claude.json')
    writeFileSync(config, JSON.stringify({ userID: 'x', projects: { '/other': { allowedTools: ['Bash'] } } }))
    trustFolder(config, '/work/AP-1')
    trustFolder(config, '/work/AP-1')
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
      userID: 'x',
      projects: { '/other': { allowedTools: ['Bash'] }, '/work/AP-1': { hasTrustDialogAccepted: true } },
    })
  })

  it('reports a session held at a startup screen and stops it', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'ap-launch-'))
    const service = new Service({ db: openDatabase(':memory:') })
    // What the launcher listens with, so the test can play the terminal.
    const terminal: { screen?: (data: string) => void; exit?: (event: { exitCode: number }) => void } = {}
    const pty: Pty = {
      pid: 1,
      write: () => {},
      kill: () => terminal.exit?.({ exitCode: 1 }),
      onData: (listener) => {
        terminal.screen = listener
      },
      onExit: (listener) => {
        terminal.exit = listener
      },
    }
    const launcher = new Launcher({
      service,
      paths: resolvePaths({ AUTOPILOT_DATA: join(dir, 'data') }),
      workstreams: () => [],
      spawn: () => pty,
      self: { node: process.execPath, script: 'autopilot.js' },
    })
    const task = service.createTask(CreateTask.parse({ idempotencyKey: 'launch-0001', title: 'Check the folder prompt' }))
    await launcher.drain()
    terminal.screen?.('\u001b[1mDo you trust this folder?\u001b[0m\r\n❯ 1. Yes, proceed\r\n  2. No, exit\r\n Enter to confirm')
    await vi.advanceTimersByTimeAsync(46_000)

    const detail = service.getTask(task.id)
    expect(detail.session?.state).toBe('ended')
    expect(detail.updates.map((u) => `${u.author}/${u.kind}`)).toEqual(['system/blocked'])
    expect(detail.updates[0]?.body).toContain('Do you trust this folder?')
  })

  it('turns on Auto-fix for a pull request the session links, once it is idle, and only once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-autofix-'))
    const service = new Service({ db: openDatabase(':memory:') })
    const typed: string[] = []
    const launcher = new Launcher({
      service,
      paths: resolvePaths({ AUTOPILOT_DATA: join(dir, 'data') }),
      workstreams: () => [],
      spawn: (): Pty => ({ pid: 1, write: (data) => void typed.push(data), kill: () => {}, onData: () => {}, onExit: () => {} }),
      self: { node: process.execPath, script: 'autopilot.js' },
    })
    const task = service.createTask(CreateTask.parse({ idempotencyKey: 'fix-00001', title: 'Fix the retry bug' }))
    await launcher.drain()
    const report = (state: 'working' | 'idle', n: number) =>
      service.reportSession(ReportSession.parse({ idempotencyKey: `fix-report-${n}`, taskId: task.id, state }))
    report('working', 1)
    const pr = { url: 'https://github.com/acme/api/pull/42', title: 'PR #42: retry the webhook' }
    const attach = (n: number) =>
      service.attachLink(AttachLink.parse({ idempotencyKey: `fix-link-${n}`, taskId: task.id, link: pr }), 'session')
    attach(1)
    attach(2)
    // Still working: it waits for the session to be free.
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toEqual([])
    report('idle', 2)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toEqual([
      '/autofix-pr Keep https://github.com/acme/api/pull/42 green and answer its reviews. Never merge it.',
    ])
    expect(service.getTask(task.id).updates.at(-1)).toMatchObject({ author: 'system', kind: 'event' })
  })

  it('keeps a finished session until the task closes, without holding a slot, and says so when a restart stranded a task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-launch-'))
    const service = new Service({ db: openDatabase(':memory:') })
    const exits: ((event: { exitCode: number }) => void)[] = []
    const spawn = (): Pty => ({
      pid: 1,
      write: () => {},
      kill: () => exits.shift()?.({ exitCode: 0 }),
      onData: () => {},
      onExit: (listener) => {
        exits.push(listener)
      },
    })
    const options = {
      service,
      paths: resolvePaths({ AUTOPILOT_DATA: join(dir, 'data') }),
      workstreams: () => [],
      spawn,
      self: { node: process.execPath, script: 'autopilot.js' },
    }
    const launcher = new Launcher({ ...options, maxParallel: 1 })
    const report = (taskId: string, state: 'working' | 'idle', n: number) =>
      service.reportSession(ReportSession.parse({ idempotencyKey: `report-${taskId}-${n}`, taskId, state }))

    const finished = service.createTask(CreateTask.parse({ idempotencyKey: 'launch-0002', title: 'Draft the reply' }))
    await launcher.drain()
    report(finished.id, 'working', 1)
    service.postUpdate(
      PostUpdate.parse({ idempotencyKey: 'done-00001', taskId: finished.id, kind: 'done', body: 'The draft is in the folder.' }),
      'session',
    )
    report(finished.id, 'idle', 2)
    await launcher.drain()
    const after = service.getTask(finished.id)
    // Back to the owner to close, its session still there to open; idle, it holds no slot.
    expect(after.band).toBe('your_turn')
    expect(after.session?.state).toBe('idle')
    expect(after.updates.map((u) => u.kind)).toEqual(['done'])

    const working = service.createTask(CreateTask.parse({ idempotencyKey: 'launch-0003', title: 'Look into the bug' }))
    await launcher.drain()
    report(working.id, 'working', 1)
    // The server restarts: the new launcher finds the session gone, before it handed over.
    new Launcher(options).reconcile()
    const stranded = service.getTask(working.id)
    expect(stranded.band).toBe('your_turn')
    expect(stranded.updates.map((u) => `${u.author}/${u.kind}`)).toEqual(['system/blocked'])
    expect(stranded.updates[0]?.body).toContain('restarted')

    // A task finished before done waited on the owner: its done was never open. A restart opens it.
    service.db.prepare('update updates set open = 0 where task_id = ?').run(finished.id)
    expect(service.getTask(finished.id).band).toBe('running')
    new Launcher(options).reconcile()
    expect(service.getTask(finished.id).band).toBe('your_turn')
  })
})
