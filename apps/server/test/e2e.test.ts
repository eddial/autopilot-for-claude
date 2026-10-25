import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Change, QueueEvent } from '@autopilot/contracts'
import { connect, type Client } from '../src/client.ts'
import { startServer, type ServerHandle } from '../src/main.ts'
import { readOwnerToken } from '../src/owner.ts'
import { resolvePaths } from '../src/paths.ts'

const SERVER = join(import.meta.dirname, '..')

let handle: ServerHandle
let owner: Client

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-e2e-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'workstreams'), { recursive: true })
  writeFileSync(join(paths.home, 'workstreams', 'engineering.md'), '## Routing\nCode.\nUrgent: prod down\n\n## Work\nBranch per task.\n')

  const claude = join(dir, 'claude')
  writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${join(SERVER, 'test', 'fixtures', 'fake-claude.ts')}" "$@"\n`)
  chmodSync(claude, 0o755)

  // The MCP bridge and hooks run as separate processes and find the server through these.
  process.env.AUTOPILOT_SOCKET = paths.socket
  handle = await startServer({
    paths,
    claude,
    self: { node: process.execPath, script: join(SERVER, 'bin', 'autopilot.js') },
    runClaude: () => Promise.resolve({ items: [] }),
    log: () => {},
  })
  owner = connect(paths.socket, readOwnerToken(paths) ?? '')
})

afterAll(async () => {
  await handle.close()
})

/** Waits for the first change in the live feed that matches. */
const waitFor = async (stream: AsyncIterator<QueueEvent>, match: (change: Change) => boolean): Promise<Change> => {
  for (;;) {
    const { value, done } = await stream.next()
    if (done) throw new Error('stream ended')
    if (value.type !== 'snapshot' && match(value)) return value
  }
}

describe('a task from start to finish', () => {
  it('starts a session that asks, takes the answer once idle, and hands over', async () => {
    const controller = new AbortController()
    const stream = (await owner.queue.subscribe({}, { signal: controller.signal }))[Symbol.asyncIterator]()

    const task = await owner.tasks.create({
      idempotencyKey: 'e2e-create',
      title: 'Decide on prompt caching',
      workstream: 'engineering-free',
    })

    const asked = await waitFor(stream, (c) => c.type === 'update.added' && c.update.kind === 'decision')
    if (asked.type !== 'update.added') throw new Error('unreachable')
    expect(asked.update).toMatchObject({ taskId: task.id, author: 'session', open: true })

    // Answer straight away: the launcher holds it until the session's Stop hook reports idle.
    await owner.updates.answer({ idempotencyKey: 'e2e-answer', updateId: asked.update.id, optionId: 'opus' })

    const done = await waitFor(stream, (c) => c.type === 'update.added' && c.update.kind === 'done')
    expect(done.type === 'update.added' && done.update.body).toBe('Enabled for Opus only.')

    await waitFor(stream, (c) => c.type === 'session.changed' && c.session.state === 'ended')
    const detail = await owner.tasks.get({ id: task.id })
    expect(detail.updates.map((u) => `${u.author}/${u.kind}`)).toEqual(['session/decision', 'owner/instruction', 'session/done'])
    expect(detail.session?.remoteControlUrl).toBe('https://claude.ai/code/session_fake123')
    expect(detail.band).toBe('running')
    controller.abort()
  }, 30_000)
})
