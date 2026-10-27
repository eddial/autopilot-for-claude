import { describe, expect, it } from 'vitest'
import { bandOf, compareQueue, effectOf, type BandInput } from '../src/queue.ts'
import type { QueueItem } from '../src/entities.ts'

const now = new Date('2026-10-25T12:00:00Z')

const input = (over: Partial<BandInput['task']> = {}, extra: Partial<BandInput> = {}): BandInput => ({
  task: { state: 'running', priority: 3, snoozedUntil: null, ...over },
  openAsk: null,
  session: null,
  ...extra,
})

describe('bandOf', () => {
  it('puts an open ask on your turn', () => {
    expect(bandOf(input({}, { openAsk: { kind: 'decision' } }), now)).toBe('your_turn')
  })

  it('puts a session stuck on a permission prompt on your turn', () => {
    expect(bandOf(input({}, { session: { state: 'waiting_permission' } }), now)).toBe('your_turn')
  })

  it('keeps a snoozed task hidden until it is due, then returns it to your turn', () => {
    const until = '2026-10-25T15:00:00Z'
    expect(bandOf(input({ state: 'snoozed', snoozedUntil: until }, { openAsk: { kind: 'question' } }), now)).toBe('snoozed')
    expect(bandOf(input({ state: 'snoozed', snoozedUntil: until }), new Date('2026-10-25T16:00:00Z'))).toBe('your_turn')
  })

  it('sends urgent new tasks straight to your turn', () => {
    expect(bandOf(input({ state: 'new', priority: 1 }), now)).toBe('your_turn')
    expect(bandOf(input({ state: 'new', priority: 2 }), now)).toBe('new')
  })

  it('keeps closed tasks done whatever else is true', () => {
    expect(bandOf(input({ state: 'canceled' }, { openAsk: { kind: 'blocked' } }), now)).toBe('done')
  })
})

describe('effectOf', () => {
  it('maps every update kind to where it sends the task', () => {
    expect(effectOf('review')).toBe('your_turn')
    // Finished: the owner closes it, or asks for more.
    expect(effectOf('done')).toBe('your_turn')
    expect(effectOf('waiting')).toBe('waiting')
    expect(effectOf('instruction')).toBe('running')
    expect(effectOf('signal')).toBe('new_if_asks')
    expect(effectOf('info')).toBe('unchanged')
  })
})

const item = (id: string, over: Partial<QueueItem> & { priority?: number; askAt?: string; updatedAt?: string } = {}) => {
  const { priority = 3, askAt, updatedAt = '2026-10-25T10:00:00Z', ...rest } = over
  return {
    task: {
      id,
      title: id,
      brief: '',
      workstream: 'engineering',
      priority,
      state: 'running',
      snoozedUntil: null,
      source: { signal: null, url: null, mirrors: null },
      links: [],
      sessionId: null,
      createdBy: 'owner',
      createdAt: updatedAt,
      updatedAt,
      seenAt: null,
    },
    band: 'your_turn',
    openAsk: askAt
      ? {
          id: `${id}-u`,
          taskId: id,
          kind: 'question',
          body: '',
          options: [],
          waitingOn: null,
          attachments: [],
          author: 'session',
          answers: null,
          open: true,
          createdAt: askAt,
        }
      : null,
    session: null,
    unread: true,
    ...rest,
  } satisfies QueueItem
}

describe('compareQueue', () => {
  it('orders your turn before new to triage, each by priority, then live sessions first, then longest wait', () => {
    const live = {
      id: 's',
      taskId: 'AP-4',
      machineId: 'm',
      cwd: '/',
      branch: null,
      resumeUrl: null,
      remoteControlUrl: null,
      state: 'idle' as const,
      activity: null,
      startedAt: '2026-10-25T09:00:00Z',
      lastActivityAt: '2026-10-25T11:00:00Z',
    }
    const items = [
      item('AP-1', { band: 'new' }),
      item('AP-6', { band: 'new', priority: 2 }),
      item('AP-2', { askAt: '2026-10-25T11:00:00Z' }),
      item('AP-3', { askAt: '2026-10-25T09:00:00Z' }),
      item('AP-4', { askAt: '2026-10-25T11:30:00Z', session: live }),
      item('AP-5', { askAt: '2026-10-25T11:45:00Z', priority: 1 }),
    ]
    expect(items.toSorted(compareQueue).map((i) => i.task.id)).toEqual(['AP-5', 'AP-4', 'AP-3', 'AP-2', 'AP-6', 'AP-1'])
  })
})
