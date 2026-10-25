import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateTask } from '@autopilot/contracts'
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
})
