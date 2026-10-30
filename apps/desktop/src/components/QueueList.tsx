import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem } from '@autopilot/contracts'
import { emptyWords, rowStatus, sectionsOf, type GroupBy } from '@autopilot/client'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Menu } from './Menu.tsx'
import { useDraft } from '../drafts.ts'
import { prefetch, send } from '../store.ts'
import { age, rowMeta } from '../format.ts'
import { QUEUE_VIEWS, type QueueView, type View } from '../view.ts'
import { Banner, Bars, Button, Icon, WorkstreamMark, NavIcon, FlyingPilot, Tumbleweed, SearchIcon, type NavIconName } from '../ui.tsx'

type Props = {
  tab: QueueView
  /** New task is beside an empty list and carries the pilot: the list says it in one line. */
  quietEmpty: boolean
  onTab: (tab: QueueView) => void
  /** How many tasks each tab holds; Done only once it has been read. */
  counts: Partial<Record<QueueView, number>>
  items: QueueItem[]
  /** How the list is cut into sections. */
  groupBy: GroupBy
  onGroupBy: (by: GroupBy) => void
  view: View
  go: (view: View) => void
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  width: number
  banner: string | null
  /** The pane beside the list shows a task (not Set up, New task…): one is always open there. */
  showingTasks: boolean
  /** The open task, kept in its place after it left the tab (answered), until you move on. */
  lingering: string | null
  /** Where the open task is in the list, and the way to the one before and after it. */
  place: { at: number; total: number; list: string; hasPrevious: boolean; hasNext: boolean; move: (delta: number) => void } | null
}

/** A thin arrow, for the way through the list. */
const Arrow = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d={dir === 'up' ? 'M7 11.5v-9M3.5 6 7 2.5 10.5 6' : 'M7 2.5v9M3.5 8 7 11.5 10.5 8'} />
  </svg>
)

/**
 * An empty list: the pilot flying past a few clouds, and a word about it. `quiet` when New task is
 * beside it, which then carries the pilot: one line here, so the window has one pilot, not two.
 */
const EmptyList = ({ tab, quiet }: { tab: QueueView; quiet: boolean }) => {
  const words = emptyWords(tab)
  // Beside New task, which says it in words: a tumbleweed rolls across the empty list, and that is all.
  if (quiet) return <Tumbleweed />
  return (
    <div className="empty-list">
      <FlyingPilot />
      <div className="empty-title">{words.title}</div>
      <div className="empty-line">{words.line}</div>
    </div>
  )
}

const TAB_ICON: Record<QueueView, NavIconName> = {
  needs_me: 'needs',
  running: 'running',
  waiting: 'waiting',
  snoozed: 'snoozed',
  done: 'done',
}

/** The tabs in order, one per status. ⌘1 to ⌘5 pick them. */
const TABS = QUEUE_VIEWS.map((q) => ({ ...q, icon: TAB_ICON[q.id] }))

/** `ws:customers from:slack pricing`: tokens narrow by workstream and source, the rest matches titles. */
const matches = (item: QueueItem, filter: string): boolean =>
  filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (word.startsWith('ws:')) return item.task.workstream.startsWith(word.slice(3))
      if (word.startsWith('from:')) return (item.task.source.signal ?? 'you').startsWith(word.slice(5))
      return item.task.title.toLowerCase().includes(word) || item.task.id.toLowerCase() === word
    })

type Entry =
  | { kind: 'part'; title: string; about: string; alone: boolean }
  | { kind: 'group'; key: string; title: string; priority: number | null; count: number; folded: boolean }
  | { kind: 'item'; item: QueueItem }

const GROUPINGS: { by: GroupBy; label: string }[] = [
  { by: 'workstream', label: 'Group by workstream' },
  { by: 'priority', label: 'Group by priority' },
]

/** The tasks of a list top to bottom, as its sections show them: what Next and ⌘] go through. */
export const listOrder = (items: QueueItem[], by: GroupBy, parted: boolean): QueueItem[] =>
  sectionsOf(items, by, parted).flatMap((s) => s.items)

/**
 * The left of the window: search, the status tabs, and the tasks of the tab in a section per
 * workstream or per priority. It is the nav and the list in one, as on the phone; Settings sits at
 * the window's top right.
 */
export const QueueList = (props: Props) => {
  const {
    tab,
    quietEmpty,
    onTab,
    counts,
    items,
    groupBy,
    onGroupBy,
    view,
    go,
    selected,
    onSelect,
    onOpen,
    width,
    banner,
    showingTasks,
    lingering,
    place,
  } = props
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const title = QUEUE_VIEWS.find((q) => q.id === tab)?.title ?? ''
  const visible = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  // Sections in the order of their most pressing task (the queue comes sorted), the inbox last; or Urgent to Low.
  const entries = useMemo(
    (): Entry[] =>
      sectionsOf(visible, groupBy, tab === 'needs_me').flatMap((section) => {
        const shut = folded.has(section.key)
        const priority = groupBy === 'priority' ? (section.items[0]?.task.priority ?? null) : null
        return [
          ...(section.part ? [{ kind: 'part' as const, ...section.part }] : []),
          { kind: 'group' as const, key: section.key, title: section.title, priority, count: section.items.length, folded: shut },
          ...(shut ? [] : section.items.map((item) => ({ kind: 'item' as const, item }))),
        ]
      }),
    [visible, groupBy, folded, tab],
  )
  const fold = (workstream: string) =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(workstream)) next.add(workstream)
      return next
    })
  const order = useMemo(() => entries.flatMap((e) => (e.kind === 'item' ? [e.item.task.id] : [])), [entries])
  const search = useRef<HTMLInputElement>(null)
  // Narrow, the list and the task take turns: a click opens the task, as a double-click does wide.
  const pick = useCallback(
    (id: string) => (window.matchMedia('(max-width: 760px)').matches ? onOpen(id) : onSelect(id)),
    [onOpen, onSelect],
  )
  // ⌘1 to ⌘6 a tab, ⌘F the search; ⌥1 to ⌥9 the first nine tasks as listed (outside a text box).
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (e.metaKey && !e.altKey && !e.shiftKey) {
        const picked = n ? TABS[Number(n) - 1] : undefined
        if (picked) {
          e.preventDefault()
          onTab(picked.id)
        } else if (e.key === 'f') {
          e.preventDefault()
          search.current?.focus()
        }
        return
      }
      if (e.altKey && !e.metaKey && n) {
        const field = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')
        const id = order[Number(n) - 1]
        if (field || !id) return
        e.preventDefault()
        onSelect(id)
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [order, onTab, onSelect])
  const rows = useRef<HTMLDivElement>(null)

  // A two-finger swipe sideways across the list moves one tab along, as on the phone: fingers to
  // the left for the next. The trackpad sends it as wheel events, momentum included after the
  // fingers lift, so one gesture moves one tab and it ends once the events stop.
  const swipe = useRef({ dx: 0, dy: 0, moved: false, quiet: 0 })
  const slideFrom = useRef(0)
  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || (event.target as HTMLElement).closest('input, textarea')) return
    const s = swipe.current
    window.clearTimeout(s.quiet)
    s.quiet = window.setTimeout(() => (swipe.current = { dx: 0, dy: 0, moved: false, quiet: 0 }), 160)
    s.dx += event.deltaX
    s.dy += event.deltaY
    if (s.moved || Math.abs(s.dx) < 60 || Math.abs(s.dx) < 2.5 * Math.abs(s.dy)) return
    s.moved = true
    const to = TABS[TABS.findIndex((t) => t.id === tab) + (s.dx > 0 ? 1 : -1)]
    if (!to) return
    slideFrom.current = s.dx > 0 ? 1 : -1
    onTab(to.id)
  }
  // The new tab's list slides in from the side it lies on, and lands: nothing more.
  useLayoutEffect(() => {
    const from = slideFrom.current
    slideFrom.current = 0
    const list = rows.current
    if (!from || !list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const child of list.children)
      child.animate([{ transform: `translateX(${from * list.clientWidth}px)` }, { transform: 'none' }], {
        duration: 220,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
  }, [tab])
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => rows.current,
    estimateSize: (i) => (entries[i]?.kind === 'item' ? 70 : 40),
    getItemKey: (i) => {
      const e = entries[i]
      return e?.kind === 'item' ? e.item.task.id : e?.kind === 'group' ? `group-${e.key}` : `part-${e?.title ?? i}`
    },
    overscan: 10,
  })

  const move = (delta: number) => {
    const index = selected ? order.indexOf(selected) : -1
    const next = order[Math.min(order.length - 1, Math.max(0, index + delta))]
    if (next) onSelect(next)
  }

  // Side by side, the pane is never empty while the tab has tasks: the first one opens, and when
  // the open one leaves the tab (done, moved), the first one again. Narrow, the list stays the list.
  const first = order[0]
  useEffect(() => {
    if (!showingTasks || !first || (selected && (order.includes(selected) || selected === lingering))) return
    if (window.matchMedia('(min-width: 761px)').matches) onSelect(first)
    // When the tab's tasks or the open one change, not on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [first, selected, showingTasks, order.length])

  useEffect(() => {
    if (!selected) return
    const index = entries.findIndex((e) => e.kind === 'item' && e.item.task.id === selected)
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' })
    // Only when the selection moves, not on every change to the list.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return
    if (event.key === 'ArrowDown' || event.key === 'j') move(1)
    else if (event.key === 'ArrowUp' || event.key === 'k') move(-1)
    else if (event.key === 'Enter' && selected) onOpen(selected)
    else if (event.key === ' ' && selected) setExpanded((e) => (e === selected ? null : selected))
    else if (event.key === 'Escape') setExpanded(null)
    else return
    event.preventDefault()
  }

  return (
    // oxlint-disable-next-line react/forbid-dom-props -- the width the person dragged it to
    <section className="pane list" style={{ width }} aria-label={title} onWheel={onWheel}>
      <div className="titlebar drag" />
      <h1 className="hidden-heading">{title}</h1>
      <div className="search-row">
        <label className="filter">
          <SearchIcon />
          <input ref={search} aria-label="Filter tasks" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <kbd className="hint hint-cmd">⌘F</kbd>
        </label>
        <Menu
          className="group-by"
          label={<Icon name="group" size={14} />}
          chevron={false}
          items={GROUPINGS.map((g) => ({ label: g.label, checked: groupBy === g.by, run: () => onGroupBy(g.by) }))}
        />
        <Button
          kind="tool"
          className="with-icon new-task"
          aria-label="New task"
          title="New task"
          aria-current={view.kind === 'new' ? 'page' : undefined}
          onClick={() => go({ kind: 'new' })}
        >
          <NavIcon name="plus" size={14} />
          New
          <kbd className="hint hint-cmd">⌘N</kbd>
        </Button>
      </div>
      {/* Every tab the same: its icon and how many; the one you are on named under them. */}
      <nav className="tabs" aria-label="Queue">
        {TABS.map((q, i) => {
          const on = tab === q.id
          const count = counts[q.id]
          return (
            <Button
              key={q.id}
              kind="tab"
              aria-label={count === undefined ? q.title : `${q.title}, ${count}`}
              title={`${q.title}: ${q.about}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => onTab(q.id)}
            >
              <NavIcon name={q.icon} size={15} />
              {count !== undefined && <span>{count}</span>}
              <kbd className="hint hint-cmd">⌘{i + 1}</kbd>
            </Button>
          )
        })}
      </nav>
      {/* The tab's name and what it holds; Triage, under Needs me, has the same heading in the list.
          Needs me with only Triage in it starts at Triage. */}
      {entries[0]?.kind !== 'part' && (
        <p className="list-heading">
          <span className="list-heading-name">{QUEUE_VIEWS.find((q) => q.id === tab)?.title}</span>
          <span className="list-heading-about">{QUEUE_VIEWS.find((q) => q.id === tab)?.about}</span>
        </p>
      )}
      {banner && <Banner>{banner}</Banner>}
      <div className="rows" ref={rows} role="listbox" aria-label="Tasks" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.length === 0 &&
          (filter ? <div className="empty">Nothing matches the search.</div> : <EmptyList tab={tab} quiet={quietEmpty} />)}
        {/* oxlint-disable-next-line react/forbid-dom-props -- measured by the virtualiser */}
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((v) => {
            const entry = entries[v.index]
            if (!entry) return null
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtual.measureElement}
                // oxlint-disable-next-line react/forbid-dom-props -- placed by the virtualiser
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
              >
                {entry.kind === 'part' ? (
                  <>
                    <h2 className={`list-heading list-part${entry.alone ? ' first' : ''}`}>
                      <span className="list-heading-name">{entry.title}</span>
                      <span className="list-heading-about">{entry.about}</span>
                    </h2>
                  </>
                ) : entry.kind === 'group' ? (
                  <Button kind="section" aria-expanded={!entry.folded} onClick={() => fold(entry.key)}>
                    {entry.priority === null ? (
                      <WorkstreamMark name={entry.title} />
                    ) : (
                      <span className="ws-mark bare">
                        <Bars priority={entry.priority} />
                      </span>
                    )}
                    <span className="ws-name">{entry.title}</span>
                    {entry.folded && <span className="ws-count">{entry.count}</span>}
                  </Button>
                ) : expanded === entry.item.task.id ? (
                  <Expanded item={entry.item} selected={selected === entry.item.task.id} onOpen={onOpen} onDone={() => setExpanded(null)} />
                ) : (
                  <TaskRow
                    item={entry.item}
                    selected={selected === entry.item.task.id}
                    left={lingering === entry.item.task.id}
                    hint={order.indexOf(entry.item.task.id) < 9 ? order.indexOf(entry.item.task.id) + 1 : undefined}
                    workstream={groupBy === 'priority'}
                    onSelect={pick}
                    onOpen={onOpen}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      {/* Under the list, as Claude keeps its account there: where you are, and the way on. */}
      {place && view.kind === 'task' && (
        <footer className="list-foot" aria-label="Where you are">
          <span className="list-foot-where">
            {place.at} of {place.total} in {place.list}
          </span>
          <Button
            kind="icon"
            disabled={!place.hasPrevious}
            onClick={() => place.move(-1)}
            aria-label="Previous task"
            title="Previous task (↑)"
          >
            <Arrow dir="up" />
          </Button>
          <Button kind="icon" disabled={!place.hasNext} onClick={() => place.move(1)} aria-label="Next task" title="Next task (↓)">
            <Arrow dir="down" />
          </Button>
        </footer>
      )}
    </section>
  )
}

type RowProps = {
  item: QueueItem
  selected: boolean
  /** Its number while ⌥ is held: ⌥1 to ⌥9 pick the first nine. */
  hint?: number | undefined
  /** Grouped by priority, where the workstreams mix: its workstream in its line. */
  workstream?: boolean
  /** It has left this tab (you answered it) and stays, faded, until you move on. */
  left?: boolean
  onSelect?: (id: string) => void
  onOpen: (id: string) => void
}

/** Under the title: where it stands, when it is your turn, in green; then what it is about now. */
const RowMeta = ({ item, workstream }: { item: QueueItem; workstream: boolean }) => {
  const status = rowStatus(item)
  const meta = rowMeta(item, workstream)
  return (
    <div className="meta">
      {status && <span className={`row-label${item.band === 'triage' ? ' triage' : ''}`}>{status}</span>}
      {status && meta ? ' · ' : null}
      {meta}
    </div>
  )
}

/** The priorities by number, for a row's bars. */
const PRIORITY_NAME: Record<number, string> = { 1: 'Urgent', 2: 'High priority', 3: 'Normal priority', 4: 'Low priority' }

/** Rerenders only when what it shows changed: the store keeps unchanged tasks and asks as the same objects. */
const TaskRow = memo(
  ({ item, selected, left = false, hint, workstream = false, onSelect, onOpen }: RowProps) => (
    <Button
      kind="row"
      className={[item.unread ? null : 'read', left ? 'left' : null].filter(Boolean).join(' ') || undefined}
      role="option"
      data-task={item.task.id}
      aria-selected={selected}
      onClick={() => onSelect?.(item.task.id)}
      onMouseEnter={() => prefetch(item.task.id)}
      onDoubleClick={() => onOpen(item.task.id)}
    >
      {hint !== undefined && <kbd className="hint hint-alt row-hint">⌥{hint}</kbd>}
      <div className="text">
        <div className="title">{item.task.title}</div>
        <RowMeta item={item} workstream={workstream} />
      </div>
      {/* When, and under it how much it matters, as on the task's properties. */}
      <span className="row-end">
        <span className="age">{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</span>
        <span title={PRIORITY_NAME[item.task.priority]}>
          <Bars priority={item.task.priority} listed />
        </span>
      </span>
    </Button>
  ),
  (a, b) =>
    a.selected === b.selected &&
    a.left === b.left &&
    a.hint === b.hint &&
    a.workstream === b.workstream &&
    a.item.task === b.item.task &&
    a.item.openAsk === b.item.openAsk &&
    a.item.session === b.item.session &&
    a.item.band === b.item.band &&
    a.item.unread === b.item.unread &&
    a.onSelect === b.onSelect &&
    a.onOpen === b.onOpen,
)

/** A row opened in place with Space: answer it without opening the task. */
const Expanded = ({
  item,
  selected,
  onOpen,
  onDone,
}: {
  item: QueueItem
  selected: boolean
  onOpen: (id: string) => void
  onDone: () => void
}) => {
  const ask = item.openAsk
  const [text, setText] = useDraft(`${item.task.id}:${ask?.id ?? 'reply'}`)
  const answer = (reply: { optionId: string } | { text: string }) => {
    if (!ask) return
    send({ kind: 'answer', taskId: item.task.id, updateId: ask.id, ...reply })
    setText('')
    onDone()
  }
  return (
    <div className="expanded">
      <TaskRow item={item} selected={selected} onOpen={onOpen} />
      <div className="ask">
        {ask ? (
          <>
            <div className="ask-body">{ask.body}</div>
            <div className="options">
              {ask.options.map((o) => (
                <Button key={o.id} onClick={() => answer({ optionId: o.id })}>
                  {o.label}
                </Button>
              ))}
              <Button kind="quiet" onClick={() => onOpen(item.task.id)}>
                Open
              </Button>
            </div>
            <textarea
              className="inline-reply"
              rows={2}
              aria-label="Reply"
              placeholder="Or answer in your own words…"
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (text.trim()) answer({ text: text.trim() })
                }
                if (e.key === 'Escape') onDone()
              }}
            />
          </>
        ) : (
          <div className="options">
            {item.band === 'triage' && (
              <Button
                kind="primary"
                onClick={() => {
                  send({ kind: 'start', taskId: item.task.id })
                  onDone()
                }}
              >
                Start
              </Button>
            )}
            <Button onClick={() => onOpen(item.task.id)}>Open {item.task.id}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
