import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { ORPCError } from '@orpc/client'
import type { QueueEvent } from '@autopilot/contracts'
import { API_VERSION } from '@autopilot/contracts'
import { createRouter } from '../src/api.ts'
import { connect, type Client } from '../src/client.ts'
import { openDatabase } from '../src/db.ts'
import { listen } from '../src/http.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'
import { Setup } from '../src/setup.ts'

let server: Server
let service: Service
let owner: Client
let socket: string

const k = (() => {
  let n = 0
  return () => `api-key-${++n}`
})()

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-'))
  socket = join(dir, 's.sock')
  service = new Service({ db: openDatabase(':memory:') })
  const router = createRouter({
    service,
    workstreams: () => [],
    applyRouting: () => {},
    setup: new Setup({ paths: resolvePaths({ AUTOPILOT_DATA: dir }), examples: join(dir, 'examples'), claude: 'claude' }),
    installService: () => {},
    startPairing: () => Promise.reject(new Error('no pairing here')),
    detect: () => Promise.resolve({ connectors: [], github: { cli: false, user: null } }),
    signals: {
      list: () => [],
      run: () => Promise.resolve([]),
      pause: () => {
        throw new Error('no signals')
      },
    },
    machine: () => ({
      id: 'local',
      name: 'Test',
      roles: ['main', 'runner'],
      capacity: 4,
      running: 0,
      workstreams: [],
      routes: [{ kind: 'socket', address: socket }],
      health: 'online',
      lastSeenAt: null,
    }),
  })
  server = await listen(router, service, socket)
  owner = connect(socket, service.issueToken('owner', 'owner', null).secret)
})

afterAll(() => {
  server.close()
})

/** The typed error a call failed with: its code and data. */
const errorOf = async (promise: Promise<unknown>): Promise<{ code: string; data: unknown }> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof ORPCError) return { code: error.code, data: error.data as unknown }
    throw error
  }
  throw new Error('expected an error')
}

describe('API over the socket', () => {
  it('lets the owner create a task and read the queue', async () => {
    const task = await owner.tasks.create({ idempotencyKey: k(), title: 'Draft the pricing note' })
    const queue = await owner.queue.list({})
    expect(queue.items.map((i) => i.task.id)).toContain(task.id)
  })

  it('refuses calls without a token, except the version check', async () => {
    const anonymous = connect(socket, 'nope')
    expect(await anonymous.meta.version()).toMatchObject({ version: API_VERSION })
    const error = await errorOf(anonymous.queue.list({}))
    expect(error.code).toBe('FORBIDDEN')
  })

  it('limits a session token to its own task', async () => {
    const mine = await owner.tasks.create({ idempotencyKey: k(), title: 'Mine', start: false })
    const other = await owner.tasks.create({ idempotencyKey: k(), title: 'Other', start: false })
    const session = connect(socket, service.issueToken(`session ${mine.id}`, 'session', mine.id).secret)

    const posted = await session.updates.post({ idempotencyKey: k(), taskId: mine.id, kind: 'question', body: 'Ok?' })
    expect(posted.author).toBe('session')

    const error = await errorOf(session.updates.post({ idempotencyKey: k(), taskId: other.id, kind: 'info', body: 'x' }))
    expect(error.code).toBe('FORBIDDEN')
    const answer = await errorOf(session.updates.answer({ idempotencyKey: k(), updateId: posted.id, text: 'yes' }))
    expect(answer.code).toBe('FORBIDDEN')
  })

  it('returns a typed conflict when an ask was already answered', async () => {
    const task = await owner.tasks.create({ idempotencyKey: k(), title: 'Ask', start: false })
    const session = connect(socket, service.issueToken('s', 'session', task.id).secret)
    const ask = await session.updates.post({ idempotencyKey: k(), taskId: task.id, kind: 'question', body: '?' })
    await owner.updates.answer({ idempotencyKey: k(), updateId: ask.id, text: 'yes' })
    const error = await errorOf(owner.updates.answer({ idempotencyKey: k(), updateId: ask.id, text: 'no' }))
    expect(error).toEqual({ code: 'CONFLICT', data: { reason: 'already_answered' } })
  })

  it('streams a snapshot and then each change as it happens', async () => {
    const controller = new AbortController()
    const stream = await owner.queue.subscribe({}, { signal: controller.signal })
    const first = await stream.next()
    expect((first.value as QueueEvent | undefined)?.type).toBe('snapshot')
    const created = owner.tasks.create({ idempotencyKey: k(), title: 'Live', start: false })
    const next = await stream.next()
    expect(next.value).toMatchObject({ type: 'task.upserted', task: { title: 'Live' } })
    await created
    controller.abort()
  })
})
