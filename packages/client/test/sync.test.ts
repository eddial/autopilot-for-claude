import { randomUUID } from 'node:crypto'
import { AnswerUpdate, CreateTask, PostUpdate } from '@autopilot/contracts'
import { keys, localInvite, startTestServer, type TestServer, type TestServerOptions } from '@autopilot/testkit'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pair, type Connection } from '../src/connection.ts'
import { nodePinnedFetch } from '../src/node.ts'
import { memoryStorage, Sync } from '../src/sync.ts'

const pinned = nodePinnedFetch()
const servers: TestServer[] = []
const key = keys('client-test')

const start = async (options: TestServerOptions = {}) => {
  const server = await startTestServer(options)
  servers.push(server)
  return server
}

/** A server, and an invite from it as the Mac app would show it. */
const setup = async () => {
  const server = await start()
  return {
    paths: server.paths,
    handle: server.handle,
    owner: server.owner,
    invite: await localInvite(server, key()),
    port: server.handle.devicePort() ?? 0,
  }
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
    const sync = new Sync({
      newKey: randomUUID,
      connection,
      pinned,
      storage: memoryStorage(),
      onYourTurn: (items) => turns.push(...items.map((i) => i.task.title)),
    })
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
    const sync = new Sync({ newKey: randomUUID, connection, pinned, storage })
    const task = handle.service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Backport the fix?', start: false }))
    const ask = handle.service.postUpdate(
      PostUpdate.parse({ idempotencyKey: key(), taskId: task.id, kind: 'question', body: 'Backport?' }),
      'session',
    )
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
    const reopened = new Sync({ newKey: randomUUID, connection, pinned, storage })
    await reopened.load()
    const back = await start({ paths, devicePort: port })
    await reopened.syncOnce()
    expect(reopened.getState()).toMatchObject({ status: 'online', outbox: [], conflicts: [{ reason: 'already_answered' }] })
    expect(back.service.queue().items.map((i) => i.task.title)).toContain('Draft the release note')
    expect(reopened.items().map((i) => i.task.title)).toContain('Draft the release note')
  }, 30_000)

  it('sends a command at once even during a long poll, and keeps an opened conversation current', async () => {
    const { handle, invite } = await setup()
    const connection = await pair(invite, { name: 'Test iPhone', kind: 'iphone' }, pinned, key())
    const sync = new Sync({ newKey: randomUUID, connection, pinned, storage: memoryStorage() })
    const task = handle.service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Pick a colour', start: false }))
    const ask = handle.service.postUpdate(
      PostUpdate.parse({ idempotencyKey: key(), taskId: task.id, kind: 'question', body: 'Red or blue?' }),
      'session',
    )
    await sync.syncOnce()
    await sync.detail(task.id)

    const polling = sync.syncOnce(20)
    await sync.send({ kind: 'answer', taskId: task.id, updateId: ask.id, text: 'Blue' })
    // The Mac has it long before the poll would have ended, and the poll ends because it did.
    await vi.waitFor(() => expect(handle.service.getTask(task.id).updates.map((u) => u.kind)).toEqual(['question', 'instruction']), {
      timeout: 3000,
    })
    await polling
    // The conversation fetched before is current from the feed, without fetching it again.
    expect(sync.cachedDetail(task.id)?.updates.map((u) => `${u.kind}:${String(u.open)}`)).toEqual(['question:false', 'instruction:false'])
  }, 30_000)

  it('keeps what the feed brought while a conversation was being fetched', async () => {
    const { handle, invite } = await setup()
    // The server answers the fetch at once, but the answer reaches the phone only when released.
    const gate: { release?: () => void } = {}
    const held = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const slow: typeof pinned = async (url, init, fingerprint) => {
      const response = await pinned(url, init, fingerprint)
      if (url.includes('/tasks/get')) await held
      return response
    }
    const connection = await pair(invite, { name: 'Test iPhone', kind: 'iphone' }, slow, key())
    const sync = new Sync({ newKey: randomUUID, connection, pinned: slow, storage: memoryStorage() })
    const task = handle.service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Pick a colour', start: false }))
    await sync.syncOnce()

    const served = vi.spyOn(handle.service, 'getTask')
    const fetching = sync.detail(task.id)
    // The server has answered with the conversation as it was; then the session asks.
    await vi.waitFor(() => expect(served).toHaveBeenCalled())
    handle.service.postUpdate(
      PostUpdate.parse({ idempotencyKey: key(), taskId: task.id, kind: 'question', body: 'Red or blue?' }),
      'session',
    )
    await sync.syncOnce()
    gate.release?.()
    await fetching
    expect(sync.cachedDetail(task.id)?.updates.map((u) => u.kind)).toEqual(['question'])
  }, 30_000)

  it('will not talk to a server whose certificate is not the paired one', async () => {
    const { invite } = await setup()
    const wrong = { ...invite, fingerprint: invite.fingerprint.replace(/^../, invite.fingerprint.startsWith('00') ? '11' : '00') }
    await expect(pair(wrong, { name: 'Test iPhone', kind: 'iphone' }, pinned, key())).rejects.toThrow(/cannot be reached/)
  }, 30_000)
})
