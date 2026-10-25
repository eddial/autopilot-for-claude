import { describe, expect, it } from 'vitest'
import { AnswerUpdate, applyEvent, CreateTask, emptyQueue, PostUpdate, queueItems, type QueueEvent } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { Service } from '../src/service.ts'

let n = 0
const key = () => `key-${++n}-padding`

const strip = (items: ReturnType<typeof queueItems>) => items.map((i) => ({ ...i, session: i.session?.id ?? null }))

describe('the live queue a client holds', () => {
  it('matches a fresh snapshot after replaying every change since the first', () => {
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new Service({ db: openDatabase(':memory:'), now: () => new Date((clock += 1000)) })
    service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Already there', start: false }))
    let live = applyEvent(emptyQueue, { type: 'snapshot', snapshot: service.queue() })
    const after = live.seq

    const a = service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Decide on caching' }))
    const ask = service.postUpdate(
      PostUpdate.parse({
        idempotencyKey: key(),
        taskId: a.id,
        kind: 'decision',
        body: 'Opus only?',
        options: [{ id: 'opus', label: 'Opus only' }],
      }),
      'session',
    )
    service.answerUpdate(AnswerUpdate.parse({ idempotencyKey: key(), updateId: ask.id, optionId: 'opus' }))
    service.systemTask('The slack signal is failing', 'Down since 9:00.')
    const b = service.createTask(CreateTask.parse({ idempotencyKey: key(), title: 'Dismiss me', start: false }))
    service.closeTask({ idempotencyKey: key(), id: b.id, outcome: 'canceled' })

    for (const change of service.changesSince(after, 500).changes) live = applyEvent(live, change as QueueEvent)
    const now = service.now()
    expect(strip(queueItems(live, now))).toEqual(strip(service.queue().items))
  })
})
