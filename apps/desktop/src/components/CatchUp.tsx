import { useEffect } from 'react'
import type { QueueItem, Workstream } from '@autopilot/contracts'
import { send } from '../store.ts'
import { Button, Meta } from '../ui.tsx'
import { TaskPane } from './TaskPane.tsx'

type Props = {
  /** The tasks to go through, fixed when catching up started: answering one does not drop it. */
  ids: string[]
  at: number
  items: QueueItem[]
  workstreams: Workstream[]
  onMove: (at: number) => void
  onExit: () => void
  /** Leaves catching up for one task, opened as usual. */
  onOpen: (id: string) => void
}

/** Tomorrow at nine: where a snooze from catching up sends a task. */
const tomorrowMorning = () => {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  return at.toISOString()
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]') !== null

/** What became of a task while catching up, for the summary at the end. */
const outcome = (item: QueueItem | undefined): string => {
  if (!item) return 'Closed'
  switch (item.band) {
    case 'your_turn':
    case 'new':
      return 'Still needs you'
    case 'running':
      return 'Replied, working on it'
    case 'waiting':
      return 'Waiting on others'
    case 'snoozed':
      return 'Snoozed'
    case 'done':
      return 'Done'
  }
}

/**
 * Catching up, as in Slack: the tasks that need you, one at a time and nothing else on screen. You
 * answer, see it land, and move on yourself: → or ⌘] for the next, ← or ⌘[ back, S to snooze until
 * tomorrow, E for done (both move on), Esc to leave. It ends on what you did.
 */
export const CatchUp = ({ ids, at, items, workstreams, onMove, onExit, onOpen }: Props) => {
  const id = ids[at]
  const item = items.find((i) => i.task.id === id)
  const move = (delta: number) => onMove(Math.min(ids.length, Math.max(0, at + delta)))
  const act = (kind: 'snooze' | 'done') => {
    if (!id) return
    send(kind === 'snooze' ? { kind: 'snooze', taskId: id, until: tomorrowMorning() } : { kind: 'close', taskId: id, outcome: 'done' })
    move(1)
  }

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const command = e.metaKey || e.ctrlKey
      if (command && (e.key === ']' || e.key === '[')) {
        e.preventDefault()
        move(e.key === ']' ? 1 : -1)
        return
      }
      if (command || e.altKey || typing(e.target)) return
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'Escape') onExit()
      else if (e.key === 's') act('snooze')
      else if (e.key === 'e') act('done')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  })

  return (
    <div className="catch-up">
      <div className="catch-up-bar drag">
        <span className="catch-up-name">Catch up</span>
        <Meta as="span">{id ? `${at + 1} of ${ids.length}` : `${ids.length} gone through`}</Meta>
        <span className="catch-up-dots" aria-hidden="true">
          {ids.map((d, i) => (
            <span key={d} className={i === at ? 'on' : i < at ? 'past' : undefined} />
          ))}
        </span>
        <span className="catch-up-actions">
          <Button kind="tool" onClick={() => move(-1)} disabled={at === 0} title="Previous (←)">
            ←
          </Button>
          {id && (
            <>
              <Button kind="tool" onClick={() => act('snooze')} title="Snooze until tomorrow morning (S)">
                Snooze
              </Button>
              <Button kind="tool" onClick={() => act('done')} title="Mark done (E)">
                Done
              </Button>
              <Button kind="primary" onClick={() => move(1)} title="Next (→)">
                Next →
              </Button>
            </>
          )}
          <Button kind="quiet" onClick={onExit} title="Leave (Esc)">
            Leave
          </Button>
        </span>
      </div>
      {id && item ? (
        <TaskPane key={id} item={item} workstreams={workstreams} onClose={onExit} />
      ) : (
        <section className="pane task catch-up-end" aria-label="All caught up">
          <h2 className="serif">All caught up</h2>
          <ul className="catch-up-summary">
            {ids.map((d) => {
              const it = items.find((i) => i.task.id === d)
              return (
                <li key={d}>
                  <Button kind="item" onClick={() => onOpen(d)}>
                    <span className="title">{it?.task.title ?? d}</span>
                    <Meta as="span">{outcome(it)}</Meta>
                  </Button>
                </li>
              )
            })}
          </ul>
          <Button kind="primary" onClick={onExit}>
            Back to the list
          </Button>
        </section>
      )}
    </div>
  )
}
