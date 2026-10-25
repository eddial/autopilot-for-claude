import { useEffect, useRef, useState } from 'react'
import { pendingText, type Pending } from '@autopilot/client'
import type { QueueItem, Update } from '@autopilot/contracts'
import { shell } from '../api.ts'
import { age, ago, titleCase, updateLabel } from '../format.ts'
import { markSeen, send, useDetail, useStore } from '../store.ts'
import { ArrowUp, Banner, Button, Dot, Meta, Spacer } from '../ui.tsx'

type Props = { item: QueueItem; onClose: () => void }

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
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
  // The conversation comes from the window's store, kept current by the feed: no request on open
  // once it has been seen. Until then, the ask from the queue shows straight away.
  const { detail, pending } = useDetail(task.id)
  const { refused } = useStore()
  const timeline = useRef<HTMLDivElement>(null)
  const answered = new Set(pending.flatMap((p) => (p.command.kind === 'answer' ? [p.command.updateId] : [])))
  const updates = detail?.updates ?? (item.openAsk ? [item.openAsk] : [])

  useEffect(() => {
    if (item.unread) markSeen(task.id)
  }, [task.id, item.unread])

  const count = updates.length + pending.length
  useEffect(() => {
    if (count > 0) timeline.current?.scrollTo({ top: timeline.current.scrollHeight })
  }, [count])

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
          {titleCase(task.workstream)} · {task.id}
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
      <div className="task-title">
        <h2 className="serif">{task.title}</h2>
        <div className="meta filed">
          {filed} · {ago(task.createdAt)}
          {task.links.map((l) => (
            <Button key={l.url} kind="chip" onClick={() => open(l.url)}>
              {l.title}
            </Button>
          ))}
        </div>
      </div>
      <div className="timeline" ref={timeline}>
        {refused && <Banner>{refused}</Banner>}
        {task.brief && <Brief text={task.brief} mine={task.createdBy === 'owner'} />}
        {updates.map((u) => (
          <Entry key={u.id} update={u} answered={answered.has(u.id)} />
        ))}
        {pending.map((p) => (
          <PendingEntry key={p.id} pending={p} options={updates.flatMap((u) => u.options)} />
        ))}
        {detail && updates.length === 0 && pending.length === 0 && !task.brief && <Meta>Nothing yet.</Meta>}
      </div>
      <Composer item={item} />
    </section>
  )
}

const Brief = ({ text, mine }: { text: string; mine: boolean }) =>
  mine ? (
    <div className="bubble">{text}</div>
  ) : (
    <div>
      <div className="label">Filed</div>
      <div className="msg filed">{text}</div>
    </div>
  )

/** What the person just did, shown at once while it reaches the server. */
const PendingEntry = ({ pending, options }: { pending: Pending; options: { id: string; label: string }[] }) => {
  const { command } = pending
  const words = pendingText(command) ?? (command.kind === 'answer' ? options.find((o) => o.id === command.optionId)?.label : undefined)
  return words ? <div className="bubble">{words}</div> : null
}

const Entry = ({ update, answered }: { update: Update; answered: boolean }) => {
  if (update.kind === 'instruction' && update.author === 'owner') return <div className="bubble">{update.body}</div>
  const by = update.author === 'session' ? '' : ` · ${titleCase(update.author)}`
  const asking = update.open && !answered
  const answer = (optionId: string) => send({ kind: 'answer', taskId: update.taskId, updateId: update.id, optionId })
  return (
    <div>
      <div className={`label${asking ? ' ask' : ''}`}>
        {updateLabel(update)}
        {by} · {age(update.createdAt)}
      </div>
      <div className="msg">{update.body}</div>
      {update.attachments.length > 0 && (
        <div className="attachments">
          {update.attachments.map((a) => (
            <Button key={a.url} kind="chip" onClick={() => open(a.url)}>
              {a.title}
            </Button>
          ))}
        </div>
      )}
      {asking && update.options.length > 0 && (
        <div className="options">
          {update.options.map((o) => (
            <Button key={o.id} onClick={() => answer(o.id)}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
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

const Composer = ({ item }: { item: QueueItem }) => {
  const { task, openAsk, session } = item
  const [text, setText] = useState('')
  const reply = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    send(openAsk ? { kind: 'answer', taskId: task.id, updateId: openAsk.id, text: body } : { kind: 'instruct', taskId: task.id, body })
  }
  const live = session && session.state !== 'ended' ? session : null
  const sessionLinks = [
    ...(live?.resumeUrl ? [{ label: 'In Claude on this Mac', run: () => open(live.resumeUrl ?? '') }] : []),
    ...(live?.remoteControlUrl ? [{ label: 'Through Remote Control', run: () => open(live.remoteControlUrl ?? '') }] : []),
  ]
  const placeholder = openAsk ? 'Answer…' : live ? 'Tell the session…' : 'Reply to Autopilot; starts a session…'
  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          aria-label="Reply to Autopilot"
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              reply()
            }
          }}
        />
        <div className="composer-bar">
          {sessionLinks.length > 0 && <Menu label="Open session" items={sessionLinks} />}
          {item.band === 'new' && !live && (
            <Button kind="tool" onClick={() => send({ kind: 'start', taskId: task.id })}>
              Start
            </Button>
          )}
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
          <Button kind="send" aria-label="Send" disabled={!text.trim()} onClick={reply}>
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  )
}
