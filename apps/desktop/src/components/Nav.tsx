import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import type { ReactNode } from 'react'
import { titleCase } from '../format.ts'
import { QUEUE_VIEWS, type QueueView, type View } from '../view.ts'
import { Button, Dot, NavIcon, Pilot, SidebarIcon, Spacer, type NavIconName } from '../ui.tsx'

type Props = {
  view: View
  go: (view: View) => void
  items: QueueItem[]
  workstreams: Workstream[]
  signals: Signal[]
}

const QUEUE_ICON: Record<QueueView, NavIconName> = {
  needs_me: 'inbox',
  running: 'running',
  waiting: 'waiting',
  snoozed: 'snoozed',
  done: 'done',
}

/** A place to go, drawn as a row in the sidebar or an icon in the rail. */
type Entry = {
  key: string
  label: string
  mark: ReactNode
  count: number
  /** The count is yours to act on. */
  you?: boolean
  /** Something there is failing. */
  alert?: string
  current: boolean
  open: () => void
}

const current = (match: boolean) => (match ? ('page' as const) : undefined)

const initial = (name: string) => (
  <span className="initial" aria-hidden="true">
    {name.slice(0, 1).toUpperCase()}
  </span>
)

/** Everywhere the nav goes, in its three groups. */
const entries = ({ view, go, items, workstreams, signals }: Props) => {
  const count = (bands: string[]) => items.filter((i) => bands.includes(i.band)).length
  const yourTurn = count(['your_turn'])
  const queues: Entry[] = QUEUE_VIEWS.map((q) => ({
    key: q.id,
    label: q.title,
    mark: <NavIcon name={QUEUE_ICON[q.id]} />,
    count: q.id === 'done' ? 0 : count(q.bands),
    you: q.id === 'needs_me' && yourTurn > 0,
    current: view.kind === 'queue' && view.queue === q.id,
    open: () => go({ kind: 'queue', queue: q.id }),
  }))
  const streams: Entry[] = workstreams.map((w) => ({
    key: w.name,
    label: titleCase(w.name),
    mark: initial(w.name),
    count: items.filter((i) => i.task.workstream === w.name).length,
    current: view.kind === 'workstream' && view.name === w.name,
    open: () => go({ kind: 'workstream', name: w.name }),
  }))
  const failing = signals.some((s) => s.health.state === 'failing')
  const places: Entry[] = [
    {
      key: 'signals',
      label: 'Signals',
      mark: <NavIcon name="signals" />,
      count: 0,
      alert: failing ? 'A signal is failing' : undefined,
      current: view.kind === 'signals',
      open: () => go({ kind: 'signals' }),
    },
    {
      key: 'servers',
      label: 'Servers',
      mark: <NavIcon name="servers" />,
      count: 0,
      current: view.kind === 'servers',
      open: () => go({ kind: 'servers' }),
    },
    {
      key: 'setup',
      label: 'Set up',
      mark: <NavIcon name="setup" />,
      count: 0,
      current: view.kind === 'setup',
      open: () => go({ kind: 'setup' }),
    },
  ]
  return { queues, streams, places }
}

const Row = ({ entry }: { entry: Entry }) => (
  <Button kind="nav" aria-current={current(entry.current)} onClick={entry.open}>
    <span className="nav-mark">{entry.mark}</span>
    {entry.label}
    {entry.count > 0 && <span className={`count${entry.you ? ' you' : ''}`}>{entry.count}</span>}
    {entry.alert && (
      <span className="count">
        <Dot tone="alert" label={entry.alert} />
      </span>
    )}
  </Button>
)

/** The sidebar: every place by name. */
export const Nav = ({ onHide, overlay, ...props }: Props & { onHide: () => void; overlay: boolean }) => {
  const { queues, streams, places } = entries(props)
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
      <Button kind="nav" className="new" aria-current={current(props.view.kind === 'new')} onClick={() => props.go({ kind: 'new' })}>
        <span className="plus" aria-hidden="true">
          +
        </span>
        New task
      </Button>

      <div className="nav-heading">Queue</div>
      {queues.map((e) => (
        <Row key={e.key} entry={e} />
      ))}

      {streams.length > 0 && <div className="nav-heading">Workstreams</div>}
      {streams.map((e) => (
        <Row key={e.key} entry={e} />
      ))}

      <span className="nav-fill" />
      {places.map((e) => (
        <Row key={e.key} entry={e} />
      ))}
    </nav>
  )
}

/**
 * Puts the flyout beside its icon. The rail scrolls when the window is short, which would cut off
 * anything hanging out of it, so the flyout is fixed to the window at the icon's place instead.
 */
const place = (e: { currentTarget: HTMLElement }) => {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--flyout-x', `${r.right + 10}px`)
  e.currentTarget.style.setProperty('--flyout-y', `${r.top + r.height / 2}px`)
}

/** The name, and the count, beside an icon in the rail while the pointer is on it. */
const Flyout = ({ entry }: { entry: Pick<Entry, 'label' | 'count' | 'alert'> }) => (
  <span className="flyout" aria-hidden="true">
    {entry.label}
    {entry.count > 0 && <span className="flyout-count">{entry.count}</span>}
    {entry.alert && <span className="flyout-count">{entry.alert}</span>}
  </span>
)

const Spot = ({ entry }: { entry: Entry }) => (
  <Button
    kind="rail"
    aria-label={entry.count > 0 ? `${entry.label}, ${entry.count}` : entry.label}
    aria-current={current(entry.current)}
    onClick={entry.open}
    onPointerEnter={place}
    onFocus={place}
  >
    {entry.mark}
    {entry.count > 0 && <span className={`badge${entry.you ? ' you' : ''}`}>{entry.count > 99 ? '99+' : entry.count}</span>}
    {entry.alert && (
      <span className="badge dot">
        <Dot tone="alert" />
      </span>
    )}
    <Flyout entry={entry} />
  </Button>
)

/** The sidebar folded away: the same places as icons, named on hover. */
export const NavRail = ({ onShow, ...props }: Props & { onShow: () => void }) => {
  const { queues, streams, places } = entries(props)
  return (
    <nav className="rail" aria-label="Autopilot">
      <div className="rail-top drag" />
      <Button kind="rail" aria-label="Show sidebar" onClick={onShow} onPointerEnter={place} onFocus={place}>
        <Pilot pixel={1.25} />
        <Flyout entry={{ label: 'Show sidebar', count: 0 }} />
      </Button>
      <Button
        kind="rail"
        className="new"
        aria-label="New task"
        aria-current={current(props.view.kind === 'new')}
        onClick={() => props.go({ kind: 'new' })}
        onPointerEnter={place}
        onFocus={place}
      >
        <span className="plus" aria-hidden="true">
          <NavIcon name="plus" size={15} />
        </span>
        <Flyout entry={{ label: 'New task', count: 0 }} />
      </Button>
      <span className="rail-gap" />
      {queues.map((e) => (
        <Spot key={e.key} entry={e} />
      ))}
      {streams.length > 0 && <span className="rail-gap" />}
      {streams.map((e) => (
        <Spot key={e.key} entry={e} />
      ))}
      <span className="nav-fill" />
      {places.map((e) => (
        <Spot key={e.key} entry={e} />
      ))}
    </nav>
  )
}
