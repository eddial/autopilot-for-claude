import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { attentionKey } from '@autopilot/client'
import { api, shell } from './api.ts'
import { NewTask } from './components/NewTask.tsx'
import { listOrder, QueueList } from './components/QueueList.tsx'
import { Setup } from './components/Setup.tsx'
import { TaskPane } from './components/TaskPane.tsx'
import { Button, Dot, NavIcon, Pilot } from './ui.tsx'
import { useQueueItems, useStore } from './store.ts'
import { QUEUE_VIEWS, type QueueView, type View } from './view.ts'

const stored = (name: string, fallback: number): number => {
  try {
    return Number(localStorage.getItem(name)) || fallback
  } catch {
    return fallback
  }
}

/**
 * Notifies once for each new thing that comes to your turn, and keeps the menu bar count. Once
 * per ask, not per arrival: answering one takes its task out of your turn for a moment, and the
 * same ask flickering back before the server's word arrives is nothing new.
 */
const useAttention = (items: QueueItem[], open: (id: string) => void) => {
  const seen = useRef<Set<string> | null>(null)
  const { connection } = useStore()
  useEffect(() => {
    const yours = items.filter((i) => i.band === 'your_turn')
    shell?.setBadge(yours.length)
    if (connection !== 'live') return
    if (seen.current && 'Notification' in window && Notification.permission === 'granted') {
      for (const item of yours) {
        if (seen.current.has(attentionKey(item))) continue
        const notice = new Notification(item.task.title, { body: item.openAsk?.body.slice(0, 180) ?? 'Your turn', silent: false })
        notice.addEventListener('click', () => open(item.task.id))
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...yours.map(attentionKey)])
  }, [items, connection, open])
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }, [])
}

/** The tasks a tab shows, or every open one. Done is not in the live queue; it is read when shown. */
const tabItems = (tab: QueueView, items: QueueItem[], done: QueueItem[], all = false) => {
  if (all) return items.filter((i) => i.band !== 'done')
  const q = QUEUE_VIEWS.find((v) => v.id === tab)
  return q ? (q.id === 'done' ? done : items).filter((i) => q.bands.includes(i.band)) : []
}

export const App = () => {
  const items = useQueueItems()
  const { connection, error, queue } = useStore()
  const [tab, setTab] = useState<QueueView>('needs_me')
  const [all, setAll] = useState(false)
  const [view, setView] = useState<View>({ kind: 'task' })
  const [selected, setSelected] = useState<string | null>(null)
  // Where the open task sat in its tab when it was picked, to keep it there once it leaves.
  const [stay, setStay] = useState<{ id: string; tab: QueueView; all: boolean; at: number } | null>(null)
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

  // Done is not in the live queue. It is fetched after the first frame for its tab's count, again
  // when a task leaves the open ones, and after every change while it is shown.
  const [doneRead, setDoneRead] = useState(false)
  const showingDone = tab === 'done'
  const doneTrigger = showingDone ? `seq ${queue.seq}` : `open ${items.length}`
  useEffect(() => {
    void api.queue.list({ band: 'done' }).then(
      (s) => {
        setDone({ seq: queue.seq, items: s.items })
        setDoneRead(true)
      },
      () => {},
    )
    // Only when the trigger changes; queue.seq alone changes on every event.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [doneTrigger])

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

  // What the tab lists without the task kept in place, and, for picking one, where each sits.
  const inTab = useMemo(() => tabItems(tab, items, done, all), [tab, items, done, all])
  const where = useRef({ tab, all, ids: [] as string[] })
  useEffect(() => {
    where.current = { tab, all, ids: inTab.map((i) => i.task.id) }
  }, [tab, all, inTab])

  // Stable, so list rows that did not change skip rendering.
  const openTask = useCallback((id: string) => {
    setView({ kind: 'task' })
    setSelected(id)
    setShowingTask(true)
  }, [])
  // Picking a task from the list while a place (Settings, New task) is open goes back to tasks.
  const selectTask = useCallback((id: string) => {
    const { tab: on, all: every, ids } = where.current
    setStay({ id, tab: on, all: every, at: Math.max(0, ids.indexOf(id)) })
    setSelected(id)
    setView((v) => (v.kind === 'task' ? v : { kind: 'task' }))
  }, [])
  useAttention(items, openTask)

  // The open task stays where it was in its tab after it leaves it (you answered, so it runs), so
  // you see your reply land; it goes when you move on or change tab.
  const lingering =
    stay && stay.id === selected && stay.tab === tab && stay.all === all && !inTab.some((i) => i.task.id === stay.id) ? stay : null
  const listed = useMemo(() => {
    const item = lingering ? [...items, ...done].find((i) => i.task.id === lingering.id) : undefined
    if (!lingering || !item) return inTab
    return [...inTab.slice(0, lingering.at), item, ...inTab.slice(lingering.at)]
  }, [inTab, lingering, items, done])

  // Next and previous in the list as it reads: → and ← (with ⌘ too), or Up next at the end of the
  // task. In a box you are writing in, the arrows move the cursor as usual.
  const ordered = useMemo(() => listOrder(listed), [listed])
  const at = ordered.findIndex((i) => i.task.id === selected)
  const nextItem = at >= 0 ? (ordered[at + 1] ?? null) : null
  const step = useCallback(
    (delta: number) => {
      const target = ordered[Math.min(ordered.length - 1, Math.max(0, at + delta))]
      if (target && target.task.id !== selected) selectTask(target.task.id)
    },
    [ordered, at, selected, selectTask],
  )
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      if (e.altKey || e.shiftKey || e.defaultPrevented) return
      // Typing: the arrows move the cursor; ⌘ with them moves on only from an empty box.
      const field = e.target instanceof HTMLElement ? e.target.closest('input, textarea, [contenteditable], [role=menu]') : null
      const command = e.metaKey || e.ctrlKey
      if (field && !(command && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.value === '')) return
      e.preventDefault()
      step(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [step])
  const counts = useMemo(() => {
    const counted: Partial<Record<QueueView | 'all', number>> = { all: tabItems(tab, items, done, true).length }
    for (const q of QUEUE_VIEWS) if (q.id !== 'done') counted[q.id] = tabItems(q.id, items, done).length
    if (doneRead) counted.done = done.length
    return counted
  }, [tab, items, done, doneRead])

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

  // A place (New task, Settings) opens beside the list.
  const go = (v: View) => {
    setView(v)
    setShowingTask(true)
  }

  // Another tab leaves no task open from the last one. Only here: a task opened for you (just
  // created, from a notification) stays open wherever it is.
  const switchTab = (next: QueueView) => {
    // The tab you are on, tapped again, shows every open task (Done stays Done).
    const showAll = next === tab && next !== 'done' && !all
    setAll(showAll)
    setTab(next)
    setView({ kind: 'task' })
    setShowingTask(false)
    if (selected && !tabItems(next, items, done, showAll).some((i) => i.task.id === selected)) setSelected(null)
  }

  return (
    <div className={`app${showingTask ? ' showing-task' : ''}`}>
      <QueueList
        tab={tab}
        all={all}
        onTab={switchTab}
        counts={counts}
        items={listed}
        view={view}
        go={go}
        selected={selected}
        onSelect={selectTask}
        onOpen={openTask}
        width={listWidth}
        banner={banner}
        showingTasks={view.kind === 'task'}
        lingering={lingering?.id ?? null}
      />
      <div className="grip" role="separator" aria-label="Resize list" aria-orientation="vertical" onPointerDown={startResize} />
      {view.kind === 'new' ? (
        <NewTask workstreams={workstreams} onCreated={openTask} />
      ) : view.kind === 'setup' ? (
        <Setup
          items={items}
          workstreams={workstreams}
          onWorkstreams={setWorkstreams}
          onOpen={openTask}
          onDone={() => setView({ kind: 'task' })}
        />
      ) : current ? (
        <TaskPane
          key={current.task.id}
          item={current}
          workstreams={workstreams}
          upNext={
            at >= 0
              ? {
                  next: nextItem,
                  hasPrevious: at > 0,
                  at: at + 1,
                  total: ordered.length,
                  list: all ? 'All open' : (QUEUE_VIEWS.find((q) => q.id === tab)?.title ?? ''),
                  move: step,
                }
              : null
          }
          onClose={() => setShowingTask(false)}
        />
      ) : listed.length === 0 ? (
        // Nothing in this list: the pane offers what you can do instead, a new task.
        <NewTask workstreams={workstreams} onCreated={openTask} />
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

      {/* Settings, at the window's top right, with a dot when a source is failing. It comes after the
          panes: Electron lets the last drag or no-drag region in page order win, so before them the
          pane's draggable head swallowed its clicks. */}
      <Button
        kind="icon"
        className="settings-button"
        aria-label="Settings"
        title="Settings"
        aria-current={view.kind === 'setup' ? 'page' : undefined}
        onClick={() => go({ kind: 'setup' })}
      >
        <NavIcon name="settings" />
        {signals.some((s) => s.health.state === 'failing') && (
          <span className="place-alert">
            <Dot tone="alert" label="A source is failing" />
          </span>
        )}
      </Button>
      {/* Too narrow for the list beside a place: the way back to it. */}
      {view.kind !== 'task' && showingTask && (
        <Button kind="quiet" className="narrow-back" onClick={() => setShowingTask(false)}>
          Back to the list
        </Button>
      )}
    </div>
  )
}
