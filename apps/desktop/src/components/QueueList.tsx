import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem } from '@autopilot/contracts'
import { emptyWords, sectionsOf, type GroupBy } from '@autopilot/client'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Menu } from './Menu.tsx'
import { useDraft } from '../drafts.ts'
import { prefetch, send } from '../store.ts'
import { age, rowMeta } from '../format.ts'
import { ALL_OPEN, QUEUE_VIEWS, type QueueView, type View } from '../view.ts'
import { Banner, Bars, Button, Icon, WorkstreamMark, NavIcon, Pilot, SearchIcon, type NavIconName } from '../ui.tsx'

type Props = {
  tab: QueueView
  /** Every open task, whatever its status: the current tab tapped again. */
  all: boolean
  /** A status, or every open task. */
  onTab: (tab: QueueView | 'all') => void
  /** How many tasks each tab holds; Done only once it has been read. */
  counts: Partial<Record<QueueView | 'all', number>>
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

/** An empty list: the pilot flying past a few clouds, and a word about it. */
const EmptyList = ({ tab }: { tab: QueueView | null }) => {
  const words = emptyWords(tab)
  return (
    <div className="empty-list">
      <div className="sky" aria-hidden="true">
        <span className="cloud one" />
        <span className="cloud two" />
        <span className="cloud three" />
        <span className="flying">
          <Pilot pixel={4} />
        </span>
      </div>
      <div className="empty-title">{words.title}</div>
      <div className="empty-line">{words.line}</div>
    </div>
  )
}

/** Each band as the icon of the tab it shows under. */
const BAND_ICON: Record<QueueItem['band'], NavIconName> = {
  your_turn: 'needs',
  new: 'needs',
  running: 'running',
  waiting: 'waiting',
  snoozed: 'snoozed',
  done: 'done',
}

const TAB_ICON: Record<QueueView, NavIconName> = {
  needs_me: 'needs',
  running: 'running',
  waiting: 'waiting',
  snoozed: 'snoozed',
  done: 'done',
}

/** The tabs in order: each status, then All. ⌘1 to ⌘6 pick them. */
const TABS = [...QUEUE_VIEWS.map((q) => ({ ...q, icon: TAB_ICON[q.id] })), { id: 'all' as const, ...ALL_OPEN, icon: 'all' as NavIconName }]

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
  { kind: 'group'; key: string; title: string; priority: number | null; count: number; folded: boolean } | { kind: 'item'; item: QueueItem }

const GROUPINGS: { by: GroupBy; label: string }[] = [
  { by: 'workstream', label: 'Group by workstream' },
  { by: 'priority', label: 'Group by priority' },
]

/** The tasks of a list top to bottom, as its sections show them: what Next and ⌘] go through. */
export const listOrder = (items: QueueItem[], by: GroupBy): QueueItem[] => sectionsOf(items, by).flatMap((s) => s.items)

/**
 * The left of the window: search, the status tabs, and the tasks of the tab in a section per
 * workstream or per priority. It is the nav and the list in one, as on the phone; Settings sits at
 * the window's top right.
 */
export const QueueList = (props: Props) => {
  const {
    tab,
    all,
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
  const title = all ? 'All open' : (QUEUE_VIEWS.find((q) => q.id === tab)?.title ?? '')
  const visible = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  // Sections in the order of their most pressing task (the queue comes sorted), the inbox last; or Urgent to Low.
  const entries = useMemo(
    (): Entry[] =>
      sectionsOf(visible, groupBy).flatMap((section) => {
        const shut = folded.has(section.key)
        const priority = groupBy === 'priority' ? (section.items[0]?.task.priority ?? null) : null
        return [
          { kind: 'group' as const, key: section.key, title: section.title, priority, count: section.items.length, folded: shut },
          ...(shut ? [] : section.items.map((item) => ({ kind: 'item' as const, item }))),
        ]
      }),
    [visible, groupBy, folded],
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
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => rows.current,
    estimateSize: (i) => (entries[i]?.kind === 'group' ? 40 : 70),
    getItemKey: (i) => {
      const e = entries[i]
      return e?.kind === 'item' ? e.item.task.id : `group-${e?.key ?? i}`
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
    if (!showingTasks || !first || (selected && order.includes(selected))) return
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
    <section className="pane list" style={{ width }} aria-label={title}>
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
      {/* Every tab the same: its icon and how many; the one you are on named under them. All last. */}
      <nav className="tabs" aria-label="Queue">
        {TABS.map((q, i) => {
          const on = q.id === 'all' ? all : !all && tab === q.id
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
              {count !== undefined && <span className={q.id === 'needs_me' && count > 0 ? 'you' : undefined}>{count}</span>}
              <kbd className="hint hint-cmd">⌘{i + 1}</kbd>
            </Button>
          )
        })}
      </nav>
      <p className="tab-caption">
        <span className="tab-caption-name">{all ? ALL_OPEN.title : QUEUE_VIEWS.find((q) => q.id === tab)?.title}</span>
        {' · '}
        {all ? ALL_OPEN.about : QUEUE_VIEWS.find((q) => q.id === tab)?.about}
      </p>
      {banner && <Banner>{banner}</Banner>}
      <div className="rows" ref={rows} role="listbox" aria-label="Tasks" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.length === 0 && (filter ? <div className="empty">Nothing matches the search.</div> : <EmptyList tab={all ? null : tab} />)}
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
                {entry.kind === 'group' ? (
                  <Button kind="section" aria-expanded={!entry.folded} onClick={() => fold(entry.key)}>
                    {entry.priority === null ? (
                      <WorkstreamMark name={entry.title} />
                    ) : (
                      <span className="ws-mark quiet">
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
                    status={all}
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
  /** Under All, where the statuses mix: its status as its tab's icon. */
  status?: boolean
  /** Grouped by priority, where the workstreams mix: its workstream in its line. */
  workstream?: boolean
  /** It has left this tab (you answered it) and stays, faded, until you move on. */
  left?: boolean
  onSelect?: (id: string) => void
  onOpen: (id: string) => void
}

/** The priorities by number, for a row's bars. */
const PRIORITY_NAME: Record<number, string> = { 1: 'Urgent', 2: 'High priority', 3: 'Normal priority', 4: 'Low priority' }

/** Rerenders only when what it shows changed: the store keeps unchanged tasks and asks as the same objects. */
const TaskRow = memo(
  ({ item, selected, left = false, hint, status = false, workstream = false, onSelect, onOpen }: RowProps) => (
    <Button
      kind="row"
      className={[item.unread ? null : 'read', left ? 'left' : null, status ? 'with-status' : null].filter(Boolean).join(' ') || undefined}
      role="option"
      data-task={item.task.id}
      aria-selected={selected}
      onClick={() => onSelect?.(item.task.id)}
      onMouseEnter={() => prefetch(item.task.id)}
      onDoubleClick={() => onOpen(item.task.id)}
    >
      {hint !== undefined && <kbd className="hint hint-alt row-hint">⌥{hint}</kbd>}
      {/* Under All: where it stands, as its tab draws it; green only when it is your turn. */}
      {status && (
        <span className={`row-status ${item.band}`} aria-hidden="true">
          <NavIcon name={BAND_ICON[item.band]} size={14} />
        </span>
      )}
      <div className="text">
        <div className="title">{item.task.title}</div>
        <div className="meta">{rowMeta(item, workstream)}</div>
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
    a.status === b.status &&
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
            {item.band === 'new' && (
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
