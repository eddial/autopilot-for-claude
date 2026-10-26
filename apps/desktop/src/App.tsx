import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { api, shell } from './api.ts'
import { NewTask } from './components/NewTask.tsx'
import { QueueList } from './components/QueueList.tsx'
import { Servers } from './components/Servers.tsx'
import { Setup } from './components/Setup.tsx'
import { Signals } from './components/Signals.tsx'
import { TaskPane } from './components/TaskPane.tsx'
import { Button, Pilot } from './ui.tsx'
import { useQueueItems, useStore } from './store.ts'
import { QUEUE_VIEWS, type QueueView, type View } from './view.ts'

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

/** The tasks a tab shows. Done is not in the live queue; it is read when shown. */
const tabItems = (tab: QueueView, items: QueueItem[], done: QueueItem[]) => {
  const q = QUEUE_VIEWS.find((v) => v.id === tab)
  return q ? (q.id === 'done' ? done : items).filter((i) => q.bands.includes(i.band)) : []
}

export const App = () => {
  const items = useQueueItems()
  const { connection, error, queue } = useStore()
  const [tab, setTab] = useState<QueueView>('needs_me')
  const [view, setView] = useState<View>({ kind: 'task' })
  const [selected, setSelected] = useState<string | null>(null)
  const [showingTask, setShowingTask] = useState(false)
  const [listWidth, setListWidth] = useState(() => stored('listWidth', 420))
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
  const [doneRead, setDoneRead] = useState(false)
  const showingDone = tab === 'done'
  useEffect(() => {
    if (showingDone)
      void api.queue.list({ band: 'done' }).then(
        (s) => {
          setDone({ seq: queue.seq, items: s.items })
          setDoneRead(true)
        },
        () => {},
      )
  }, [showingDone, queue.seq])

  useEffect(
    () =>
      shell?.onNavigate((to) => {
        if (to !== 'new') return
        setView({ kind: 'new' })
        setShowingTask(true)
      }),
    [],
  )
  // For the smoke test and anyone looking: whether the window is live on the server.
  useEffect(() => {
    document.body.dataset.connection = connection
  }, [connection])

  // Stable, so list rows that did not change skip rendering.
  const openTask = useCallback((id: string) => {
    setView({ kind: 'task' })
    setSelected(id)
    setShowingTask(true)
  }, [])
  const selectTask = useCallback((id: string) => setSelected(id), [])
  useAttention(items, openTask)

  const listed = useMemo(() => tabItems(tab, items, done), [tab, items, done])
  const counts = useMemo(() => {
    const counted: Partial<Record<QueueView, number>> = {}
    for (const q of QUEUE_VIEWS) if (q.id !== 'done') counted[q.id] = tabItems(q.id, items, done).length
    if (doneRead) counted.done = done.length
    return counted
  }, [items, done, doneRead])

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

  // A place (New task, Signals, Servers, Set up) opens beside the list.
  const go = (v: View) => {
    setView(v)
    setShowingTask(true)
  }

  // Another tab leaves no task open from the last one. Only here: a task opened for you (just
  // created, from a notification) stays open wherever it is.
  const switchTab = (next: QueueView) => {
    setTab(next)
    setView({ kind: 'task' })
    setShowingTask(false)
    if (selected && !tabItems(next, items, done).some((i) => i.task.id === selected)) setSelected(null)
  }

  return (
    <div className={`app${showingTask ? ' showing-task' : ''}`}>
      <QueueList
        tab={tab}
        onTab={switchTab}
        counts={counts}
        items={listed}
        signals={signals}
        view={view}
        go={go}
        selected={selected}
        onSelect={selectTask}
        onOpen={openTask}
        width={listWidth}
        banner={banner}
      />
      <div className="grip" role="separator" aria-label="Resize list" aria-orientation="vertical" onPointerDown={startResize}>
        <span />
      </div>
      {/* Too narrow for the list beside a place: the way back to it. */}
      {view.kind !== 'task' && showingTask && (
        <Button kind="quiet" className="narrow-back" onClick={() => setShowingTask(false)}>
          Back to the list
        </Button>
      )}
      {view.kind === 'new' ? (
        <NewTask workstreams={workstreams} onCreated={openTask} />
      ) : view.kind === 'signals' ? (
        <Signals items={items} workstreams={workstreams} onWorkstreams={setWorkstreams} onOpen={openTask} />
      ) : view.kind === 'servers' ? (
        <Servers />
      ) : view.kind === 'setup' ? (
        <Setup onDone={() => setView({ kind: 'task' })} />
      ) : current ? (
        <TaskPane key={current.task.id} item={current} onClose={() => setShowingTask(false)} />
      ) : (
        <section className="pane task">
          <div className="task-head drag" />
          <div className="empty centred">
            <div className="empty-pilot">
              <Pilot pixel={3} />
            </div>
            Pick a task, or press Space on one to answer it in place.
          </div>
        </section>
      )}
    </div>
  )
}
