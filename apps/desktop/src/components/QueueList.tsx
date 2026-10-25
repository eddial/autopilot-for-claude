import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Band, QueueItem } from '@autopilot/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { prefetch, send } from '../store.ts'
import { age, rowMeta } from '../format.ts'
import { BAND_TITLE } from '../view.ts'

type Props = {
  title: string
  items: QueueItem[]
  /** Group by band (Needs me, a workstream), or one flat list. */
  grouped: boolean
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  width: number
  banner: string | null
  /** Opens navigation when the window is too narrow to show it. */
  onMenu: () => void
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

type Entry = { kind: 'group'; band: Band; count: number } | { kind: 'item'; item: QueueItem }

export const QueueList = ({ title, items, grouped, selected, onSelect, onOpen, width, banner, onMenu }: Props) => {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const visible = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  // One flat list of group headers and rows, so only what is on screen is rendered.
  const entries = useMemo((): Entry[] => {
    if (!grouped) return visible.map((item) => ({ kind: 'item', item }))
    const bands: Band[] = ['your_turn', 'new', 'running', 'waiting', 'snoozed', 'done']
    return bands.flatMap((band) => {
      const inBand = visible.filter((i) => i.band === band)
      return inBand.length === 0
        ? []
        : [{ kind: 'group' as const, band, count: inBand.length }, ...inBand.map((item) => ({ kind: 'item' as const, item }))]
    })
  }, [visible, grouped])
  const order = useMemo(() => entries.flatMap((e) => (e.kind === 'item' ? [e.item.task.id] : [])), [entries])
  const rows = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => rows.current,
    estimateSize: (i) => (entries[i]?.kind === 'group' ? 46 : 72),
    getItemKey: (i) => {
      const e = entries[i]
      return e?.kind === 'item' ? e.item.task.id : `group-${e?.band ?? i}`
    },
    overscan: 10,
  })

  const move = (delta: number) => {
    const index = selected ? order.indexOf(selected) : -1
    const next = order[Math.min(order.length - 1, Math.max(0, index + delta))]
    if (next) onSelect(next)
  }

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
    <section className="pane list" style={{ width }} aria-label={title}>
      <div className="list-head drag">
        <button className="icon-button narrow-only" aria-label="Show navigation" onClick={onMenu}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6 3v10" />
          </svg>
        </button>
        <h1 className="serif">{title}</h1>
        <span className="meta" style={{ fontSize: 14, marginTop: 4 }}>
          {visible.length}
        </span>
      </div>
      <label className="filter">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#9C9A92" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          aria-label="Filter tasks"
          placeholder="Filter, e.g. ws:customers from:slack"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      {banner && <div className="banner">{banner}</div>}
      <div className="rows" ref={rows} role="listbox" aria-label="Tasks" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.length === 0 && (
          <div className="empty">
            {filter ? 'Nothing matches the filter.' : 'Nothing here. Autopilot fills this as signals file and sessions hand over.'}
          </div>
        )}
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((v) => {
            const entry = entries[v.index]
            if (!entry) return null
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtual.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
              >
                {entry.kind === 'group' ? (
                  <div className="group">
                    <span className={`name ${entry.band}`}>{BAND_TITLE[entry.band]}</span>
                    <span>{entry.count}</span>
                  </div>
                ) : expanded === entry.item.task.id ? (
                  <Expanded item={entry.item} selected={selected === entry.item.task.id} onOpen={onOpen} onDone={() => setExpanded(null)} />
                ) : (
                  <Row item={entry.item} selected={selected === entry.item.task.id} onSelect={onSelect} onOpen={onOpen} />
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
const Row = memo(
  ({ item, selected, onSelect, onOpen }: RowProps) => (
    <button
      className={`row${item.unread ? '' : ' read'}`}
      role="option"
      data-task={item.task.id}
      aria-selected={selected}
      onClick={() => onSelect?.(item.task.id)}
      onMouseEnter={() => prefetch(item.task.id)}
      onDoubleClick={() => onOpen(item.task.id)}
    >
      <span className={`dot ${item.band}${item.unread ? '' : ' read'}`} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div className="title">{item.task.title}</div>
        <div className="meta">{rowMeta(item)}</div>
      </div>
      <span className="age">{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</span>
    </button>
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
  const [text, setText] = useState('')
  const ask = item.openAsk
  const answer = (reply: { optionId: string } | { text: string }) => {
    if (!ask) return
    send({ kind: 'answer', taskId: item.task.id, updateId: ask.id, ...reply })
    onDone()
  }
  return (
    <div className="expanded">
      <Row item={item} selected={selected} onOpen={onOpen} />
      <div className="ask">
        {ask ? (
          <>
            <div className="ask-body">{ask.body}</div>
            <div className="options">
              {ask.options.map((o) => (
                <button key={o.id} className="btn" onClick={() => answer({ optionId: o.id })}>
                  {o.label}
                </button>
              ))}
              <button className="tool bare" onClick={() => onOpen(item.task.id)}>
                Open
              </button>
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
              <button
                className="btn primary"
                onClick={() => {
                  send({ kind: 'start', taskId: item.task.id })
                  onDone()
                }}
              >
                Start
              </button>
            )}
            <button className="btn" onClick={() => onOpen(item.task.id)}>
              Open {item.task.id}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
