import type { Band } from '@autopilot/contracts'

export type QueueView = 'needs_me' | 'running' | 'waiting' | 'snoozed' | 'done'

export type View =
  | { kind: 'queue'; queue: QueueView }
  | { kind: 'workstream'; name: string }
  | { kind: 'new' }
  | { kind: 'artifacts' }
  | { kind: 'signals' }
  | { kind: 'setup' }
  | { kind: 'servers' }

export const QUEUE_VIEWS: { id: QueueView; title: string; bands: Band[] }[] = [
  { id: 'needs_me', title: 'Needs me', bands: ['your_turn', 'new'] },
  { id: 'running', title: 'Running', bands: ['running'] },
  { id: 'waiting', title: 'Waiting on others', bands: ['waiting'] },
  { id: 'snoozed', title: 'Snoozed', bands: ['snoozed'] },
  { id: 'done', title: 'Done', bands: ['done'] },
]

export const BAND_TITLE: Record<Band, string> = {
  your_turn: 'Your turn',
  new: 'New',
  running: 'Running',
  waiting: 'Waiting on others',
  snoozed: 'Snoozed',
  done: 'Done',
}
