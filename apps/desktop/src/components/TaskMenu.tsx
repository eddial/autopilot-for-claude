import type { Band, MoveTarget, QueueItem, Workstream } from '@autopilot/contracts'
import { send } from '../store.ts'
import { Bars, NavIcon, WorkstreamMark, type NavIconName } from '../ui.tsx'
import type { MenuItem } from './Menu.tsx'

/** What a task can be done with, shared by its pane and its row's right-click menu. */

export const PRIORITY: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' }

const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Snooze choices, as times from now, each with the day and time it comes back. */
export const snoozeTimes = (): { label: string; day: string; time: string; until: Date }[] => {
  const now = new Date()
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000)
  const monday = (8 - now.getDay()) % 7 || 7
  const day = (d: Date) => {
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    return d.toLocaleDateString('en-GB', days < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' })
  }
  // An evening less than an hour away is no snooze at all.
  const soon = later(1)
  const choices = [
    { label: 'In an hour', until: soon },
    { label: 'In three hours', until: later(3) },
    { label: 'This evening', until: at(0, 18) },
    { label: 'Tomorrow morning', until: at(1, 9) },
    { label: 'Monday morning', until: at(monday, 9) },
    { label: 'In a week', until: at(7, 9) },
  ]
  // On a Sunday, Monday morning is tomorrow morning.
  return choices
    .filter((t, i) => t.until >= soon && !choices.slice(0, i).some((c) => c.until.getTime() === t.until.getTime()))
    .map((t) => ({ ...t, day: day(t.until), time: time(t.until) }))
}

/** The views a task can be moved to by hand, and the bands each shows. */
const MOVES: { to: MoveTarget; label: string; icon: NavIconName; bands: Band[] }[] = [
  { to: 'needs_me', label: 'Needs me', icon: 'needs', bands: ['your_turn', 'fyi', 'triage'] },
  { to: 'running', label: 'Running', icon: 'running', bands: ['running'] },
  { to: 'waiting', label: 'Waiting on others', icon: 'waiting', bands: ['waiting'] },
]

/** Every view but the one it is in, to move it there by hand. */
export const moves = (item: QueueItem, prefix: string): MenuItem[] =>
  MOVES.filter((m) => !m.bands.includes(item.band)).map((m) => ({
    label: `${prefix}${m.label}`,
    icon: <NavIcon name={m.icon} size={14} />,
    run: () => send({ kind: 'move', taskId: item.task.id, to: m.to }),
  }))

/** The workstreams a task can go to: the configured ones and the inbox, never Autopilot's own. */
export const workstreamNames = (workstreams: Workstream[]): string[] => [
  ...new Set([...workstreams.map((w) => w.name).filter((n) => n !== 'autopilot'), 'inbox']),
]

/**
 * A row's right-click menu, as Linear has it: open it, start it from triage, and change its
 * status, priority and workstream or snooze it without opening the task.
 */
export const taskMenu = (item: QueueItem, workstreams: Workstream[], onOpen: (id: string) => void): MenuItem[] => {
  const { task } = item
  const live = item.session && item.session.state !== 'ended'
  const closed = item.band === 'done'
  return [
    { label: 'Open', run: () => onOpen(task.id) },
    ...(item.band === 'triage' && !live ? [{ label: 'Start', run: () => send({ kind: 'start', taskId: task.id }) }] : []),
    {
      label: closed ? 'Reopen' : 'Status',
      items: [
        ...moves(item, closed ? '' : 'Move to '),
        ...(item.band === 'triage'
          ? [{ label: 'Not for me', run: () => send({ kind: 'close', taskId: task.id, outcome: 'canceled' }) }]
          : []),
      ],
    },
    {
      label: 'Priority',
      items: [1, 2, 3, 4].map((p) => ({
        label: PRIORITY[p] ?? '',
        icon: <Bars priority={p} />,
        checked: p === task.priority,
        run: () => p !== task.priority && send({ kind: 'edit', taskId: task.id, priority: p }),
      })),
    },
    {
      label: 'Workstream',
      items: workstreamNames(workstreams).map((name) => ({
        label: name,
        icon: <WorkstreamMark name={name} />,
        checked: name === task.workstream,
        run: () => name !== task.workstream && send({ kind: 'edit', taskId: task.id, workstream: name }),
      })),
    },
    ...(closed
      ? []
      : [
          {
            label: 'Snooze',
            items: snoozeTimes().map((t) => ({
              label: t.label,
              detail: [t.day, t.time],
              run: () => send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() }),
            })),
          },
          { label: 'Mark done', run: () => send({ kind: 'close', taskId: task.id, outcome: 'done' }) },
        ]),
  ]
}
