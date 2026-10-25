import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { titleCase } from '../format.ts'
import { QUEUE_VIEWS, type View } from '../view.ts'
import { Pilot } from './Pilot.tsx'

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

const SidebarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </svg>
)

const current = (match: boolean) => (match ? ('page' as const) : undefined)

export const Nav = ({ view, go, items, workstreams, signals, onHide, overlay }: Props) => {
  const count = (bands: string[]) => items.filter((i) => bands.includes(i.band)).length
  const yourTurn = count(['your_turn'])
  const failing = signals.some((s) => s.health.state === 'failing')
  return (
    <nav className={`nav collapsible${overlay ? ' overlay' : ''}`} aria-label="Autopilot">
      <div className="nav-top drag">
        <span style={{ flex: 1 }} />
        <button className="icon-button" aria-label="Hide sidebar" onClick={onHide}>
          <SidebarIcon />
        </button>
      </div>
      <div className="brand">
        <Pilot />
        <span className="serif">Autopilot</span>
      </div>
      <button
        className="nav-item"
        style={{ color: 'var(--text)' }}
        aria-current={current(view.kind === 'new')}
        onClick={() => go({ kind: 'new' })}
      >
        <span className="plus" aria-hidden="true">
          +
        </span>
        New task
      </button>

      <div className="nav-heading">Queue</div>
      {QUEUE_VIEWS.map((q) => {
        const n = q.id === 'done' ? 0 : count(q.bands)
        return (
          <button
            key={q.id}
            className="nav-item"
            aria-current={current(view.kind === 'queue' && view.queue === q.id)}
            onClick={() => go({ kind: 'queue', queue: q.id })}
          >
            {q.title}
            {n > 0 && <span className={`count${q.id === 'needs_me' && yourTurn > 0 ? ' clay' : ''}`}>{n}</span>}
          </button>
        )
      })}

      {workstreams.length > 0 && <div className="nav-heading">Workstreams</div>}
      {workstreams.map((w) => {
        const n = items.filter((i) => i.task.workstream === w.name).length
        return (
          <button
            key={w.name}
            className="nav-item"
            aria-current={current(view.kind === 'workstream' && view.name === w.name)}
            onClick={() => go({ kind: 'workstream', name: w.name })}
          >
            {titleCase(w.name)}
            {n > 0 && <span className="count">{n}</span>}
          </button>
        )
      })}

      <span style={{ flex: 1, minHeight: 24 }} />
      <button className="nav-item" aria-current={current(view.kind === 'signals')} onClick={() => go({ kind: 'signals' })}>
        Signals
        <span className="count">
          {failing && <span className="health-dot" style={{ background: 'var(--clay)' }} aria-label="A signal is failing" />}
        </span>
      </button>
      <button className="nav-item" aria-current={current(view.kind === 'servers')} onClick={() => go({ kind: 'servers' })}>
        Servers
      </button>
      <button className="nav-item" aria-current={current(view.kind === 'setup')} onClick={() => go({ kind: 'setup' })}>
        Set up
      </button>
    </nav>
  )
}
