import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * A launcher on fake terminals: what it types, and a way to draw on the last one's screen.
 * `spawned` is every Claude Code it starts, where and with what; `checkouts` and `prBranch` stand
 * in for this Mac's checkouts and GitHub.
 */
const autofixSession = async (
  key: string,
  options: { checkouts?: Record<string, string>; prBranch?: (url: string) => string | null } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-autofix-'))
  const service = new Service({ db: openDatabase(':memory:') })
  const typed: string[] = []
  const spawned: { cwd: string; args: string[]; killed: boolean }[] = []
  const terminal: { draw?: (data: string) => void } = {}
  const launcher = new Launcher({
    service,
    paths: resolvePaths({ AUTOPILOT_DATA: join(dir, 'data') }),
    workstreams: () => [],
    spawn: (_file, args, { cwd }): Pty => {
      const run = { cwd, args, killed: false }
      spawned.push(run)
      return {
        pid: 1,
        write: (data) => void typed.push(data),
        kill: () => {
          run.killed = true
        },
        onData: (listener) => {
          terminal.draw = listener
        },
        onExit: () => {},
      }
    },
    self: { node: process.execPath, script: 'autopilot.js' },
    checkouts: () => ({ repos: options.checkouts ?? {}, fallback: null }),
    prBranch: options.prBranch ?? (() => null),
    claudeHome: join(dir, 'claude'),
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
  /** What `/autofix-pr` leaves behind: the cloud session, recorded as a background task of `session` in `folder`. */
  const recordAutofix = (pr: number, taskId: string, session: string, folder: string, conversation = true) => {
    const project = join(dir, 'claude', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(join(project, session, 'remote-agents'), { recursive: true })
    if (conversation) writeFileSync(join(project, `${session}.jsonl`), `${JSON.stringify({ type: 'user', cwd: folder })}\n`)
    const file = join(project, session, 'remote-agents', `remote-agent-${taskId}.meta.json`)
    writeFileSync(
      file,
      JSON.stringify({
        taskId,
        remoteTaskType: 'autofix-pr',
        sessionId: `session_${taskId}`,
        remoteTaskMetadata: { owner: 'acme', repo: 'api', prNumber: pr },
      }),
    )
    return file
  }
  return { service, launcher, task, cwd, typed, spawned, report, attach, draw, recordAutofix }
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })

/** A checkout of acme/api with a worktree on `branch`, as a session in another repository leaves it. */
const acmeCheckout = (branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'ap-acme-'))
  git(clone, 'init', '-q', '-b', 'main')
  git(clone, 'remote', 'add', 'origin', 'git@github.com:acme/api.git')
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first')
  const worktree = join(mkdtempSync(join(tmpdir(), 'ap-acme-wt-')), 'fix')
  git(clone, 'worktree', 'add', '-q', '-b', branch, worktree)
  return { clone, worktree: realpathSync(worktree) }
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

  it('turns on Auto-fix for a pull request the session links, once it is idle and only once, and not once switched off', async () => {
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

    // Switched off: a new pull request gets none, and `/autofix-pr` is never typed to stop one.
    report('idle', 3)
    service.editTask(EditTask.parse({ idempotencyKey: 'fix-off-1', id: task.id, autofix: false }))
    await launcher.drain()
    report('idle', 4)
    attach(3, 43)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toHaveLength(1)
  })

  it('stops Auto-fix through the background task of the session that started it, and says it is off only once Claude Code has', async () => {
    const { service, launcher, task, cwd, typed, spawned, report, recordAutofix } = await autofixSession('stop')
    const { worktree } = acmeCheckout('claude/fix')
    const session = service.getTask(task.id).session?.id ?? ''
    for (const pr of [42, 43])
      service.attachLink(
        AttachLink.parse({
          idempotencyKey: `stop-link-${pr}`,
          taskId: task.id,
          link: { url: `https://github.com/acme/api/pull/${pr}`, title: `PR #${pr}` },
        }),
        'owner',
      )
    // #42 from the task's session; #43 from a short Claude Code in another checkout, long closed.
    const own = recordAutofix(42, 'rauto0042', session, cwd)
    const short = recordAutofix(43, 'rauto0043', 'short-session', worktree)
    vi.useFakeTimers()

    // Switched off: the task's session is asked once it is idle; the other is resumed where it ran.
    report('working', 1)
    service.editTask(EditTask.parse({ idempotencyKey: 'stop-off-01', id: task.id, autofix: false }))
    await launcher.drain()
    expect(typed.filter((t) => t.includes('TaskStop'))).toEqual([])
    report('idle', 2)
    await launcher.drain()
    const asked = typed.filter((t) => t.includes('TaskStop'))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(
      'Auto-fix is now off for https://github.com/acme/api/pull/42. Stop its cloud session: call TaskStop with task_id rauto0042.',
    )
    const resumed = spawned.at(-1)
    expect(resumed?.cwd).toBe(worktree)
    expect(resumed?.args.slice(0, 2)).toEqual(['--resume', 'short-session'])
    expect(resumed?.args.at(-1)).toContain('call TaskStop with task_id rauto0043.')
    expect(typed.some((t) => t.startsWith('/autofix-pr stop'))).toBe(false)

    // Off once Claude Code has removed the record, not before.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(service.getTask(task.id).updates.some((u) => u.body.startsWith('Turned off'))).toBe(false)
    rmSync(own)
    rmSync(short)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.getTask(task.id).updates.map((u) => u.body)).toEqual(
      expect.arrayContaining([
        'Turned off Auto-fix for https://github.com/acme/api/pull/42: its cloud session is stopped (https://claude.ai/code/session_rauto0042)',
        'Turned off Auto-fix for https://github.com/acme/api/pull/43: its cloud session is stopped (https://claude.ai/code/session_rauto0043)',
      ]),
    )
    expect(resumed?.killed).toBe(true)
  })

  it('says when Auto-fix did not stop, with where to stop it', async () => {
    const { service, launcher, task, cwd, report, recordAutofix } = await autofixSession('late')
    service.attachLink(
      AttachLink.parse({
        idempotencyKey: 'late-link-1',
        taskId: task.id,
        link: { url: 'https://github.com/acme/api/pull/42', title: 'PR #42' },
      }),
      'owner',
    )
    recordAutofix(42, 'rauto0042', service.getTask(task.id).session?.id ?? '', cwd)
    // One started by a Claude Code that only ran `/autofix-pr`: no conversation to resume it with.
    recordAutofix(42, 'rauto0099', 'no-conversation', cwd, false)
    vi.useFakeTimers()
    report('idle', 1)
    service.editTask(EditTask.parse({ idempotencyKey: 'late-off-01', id: task.id, autofix: false }))
    await launcher.drain()
    expect(service.getTask(task.id).updates.at(-1)).toMatchObject({
      kind: 'blocked',
      body: 'Auto-fix for https://github.com/acme/api/pull/42 is still on: the Claude Code that started it has no conversation to bring it back with. Stop it at https://claude.ai/code/session_rauto0099 (archive the session), then reply here.',
    })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(service.getTask(task.id).updates.at(-1)?.body).toBe(
      'Auto-fix for https://github.com/acme/api/pull/42 is still on: it did not stop within two minutes. Stop it at https://claude.ai/code/session_rauto0042 (archive the session), then reply here.',
    )
  })

  it('never leaves a session held by Auto-fix, and tells the owner when it is not on: no checkout to start from, or a failure', async () => {
    const { service, launcher, task, cwd, typed, report, attach, draw } = await autofixSession('fail')
    report('idle', 1)
    // The session's folder has no remote for acme/api and no worktree has the branch out: nothing
    // is typed, and the owner hears it, with what to do.
    attach(1)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toEqual([])
    expect(service.getTask(task.id).session?.state).toBe('idle')
    const missing = service.getTask(task.id)
    expect(missing.band).toBe('your_turn')
    expect(missing.updates.at(-1)).toMatchObject({ author: 'system', kind: 'blocked', open: true })
    expect(missing.updates.at(-1)?.body).toContain('Auto-fix is not on for https://github.com/acme/api/pull/42')
    expect(missing.updates.at(-1)?.body).toContain('/autofix-pr https://github.com/acme/api/pull/42')

    // It fails anyway: the message is closed, the owner hears it, and the session is free.
    git(cwd, 'remote', 'add', 'origin', 'https://github.com/acme/api.git')
    attach(2, 43)
    await launcher.drain()
    expect(typed.filter((t) => t.startsWith('/autofix-pr'))).toHaveLength(1)
    draw("\r\n Autofix PR failed: can't start autofix —\r\n   Cloud agents need a moment.\r\n Esc/Enter to close")
    await vi.waitFor(() => expect(service.getTask(task.id).session?.state).toBe('idle'))
    expect(typed.at(-1)).toBe('\u001b')
    expect(service.getTask(task.id).updates.at(-1)).toMatchObject({ kind: 'blocked' })
    expect(service.getTask(task.id).updates.at(-1)?.body).toContain('Auto-fix is not on for https://github.com/acme/api/pull/43')
    expect(service.getTask(task.id).updates.at(-1)?.body).toContain('Cloud agents need a moment')
  })

  it('turns on Auto-fix from the worktree a pull request was opened from, in another repository than the session’s', async () => {
    const { clone, worktree } = acmeCheckout('fix-retry')
    const { service, launcher, task, cwd, spawned, report, attach, draw } = await autofixSession('elsewhere', {
      checkouts: { 'acme/api': clone },
      prBranch: (url) => (url.endsWith('/42') ? 'fix-retry' : null),
    })
    // Still working: it does not wait on the session, whose folder is not where Auto-fix starts.
    report('working', 1)
    attach(1)
    await launcher.drain()
    const run = spawned.at(-1)
    expect(spawned).toHaveLength(2)
    expect(run?.cwd).toBe(worktree)
    expect(run?.cwd).not.toBe(cwd)
    expect(run?.args.at(-1)).toBe('/autofix-pr Keep https://github.com/acme/api/pull/42 green and answer its reviews. Never merge it.')
    expect(service.getTask(task.id).session?.state).toBe('working')
    draw('\r\n Autofix PR\r\n Before you start\r\n ❯ 1. Continue  start monitoring this PR\r\n   2. Not now\r\n Esc to cancel')
    draw('\r\n ⎿  Spawned cloud autofix PR session on fix-retry (PR #42)\r\n')
    await vi.waitFor(() => expect(run?.killed).toBe(true))
    const detail = service.getTask(task.id)
    expect(detail.updates.at(-1)).toMatchObject({ author: 'system', kind: 'event' })
    expect(detail.updates.at(-1)?.body).toContain(`Turned on Auto-fix for https://github.com/acme/api/pull/42 (started from ${worktree})`)
    expect(detail.band).toBe('running')
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
