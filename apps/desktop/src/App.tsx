import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem, Signal, Workstream } from '@autopilot/contracts'
import { attentionKey, type GroupBy } from '@autopilot/client'
import { api, shell } from './api.ts'
import { NewTask } from './components/NewTask.tsx'
import { listOrder, QueueList } from './components/QueueList.tsx'
import { Setup } from './components/Setup.tsx'
import { TaskPane } from './components/TaskPane.tsx'
import { Button, Dot, NavIcon, Pilot } from './ui.tsx'
import { useQueueItems, useStore } from './store.ts'
import { QUEUE_VIEWS, type QueueView, type View } from './view.ts'

/** The keys that move through the list, and which way. */
const STEP_KEYS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/**
 * Which modifier is held long enough to show its shortcuts: ⌘ for the places (tabs, New, Search,
 * Settings, back and forward), ⌥ for the tasks. Let go, or use one, and they hide.
 */
const useHeldKey = (): 'cmd' | 'alt' | null => {
  const [held, setHeld] = useState<'cmd' | 'alt' | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = () => {
      clearTimeout(timer)
      setHeld(null)
    }
    const down = (e: KeyboardEvent) => {
      const which = e.key === 'Meta' ? 'cmd' : e.key === 'Alt' ? 'alt' : null
      if (!which) return clear()
      clearTimeout(timer)
      timer = setTimeout(() => setHeld(which), 400)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', clear)
    window.addEventListener('blur', clear)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', clear)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return held
}

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
  // Settings and set-up float above the window, as Claude's do; Escape or a click beside closes them.
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    if (!settings) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setSettings(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [settings])
  const [selected, setSelected] = useState<string | null>(null)
  // Where the open task sat in its tab when it was picked, to keep it there once it leaves.
  const [stay, setStay] = useState<{ id: string; tab: QueueView; all: boolean; at: number } | null>(null)
  const [showingTask, setShowingTask] = useState(false)
  const [listWidth, setListWidth] = useState(() => stored('listWidth', 420))
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    try {
      return localStorage.getItem('groupBy') === 'priority' ? 'priority' : 'workstream'
    } catch {
      return 'workstream'
    }
  })
  const chooseGroupBy = (by: GroupBy) => {
    setGroupBy(by)
    try {
      localStorage.setItem('groupBy', by)
    } catch {
      // Private storage: the grouping just is not remembered.
    }
  }
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

  // Back and forward through where you have been (a tab, a task, New), as a browser: the mouse's
  // side buttons, or ⌘[ and ⌘].
  type Place = { tab: QueueView; all: boolean; selected: string | null; kind: View['kind'] }
  const here: Place = { tab, all, selected, kind: view.kind }
  const trail = useRef({ past: [] as Place[], future: [] as Place[], last: here, moving: false })
  useEffect(() => {
    const t = trail.current
    const now = { tab, all, selected, kind: view.kind }
    const same = t.last.tab === now.tab && t.last.all === now.all && t.last.selected === now.selected && t.last.kind === now.kind
    if (t.moving) t.moving = false
    else if (!same) {
      t.past = [...t.past.slice(-99), t.last]
      t.future = []
    }
    t.last = now
  }, [tab, all, selected, view.kind])
  const travel = useCallback((delta: -1 | 1) => {
    const t = trail.current
    const to = delta < 0 ? t.past.at(-1) : t.future.at(-1)
    if (!to) return
    if (delta < 0) {
      t.past = t.past.slice(0, -1)
      t.future = [...t.future, t.last]
    } else {
      t.future = t.future.slice(0, -1)
      t.past = [...t.past, t.last]
    }
    t.moving = true
    setTab(to.tab)
    setAll(to.all)
    setSelected(to.selected)
    setView({ kind: to.kind })
    setShowingTask(to.kind !== 'task' || to.selected !== null)
  }, [])
  useEffect(() => {
    // Mouse buttons 4 and 5 are back and forward.
    const mouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      travel(e.button === 3 ? -1 : 1)
    }
    const keys = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.shiftKey) return
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        travel(e.key === '[' ? -1 : 1)
      }
      if (e.key === ',') {
        e.preventDefault()
        setSettings(true)
      }
    }
    window.addEventListener('mouseup', mouse)
    window.addEventListener('keydown', keys)
    return () => {
      window.removeEventListener('mouseup', mouse)
      window.removeEventListener('keydown', keys)
    }
  }, [travel])
  const held = useHeldKey()

  // The open task stays where it was in its tab after it leaves it (you answered, so it runs), so
  // you see your reply land; it goes when you move on or change tab.
  const lingering =
    stay && stay.id === selected && stay.tab === tab && stay.all === all && !inTab.some((i) => i.task.id === stay.id) ? stay : null
  const listed = useMemo(() => {
    const item = lingering ? [...items, ...done].find((i) => i.task.id === lingering.id) : undefined
    if (!lingering || !item) return inTab
    return [...inTab.slice(0, lingering.at), item, ...inTab.slice(lingering.at)]
  }, [inTab, lingering, items, done])

  // Next and previous in the list as it reads: ↓ and ↑ (← and → too, with ⌘ from an empty box),
  // or the arrows under the list. In a box you are writing in, the arrows move the cursor as usual.
  const ordered = useMemo(() => listOrder(listed, groupBy), [listed, groupBy])
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
      const delta = STEP_KEYS[e.key]
      if (delta === undefined || e.altKey || e.shiftKey || e.defaultPrevented) return
      // Settings float above the list; the arrows are theirs while open.
      if (document.querySelector('[role=dialog]')) return
      // Typing: the arrows move the cursor; ⌘ with them moves on only from an empty box.
      const field = e.target instanceof HTMLElement ? e.target.closest('input, textarea, [contenteditable], [role=menu]') : null
      const command = e.metaKey || e.ctrlKey
      if (field && !(command && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.value === '')) return
      e.preventDefault()
      step(delta)
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
  const switchTab = (picked: QueueView | 'all') => {
    // All is every open task across workstreams; it keeps the status tab you came from.
    const showAll = picked === 'all'
    const next = showAll ? tab : picked
    setAll(showAll)
    setTab(next)
    setView({ kind: 'task' })
    setShowingTask(false)
    if (selected && !tabItems(next, items, done, showAll).some((i) => i.task.id === selected)) setSelected(null)
  }

  return (
    <div className={`app${showingTask ? ' showing-task' : ''}${held ? ` hold-${held}` : ''}`}>
      <QueueList
        tab={tab}
        all={all}
        onTab={switchTab}
        counts={counts}
        groupBy={groupBy}
        onGroupBy={chooseGroupBy}
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
        place={
          at >= 0
            ? {
                at: at + 1,
                total: ordered.length,
                list: all ? 'All open' : (QUEUE_VIEWS.find((q) => q.id === tab)?.title ?? ''),
                hasPrevious: at > 0,
                hasNext: nextItem !== null,
                move: step,
              }
            : null
        }
      />
      <div className="grip" role="separator" aria-label="Resize list" aria-orientation="vertical" onPointerDown={startResize} />
      {view.kind === 'new' ? (
        <NewTask workstreams={workstreams} onCreated={openTask} />
      ) : current ? (
        <TaskPane key={current.task.id} item={current} workstreams={workstreams} onClose={() => setShowingTask(false)} />
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
        aria-current={settings ? 'page' : undefined}
        onClick={() => setSettings(true)}
      >
        <NavIcon name="settings" />
        <kbd className="hint hint-cmd">⌘,</kbd>
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
      {settings && (
        <div
          className="dialog-scrim"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSettings(false)
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Settings">
            <Setup
              items={items}
              workstreams={workstreams}
              onWorkstreams={setWorkstreams}
              onOpen={(id) => {
                setSettings(false)
                openTask(id)
              }}
              onDone={() => setSettings(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
