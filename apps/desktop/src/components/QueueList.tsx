import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem } from '@autopilot/contracts'
import { workstreamMark } from '@autopilot/client'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDraft } from '../drafts.ts'
import { prefetch, send } from '../store.ts'
import { age, rowMeta } from '../format.ts'
import { QUEUE_VIEWS, type QueueView, type View } from '../view.ts'
import { Banner, Button, NavIcon, SearchIcon, type NavIconName } from '../ui.tsx'

type Props = {
  tab: QueueView
  /** Every open task, whatever its status: the current tab tapped again. */
  all: boolean
  onTab: (tab: QueueView) => void
  /** How many tasks each tab holds; Done only once it has been read. */
  counts: Partial<Record<QueueView | 'all', number>>
  items: QueueItem[]
  view: View
  go: (view: View) => void
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  width: number
  banner: string | null
  /** The pane beside the list shows a task (not Set up, New task…): one is always open there. */
  showingTasks: boolean
}

const TAB_ICON: Record<QueueView, NavIconName> = {
  needs_me: 'inbox',
  running: 'running',
  waiting: 'waiting',
  snoozed: 'snoozed',
  done: 'done',
}

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

type Entry = { kind: 'group'; workstream: string; count: number; folded: boolean } | { kind: 'item'; item: QueueItem }

/**
 * The left of the window: the status tabs, search, and the tasks of the tab in a section per
 * workstream. It is the nav and the list in one, as on the phone; Settings sits at the window's
 * top right.
 */
export const QueueList = (props: Props) => {
  const { tab, all, onTab, counts, items, view, go, selected, onSelect, onOpen, width, banner, showingTasks } = props
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const title = all ? 'All open' : (QUEUE_VIEWS.find((q) => q.id === tab)?.title ?? '')
  const visible = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  // Sections in the order of their most pressing task (the queue comes sorted), the inbox last.
  const entries = useMemo((): Entry[] => {
    const order = [...new Set(visible.map((i) => i.task.workstream))].toSorted((a, b) => Number(a === 'inbox') - Number(b === 'inbox'))
    return order.flatMap((workstream) => {
      const inSection = visible.filter((i) => i.task.workstream === workstream)
      const shut = folded.has(workstream)
      return [
        { kind: 'group' as const, workstream, count: inSection.length, folded: shut },
        ...(shut ? [] : inSection.map((item) => ({ kind: 'item' as const, item }))),
      ]
    })
  }, [visible, folded])
  const fold = (workstream: string) =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(workstream)) next.add(workstream)
      return next
    })
  const order = useMemo(() => entries.flatMap((e) => (e.kind === 'item' ? [e.item.task.id] : [])), [entries])
  const rows = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => rows.current,
    estimateSize: (i) => (entries[i]?.kind === 'group' ? 40 : 70),
    getItemKey: (i) => {
      const e = entries[i]
      return e?.kind === 'item' ? e.item.task.id : `group-${e?.workstream ?? i}`
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
      <nav className="tabs" aria-label="Queue">
        {/* The tab you are on says its name; tapped again, it shows every open task. */}
        {QUEUE_VIEWS.map((q) => {
          const on = tab === q.id
          const name = on && all ? 'All open' : q.title
          const count = on && all ? counts.all : counts[q.id]
          return (
            <Button
              key={q.id}
              kind="tab"
              aria-label={count === undefined ? name : `${name}, ${count}`}
              title={on && q.id !== 'done' ? `${q.title} · click again for ${all ? q.title : 'all open'}` : q.title}
              aria-current={on ? 'page' : undefined}
              onClick={() => onTab(q.id)}
            >
              <NavIcon name={TAB_ICON[q.id]} size={15} />
              {on && <span className="tab-name">{name}</span>}
              {count !== undefined && <span className={q.id === 'needs_me' && !all && count > 0 ? 'you' : undefined}>{count}</span>}
            </Button>
          )
        })}
      </nav>
      <div className="search-row">
        <label className="filter">
          <SearchIcon />
          <input aria-label="Filter tasks" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <Button
          kind="icon"
          aria-label="New task"
          title="New task"
          aria-current={view.kind === 'new' ? 'page' : undefined}
          onClick={() => go({ kind: 'new' })}
        >
          <NavIcon name="compose" />
        </Button>
      </div>
      {banner && <Banner>{banner}</Banner>}
      <div className="rows" ref={rows} role="listbox" aria-label="Tasks" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.length === 0 && (
          <div className="empty">
            {filter ? 'Nothing matches the search.' : 'Nothing here. Autopilot fills this as signals file and sessions hand over.'}
          </div>
        )}
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
                  <Button kind="section" aria-expanded={!entry.folded} onClick={() => fold(entry.workstream)}>
                    <span className={`ws-mark ${workstreamMark(entry.workstream).tone}`} aria-hidden="true">
                      {workstreamMark(entry.workstream).letters}
                    </span>
                    <span className="ws-name">{entry.workstream}</span>
                    {entry.folded && <span className="ws-count">{entry.count}</span>}
                  </Button>
                ) : expanded === entry.item.task.id ? (
                  <Expanded item={entry.item} selected={selected === entry.item.task.id} onOpen={onOpen} onDone={() => setExpanded(null)} />
                ) : (
                  <TaskRow item={entry.item} selected={selected === entry.item.task.id} onSelect={onSelect} onOpen={onOpen} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

type RowProps = { item: QueueItem; selected: boolean; onSelect?: (id: string) => void; onOpen: (id: string) => void }

/** Rerenders only when what it shows changed: the store keeps unchanged tasks and asks as the same objects. */
const TaskRow = memo(
  ({ item, selected, onSelect, onOpen }: RowProps) => (
    <Button
      kind="row"
      className={item.unread ? undefined : 'read'}
      role="option"
      data-task={item.task.id}
      aria-selected={selected}
      onClick={() => onSelect?.(item.task.id)}
      onMouseEnter={() => prefetch(item.task.id)}
      onDoubleClick={() => onOpen(item.task.id)}
    >
      <span className={`dot ${item.band}${item.unread ? '' : ' read'}`} aria-hidden="true" />
      <div className="text">
        <div className="title">{item.task.title}</div>
        <div className="meta">{rowMeta(item, false)}</div>
      </div>
      <span className="age">{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</span>
    </Button>
  ),
  (a, b) =>
    a.selected === b.selected &&
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
            <input
              className="inline-reply"
              aria-label="Reply"
              placeholder="Or reply in words…"
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) answer({ text: text.trim() })
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
