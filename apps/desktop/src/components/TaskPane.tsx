import { useEffect, useRef, useState } from 'react'
import type { QueueItem, TaskDetail, Update } from '@autopilot/contracts'
import { api, key, shell } from '../api.ts'
import { age, ago, titleCase, updateLabel } from '../format.ts'

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
  const [loaded, setLoaded] = useState<{ version: string; detail: TaskDetail } | null>(null)
  const detail = loaded?.detail ?? null
  const [error, setError] = useState<string | null>(null)
  const timeline = useRef<HTMLDivElement>(null)

  // Refetch whenever the queue says the task, its ask or its session changed.
  const version = `${task.id}|${task.updatedAt}|${item.openAsk?.id ?? ''}|${item.session?.state ?? ''}`
  useEffect(() => {
    let cancelled = false
    api.tasks
      .get({ id: task.id })
      .then((d) => {
        if (!cancelled) setLoaded({ version, detail: d })
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [task.id, version])

  useEffect(() => {
    if (item.unread) void api.tasks.markSeen({ idempotencyKey: key(), id: task.id }).catch(() => {})
  }, [task.id, item.unread])

  const count = detail?.updates.length ?? 0
  useEffect(() => {
    if (count > 0) timeline.current?.scrollTo({ top: timeline.current.scrollHeight })
  }, [count])

  const session = item.session
  const filed = task.source.signal ? `From ${titleCase(task.source.signal)}` : task.createdBy === 'system' ? 'From Autopilot' : 'Created by you'

  return (
    <section className="pane task" aria-label={task.title}>
      <div className="task-head drag">
        <button className="icon-button back" aria-label="Back to the list" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 2L4 7l5 5" />
          </svg>
        </button>
        <span className="meta">
          {titleCase(task.workstream)} · {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {session && session.state !== 'ended' && (
          <span className="meta">
            <span className="health-dot" style={{ background: 'var(--pilot)', marginRight: 6 }} />
            {session.activity ?? SESSION_STATE[session.state]}
          </span>
        )}
      </div>
      <div className="task-title">
        <h2 className="serif">{task.title}</h2>
        <div className="meta" style={{ marginTop: 8 }}>
          {filed} · {ago(task.createdAt)}
          {task.links.map((l) => (
            <button key={l.url} className="chip" style={{ marginLeft: 8 }} onClick={() => open(l.url)}>
              {l.title}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline" ref={timeline}>
        {error && <div className="banner">{error}</div>}
        {task.brief && <Brief text={task.brief} mine={task.createdBy === 'owner'} />}
        {detail?.updates.map((u) => <Entry key={u.id} update={u} />)}
        {detail && detail.updates.length === 0 && !task.brief && <div className="meta">Nothing yet.</div>}
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
      <div className="msg" style={{ color: 'var(--text-2)' }}>
        {text}
      </div>
    </div>
  )

const Entry = ({ update }: { update: Update }) => {
  if (update.kind === 'instruction' && update.author === 'owner') return <div className="bubble">{update.body}</div>
  const by = update.author === 'session' ? '' : ` · ${titleCase(update.author)}`
  const answer = (optionId: string) => void api.updates.answer({ idempotencyKey: key(), updateId: update.id, optionId })
  return (
    <div>
      <div className={`label${update.open ? ' ask' : ''}`}>
        {updateLabel(update)}
        {by} · {age(update.createdAt)}
      </div>
      <div className="msg">{update.body}</div>
      {update.attachments.length > 0 && (
        <div className="attachments">
          {update.attachments.map((a) => (
            <button key={a.url} className="chip" onClick={() => open(a.url)}>
              {a.title}
            </button>
          ))}
        </div>
      )}
      {update.open && update.options.length > 0 && (
        <div className="options">
          {update.options.map((o) => (
            <button key={o.id} className="btn" onClick={() => answer(o.id)}>
              {o.label}
            </button>
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
      <button className="tool" aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        {label}
      </button>
      {shown && (
        <div className="menu-items" role="menu" onMouseLeave={() => setShown(false)}>
          {items.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              onClick={() => {
                setShown(false)
                i.run()
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const Composer = ({ item }: { item: QueueItem }) => {
  const { task, openAsk, session } = item
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const send = () => {
    const body = text.trim()
    if (!body) return
    void run(async () => {
      if (openAsk) await api.updates.answer({ idempotencyKey: key(), updateId: openAsk.id, text: body })
      else await api.updates.instruct({ idempotencyKey: key(), taskId: task.id, body })
      setText('')
    })
  }
  const live = session && session.state !== 'ended' ? session : null
  const sessionLinks = [
    ...(live?.resumeUrl ? [{ label: 'In Claude on this Mac', run: () => open(live.resumeUrl ?? '') }] : []),
    ...(live?.remoteControlUrl ? [{ label: 'Through Remote Control', run: () => open(live.remoteControlUrl ?? '') }] : []),
  ]
  const placeholder = openAsk ? 'Answer…' : live ? 'Tell the session…' : 'Reply to Autopilot; starts a session…'
  return (
    <div className="composer-wrap">
      {error && <div className="banner" style={{ margin: '0 0 8px' }}>{error}</div>}
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
              send()
            }
          }}
        />
        <div className="composer-bar">
          {sessionLinks.length > 0 && <Menu label="Open session" items={sessionLinks} />}
          {item.band === 'new' && !live && (
            <button className="tool" onClick={() => void run(() => api.tasks.start({ idempotencyKey: key(), id: task.id }))}>
              Start
            </button>
          )}
          <Menu
            label="Snooze"
            items={snoozeTimes().map((t) => ({
              label: t.label,
              run: () => void run(() => api.tasks.snooze({ idempotencyKey: key(), id: task.id, until: t.until.toISOString() })),
            }))}
          />
          <button className="tool" onClick={() => void run(() => api.tasks.close({ idempotencyKey: key(), id: task.id, outcome: 'done' }))}>
            Mark done
          </button>
          {item.band === 'new' && (
            <button className="tool bare" onClick={() => void run(() => api.tasks.close({ idempotencyKey: key(), id: task.id, outcome: 'canceled' }))}>
              Not for me
            </button>
          )}
          <button className="send" aria-label="Send" disabled={busy || !text.trim()} onClick={send}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#141413" strokeWidth="1.8" aria-hidden="true">
              <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
