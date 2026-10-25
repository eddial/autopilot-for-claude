import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnswerUpdate, CreateTask, PostUpdate, type Invite } from '@autopilot/contracts'
import { connect } from '@autopilot/server/client'
import { startServer, type ServerHandle } from '@autopilot/server/main'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths, type Paths } from '@autopilot/server/paths'
import { afterAll, describe, expect, it } from 'vitest'
import { pair, type Connection } from '../src/connection.ts'
import { nodePinnedFetch } from '../src/node.ts'
import { memoryStorage, Sync } from '../src/sync.ts'

const pinned = nodePinnedFetch()
const servers: ServerHandle[] = []
let n = 0
const key = () => `client-test-${++n}-key`

const start = async (paths: Paths, devicePort = 0) => {
  const handle = await startServer({
    paths,
    self: { node: process.execPath, script: 'autopilot.js' },
    runClaude: () => Promise.resolve({ items: [] }),
    spawn: () => ({ pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} }),
    devicePort,
    log: () => {},
  })
  servers.push(handle)
  return handle
}

/** A server, and an invite from it as the Mac app would show it. Loopback first so tests do not wait on mDNS. */
const setup = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-client-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  const handle = await start(paths)
  const owner = connect(paths.socket, readOwnerToken(paths) ?? '')
  const { invite } = await owner.devices.startPairing({ idempotencyKey: key() })
  const port = handle.devicePort() ?? 0
  const local: Invite = { ...invite, routes: [{ kind: 'lan', address: `127.0.0.1:${port}` }, ...invite.routes] }
  return { paths, handle, owner, invite: local, port }
}

afterAll(async () => {
  for (const s of servers) await s.close().catch(() => {})
})

describe('the phone against the Mac', () => {
  it('pairs once with the code, then keeps its queue current through the long poll', async () => {
    const { handle, invite, owner } = await setup()
    const connection = await pair(invite, { name: 'Test iPhone', kind: 'iphone' }, pinned, key())
    await expect(pair(invite, { name: 'Again', kind: 'iphone' }, pinned, key())).rejects.toThrow(/wrong or has expired/)
    expect((await owner.devices.list()).map((d) => d.name)).toEqual(['Test iPhone'])

    const turns: string[] = []
    const sync = new Sync({ connection, pinned, storage: memoryStorage(), onYourTurn: (items) => turns.push(...items.map((i) => i.task.title)) })
    await sync.syncOnce()
    expect(sync.getState().status).toBe('online')

    const task = handle.service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Decide on caching', start: false }))
    // The long poll returns as soon as the change lands.
    const polling = sync.syncOnce(10)
    handle.service.postUpdate(PostUpdate.parse({ idempotencyKey: key(), taskId: task.id, kind: 'question', body: 'Opus only?' }), 'session')
    await polling
    expect(sync.items().map((i) => [i.task.title, i.band])).toEqual([['Decide on caching', 'your_turn']])
    expect(turns).toEqual(['Decide on caching'])
  }, 30_000)

  it('keeps commands while the Mac is away, sends them once it is back, and reports an answer given on the Mac', async () => {
    const { paths, handle, invite, port } = await setup()
    const connection: Connection = await pair(invite, { name: 'Test iPhone', kind: 'iphone' }, pinned, key())
    const storage = memoryStorage()
    const sync = new Sync({ connection, pinned, storage })
    const task = handle.service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Backport the fix?', start: false }))
    const ask = handle.service.postUpdate(PostUpdate.parse({ idempotencyKey: key(), taskId: task.id, kind: 'question', body: 'Backport?' }), 'session')
    await sync.syncOnce()

    // Answered on the Mac, then the Mac goes to sleep before the phone hears of it.
    handle.service.answerUpdate(AnswerUpdate.parse({ idempotencyKey: key(), updateId: ask.id, text: 'Main only' }))
    await handle.close()

    await sync.send({ kind: 'answer', taskId: task.id, updateId: ask.id, text: 'Yes, backport' })
    await sync.send({ kind: 'create', title: 'Draft the release note', brief: '', start: false })
    await sync.syncOnce()
    expect(sync.getState().status).toBe('offline')
    expect(sync.items().map((i) => [i.task.id, i.band])).toEqual([
      ['NEW-2', 'new'],
      [task.id, 'running'],
    ])

    // The app was closed meanwhile: a new Sync reads the outbox back from storage.
    const reopened = new Sync({ connection, pinned, storage })
    await reopened.load()
    const back = await start(paths, port)
    await reopened.syncOnce()
    expect(reopened.getState()).toMatchObject({ status: 'online', outbox: [], conflicts: [{ reason: 'already_answered' }] })
    expect(back.service.queue().items.map((i) => i.task.title)).toContain('Draft the release note')
    expect(reopened.items().map((i) => i.task.title)).toContain('Draft the release note')
  }, 30_000)

  it('will not talk to a server whose certificate is not the paired one', async () => {
    const { invite } = await setup()
    const wrong = { ...invite, fingerprint: invite.fingerprint.replace(/^../, invite.fingerprint.startsWith('00') ? '11' : '00') }
    await expect(pair(wrong, { name: 'Test iPhone', kind: 'iphone' }, pinned, key())).rejects.toThrow(/cannot be reached/)
  }, 30_000)
})
