import { useEffect, useMemo, useRef, useState } from 'react'
import type { Band, QueueItem } from '@autopilot/contracts'
import { api, key } from '../api.ts'
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

export const QueueList = ({ title, items, grouped, selected, onSelect, onOpen, width, banner, onMenu }: Props) => {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const visible = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  const groups = useMemo(() => {
    if (!grouped) return [{ band: null, items: visible }]
    const bands: Band[] = ['your_turn', 'new', 'running', 'waiting', 'snoozed', 'done']
    return bands.map((band) => ({ band, items: visible.filter((i) => i.band === band) })).filter((g) => g.items.length > 0)
  }, [visible, grouped])
  const order = groups.flatMap((g) => g.items.map((i) => i.task.id))
  const rows = useRef<HTMLDivElement>(null)

  const move = (delta: number) => {
    const index = selected ? order.indexOf(selected) : -1
    const next = order[Math.min(order.length - 1, Math.max(0, index + delta))]
    if (next) onSelect(next)
  }

  useEffect(() => {
    if (selected) rows.current?.querySelector<HTMLElement>(`[data-task="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
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
        <input aria-label="Filter tasks" placeholder="Filter, e.g. ws:customers from:slack" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {banner && <div className="banner">{banner}</div>}
      <div className="rows" ref={rows} role="listbox" aria-label="Tasks" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.length === 0 && <div className="empty">{filter ? 'Nothing matches the filter.' : 'Nothing here. Autopilot fills this as signals file and sessions hand over.'}</div>}
        {groups.map((group) => (
          <div key={group.band ?? 'all'}>
            {group.band && (
              <div className="group">
                <span className={`name ${group.band}`}>{BAND_TITLE[group.band]}</span>
                <span>{group.items.length}</span>
              </div>
            )}
            {group.items.map((item) =>
              expanded === item.task.id ? (
                <Expanded key={item.task.id} item={item} selected={selected === item.task.id} onOpen={onOpen} onDone={() => setExpanded(null)} />
              ) : (
                <Row key={item.task.id} item={item} selected={selected === item.task.id} onClick={() => onSelect(item.task.id)} onOpen={onOpen} />
              ),
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

const Row = ({ item, selected, onClick, onOpen }: { item: QueueItem; selected: boolean; onClick?: () => void; onOpen: (id: string) => void }) => (
  <button
    className={`row${item.unread ? '' : ' read'}`}
    role="option"
    data-task={item.task.id}
    aria-selected={selected}
    onClick={onClick}
    onDoubleClick={() => onOpen(item.task.id)}
  >
    <span className={`dot ${item.band}${item.unread ? '' : ' read'}`} aria-hidden="true" />
    <div style={{ minWidth: 0 }}>
      <div className="title">{item.task.title}</div>
      <div className="meta">{rowMeta(item)}</div>
    </div>
    <span className="age">{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</span>
  </button>
)

/** A row opened in place with Space: answer it without opening the task. */
const Expanded = ({ item, selected, onOpen, onDone }: { item: QueueItem; selected: boolean; onOpen: (id: string) => void; onDone: () => void }) => {
  const [text, setText] = useState('')
  const ask = item.openAsk
  const answer = async (reply: { optionId: string } | { text: string }) => {
    if (!ask) return
    await api.updates.answer({ idempotencyKey: key(), updateId: ask.id, ...reply })
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
                <button key={o.id} className="btn" onClick={() => void answer({ optionId: o.id })}>
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
                if (e.key === 'Enter' && text.trim()) void answer({ text: text.trim() })
                if (e.key === 'Escape') onDone()
              }}
            />
          </>
        ) : (
          <div className="options">
            {item.band === 'new' && (
              <button className="btn primary" onClick={() => void api.tasks.start({ idempotencyKey: key(), id: item.task.id }).then(onDone)}>
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
