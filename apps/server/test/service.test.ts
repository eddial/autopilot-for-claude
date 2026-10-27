import { describe, expect, it } from 'vitest'
import { CreateTask, FileItem, PostUpdate } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { DomainError, Service } from '../src/service.ts'

let n = 0
const key = () => `key-${++n}-padding`

const setup = () => {
  let clock = Date.parse('2026-10-25T10:00:00Z')
  const service = new Service({ db: openDatabase(':memory:'), now: () => new Date((clock += 1000)) })
  return service
}

const create = (s: Service, over: Partial<{ title: string; start: boolean }> = {}) =>
  s.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Draft the pricing note', ...over }))

const post = (s: Service, taskId: string, body: Record<string, unknown>) =>
  s.postUpdate(PostUpdate.parse({ idempotencyKey: key(), taskId, ...body }), 'session')

const liveSession = (s: Service, taskId: string) =>
  s.recordSession({
    id: `s-${taskId}`,
    taskId,
    machineId: 'local',
    cwd: '/tmp',
    branch: null,
    resumeUrl: null,
    remoteControlUrl: null,
    state: 'working',
    pid: null,
  })

describe('tasks', () => {
  it('starts a session for a new task and applies a replayed command once', () => {
    const s = setup()
    const input = CreateTask.parse({ idempotencyKey: 'same-key-123', title: 'Answer Plato' })
    const first = s.createTask(input)
    const again = s.createTask(input)
    expect(again).toEqual(first)
    expect(s.queue().items).toHaveLength(1)
    expect(s.pendingOutbox().map((o) => o.kind)).toEqual(['start_session'])
  })

  it('keeps a saved task in New without starting anything', () => {
    const s = setup()
    const task = create(s, { start: false })
    expect(s.queue().items[0]?.band).toBe('triage')
    expect(s.pendingOutbox()).toEqual([])
    expect(task.state).toBe('triage')
  })
})

describe('updates', () => {
  it('puts a task on your turn with one open ask at a time', () => {
    const s = setup()
    const task = create(s)
    post(s, task.id, { kind: 'question', body: 'Backport too?' })
    const decision = post(s, task.id, { kind: 'decision', body: 'Which models?', options: [{ id: 'opus', label: 'Opus only' }] })
    const detail = s.getTask(task.id)
    expect(detail.band).toBe('your_turn')
    expect(detail.updates.filter((u) => u.open).map((u) => u.id)).toEqual([decision.id])
  })

  it('delivers an answer into a live session, and starts one when there is none', () => {
    const s = setup()
    const task = create(s)
    s.finishOutbox(s.pendingOutbox()[0]?.id ?? 0)
    liveSession(s, task.id)
    const ask = post(s, task.id, { kind: 'decision', body: 'Which?', options: [{ id: 'a', label: 'Opus only' }] })

    const answer = s.answerUpdate({ idempotencyKey: key(), updateId: ask.id, optionId: 'a' })
    expect(answer).toMatchObject({ kind: 'instruction', body: 'Opus only', answers: ask.id, author: 'owner' })
    expect(s.getTask(task.id).band).toBe('running')
    expect(s.pendingOutbox().map((o) => o.kind)).toEqual(['deliver_answer'])

    const other = create(s, { start: false })
    const question = post(s, other.id, { kind: 'question', body: 'Ok?' })
    s.answerUpdate({ idempotencyKey: key(), updateId: question.id, text: 'Yes' })
    expect(s.pendingOutbox().at(-1)).toMatchObject({ kind: 'start_session', payload: { taskId: other.id } })
  })

  it('refuses a second answer to the same ask, as from a phone that was offline', () => {
    const s = setup()
    const task = create(s)
    const ask = post(s, task.id, { kind: 'question', body: 'Backport?' })
    s.answerUpdate({ idempotencyKey: key(), updateId: ask.id, text: 'Yes' })
    const second = () => s.answerUpdate({ idempotencyKey: key(), updateId: ask.id, text: 'No' })
    expect(second).toThrow(DomainError)
    expect(second).toThrow(expect.objectContaining({ code: 'CONFLICT', data: { reason: 'already_answered' } }))
  })
})

describe('change feed', () => {
  it('numbers every write so a client can catch up after the last number it saw', () => {
    const s = setup()
    const task = create(s)
    const seen = s.latestSeq()
    post(s, task.id, { kind: 'info', body: 'Found the call sites' })
    const page = s.changesSince(seen, 100)
    expect(page.changes.map((c) => c.type)).toEqual(['update.added', 'task.upserted'])
    expect(page.changes.every((c) => c.seq > seen)).toBe(true)
    expect(page.more).toBe(false)
  })
})

describe('filing', () => {
  const item = {
    signal: 'slack',
    url: 'https://example.slack.com/archives/C1/p1',
    sender: 'Alex',
    channel: '#eng',
    at: '2026-10-25T09:00:00Z',
    title: 'Decide on prompt caching',
    summary: 'Alex asks whether to enable prompt caching.',
  }

  it('turns a second filing of the same thread into an update on the first task', () => {
    const s = setup()
    const file = (over: Record<string, unknown>) =>
      s.fileItem(
        FileItem.parse({ idempotencyKey: key(), item, action: 'create', reason: 'asks you', searches: ['caching'], gated: false, ...over }),
      )
    const first = file({ workstream: 'engineering' })
    const second = file({ note: 'Alex adds a deadline: Friday' })
    expect(first.action).toBe('created')
    expect(second).toMatchObject({ action: 'updated', taskId: first.taskId })
    expect(s.getTask(first.taskId ?? '').updates.map((u) => u.kind)).toEqual(['signal'])
    expect(s.matchItems({ queries: [item.url] }).tasks.map((t) => t.id)).toEqual([first.taskId])
  })

  it('mirrors a team ticket once and closes the mirror when the ticket closes', () => {
    const s = setup()
    const ticket = (over: Record<string, unknown>, closed: boolean) =>
      s.fileItem(
        FileItem.parse({
          idempotencyKey: key(),
          item: {
            ...item,
            signal: 'linear',
            url: `https://linear.app/acme/issue/LLE-15982/${closed ? 'x' : 'y'}`,
            ticket: { id: 'LLE-15982', closed },
          },
          action: 'create',
          reason: 'assigned to you',
          searches: ['LLE-15982'],
          gated: false,
          ...over,
        }),
      )
    const first = ticket({}, false)
    expect(s.getTask(first.taskId ?? '').task.source.mirrors).toBe('LLE-15982')
    // Another URL for the same ticket is still the same task; its closing closes the mirror.
    expect(ticket({}, true)).toMatchObject({ action: 'updated', taskId: first.taskId })
    expect(s.getTask(first.taskId ?? '').band).toBe('done')
    // A closed ticket nobody mirrors is not filed.
    expect(ticket({}, true).action).toBe('dropped')
  })
})

describe('tokens', () => {
  it('authenticates a token until it is revoked', () => {
    const s = setup()
    const { token, secret } = s.issueToken('Claude Desktop', 'owner', null)
    expect(s.authenticate(secret)).toMatchObject({ scope: 'owner', tokenId: token.id })
    s.revokeToken({ idempotencyKey: key(), id: token.id })
    expect(s.authenticate(secret)).toBeNull()
  })
})
