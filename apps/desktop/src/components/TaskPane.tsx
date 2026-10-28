import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  createdText,
  eventText,
  linkKind,
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
import {
  filedBy,
  firstLookQuestions,
  isArtifact,
  isPaste,
  pasteSize,
  signalChannel,
  signalMark,
  signalName,
  signalSender,
  withoutQuestions,
} from '@autopilot/client'
import { shell } from '../api.ts'
import { age, ago, updateLabel } from '../format.ts'
import { useDraft } from '../drafts.ts'
import { markSeen, send, useDetail, useStore } from '../store.ts'
import { AttachButton, FileChips, useFiles } from './Files.tsx'
import { Menu, type MenuItem } from './Menu.tsx'
import type { Tone } from '@autopilot/design'
import {
  Avatar,
  MoreToggle,
  Bars,
  WorkstreamMark,
  Banner,
  Button,
  Claude,
  Dot,
  Icon,
  Markdown,
  Meta,
  NavIcon,
  SourceMark,
  TriageMark,
  Spacer,
  Tag,
} from '../ui.tsx'
import { LinkIcon, Linked, SideLink } from './Links.tsx'
import { isPicture, Shots } from './Shots.tsx'
import { BAND_TITLE } from '../view.ts'

type Props = {
  item: QueueItem
  workstreams: Workstream[]
  /** Where this task sits in the list it was opened from, and the way through it. */
  onClose: () => void
}

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

const BAND_TONE: Record<QueueItem['band'], Tone> = {
  your_turn: 'pilot',
  triage: 'quiet',
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
  const asking = !ask && item.band === 'triage' && firstLookQuestions(updates).length > 0
  const activity = updates
    .filter((u) => u !== ask)
    .map((u) => (asking && u.author === 'scout' && u.kind === 'info' ? { ...u, body: withoutQuestions(u.body) } : u))

  useEffect(() => {
    if (item.unread) markSeen(task.id)
  }, [task.id, item.unread])

  const body = usePinnedToEnd()
  // From how it began to where it stands now, read downwards like a conversation; the newest
  // one shows in full.
  const entries = [
    <Marker key="created" who={task.createdBy} label={createdText(task)} at={shortDate(task.createdAt)} />,
    ...activity.map((u, i) => <Entry key={u.id} update={u} latest={i === activity.length - 1 && pending.length === 0} />),
    ...pending.map((p) => <PendingEntry key={p.id} pending={p} options={updates.flatMap((u) => u.options)} />),
    // Where it stands now: what waits on you, with its answer, or the line saying how it stands
    // and the box for what you write next, after the newest entry.
    // A new task whose first look has questions asks them there, in place of the box.
    ...(ask
      ? [
          <li key="ask" className="entry ask-entry">
            <Avatar who={ask.author} />
            <AskCard update={ask} />
          </li>,
        ]
      : item.band === 'triage' && firstLookQuestions(updates).length > 0
        ? [
            <li key="before" className="entry ask-entry">
              <Avatar who="scout" />
              <BeforeStart taskId={task.id} updates={updates} />
            </li>,
          ]
        : [<Now key="now" item={item} />, <Composer key="composer" item={item} />]),
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
        {/* Its number, once, where Linear puts it: at the top; a click copies it. */}
        <Button kind="quiet" className="head-id" title={`Copy ${task.id}`} onClick={() => void navigator.clipboard.writeText(task.id)}>
          {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </Button>
        <Button kind="quiet" className="head-title" tabIndex={-1} onClick={() => body.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          {task.title}
        </Button>
        <Spacer />
        {session && session.state !== 'ended' && (
          <span className="meta session head-session">
            <Dot tone="claude" />
            {session.activity ?? SESSION_STATE[session.state]}
          </span>
        )}
      </div>
      <div className="task-body" ref={body}>
        <div className="task-col">
          <div className="timeline">
            <div className="task-main">
              <header className="task-title">
                <h2 className="serif">{task.title}</h2>
                {/* Narrow, the properties sit here; wide, in the column on the right (styles.css). */}
                <div className="props">
                  <span className="prop-text">
                    {item.band === 'triage' ? <TriageMark /> : <Dot tone={BAND_TONE[item.band]} />}
                    {BAND_TITLE[item.band]}
                  </span>
                  <Tag>{task.workstream}</Tag>
                  {task.priority <= 2 && <Tag>{task.priority === 1 ? 'Urgent' : 'High priority'}</Tag>}
                  <Meta as="span">
                    {filed} · {ago(task.createdAt)}
                  </Meta>
                </div>
                <Actions item={item} start={!(item.band === 'triage' && firstLookQuestions(updates).length > 0)} />
              </header>
              {task.brief && (
                <section className="section">
                  <div className="section-label">Brief</div>
                  <Body text={task.brief} />
                </section>
              )}
              <div className="linked-inline">
                <Linked taskId={task.id} links={task.links.filter(isArtifact)} noun="artifact" />
                <Linked taskId={task.id} links={task.links.filter((l) => !isArtifact(l))} noun="linked" />
              </div>
              <section className="section">
                <div className="section-label">Activity</div>
                <ol className="feed">{entries}</ol>
              </section>
              {/* What waits on the owner comes last, where the reading ends and the page opens. */}
              {refused && <Banner>{refused}</Banner>}
            </div>
          </div>
        </div>
        <Properties item={item} workstreams={workstreams} signals={detail?.signals ?? []} updates={updates} />
      </div>
    </section>
  )
}

/**
 * The page opens at its end, where the newest entry and the reply are, and stays there as entries
 * arrive while you are at the end; scroll up and it stays where you put it. Once the title is out of
 * sight the head shows it, a click away from the top. Scrolled, the page
 * fades in under its head so you can tell there is more above. Each task mounts its own pane.
 */
const usePinnedToEnd = () => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let pinned = true
    const toEnd = () => {
      if (pinned) el.scrollTop = el.scrollHeight
    }
    const onScroll = () => {
      pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      el.classList.toggle('scrolled', el.scrollTop > 0)
      // The title scrolled out of sight: the head says it instead.
      const title = el.querySelector('.task-title h2')
      const off = title ? title.getBoundingClientRect().bottom < el.getBoundingClientRect().top + 8 : false
      el.closest('.pane')?.classList.toggle('title-off', off)
    }
    toEnd()
    onScroll()
    const grown = new ResizeObserver(toEnd)
    for (const child of el.children) grown.observe(child)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      grown.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [])
  return ref
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
      {long && <MoreToggle open={more} onToggle={() => setMore((m) => !m)} />}
    </>
  )
}

/** What an update attaches: pictures as thumbnails, the rest as chips. */
const Attachments = ({ taskId, links }: { taskId: string; links: Update['attachments'] }) => {
  const others = links.filter((a) => !isPicture(a.url))
  return (
    <>
      <Shots taskId={taskId} links={links.filter((a) => isPicture(a.url))} />
      {others.length > 0 && (
        <div className="attachments">
          {others.map((a) => (
            <Button key={a.url} kind="chip" title={a.title} onClick={() => open(a.url)}>
              <LinkIcon link={a} />
              <span className="chip-text">{a.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')}</span>
            </Button>
          ))}
        </div>
      )}
    </>
  )
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
        placeholder="Answer what you know…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            start()
          }
        }}
      />
      <div className="options">
        <Button kind="primary" title="⌘↩" onClick={start}>
          {text.trim() ? 'Start with these answers' : 'Start without answering'}
          <kbd>⌘↩</kbd>
        </Button>
      </div>
    </section>
  )
}

/** The one thing waiting on the owner, with its answers. */
const AskCard = ({ update }: { update: Update }) => {
  const [text, setText] = useDraft(`${update.taskId}:${update.id}`)
  const files = useFiles(update.taskId)
  const answer = (reply: { optionId: string } | { text: string }) => {
    send({
      kind: 'answer',
      taskId: update.taskId,
      updateId: update.id,
      ...reply,
      ...(files.links.length > 0 ? { attachments: files.links } : {}),
    })
    setText('')
    files.clear()
  }
  const ready = (text.trim().length > 0 || files.links.length > 0) && !files.busy
  const submit = () => {
    if (ready) answer({ text: text.trim() })
  }
  return (
    <section className="ask-card" aria-label="Needs you" {...files.drop}>
      <div className="ask-head">
        {updateLabel(update)} · {age(update.createdAt)}
      </div>
      <Body text={update.body} />
      <Attachments taskId={update.taskId} links={update.attachments} />
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
      <FileChips files={files.files} onRemove={files.remove} />
      <div className="inline-reply-box">
        {/* Three lines to start with, room to write a real answer; Enter sends, Shift-Enter breaks the line. */}
        <textarea
          className="inline-reply"
          rows={3}
          aria-label="Reply to Autopilot"
          placeholder={
            update.kind === 'done' ? 'Or ask for changes…' : update.options.length > 0 ? 'Or answer in your own words…' : 'Answer…'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={files.onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <span className="inline-reply-attach">
          <AttachButton onFiles={files.add} />
        </span>
        <Button
          kind="icon"
          className="enter-key"
          aria-label="Send"
          title="Send (Enter; Shift-Enter for a new line)"
          disabled={!ready}
          onClick={submit}
        >
          <Icon name="enter" size={14} />
        </Button>
      </div>
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
      {update.author === 'owner' && isPaste(update.body) ? <Pasted text={update.body} /> : <Body text={update.body} full={latest} />}
      <Attachments taskId={update.taskId} links={update.attachments} />
    </li>
  )
}

/** A long message of the owner's, most likely pasted: a card with its first words, opened on a click. */
const Pasted = ({ text }: { text: string }) => {
  const [shown, setShown] = useState(false)
  return (
    <div className={`pasted${shown ? ' open' : ''}`}>
      <Button kind="item" className="pasted-head" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        <NavIcon name="document" size={15} />
        <span className="pasted-text">
          <span className="pasted-title">Pasted text</span>
          <span className="pasted-meta">
            {pasteSize(text)} · {shown ? 'Hide' : 'Show'}
          </span>
        </span>
      </Button>
      {shown ? (
        <div className="msg">
          <Markdown text={text} onLink={open} />
        </div>
      ) : (
        <div className="pasted-peek">{text.slice(0, 240)}</div>
      )}
    </div>
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
      {isPaste(words) ? <Pasted text={words} /> : <div className="msg">{words}</div>}
    </li>
  ) : null
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
  // An ended session still opens on this Mac, where Claude keeps its conversation; Remote Control
  // only while it runs.
  const ways: { id: OpenWith; label: string; url: string }[] = [
    ...(session?.resumeUrl ? [{ id: 'mac' as const, label: 'In Claude on this Mac', url: session.resumeUrl }] : []),
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

/**
 * What you can do with the task: Start (unless Before I start in the timeline starts it), the
 * session, Snooze and Mark done; Not for me behind the ⋯, being rarer.
 */
const Actions = ({ item, session: withSession = true, start = true }: { item: QueueItem; session?: boolean; start?: boolean }) => {
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  const { preferred, choices } = useOpenSession(session)
  return (
    <div className="task-actions">
      {start && item.band === 'triage' && !live && (
        <Button kind="primary" className="with-icon" onClick={() => send({ kind: 'start', taskId: task.id })}>
          <NavIcon name="running" size={14} />
          Start
        </Button>
      )}
      {withSession && preferred && (
        <div className="split">
          {/* One click opens it the way you last chose; the arrow picks another and keeps it. */}
          <Button kind="tool" className="split-main" title={preferred.label} onClick={() => open(preferred.url)}>
            <Claude pixel={0.875} />
            Open session
          </Button>
          {choices.length > 1 && (
            <Menu className="split-arrow" label={<span className="sr-only">Other ways to open the session</span>} items={choices} />
          )}
        </div>
      )}
      <Menu
        className="with-icon"
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
      {item.band === 'triage' && (
        <Menu
          className="icon-only"
          chevron={false}
          align="right"
          label={
            <>
              <NavIcon name="ellipsis" />
              <span className="sr-only">More</span>
            </>
          }
          items={[{ label: 'Not for me', run: () => send({ kind: 'close', taskId: task.id, outcome: 'canceled' }) }]}
        />
      )}
    </div>
  )
}

/** The timeline's newest entry: a line for telling the session something; it grows while you write. */
const Composer = ({ item }: { item: QueueItem }) => {
  const { task, session } = item
  const [text, setText] = useDraft(`${task.id}:composer`)
  const files = useFiles(task.id)
  const ready = (text.trim().length > 0 || files.links.length > 0) && !files.busy
  const reply = () => {
    if (!ready) return
    send({ kind: 'instruct', taskId: task.id, body: text.trim(), ...(files.links.length > 0 ? { attachments: files.links } : {}) })
    setText('')
    files.clear()
  }
  const live = session && session.state !== 'ended'
  return (
    <li className="entry composer-entry">
      <Avatar who="owner" />
      <div className="composer-box" {...files.drop}>
        <div className="composer compact">
          <textarea
            aria-label="Reply to Autopilot"
            rows={Math.min(8, Math.max(2, text.split('\n').length))}
            placeholder={live ? 'Reply to the session…' : session ? 'Reply to pick it up again…' : 'Reply to start a session…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={files.onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                reply()
              }
            }}
          />
          <AttachButton onFiles={files.add} />
          <Button kind="send" aria-label="Send" title="Send (Enter; Shift-Enter for a new line)" disabled={!ready} onClick={reply}>
            <Icon name="enter" size={14} />
          </Button>
        </div>
        <FileChips files={files.files} onRemove={files.remove} />
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
  const closed = item.band === 'done'
  const streams: MenuItem[] = [...new Set([...workstreams.map((w) => w.name).filter((n) => n !== 'autopilot'), 'inbox'])]
    .filter((name) => name !== task.workstream)
    .map((name) => ({
      label: name,
      icon: <WorkstreamMark name={name} />,
      run: () => send({ kind: 'edit', taskId: task.id, workstream: name }),
    }))
  const priorities: MenuItem[] = [1, 2, 3, 4]
    .filter((p) => p !== task.priority)
    .map((p) => ({
      label: PRIORITY[p] ?? '',
      icon: <Bars priority={p} />,
      run: () => send({ kind: 'edit', taskId: task.id, priority: p }),
    }))
  const { preferred, choices } = useOpenSession(session)
  return (
    <aside className="task-side" aria-label="Properties">
      {!closed && (
        <div className="side-actions">
          <Actions item={item} start={!(item.band === 'triage' && firstLookQuestions(updates).length > 0)} />
        </div>
      )}
      <div className="side-group">
        {/* Where it stands, said once; what you can do about it is in the buttons above. */}
        <Prop label="Status">
          <span className="prop-text">
            {item.band === 'triage' ? <TriageMark /> : <Dot tone={BAND_TONE[item.band]} />}
            {BAND_TITLE[item.band]}
          </span>
        </Prop>
        <Prop label="Workstream">
          <Menu
            trigger="prop"
            chevron={false}
            align="right"
            label={
              <>
                <WorkstreamMark name={task.workstream} />
                {task.workstream}
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
        {/* Claude Code's Auto-fix, once the session opened a pull request: on unless you turn it off. */}
        {task.links.some((l) => linkKind(l).label === 'Pull request') && (
          <Prop label="Auto-fix">
            <Menu
              trigger="prop"
              chevron={false}
              align="right"
              label={
                <span title="Claude watches the pull request's checks and reviews and pushes fixes">
                  <Dot tone={task.autofix ? 'pilot' : 'quiet'} />
                  {task.autofix ? 'On' : 'Off'}
                </span>
              }
              items={[
                {
                  label: 'On: keep the PR green',
                  checked: task.autofix,
                  run: () => send({ kind: 'edit', taskId: task.id, autofix: true }),
                },
                { label: 'Off', checked: !task.autofix, run: () => send({ kind: 'edit', taskId: task.id, autofix: false }) },
              ]}
            />
          </Prop>
        )}
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

      {/* What the session made first, then what it points to, then where it came from; newest first in each. */}
      {[
        { heading: 'Artifacts', shown: 5, links: newestFirst(task.links.filter(isArtifact), (l) => l.at ?? linkedAt(l.url)) },
        {
          heading: 'Linked',
          shown: 3,
          links: newestFirst(
            task.links.filter((l) => !isArtifact(l)),
            (l) => l.at ?? linkedAt(l.url),
          ),
        },
      ].map((group) => (
        <SideGroup
          key={group.heading}
          heading={group.heading}
          shown={group.shown}
          list
          rows={group.links.map((l) => (
            <SideLink key={l.url} taskId={task.id} link={l} at={l.at ?? linkedAt(l.url)} />
          ))}
        />
      ))}
      <SideGroup
        heading="Signal"
        shown={3}
        rows={newestFirst(signals, (m) => m.at).map((m) => (
          <SignalRow key={`${m.url}-${m.at}`} mention={m} />
        ))}
      />
    </aside>
  )
}

/** Newest first; anything without a readable time keeps its place at the end. */
const newestFirst = <T,>(list: T[], at: (item: T) => string | null): T[] =>
  list
    .map((item, i) => ({ item, i, t: Date.parse(at(item) ?? '') }))
    .toSorted((a, b) => (Number.isNaN(b.t) ? -1 : Number.isNaN(a.t) ? 1 : b.t - a.t) || b.i - a.i)
    .map((x) => x.item)

/** A card in the properties column: its first rows, and the rest a click away. */
const SideGroup = ({ heading, rows, shown, list = false }: { heading: string; rows: ReactNode[]; shown: number; list?: boolean }) => {
  const [all, setAll] = useState(false)
  if (rows.length === 0) return null
  const visible = all ? rows : rows.slice(0, shown)
  return (
    <div className="side-group">
      <span className="side-heading">{heading}</span>
      {list ? <ul className="side-links">{visible}</ul> : visible}
      {rows.length > shown && (
        <Button kind="link" className="side-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </Button>
      )}
    </div>
  )
}

/** A message a signal filed or added: where, from whom, when; opens the message. */
const SignalRow = ({ mention }: { mention: TaskSignal }) => {
  const link = /^https?:\/\//.test(mention.url)
  const mark = signalMark(mention.signal, mention.url)
  const body = (
    <>
      <span className="signal-head">
        {mark ? <SourceMark mark={mark} size={13} /> : <NavIcon name="signals" size={13} />}
        {signalName(mention.signal)}
        {signalChannel(mention) ? ` · ${signalChannel(mention)}` : ''}
      </span>
      <span className="signal-title">{mention.title}</span>
      <span className="signal-meta">
        {[signalSender(mention), Number.isNaN(Date.parse(mention.at)) ? mention.at : ago(mention.at)].filter(Boolean).join(' · ')}
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
