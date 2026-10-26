import { describe, expect, it } from 'vitest'
import { AttachLink, CreateTask } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { Service } from '../src/service.ts'

describe('timeline events', () => {
  it('records links and watchers as events that move nothing', () => {
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new Service({ db: openDatabase(':memory:'), now: () => new Date(clock) })
    const task = service.createTask(CreateTask.parse({ idempotencyKey: 'create-1', title: 'Reply to Acme', start: false }), 'owner')

    const link = { url: 'https://mail.google.com/mail/u/0/#drafts/1', title: 'gmail: reply to Sarah (draft)' }
    service.attachLink(AttachLink.parse({ idempotencyKey: 'link-0001', taskId: task.id, link }), 'session')
    service.attachLink(AttachLink.parse({ idempotencyKey: 'link-0002', taskId: task.id, link }), 'session')
    service.addWatcher({ idempotencyKey: 'watch-0001', taskId: task.id, what: 'Sarah’s reply', every: '1h', until: '2026-10-25T12:00:00Z' })
    const [watcher] = service.watcherRuns().map((r) => r.watcher)
    clock = Date.parse('2026-10-25T13:00:00Z')
    service.watcherExpired(watcher?.id ?? '')

    const detail = service.getTask(task.id)
    expect(detail.updates.map((u) => [u.kind, u.author, u.body.split(',')[0]])).toEqual([
      ['event', 'session', 'Linked gmail: reply to Sarah (draft)'],
      ['event', 'watcher', 'Watching Sarah’s reply'],
      ['event', 'watcher', 'Stopped watching Sarah’s reply: nothing new by the deadline'],
    ])
    expect(detail.updates[0]?.attachments).toEqual([link])
    expect(detail.task.links).toEqual([{ ...link, at: '2026-10-25T10:00:00.000Z' }])
    expect(detail.band).toBe('new')
  })
})
