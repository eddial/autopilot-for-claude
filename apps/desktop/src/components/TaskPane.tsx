import { useEffect, useState } from 'react'
import {
  createdText,
  eventText,
  linkSource,
  nowText,
  nowTone,
  pendingText,
  shortDate,
  updateAuthor,
  updateTone,
  type Pending,
} from '@autopilot/client'
import type { QueueItem, Update } from '@autopilot/contracts'
import { shell } from '../api.ts'
import { age, ago, titleCase, updateLabel } from '../format.ts'
import { markSeen, send, useDetail, useStore } from '../store.ts'
import type { Tone } from '@autopilot/design'
import { ArrowUp, Avatar, Banner, Button, Dot, Meta, Pill, Spacer, Tag } from '../ui.tsx'
import { BAND_TITLE } from '../view.ts'

type Props = { item: QueueItem; onClose: () => void }

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

const BAND_TONE: Record<QueueItem['band'], Tone> = {
  your_turn: 'attention',
  new: 'quiet',
  running: 'good',
  waiting: 'quiet',
  snoozed: 'quiet',
  done: 'good',
}

const SESSION_STATE: Record<string, string> = {
  starting: 'Session starting',
  working: 'Session working',
  idle: 'Session idle',
  waiting_permission: 'Session waits for a permission',
  ended: 'Session ended',
}

/** Snooze choices, as times from now. */
const snoozeTimes = (): { label: string; until: Date }[] => {
  const now = new Date()
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const monday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'For an hour', until: new Date(now.getTime() + 3_600_000) },
    { label: 'This evening', until: at(0, 18) },
    { label: 'Tomorrow morning', until: at(1, 9) },
    { label: 'Monday morning', until: at(monday, 9) },
  ].filter((t) => t.until > now)
}

export const TaskPane = ({ item, onClose }: Props) => {
  const { task } = item
  // The task comes from the window's store, kept current by the feed: no request on open once it
  // has been seen. Until then, the ask from the queue shows straight away.
  const { detail, pending } = useDetail(task.id)
  const { refused } = useStore()
  const answered = new Set(pending.flatMap((p) => (p.command.kind === 'answer' ? [p.command.updateId] : [])))
  const updates = detail?.updates ?? (item.openAsk ? [item.openAsk] : [])
  // What needs the owner goes on top; the activity below is everything else, oldest first.
  const ask = updates.find((u) => u.open && !answered.has(u.id)) ?? null
  const activity = updates.filter((u) => u !== ask)

  useEffect(() => {
    if (item.unread) markSeen(task.id)
  }, [task.id, item.unread])

  const [order, setOrder] = useOrder()
  // Oldest first as they happened; the newest one shows in full.
  // From how it began to where it stands now; the newest one shows in full.
  const entries = [
    <Marker key="created" who={task.createdBy} label={createdText(task)} at={shortDate(task.createdAt)} />,
    ...activity.map((u, i) => <Entry key={u.id} update={u} latest={i === activity.length - 1 && pending.length === 0} />),
    ...pending.map((p) => <PendingEntry key={p.id} pending={p} options={updates.flatMap((u) => u.options)} />),
    <Now key="now" item={item} />,
  ]

  const session = item.session
  const filed = task.source.signal
    ? `From ${titleCase(task.source.signal)}`
    : task.createdBy === 'system'
      ? 'From Autopilot'
      : 'Created by you'

  return (
    <section className="pane task" aria-label={task.title}>
      <div className="task-head drag">
        <Button kind="icon" className="back" aria-label="Back to the list" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 2L4 7l5 5" />
          </svg>
        </Button>
        <Meta as="span">
          {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </Meta>
        <Spacer />
        {session && session.state !== 'ended' && (
          <span className="meta session">
            <Dot tone="good" />
            {session.activity ?? SESSION_STATE[session.state]}
          </span>
        )}
      </div>
      <div className="timeline">
        <header className="task-title">
          <h2 className="serif">{task.title}</h2>
          <div className="props">
            <Pill tone={BAND_TONE[item.band]}>{BAND_TITLE[item.band]}</Pill>
            <Tag>{titleCase(task.workstream)}</Tag>
            {task.priority <= 2 && <Tag>{task.priority === 1 ? 'Urgent' : 'High priority'}</Tag>}
            <Meta as="span">
              {filed} · {ago(task.createdAt)}
            </Meta>
          </div>
          <Actions item={item} />
        </header>
        {task.brief && (
          <section className="section">
            <div className="section-label">Brief</div>
            <Body text={task.brief} />
          </section>
        )}
        {task.links.length > 0 && (
          <section className="section">
            <div className="section-label">Linked</div>
            <ul className="linked">
              {task.links.map((l) => (
                <li key={l.url}>
                  <Button kind="item" onClick={() => open(l.url)}>
                    <span className="source">
                      <span className="badge">{linkSource(l.url).charAt(0)}</span>
                      {linkSource(l.url)}
                    </span>
                    <span className="title">{l.title}</span>
                    {l.subtitle && <span className="meta">{l.subtitle}</span>}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {refused && <Banner>{refused}</Banner>}
        {ask && <AskCard update={ask} />}
        <section className="section">
          <div className="section-head">
            <div className="section-label">Activity</div>
            <Button kind="quiet" aria-label="Order of the activity" onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}>
              {order === 'newest' ? 'Newest first' : 'Oldest first'}
            </Button>
          </div>
          <ol className="feed">{order === 'newest' ? entries.toReversed() : entries}</ol>
        </section>
      </div>
      {!ask && <Composer item={item} />}
    </section>
  )
}

type Order = 'newest' | 'oldest'
const ORDER_KEY = 'autopilot.order'

/** Newest first unless the person chose otherwise; remembered in this window. */
const useOrder = (): [Order, (order: Order) => void] => {
  const [order, setOrder] = useState<Order>(() => {
    try {
      return localStorage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest'
    } catch {
      return 'newest'
    }
  })
  const choose = (next: Order) => {
    setOrder(next)
    try {
      localStorage.setItem(ORDER_KEY, next)
    } catch {
      // Not remembered; the choice still holds for now.
    }
  }
  return [order, choose]
}

/** Long text shows its first lines; a click shows the rest. */
const Body = ({ text, full = false }: { text: string; full?: boolean }) => {
  const long = !full && (text.length > 360 || text.split('\n').length > 6)
  const [more, setMore] = useState(false)
  return (
    <>
      <div className={`msg${long && !more ? ' clamped' : ''}`}>{text}</div>
      {long && (
        <Button kind="link" onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : 'Show more'}
        </Button>
      )}
    </>
  )
}

const Attachments = ({ links }: { links: Update['attachments'] }) =>
  links.length > 0 ? (
    <div className="attachments">
      {links.map((a) => (
        <Button key={a.url} kind="chip" onClick={() => open(a.url)}>
          {a.title}
        </Button>
      ))}
    </div>
  ) : null

/** The one thing waiting on the owner, with its answers. */
const AskCard = ({ update }: { update: Update }) => {
  const [text, setText] = useState('')
  const answer = (reply: { optionId: string } | { text: string }) =>
    send({ kind: 'answer', taskId: update.taskId, updateId: update.id, ...reply })
  return (
    <section className="ask-card" aria-label="Needs you">
      <div className="ask-head">
        {updateLabel(update)} · {age(update.createdAt)}
      </div>
      <div className="msg">{update.body}</div>
      <Attachments links={update.attachments} />
      {update.options.length > 0 && (
        <div className="options">
          {/* Sessions put their recommendation first. */}
          {update.options.map((o, i) => (
            <Button key={o.id} kind={i === 0 ? 'primary' : 'secondary'} onClick={() => answer({ optionId: o.id })}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
      <input
        className="inline-reply"
        aria-label="Reply to Autopilot"
        placeholder={update.options.length > 0 ? 'Or answer in words…' : 'Answer…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            answer({ text: text.trim() })
            setText('')
          }
        }}
      />
    </section>
  )
}

/** The latest entry shows in full; older long ones fold. */
const Entry = ({ update, latest }: { update: Update; latest: boolean }) => {
  if (update.kind === 'event') return <EventEntry update={update} />
  const by = updateAuthor(update)
  return (
    <li className={`entry tone-${updateTone(update)}`}>
      <Avatar who={update.author} />
      <div className="entry-head">
        <span className="entry-label">{updateLabel(update)}</span>
        {by ? ` · ${by}` : ''} · {age(update.createdAt)}
      </div>
      <Body text={update.body} full={latest} />
      <Attachments links={update.attachments} />
    </li>
  )
}

/** Where the timeline starts: how the task came in. */
const Marker = ({ who, label, at }: { who: Update['author']; label: string; at: string }) => (
  <li className="entry marker">
    <Avatar who={who} />
    <div className="entry-head">
      <span className="entry-label">{label}</span> · {at}
    </div>
  </li>
)

/** Where the timeline ends: where the task stands now. */
const Now = ({ item }: { item: QueueItem }) => (
  <li className={`entry marker now tone-${nowTone(item)}`}>
    <span className="avatar now" aria-hidden="true">
      <span className="now-dot" />
    </span>
    <div className="entry-head">
      <span className="entry-label">Now</span> · {nowText(item)}
    </div>
  </li>
)

/** A line that moves nothing: a link attached, a watcher started or stopped. */
const EventEntry = ({ update }: { update: Update }) => (
  <li className="entry event tone-quiet">
    <Avatar who={update.author} />
    <div className="entry-head">
      <span className="entry-label">{updateLabel(update)}</span> {eventText(update)} · {age(update.createdAt)}
      {update.attachments.map((a) => (
        <Button key={a.url} kind="chip" onClick={() => open(a.url)}>
          Open in {linkSource(a.url)}
        </Button>
      ))}
    </div>
  </li>
)

/** What the person just did, shown at once while it reaches the server. */
const PendingEntry = ({ pending, options }: { pending: Pending; options: { id: string; label: string }[] }) => {
  const { command } = pending
  const words = pendingText(command) ?? (command.kind === 'answer' ? options.find((o) => o.id === command.optionId)?.label : undefined)
  return words ? (
    <li className="entry tone-quiet sending">
      <Avatar who="owner" />
      <div className="entry-head">
        <span className="entry-label">You</span> · sending
      </div>
      <div className="msg">{words}</div>
    </li>
  ) : null
}

const Menu = ({ label, items }: { label: string; items: { label: string; run: () => void }[] }) => {
  const [shown, setShown] = useState(false)
  return (
    <div className="menu">
      <Button kind="tool" aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        {label}
      </Button>
      {shown && (
        <div className="menu-items" role="menu" onMouseLeave={() => setShown(false)}>
          {items.map((i) => (
            <Button
              key={i.label}
              kind="menu"
              role="menuitem"
              onClick={() => {
                setShown(false)
                i.run()
              }}
            >
              {i.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** What can be done with the task as a whole. */
const Actions = ({ item }: { item: QueueItem }) => {
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  const sessionLinks = [
    ...(live?.resumeUrl ? [{ label: 'In Claude on this Mac', run: () => open(live.resumeUrl ?? '') }] : []),
    ...(live?.remoteControlUrl ? [{ label: 'Through Remote Control', run: () => open(live.remoteControlUrl ?? '') }] : []),
  ]
  return (
    <div className="task-actions">
      {item.band === 'new' && !live && (
        <Button kind="primary" onClick={() => send({ kind: 'start', taskId: task.id })}>
          Start
        </Button>
      )}
      {sessionLinks.length > 0 && <Menu label="Open session" items={sessionLinks} />}
      <Menu
        label="Snooze"
        items={snoozeTimes().map((t) => ({
          label: t.label,
          run: () => send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() }),
        }))}
      />
      <Button kind="tool" onClick={() => send({ kind: 'close', taskId: task.id, outcome: 'done' })}>
        Mark done
      </Button>
      {item.band === 'new' && (
        <Button kind="quiet" onClick={() => send({ kind: 'close', taskId: task.id, outcome: 'canceled' })}>
          Not for me
        </Button>
      )}
    </div>
  )
}

/** A line for telling the session something; it grows while you write. */
const Composer = ({ item }: { item: QueueItem }) => {
  const { task, session } = item
  const [text, setText] = useState('')
  const reply = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    send({ kind: 'instruct', taskId: task.id, body })
  }
  const live = session && session.state !== 'ended'
  return (
    <div className="composer-wrap">
      <div className="composer compact">
        <textarea
          aria-label="Reply to Autopilot"
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          placeholder={live ? 'Tell the session…' : 'Tell Autopilot what to do; starts a session…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              reply()
            }
          }}
        />
        <Button kind="send" aria-label="Send" disabled={!text.trim()} onClick={reply}>
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}
