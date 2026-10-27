import type { Band } from '@autopilot/contracts'

export type QueueView = 'needs_me' | 'running' | 'waiting' | 'snoozed' | 'done'

/** What the pane beside the list shows: the selected task, or a new one. Settings float above. */
export type View = { kind: 'task' } | { kind: 'new' }

export const QUEUE_VIEWS: { id: QueueView; title: string; about: string; bands: Band[] }[] = [
  { id: 'needs_me', title: 'Needs me', about: 'Under way and waiting on you', bands: ['your_turn', 'triage'] },
  { id: 'running', title: 'Running', about: 'A session is working on it', bands: ['running'] },
  { id: 'waiting', title: 'Waiting on others', about: "Someone else's move", bands: ['waiting'] },
  { id: 'snoozed', title: 'Snoozed', about: 'Put away until later', bands: ['snoozed'] },
  { id: 'done', title: 'Done', about: 'Closed, newest first', bands: ['done'] },
]

/** Every open task, as a tab after the statuses. */
export const ALL_OPEN = { title: 'All open', about: 'Every open task, across workstreams' }

export const BAND_TITLE: Record<Band, string> = {
  your_turn: 'Your turn',
  triage: 'Triage',
  running: 'Running',
  waiting: 'Waiting on others',
  snoozed: 'Snoozed',
  done: 'Done',
}
