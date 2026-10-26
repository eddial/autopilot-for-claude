import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateTask } from '@autopilot/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.ts'
import { Launcher } from '../src/launcher.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'
import { connectSessionHost, runSessionHost } from '../src/session-host.ts'

let closeHost: (() => Promise<void>) | null = null
afterEach(async () => {
  await closeHost?.()
  closeHost = null
})

describe('the session host', () => {
  it('keeps a session running while the server restarts, and the new server picks it up, link and all', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ap-host-')))
    // Stands in for Claude Code: says its Remote Control link, then stays until stopped.
    const claude = join(dir, 'claude.sh')
    writeFileSync(claude, '#!/bin/sh\necho "https://claude.ai/code/session_kept"\nsleep 60\n')
    chmodSync(claude, 0o755)
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    const socket = join(dir, 'h.sock')
    closeHost = (await runSessionHost(socket)).close
    const service = new Service({ db: openDatabase(':memory:') })

    const server = async () => {
      const host = await connectSessionHost(socket, null)
      const launcher = new Launcher({
        service,
        paths,
        workstreams: () => [],
        spawn: host.spawn,
        attach: host.attach,
        claude,
        self: { node: process.execPath, script: 'autopilot.js' },
      })
      await launcher.attach()
      launcher.reconcile()
      return { host, launcher }
    }
    const link = async (taskId: string) => {
      for (let i = 0; i < 50 && !service.getTask(taskId).session?.remoteControlUrl; i++) await new Promise((r) => setTimeout(r, 50))
      return service.getTask(taskId).session
    }

    const first = await server()
    const task = service.createTask(CreateTask.parse({ idempotencyKey: 'host-00001', title: 'Draft the update' }))
    await first.launcher.drain()
    const before = await link(task.id)
    expect(before?.remoteControlUrl).toBe('https://claude.ai/code/session_kept')

    // The server stops and starts again; the session runs on in the host.
    first.launcher.stopAll()
    first.host.close()
    await server()
    const after = service.getTask(task.id).session
    expect({ id: after?.id, state: after?.state, link: after?.remoteControlUrl }).toEqual({
      id: before?.id,
      state: 'starting',
      link: 'https://claude.ai/code/session_kept',
    })
  })
})
