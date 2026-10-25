import type { QueueEvent } from './changes.ts'
import type { QueueItem, Session, Task, Update } from './entities.ts'
import { bandOf, compareQueue } from './queue.ts'

/**
 * The queue as a client holds it from `queue.subscribe`: the snapshot, then every change applied
 * in order. Tasks, open asks and sessions are kept apart, so changes apply in any order within a
 * write (an ask can arrive before its task). Shared by the Mac and iPhone apps.
 */
export type LiveQueue = {
  seq: number
  tasks: Record<string, Task>
  asks: Record<string, Update>
  sessions: Record<string, Session>
}

export const emptyQueue: LiveQueue = { seq: 0, tasks: {}, asks: {}, sessions: {} }

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const applyEvent = (state: LiveQueue, event: QueueEvent): LiveQueue => {
  if (event.type === 'snapshot') {
    const next: LiveQueue = { seq: event.snapshot.seq, tasks: {}, asks: {}, sessions: {} }
    for (const item of event.snapshot.items) {
      next.tasks[item.task.id] = item.task
      if (item.openAsk) next.asks[item.task.id] = item.openAsk
      if (item.session) next.sessions[item.task.id] = item.session
    }
    return next
  }
  if (event.seq <= state.seq) return state
  const seq = event.seq
  switch (event.type) {
    case 'task.upserted':
      return { ...state, seq, tasks: { ...state.tasks, [event.task.id]: event.task } }
    case 'task.removed':
      return {
        seq,
        tasks: without(state.tasks, event.id),
        asks: without(state.asks, event.id),
        sessions: without(state.sessions, event.id),
      }
    case 'update.added':
    case 'update.changed': {
      const { update } = event
      if (update.open) return { ...state, seq, asks: { ...state.asks, [update.taskId]: update } }
      if (state.asks[update.taskId]?.id === update.id) return { ...state, seq, asks: without(state.asks, update.taskId) }
      return { ...state, seq }
    }
    case 'session.changed':
      return { ...state, seq, sessions: { ...state.sessions, [event.session.taskId]: event.session } }
    case 'signal.changed':
    case 'workstream.changed':
      return { ...state, seq }
  }
}

/** The queue's items, as `queue.list` would return them; closed tasks drop out. */
export const queueItems = (state: LiveQueue, now: Date): QueueItem[] => {
  const items = Object.values(state.tasks)
    .map((task) => {
      const openAsk = state.asks[task.id] ?? null
      const session = task.sessionId && state.sessions[task.id]?.id === task.sessionId ? (state.sessions[task.id] ?? null) : null
      return {
        task,
        band: bandOf({ task, openAsk, session }, now),
        openAsk,
        session,
        unread: task.seenAt === null || task.updatedAt > task.seenAt,
      }
    })
    .filter((item) => item.band !== 'done')
  // A fresh array, sorted in place: Hermes on older iPhones has no toSorted.
  items.sort(compareQueue)
  return items
}
