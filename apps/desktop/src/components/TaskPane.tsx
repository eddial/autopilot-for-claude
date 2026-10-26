import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import type { QueueItem, TaskSignal, Update, Workstream } from '@autopilot/contracts'
import { filedBy, signalName, workstreamMark } from '@autopilot/client'
import { shell } from '../api.ts'
import { age, ago, titleCase, updateLabel } from '../format.ts'
import { useDraft } from '../drafts.ts'
import { markSeen, send, useDetail, useStore } from '../store.ts'
import type { Tone } from '@autopilot/design'
import { ArrowUp, Avatar, Banner, Button, Claude, Dot, Icon, Markdown, Meta, NavIcon, Pill, Spacer, Tag } from '../ui.tsx'
import { LinkIcon, Linked, SideLink } from './Links.tsx'
import { BAND_TITLE } from '../view.ts'

type Props = { item: QueueItem; workstreams: Workstream[]; onClose: () => void }

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

const BAND_TONE: Record<QueueItem['band'], Tone> = {
  your_turn: 'pilot',
  new: 'quiet',
  running: 'claude',
  waiting: 'paused',
  snoozed: 'paused',
  done: 'quiet',
}

const SESSION_STATE: Record<string, string> = {
  starting: 'Session starting',
  working: 'Session working',
  idle: 'Session idle',
  waiting_permission: 'Session waits for a permission',
  ended: 'Session ended',
}

const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Snooze choices, as times from now, each with the day and time it comes back. */
const snoozeTimes = (): { label: string; day: string; time: string; until: Date }[] => {
  const now = new Date()
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000)
  const monday = (8 - now.getDay()) % 7 || 7
  const day = (d: Date) => {
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    return d.toLocaleDateString('en-GB', days < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' })
  }
  // An evening less than an hour away is no snooze at all.
  const soon = later(1)
  const choices = [
    { label: 'In an hour', until: soon },
    { label: 'In three hours', until: later(3) },
    { label: 'This evening', until: at(0, 18) },
    { label: 'Tomorrow morning', until: at(1, 9) },
    { label: 'Monday morning', until: at(monday, 9) },
    { label: 'In a week', until: at(7, 9) },
  ]
  // On a Sunday, Monday morning is tomorrow morning.
  return choices
    .filter((t, i) => t.until >= soon && !choices.slice(0, i).some((c) => c.until.getTime() === t.until.getTime()))
    .map((t) => ({ ...t, day: day(t.until), time: time(t.until) }))
}

export const TaskPane = ({ item, workstreams, onClose }: Props) => {
  const { task } = item
  // The task comes from the window's store, kept current by the feed: no request on open once it
  // has been seen. Until then, the ask from the queue shows straight away.
  const { detail, pending } = useDetail(task.id)
  const { refused } = useStore()
  const answered = new Set(pending.flatMap((p) => (p.command.kind === 'answer' ? [p.command.updateId] : [])))
  const updates = detail?.updates ?? (item.openAsk ? [item.openAsk] : [])
  // What needs the owner goes on top; the activity below is everything else, oldest first.
  const ask = updates.find((u) => u.open && !answered.has(u.id)) ?? null
  // While the first look's questions are asked on top, its entry below keeps only what it found.
  const asking = !ask && item.band === 'new' && firstLookQuestions(updates).length > 0
  const activity = updates
    .filter((u) => u !== ask)
    .map((u) => (asking && u.author === 'scout' && u.kind === 'info' ? { ...u, body: withoutQuestions(u.body) } : u))

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
    // What you write next sits where it will appear: the newest entry (first, newest first).
    ...(ask ? [] : [<Composer key="composer" item={item} />]),
  ]

  const session = item.session
  const filed = filedBy(task)

  return (
    <section className="pane task" aria-label={task.title}>
      <div className="task-head drag">
        <Button kind="icon" className="back" aria-label="Back to the list" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 2L4 7l5 5" />
          </svg>
        </Button>
        <Meta as="span" className="head-id">
          {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </Meta>
        <Spacer />
        {session && session.state !== 'ended' && (
          <span className="meta session head-session">
            <Dot tone="claude" />
            {session.activity ?? SESSION_STATE[session.state]}
          </span>
        )}
      </div>
      <div className="task-body">
        <div className="task-col">
          <div className="timeline">
            <div className="task-main">
              <header className="task-title">
                <h2 className="serif">{task.title}</h2>
                {/* Narrow, the properties sit here; wide, in the column on the right (styles.css). */}
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
              <div className="linked-inline">
                <Linked taskId={task.id} links={task.links} />
              </div>
              {refused && <Banner>{refused}</Banner>}
              {ask && <AskCard update={ask} />}
              {!ask && item.band === 'new' && <BeforeStart taskId={task.id} updates={updates} />}
              <section className="section">
                <div className="section-head">
                  <div className="section-label">Activity</div>
                  <Button
                    kind="quiet"
                    aria-label="Order of the activity"
                    onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}
                  >
                    {order === 'newest' ? 'Newest first' : 'Oldest first'}
                  </Button>
                </div>
                <ol className="feed">{order === 'newest' ? entries.toReversed() : entries}</ol>
              </section>
            </div>
          </div>
        </div>
        <Properties item={item} workstreams={workstreams} signals={detail?.signals ?? []} updates={updates} />
      </div>
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
      <div className={`msg${long && !more ? ' clamped' : ''}`}>
        <Markdown text={text} onLink={open} />
      </div>
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
        <Button key={a.url} kind="chip" title={a.title} onClick={() => open(a.url)}>
          <LinkIcon link={a} />
          <span className="chip-text">{a.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')}</span>
        </Button>
      ))}
    </div>
  ) : null

const BEFORE_STARTING = /^Before starting:\s*$/m

/** A first look without its questions, for when they are asked on their own. */
const withoutQuestions = (body: string) => body.split(BEFORE_STARTING)[0]?.trim() ?? body

/** What the first look asked before anyone starts: its "Before starting" lines. */
const firstLookQuestions = (updates: Update[]): string[] => {
  const look = updates.findLast((u) => u.author === 'scout' && u.kind === 'info')
  const after = look?.body.split(BEFORE_STARTING)[1]
  return after ? after.split('\n').flatMap((l) => (/^\s*[-*]\s+/.test(l) ? [l.replace(/^\s*[-*]\s+/, '').trim()] : [])) : []
}

/**
 * A new task whose first look has questions: asked here, before the start, so the session begins
 * with the answers instead of guessing. Answering is optional; Start goes either way.
 */
const BeforeStart = ({ taskId, updates }: { taskId: string; updates: Update[] }) => {
  const [text, setText] = useDraft(`${taskId}:answers`)
  const questions = firstLookQuestions(updates)
  if (questions.length === 0) return null
  const start = () => {
    if (text.trim()) send({ kind: 'instruct', taskId, body: `Answers to the first look's questions:\n\n${text.trim()}` })
    else send({ kind: 'start', taskId })
    setText('')
  }
  return (
    <section className="ask-card" aria-label="Before starting">
      <div className="ask-head">Before I start</div>
      <ul className="questions">
        {questions.map((q) => (
          <li key={q}>
            <Markdown text={q} onLink={open} />
          </li>
        ))}
      </ul>
      <textarea
        className="inline-reply"
        rows={3}
        aria-label="Your answers"
        placeholder="Answer what you know; leave the rest to the session…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="options">
        <Button kind="primary" onClick={start}>
          {text.trim() ? 'Start with these answers' : 'Start without answering'}
        </Button>
      </div>
    </section>
  )
}

/** The one thing waiting on the owner, with its answers. */
const AskCard = ({ update }: { update: Update }) => {
  const [text, setText] = useDraft(`${update.taskId}:${update.id}`)
  const answer = (reply: { optionId: string } | { text: string }) => {
    send({ kind: 'answer', taskId: update.taskId, updateId: update.id, ...reply })
    setText('')
  }
  return (
    <section className="ask-card" aria-label="Needs you">
      <div className="ask-head">
        {updateLabel(update)} · {age(update.createdAt)}
      </div>
      <Body text={update.body} />
      <Attachments links={update.attachments} />
      {update.kind === 'done' && (
        <div className="options">
          <Button kind="primary" onClick={() => send({ kind: 'close', taskId: update.taskId, outcome: 'done' })}>
            Close it
          </Button>
        </div>
      )}
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
        placeholder={update.kind === 'done' ? 'Or ask for more…' : update.options.length > 0 ? 'Or answer in words…' : 'Answer…'}
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

/** A choice in a menu; `detail` is lined up in columns beside the labels. */
type MenuItem = { label: string; detail?: string[]; run: () => void; /** A choice that is on: ticked at the start. */ checked?: boolean }

const Menu = ({
  label,
  className,
  items,
  trigger = 'tool',
  chevron = true,
  align = 'left',
}: {
  label: ReactNode
  className?: string
  items: MenuItem[]
  /** The button that opens it: a toolbar button, or a property row. */
  trigger?: 'tool' | 'prop'
  chevron?: boolean
  align?: 'left' | 'right'
}) => {
  const [shown, setShown] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setShown(false)
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setShown(false)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away)
    }
  }, [shown])
  return (
    <div className={`menu${trigger === 'prop' ? ' menu-prop' : ''}`} ref={ref}>
      <Button kind={trigger} className={className} aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        {label}
        {chevron && <Icon name="more" />}
      </Button>
      {shown && (
        <div
          className={`menu-items${align === 'right' ? ' align-right' : ''}${items.some((i) => i.checked !== undefined) ? ' with-checks' : ''}`}
          role="menu"
        >
          {items.map((i) => (
            <Button
              key={i.label}
              kind="menu"
              role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={i.checked}
              onClick={() => {
                setShown(false)
                i.run()
              }}
            >
              {i.checked !== undefined && <span className="menu-check">{i.checked && <Icon name="done" />}</span>}
              {i.label}
              {i.detail?.map((d) => (
                <span key={d} className="menu-detail">
                  {d}
                </span>
              ))}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

type OpenWith = 'mac' | 'remote'
const OPEN_WITH_KEY = 'autopilot.openWith'

const OPEN_WITH_EVENT = 'autopilot-open-with'

const readOpenWith = (): OpenWith => {
  try {
    return localStorage.getItem(OPEN_WITH_KEY) === 'remote' ? 'remote' : 'mac'
  } catch {
    return 'mac'
  }
}

/**
 * How a session opens: one click opens it the way last chosen (this Mac at first); the choices
 * tick that way, and picking another opens it there and makes it the default, everywhere.
 */
const useOpenSession = (session: QueueItem['session']) => {
  const [openWith, setOpenWith] = useState<OpenWith>(readOpenWith)
  useEffect(() => {
    const changed = () => setOpenWith(readOpenWith())
    window.addEventListener(OPEN_WITH_EVENT, changed)
    return () => window.removeEventListener(OPEN_WITH_EVENT, changed)
  }, [])
  const live = session && session.state !== 'ended' ? session : null
  const ways: { id: OpenWith; label: string; url: string }[] = [
    ...(live?.resumeUrl ? [{ id: 'mac' as const, label: 'In Claude on this Mac', url: live.resumeUrl }] : []),
    ...(live?.remoteControlUrl ? [{ id: 'remote' as const, label: 'Through Remote Control', url: live.remoteControlUrl }] : []),
  ]
  const preferred = ways.find((w) => w.id === openWith) ?? ways[0] ?? null
  const choices: MenuItem[] = ways.map((w) => ({
    label: w.label,
    checked: w.id === preferred?.id,
    run: () => {
      try {
        localStorage.setItem(OPEN_WITH_KEY, w.id)
      } catch {
        // Not remembered: the default stays this Mac.
      }
      window.dispatchEvent(new Event(OPEN_WITH_EVENT))
      open(w.url)
    },
  }))
  return { preferred, choices }
}

/** What can be done with the task as a whole. */
const Actions = ({ item }: { item: QueueItem }) => {
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  const { preferred, choices } = useOpenSession(session)
  return (
    <div className="task-actions">
      {item.band === 'new' && !live && (
        <Button kind="primary" className="with-icon" onClick={() => send({ kind: 'start', taskId: task.id })}>
          <Icon name="play" />
          Start
        </Button>
      )}
      {preferred && (
        <div className="split tone-claude">
          {/* One click opens it the way you last chose; the arrow picks another and keeps it. */}
          <Button kind="tool" className="tinted split-main" title={preferred.label} onClick={() => open(preferred.url)}>
            <Claude pixel={0.875} />
            Open session
          </Button>
          {choices.length > 1 && (
            <Menu className="tinted split-arrow" label={<span className="sr-only">Other ways to open the session</span>} items={choices} />
          )}
        </div>
      )}
      <Menu
        className="tinted tone-paused"
        label={
          <>
            <Icon name="clock" />
            Snooze
          </>
        }
        items={snoozeTimes().map((t) => ({
          label: t.label,
          detail: [t.day, t.time],
          run: () => send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() }),
        }))}
      />
      <Button kind="tool" className="with-icon" onClick={() => send({ kind: 'close', taskId: task.id, outcome: 'done' })}>
        <Icon name="done" />
        Mark done
      </Button>
      {item.band === 'new' && (
        <Button kind="quiet" onClick={() => send({ kind: 'close', taskId: task.id, outcome: 'canceled' })}>
          <Icon name="dismiss" />
          Not for me
        </Button>
      )}
    </div>
  )
}

/** The timeline's newest entry: a line for telling the session something; it grows while you write. */
const Composer = ({ item }: { item: QueueItem }) => {
  const { task, session } = item
  const [text, setText] = useDraft(`${task.id}:composer`)
  const reply = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    send({ kind: 'instruct', taskId: task.id, body })
  }
  const live = session && session.state !== 'ended'
  return (
    <li className="entry composer-entry">
      <Avatar who="owner" />
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
    </li>
  )
}

/** A label and its value in the properties column, as in Linear: the value is what you click. */
const Prop = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="prop">
    <span className="prop-label">{label}</span>
    <div className="prop-value">{children}</div>
  </div>
)

/** Four bars, as many lit as the priority is high. */
const Bars = ({ priority }: { priority: number }) => (
  <span className={`bars p${priority}`} aria-hidden="true">
    {[1, 2, 3].map((b) => (
      <span key={b} className={b <= 4 - priority ? 'lit' : ''} />
    ))}
  </span>
)

/**
 * What a task is, beside what happened to it, as in Linear: status, workstream and priority to
 * change in place, where it came from, its session, and what it links to. It stays put while the
 * page scrolls; shown when the pane is wide enough.
 */
const Properties = ({
  item,
  workstreams,
  signals,
  updates,
}: {
  item: QueueItem
  workstreams: Workstream[]
  signals: TaskSignal[]
  updates: Update[]
}) => {
  // Links from before they carried a time: when the activity says it was linked.
  const linkedAt = (url: string) => updates.find((u) => u.attachments.some((a) => a.url === url))?.createdAt ?? null
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  const closed = item.band === 'done'
  const status: MenuItem[] = closed
    ? []
    : [
        ...(item.band === 'new' && !live ? [{ label: 'Start', run: () => send({ kind: 'start', taskId: task.id }) }] : []),
        ...snoozeTimes().map((t) => ({
          label: `Snooze: ${t.label}`,
          detail: [t.day, t.time],
          run: () => send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() }),
        })),
        { label: 'Mark done', run: () => send({ kind: 'close', taskId: task.id, outcome: 'done' }) },
        { label: 'Not for me', run: () => send({ kind: 'close', taskId: task.id, outcome: 'canceled' }) },
      ]
  const streams: MenuItem[] = [...new Set([...workstreams.map((w) => w.name).filter((n) => n !== 'autopilot'), 'inbox'])]
    .filter((name) => name !== task.workstream)
    .map((name) => ({ label: titleCase(name), run: () => send({ kind: 'edit', taskId: task.id, workstream: name }) }))
  const priorities: MenuItem[] = [1, 2, 3, 4]
    .filter((p) => p !== task.priority)
    .map((p) => ({ label: PRIORITY[p] ?? '', run: () => send({ kind: 'edit', taskId: task.id, priority: p }) }))
  const { preferred, choices } = useOpenSession(session)
  const mark = workstreamMark(task.workstream)
  return (
    <aside className="task-side" aria-label="Properties">
      <div className="side-top">
        <span className="side-id">
          {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </span>
        <Button
          kind="icon"
          aria-label={`Copy ${task.id}`}
          title={`Copy ${task.id}`}
          onClick={() => void navigator.clipboard.writeText(task.id)}
        >
          <NavIcon name="document" size={13} />
        </Button>
      </div>
      <div className="side-group">
        <Prop label="Status">
          {status.length > 0 ? (
            <Menu
              trigger="prop"
              chevron={false}
              align="right"
              label={<Pill tone={BAND_TONE[item.band]}>{BAND_TITLE[item.band]}</Pill>}
              items={status}
            />
          ) : (
            <Pill tone={BAND_TONE[item.band]}>{BAND_TITLE[item.band]}</Pill>
          )}
        </Prop>
        <Prop label="Workstream">
          <Menu
            trigger="prop"
            chevron={false}
            align="right"
            label={
              <>
                <span className={`ws-mark ${mark.tone}`} aria-hidden="true">
                  {mark.letters}
                </span>
                {titleCase(task.workstream)}
              </>
            }
            items={streams}
          />
        </Prop>
        <Prop label="Priority">
          <Menu
            trigger="prop"
            chevron={false}
            align="right"
            label={
              <>
                <Bars priority={task.priority} />
                {PRIORITY[task.priority] ?? 'Normal'}
              </>
            }
            items={priorities}
          />
        </Prop>
      </div>

      <div className="side-group">
        <Prop label="From">
          {task.source.url ? (
            <Button kind="prop" onClick={() => open(task.source.url ?? '')} title={task.source.url}>
              {task.source.signal ? signalName(task.source.signal) : task.createdBy === 'system' ? 'Autopilot' : 'You'}
              <NavIcon name="link" size={13} />
            </Button>
          ) : (
            <span className="prop-text">
              {task.source.signal ? signalName(task.source.signal) : task.createdBy === 'system' ? 'Autopilot' : 'You'}
            </span>
          )}
        </Prop>
        <Prop label="Created">
          <span className="prop-text" title={new Date(task.createdAt).toLocaleString('en-GB')}>
            {ago(task.createdAt)}
          </span>
        </Prop>
        {task.source.mirrors && (
          <Prop label="Mirrors">
            <span className="prop-text">{task.source.mirrors}</span>
          </Prop>
        )}
        {session && (
          <Prop label="Session">
            {preferred ? (
              <div className="prop-split">
                <Button kind="prop" title={preferred.label} onClick={() => open(preferred.url)}>
                  <Claude pixel={0.75} />
                  {session.activity ?? SESSION_STATE[session.state]}
                </Button>
                {choices.length > 1 && (
                  <Menu
                    trigger="prop"
                    align="right"
                    label={<span className="sr-only">Other ways to open the session</span>}
                    items={choices}
                  />
                )}
              </div>
            ) : (
              <span className="prop-text">{session.state === 'ended' ? 'Ended' : (session.activity ?? SESSION_STATE[session.state])}</span>
            )}
          </Prop>
        )}
      </div>

      {signals.length > 0 && (
        <div className="side-group">
          <span className="side-heading">Signal</span>
          {signals.map((m) => (
            <SignalRow key={`${m.url}-${m.at}`} mention={m} />
          ))}
        </div>
      )}

      {task.links.length > 0 && (
        <div className="side-group">
          <span className="side-heading">Linked</span>
          <ul className="side-links">
            {task.links.toReversed().map((l) => (
              <SideLink key={l.url} taskId={task.id} link={l} at={l.at ?? linkedAt(l.url)} />
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

/** A message a signal filed or added: where, from whom, when; opens the message. */
const SignalRow = ({ mention }: { mention: TaskSignal }) => {
  const link = /^https?:\/\//.test(mention.url)
  const body = (
    <>
      <span className="signal-head">
        <NavIcon name="signals" size={13} />
        {signalName(mention.signal)}
        {mention.channel ? ` · ${mention.channel}` : ''}
      </span>
      <span className="signal-title">{mention.title}</span>
      <span className="signal-meta">
        {mention.sender} · {Number.isNaN(Date.parse(mention.at)) ? mention.at : ago(mention.at)}
        {mention.action === 'updated' ? ' · added' : ''}
      </span>
    </>
  )
  return link ? (
    <Button kind="prop" className="signal-row" title={mention.url} onClick={() => open(mention.url)}>
      {body}
    </Button>
  ) : (
    <div className="prop-text signal-row">{body}</div>
  )
}

const PRIORITY: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' }
