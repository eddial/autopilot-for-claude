import type { Band, SessionState, TaskState, UpdateKind } from './enums.ts'
import { ASK_KINDS } from './enums.ts'
import type { QueueItem } from './entities.ts'

/**
 * Queue rules from docs/PRODUCT.md, shared so the server and the apps agree,
 * including the phone while it is offline.
 */

export const isAsk = (kind: UpdateKind): boolean => (ASK_KINDS as readonly UpdateKind[]).includes(kind)

/** Where posting an update of this kind sends its task. */
export type UpdateEffect = 'your_turn' | 'waiting' | 'running' | 'new_if_asks' | 'unchanged'

export const effectOf = (kind: UpdateKind): UpdateEffect => {
  switch (kind) {
    case 'decision':
    case 'question':
    case 'review':
    case 'blocked':
      return 'your_turn'
    case 'done':
      // Finished: back to the owner to close, or to ask for more.
      return 'your_turn'
    case 'waiting':
      return 'waiting'
    case 'instruction':
      return 'running'
    case 'signal':
      return 'new_if_asks'
    case 'info':
    case 'event':
      return 'unchanged'
  }
}

export type BandInput = {
  task: { state: TaskState; priority: number; snoozedUntil: string | null }
  openAsk: { kind: UpdateKind } | null
  session: { state: SessionState } | null
}

export const bandOf = ({ task, openAsk, session }: BandInput, now: Date): Band => {
  if (task.state === 'done' || task.state === 'canceled') return 'done'
  if (task.state === 'snoozed' && task.snoozedUntil !== null && Date.parse(task.snoozedUntil) > now.getTime()) {
    return 'snoozed'
  }
  if (openAsk !== null || session?.state === 'waiting_permission') return 'your_turn'
  // A snooze that has run out comes back as your turn.
  if (task.state === 'snoozed') return 'your_turn'
  if (task.state === 'running') return 'running'
  if (task.state === 'waiting') return 'waiting'
  return task.priority === 1 ? 'your_turn' : 'new'
}

const BAND_ORDER: Record<Band, number> = { your_turn: 0, new: 1, running: 2, waiting: 3, snoozed: 4, done: 5 }

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0)

/** A live session sits waiting on this answer; those come first. */
const blocksLiveSession = (item: QueueItem): boolean =>
  item.session !== null && (item.session.state === 'waiting_permission' || (item.session.state === 'idle' && item.openAsk !== null))

/** Since when the task has been waiting on you. */
const waitingSince = (item: QueueItem): number => time(item.openAsk?.createdAt ?? item.task.updatedAt)

/** Your turn and New are one list (Needs me): priority leads there, whose turn it is next. */
const needsYou = (band: Band): boolean => band === 'your_turn' || band === 'new'

export const compareQueue = (a: QueueItem, b: QueueItem): number => {
  const byPriority = needsYou(a.band) && needsYou(b.band) ? a.task.priority - b.task.priority : 0
  const byBand = byPriority || BAND_ORDER[a.band] - BAND_ORDER[b.band]
  if (byBand !== 0) return byBand

  let order = 0
  switch (a.band) {
    case 'your_turn':
      order = Number(blocksLiveSession(b)) - Number(blocksLiveSession(a)) || waitingSince(a) - waitingSince(b)
      break
    case 'new':
      order = time(b.task.createdAt) - time(a.task.createdAt)
      break
    case 'running':
      order = time(b.session?.lastActivityAt ?? b.task.updatedAt) - time(a.session?.lastActivityAt ?? a.task.updatedAt)
      break
    case 'snoozed':
      order = time(a.task.snoozedUntil) - time(b.task.snoozedUntil)
      break
    case 'waiting':
    case 'done':
      order = time(b.task.updatedAt) - time(a.task.updatedAt)
      break
  }
  return order || a.task.id.localeCompare(b.task.id)
}
