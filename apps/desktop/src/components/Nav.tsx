import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { titleCase } from '../format.ts'
import { QUEUE_VIEWS, type View } from '../view.ts'
import { Button, Dot, Pilot, SidebarIcon, Spacer } from '../ui.tsx'

type Props = {
  view: View
  go: (view: View) => void
  items: QueueItem[]
  workstreams: Workstream[]
  signals: Signal[]
  onHide: () => void
  /** Shown over the window when it is too narrow for a sidebar. */
  overlay: boolean
}

const current = (match: boolean) => (match ? ('page' as const) : undefined)

export const Nav = ({ view, go, items, workstreams, signals, onHide, overlay }: Props) => {
  const count = (bands: string[]) => items.filter((i) => bands.includes(i.band)).length
  const yourTurn = count(['your_turn'])
  const failing = signals.some((s) => s.health.state === 'failing')
  return (
    <nav className={`nav collapsible${overlay ? ' overlay' : ''}`} aria-label="Autopilot">
      <div className="nav-top drag">
        <Spacer />
        <Button kind="icon" aria-label="Hide sidebar" onClick={onHide}>
          <SidebarIcon />
        </Button>
      </div>
      <div className="brand">
        <Pilot />
        <span className="serif">Autopilot</span>
      </div>
      <Button kind="nav" className="new" aria-current={current(view.kind === 'new')} onClick={() => go({ kind: 'new' })}>
        <span className="plus" aria-hidden="true">
          +
        </span>
        New task
      </Button>

      <div className="nav-heading">Queue</div>
      {QUEUE_VIEWS.map((q) => {
        const n = q.id === 'done' ? 0 : count(q.bands)
        return (
          <Button
            key={q.id}
            kind="nav"
            aria-current={current(view.kind === 'queue' && view.queue === q.id)}
            onClick={() => go({ kind: 'queue', queue: q.id })}
          >
            {q.title}
            {n > 0 && <span className={`count${q.id === 'needs_me' && yourTurn > 0 ? ' you' : ''}`}>{n}</span>}
          </Button>
        )
      })}

      {workstreams.length > 0 && <div className="nav-heading">Workstreams</div>}
      {workstreams.map((w) => {
        const n = items.filter((i) => i.task.workstream === w.name).length
        return (
          <Button
            key={w.name}
            kind="nav"
            aria-current={current(view.kind === 'workstream' && view.name === w.name)}
            onClick={() => go({ kind: 'workstream', name: w.name })}
          >
            {titleCase(w.name)}
            {n > 0 && <span className="count">{n}</span>}
          </Button>
        )
      })}

      <span className="nav-fill" />
      <Button kind="nav" aria-current={current(view.kind === 'signals')} onClick={() => go({ kind: 'signals' })}>
        Signals
        <span className="count">{failing && <Dot tone="alert" label="A signal is failing" />}</span>
      </Button>
      <Button kind="nav" aria-current={current(view.kind === 'servers')} onClick={() => go({ kind: 'servers' })}>
        Servers
      </Button>
      <Button kind="nav" aria-current={current(view.kind === 'setup')} onClick={() => go({ kind: 'setup' })}>
        Set up
      </Button>
    </nav>
  )
}
