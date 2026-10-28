import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachLink, CreateTask, EditTask, PostUpdate, ReportSession } from '@autopilot/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/db.ts'
import { Launcher, trustFolder, type Pty } from '../src/launcher.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'

afterEach(() => {
  vi.useRealTimers()
})

/** A launcher on a fake terminal: what it types, and a way to draw on its screen. */
const autofixSession = async (key: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-autofix-'))
  const service = new Service({ db: openDatabase(':memory:') })
  const typed: string[] = []
  const terminal: { draw?: (data: string) => void } = {}
  const launcher = new Launcher({
    service,
    paths: resolvePaths({ AUTOPILOT_DATA: join(dir, 'data') }),
    workstreams: () => [],
    spawn: (): Pty => ({
      pid: 1,
      write: (data) => void typed.push(data),
      kill: () => {},
      onData: (listener) => {
        terminal.draw = listener
      },
      onExit: () => {},
    }),
    self: { node: process.execPath, script: 'autopilot.js' },
  })
  const task = service.createTask(CreateTask.parse({ idempotencyKey: `${key}-00001`, title: 'Fix the retry bug' }))
  await launcher.drain()
  const cwd = service.getTask(task.id).session?.cwd ?? ''
  const report = (state: 'working' | 'idle', n: number) =>
    service.reportSession(ReportSession.parse({ idempotencyKey: `${key}-report-${n}`, taskId: task.id, state }))
  const attach = (n: number, pr = 42) =>
    service.attachLink(
      AttachLink.parse({
        idempotencyKey: `${key}-link-${n}`,
        taskId: task.id,
        link: { url: `https://github.com/acme/api/pull/${pr}`, title: `PR #${pr}` },
      }),
      'session',
    )
  const draw = (data: string) => terminal.draw?.(data)
  return { service, launcher, task, cwd, typed, report, attach, draw }
}

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

  it('turns on Auto-fix for a pull request the session links, once it is idle and only once, and stops it when switched off', async () => {
    const { service, launcher, task, cwd, typed, report, attach, draw } = await autofixSession('fix')
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'git@github.com:acme/api.git'])
    report('working', 1)
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
    // It asks first, with nobody at the terminal: Continue. Answers wait meanwhile.
    expect(service.getTask(task.id).session?.state).toBe('working')
    const keys = typed.length
    draw('\r\n Autofix PR\r\n Before you start\r\n ❯ 1. Continue  start monitoring this PR\r\n   2. Not now\r\n Esc to cancel')
    await vi.waitFor(() => expect(typed.slice(keys)).toEqual(['\r']))
    // Started: the session is free again, with no Stop hook to say so.
    draw('\r\n ⎿  Spawned cloud autofix PR session on claude/fix (PR #42)\r\n')
    await vi.waitFor(() => expect(service.getTask(task.id).session?.state).toBe('idle'))
    expect(service.getTask(task.id).updates.at(-1)).toMatchObject({ author: 'system', kind: 'event' })
    expect(service.getTask(task.id).updates.at(-1)?.body).toContain('Turned on Auto-fix')

    // Switched off: stopped on that pull request, and a new one gets none.
    report('idle', 3)
    service.editTask(EditTask.parse({ idempotencyKey: 'fix-off-1', id: task.id, autofix: false }))
    await launcher.drain()
    report('idle', 4)
    attach(3, 43)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr')).slice(1)).toEqual(['/autofix-pr stop'])
  })

  it('never leaves a session held by Auto-fix: skipped outside the pull request’s repository, and a failure closed and said', async () => {
    const { service, launcher, task, cwd, typed, report, attach, draw } = await autofixSession('fail')
    report('idle', 1)
    // A checkout with no remote for acme/api: Auto-fix would fail there, so it is not typed.
    attach(1)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toEqual([])
    expect(service.getTask(task.id).session?.state).toBe('idle')
    expect(service.getTask(task.id).updates.at(-1)?.body).toContain('no GitHub remote for acme/api')

    // It fails anyway: the message is closed and goes on the task, and the session is free.
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/acme/api.git'])
    attach(2, 43)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toHaveLength(1)
    draw("\r\n Autofix PR failed: can't start autofix —\r\n   Cloud agents need a moment.\r\n Esc/Enter to close")
    await vi.waitFor(() => expect(service.getTask(task.id).session?.state).toBe('idle'))
    expect(typed.at(-1)).toBe('\u001b')
    expect(service.getTask(task.id).updates.at(-1)?.body).toContain('Auto-fix could not start for https://github.com/acme/api/pull/43')
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
