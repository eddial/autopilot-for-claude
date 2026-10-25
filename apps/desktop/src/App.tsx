import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { api, shell } from './api.ts'
import { Nav } from './components/Nav.tsx'
import { NewTask } from './components/NewTask.tsx'
import { QueueList } from './components/QueueList.tsx'
import { Servers } from './components/Servers.tsx'
import { Setup } from './components/Setup.tsx'
import { Signals } from './components/Signals.tsx'
import { TaskPane } from './components/TaskPane.tsx'
import { Pilot } from './components/Pilot.tsx'
import { titleCase } from './format.ts'
import { useQueueItems, useStore } from './store.ts'
import { QUEUE_VIEWS, type View } from './view.ts'

const stored = (name: string, fallback: number): number => {
  try {
    return Number(localStorage.getItem(name)) || fallback
  } catch {
    return fallback
  }
}

/** Notifies when a task comes to your turn, and keeps the menu bar count. */
const useAttention = (items: QueueItem[], open: (id: string) => void) => {
  const seen = useRef<Set<string> | null>(null)
  const { connection } = useStore()
  useEffect(() => {
    const yours = items.filter((i) => i.band === 'your_turn')
    shell?.setBadge(yours.length)
    if (connection !== 'live') return
    const ids = new Set(yours.map((i) => i.task.id))
    if (seen.current && 'Notification' in window && Notification.permission === 'granted') {
      for (const item of yours) {
        if (seen.current.has(item.task.id)) continue
        const notice = new Notification(item.task.title, { body: item.openAsk?.body.slice(0, 180) ?? 'Your turn', silent: false })
        notice.addEventListener('click', () => open(item.task.id))
      }
    }
    seen.current = ids
  }, [items, connection, open])
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }, [])
}

export const App = () => {
  const items = useQueueItems()
  const { connection, error, queue } = useStore()
  const [view, setView] = useState<View>({ kind: 'queue', queue: 'needs_me' })
  const [selected, setSelected] = useState<string | null>(null)
  const [showingTask, setShowingTask] = useState(false)
  const [navHidden, setNavHidden] = useState(false)
  const [navOverlay, setNavOverlay] = useState(false)
  const [listWidth, setListWidth] = useState(() => stored('listWidth', 520))
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [doneList, setDone] = useState<{ seq: number; items: QueueItem[] }>({ seq: -1, items: [] })
  const done = doneList.items

  useEffect(() => {
    if (connection !== 'live') return
    const load = () => {
      void api.workstreams.list().then(setWorkstreams, () => {})
      void api.signals.list().then(setSignals, () => {})
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [connection])

  // Done is not in the live queue; it is fetched when shown, again after each change.
  const showingDone = view.kind === 'queue' && view.queue === 'done'
  useEffect(() => {
    if (showingDone)
      void api.queue.list({ band: 'done' }).then(
        (s) => setDone({ seq: queue.seq, items: s.items }),
        () => {},
      )
  }, [showingDone, queue.seq])

  useEffect(() => shell?.onNavigate((to) => to === 'new' && setView({ kind: 'new' })), [])
  // For the smoke test and anyone looking: whether the window is live on the server.
  useEffect(() => {
    document.body.dataset.connection = connection
  }, [connection])

  // Stable, so list rows that did not change skip rendering.
  const openTask = useCallback((id: string) => {
    setView((v) => (v.kind === 'queue' || v.kind === 'workstream' ? v : { kind: 'queue', queue: 'needs_me' }))
    setSelected(id)
    setShowingTask(true)
  }, [])
  const selectTask = useCallback((id: string) => setSelected(id), [])
  useAttention(items, openTask)

  const list = useMemo(() => {
    if (view.kind === 'workstream')
      return { title: titleCase(view.name), items: items.filter((i) => i.task.workstream === view.name), grouped: true }
    if (view.kind === 'queue') {
      const q = QUEUE_VIEWS.find((v) => v.id === view.queue) ?? QUEUE_VIEWS[0]
      if (!q) return null
      const source = q.id === 'done' ? done : items
      return { title: q.title, items: source.filter((i) => q.bands.includes(i.band)), grouped: q.id === 'needs_me' }
    }
    return null
  }, [view, items, done])

  const current = [...items, ...done].find((i) => i.task.id === selected) ?? null
  const banner = connection === 'offline' ? `Not connected to the Autopilot server${error ? `: ${error}` : ''}. Retrying…` : null

  const startResize = (event: React.PointerEvent) => {
    const startX = event.clientX
    const start = listWidth
    const move = (e: PointerEvent) => setListWidth(Math.min(900, Math.max(320, start + e.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setListWidth((w) => {
        try {
          localStorage.setItem('listWidth', String(w))
        } catch {
          // Private storage: the width just is not remembered.
        }
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={`app${showingTask || !list ? ' showing-task' : ''}${navHidden ? ' nav-hidden' : ''}`}>
      {navOverlay && <div className="scrim" onClick={() => setNavOverlay(false)} aria-hidden="true" />}
      {navHidden ? (
        <div className="drag" style={{ width: 120, flex: 'none', paddingTop: 12, paddingLeft: 78 }}>
          <button className="icon-button" aria-label="Show sidebar" onClick={() => setNavHidden(false)}>
            <Pilot />
          </button>
        </div>
      ) : (
        <Nav
          view={view}
          go={(v) => {
            setView(v)
            setShowingTask(false)
            setNavOverlay(false)
          }}
          overlay={navOverlay}
          items={items}
          workstreams={workstreams}
          signals={signals}
          onHide={() => setNavHidden(true)}
        />
      )}
      {list && (
        <>
          <QueueList
            title={list.title}
            items={list.items}
            grouped={list.grouped}
            selected={selected}
            onSelect={selectTask}
            onOpen={openTask}
            width={listWidth}
            banner={banner}
            onMenu={() => setNavOverlay(true)}
          />
          <div className="grip" role="separator" aria-label="Resize list" aria-orientation="vertical" onPointerDown={startResize}>
            <span />
          </div>
        </>
      )}
      {view.kind === 'new' ? (
        <NewTask workstreams={workstreams} onCreated={openTask} />
      ) : view.kind === 'signals' ? (
        <Signals items={items} workstreams={workstreams} onOpen={openTask} />
      ) : view.kind === 'servers' ? (
        <Servers />
      ) : view.kind === 'setup' ? (
        <Setup onDone={() => setView({ kind: 'queue', queue: 'needs_me' })} />
      ) : current ? (
        <TaskPane key={current.task.id} item={current} onClose={() => setShowingTask(false)} />
      ) : (
        <section className="pane task">
          <div className="task-head drag" />
          <div className="empty" style={{ margin: 'auto', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Pilot pixel={3} />
            </div>
            Pick a task, or press Space on one to answer it in place.
          </div>
        </section>
      )}
    </div>
  )
}
