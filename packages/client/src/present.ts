import type { QueueItem, Task, Update } from '@autopilot/contracts'
import { MARKS, type Mark } from '@autopilot/design'

/**
 * How an update reads on a task's page, the same on the Mac and the iPhone: its label, who posted
 * it when the label does not say, and its tone (the names of `@autopilot/design`'s tones).
 */

/** The names of `@autopilot/design`'s tones. */
export type EntryTone = 'pilot' | 'claude' | 'paused' | 'alert' | 'quiet'

const ASKING: Partial<Record<Update['kind'], string>> = {
  decision: 'Needs your decision',
  question: 'Asked you',
  review: 'Ready to review',
  blocked: 'Stuck',
  done: 'Finished',
}

/** The same asks once answered: history, not a call to act. */
const ASKED: Partial<Record<Update['kind'], string>> = {
  decision: 'Asked for a decision',
  question: 'Asked a question',
  review: 'Asked for a review',
  blocked: 'Was stuck',
  done: 'Finished',
}

export const updateLabel = (update: Update): string => {
  const ask = update.open ? ASKING[update.kind] : (ASKED[update.kind] ?? ASKING[update.kind])
  if (ask) return ask
  switch (update.kind) {
    case 'waiting':
      return update.waitingOn ? `Waiting on ${update.waitingOn}` : 'Waiting'
    case 'done':
      return 'Done'
    case 'info':
      return INFO[update.author] ?? 'Update'
    case 'event':
      return WHO[update.author]
    case 'signal':
      return 'New on the thread'
    case 'instruction':
      return 'You'
    default:
      return update.kind
  }
}

const INFO: Partial<Record<Update['author'], string>> = { watcher: 'News', scout: 'First look', system: 'From Autopilot' }

/** Who did it, as an event's line starts: "Session linked …", "You linked …". */
const WHO: Record<Update['author'], string> = {
  owner: 'You',
  session: 'Session',
  watcher: 'Watcher',
  signal: 'Signal',
  system: 'Autopilot',
  scout: 'Autopilot',
}

const BY: Partial<Record<Update['author'], string>> = { session: 'Session', watcher: 'Watcher', signal: 'Signal' }

/** Who posted it, when the label does not already say. */
export const updateAuthor = (update: Update): string | null => (update.kind === 'event' ? null : (BY[update.author] ?? null))

/** An event's line after who did it: "Linked …" reads "linked …" after "Session". */
export const eventText = (update: Update): string => update.body.charAt(0).toLowerCase() + update.body.slice(1)

/** Where a link lives: its host (and, where one host holds several apps, its path), name and mark. */
const SOURCES: [host: RegExp, name: string, mark: Mark | null, path?: RegExp][] = [
  [/(^|\.)mail\.google\.com$/, 'Gmail', 'gmail'],
  [/^docs\.google\.com$/, 'Google Sheets', 'googleSheets', /^\/spreadsheets\//],
  [/^docs\.google\.com$/, 'Google Slides', 'googleSlides', /^\/presentation\//],
  [/^docs\.google\.com$/, 'Google Docs', 'googleDocs'],
  [/^drive\.google\.com$/, 'Google Drive', 'googleDrive'],
  [/^calendar\.google\.com$/, 'Google Calendar', 'googleCalendar'],
  [/^meet\.google\.com$/, 'Google Meet', 'googleMeet'],
  [/(^|\.)slack\.com$/, 'Slack', 'slack'],
  [/(^|\.)github\.com$/, 'GitHub', 'github'],
  [/(^|\.)gitlab\.com$/, 'GitLab', 'gitlab'],
  [/(^|\.)linear\.app$/, 'Linear', 'linear'],
  [/(^|\.)notion\.(so|site)$/, 'Notion', 'notion'],
  [/(^|\.)fathom\.video$/, 'Fathom', 'fathom'],
  [/(^|\.)claude\.ai$/, 'Claude', 'claude'],
  [/(^|\.)figma\.com$/, 'Figma', 'figma'],
  [/\.atlassian\.net$/, 'Confluence', 'confluence', /^\/wiki\//],
  [/\.atlassian\.net$/, 'Jira', 'jira'],
  [/(^|\.)zoom\.us$/, 'Zoom', 'zoom'],
  [/(^|\.)loom\.com$/, 'Loom', 'loom'],
  [/(^|\.)dropbox\.com$/, 'Dropbox', 'dropbox'],
  [/(^|\.)asana\.com$/, 'Asana', 'asana'],
  [/(^|\.)trello\.com$/, 'Trello', 'trello'],
  [/(^|\.)clickup\.com$/, 'ClickUp', 'clickup'],
  [/(^|\.)airtable\.com$/, 'Airtable', 'airtable'],
  [/(^|\.)miro\.com$/, 'Miro', 'miro'],
  [/(^|\.)discord\.(com|gg)$/, 'Discord', 'discord'],
  [/(^|\.)intercom\.(com|io)$/, 'Intercom', 'intercom'],
  [/(^|\.)hubspot\.com$/, 'HubSpot', 'hubspot'],
  [/(^|\.)(salesforce|force)\.com$/, 'Salesforce', 'salesforce'],
  [/(^|\.)stripe\.com$/, 'Stripe', 'stripe'],
  [/(^|\.)vercel\.(com|app)$/, 'Vercel', 'vercel'],
  [/(^|\.)sentry\.io$/, 'Sentry', 'sentry'],
  [/(^|\.)calendly\.com$/, 'Calendly', 'calendly'],
  [/(^|\.)zendesk\.com$/, 'Zendesk', 'zendesk'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', 'youtube'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp', 'whatsapp'],
  [/(^|\.)(telegram\.org|t\.me)$/, 'Telegram', 'telegram'],
  [/(^|\.)(x|twitter)\.com$/, 'X', 'x'],
  [/^outlook\.(office|office365|live)\.com$/, 'Outlook', 'outlook'],
  [/^teams\.(microsoft|live)\.com$/, 'Teams', 'teams'],
  [/\.sharepoint\.com$/, 'SharePoint', 'sharepoint'],
  [/^(onedrive\.live\.com|1drv\.ms)$/, 'OneDrive', 'onedrive'],
]

/** What signals are called, where it is not their mark's name. */
const SIGNAL_MARKS: Record<string, Mark> = {
  calendar: 'googleCalendar',
  drive: 'googleDrive',
  docs: 'googleDocs',
  meet: 'googleMeet',
  sheets: 'googleSheets',
  microsoft: 'outlook',
  office: 'outlook',
  mail: 'gmail',
  twitter: 'x',
}

/** A signal's mark, by its name or, failing that, by where its message lives. */
export const signalMark = (signal: string, url?: string): Mark | null => {
  const name = signal.toLowerCase()
  if (name in MARKS) return name as Mark
  return SIGNAL_MARKS[name] ?? (url ? (sourceOf(url)?.[2] ?? null) : null)
}

/** A signal or source as its makers write it: GitHub, not Github. */
export const signalName = (name: string): string => ({ github: 'GitHub' })[name] ?? name.charAt(0).toUpperCase() + name.slice(1)

/**
 * A workstream's badge in the list: two letters (the first of its first two words, or its first
 * two) and one of three tints, the same for a name on every device. The inbox stays quiet.
 */
export const workstreamMark = (name: string): { letters: string; tone: 'pilot' | 'clay' | 'amber' | 'quiet' } => {
  const words = name.split('-').filter(Boolean)
  const letters = (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase()
  if (name === 'inbox') return { letters, tone: 'quiet' }
  let hash = 0
  for (const c of name) hash = (hash * 31 + (c.codePointAt(0) ?? 0)) % 9973
  const tones = ['pilot', 'clay', 'amber'] as const
  return { letters, tone: tones[hash % tones.length] ?? 'quiet' }
}

/** Who a task came from, as both apps say it under its title: "From Gmail", "Created by you". */
export const filedBy = (task: Task): string =>
  task.source.signal ? `From ${signalName(task.source.signal)}` : task.createdBy === 'system' ? 'From Autopilot' : 'Created by you'

// Not URL: React Native's has no hostname.
const parts = (url: string) => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)(?::\d+)?([^?#]*)/i.exec(url)
  return match?.[1] ? { host: match[1].toLowerCase(), path: match[2] ?? '' } : null
}

const sourceOf = (url: string) => {
  const at = parts(url)
  return at ? SOURCES.find(([host, , , path]) => host.test(at.host) && (!path || path.test(at.path))) : undefined
}

/** Where a link goes, for a list of linked things: `Gmail`, `GitHub`, `File`, or the host. */
export const linkSource = (url: string): string => {
  if (url.startsWith('file:')) return 'File'
  const at = parts(url)
  if (!at) return 'Link'
  return sourceOf(url)?.[1] ?? at.host.replace(/^www\./, '')
}

/**
 * What sort of thing a link is: the label, the icon both apps draw, and the mark of where it lives,
 * which they draw grey in the icon's place when there is one.
 */
export type LinkKind = { label: string; icon: 'document' | 'code' | 'mail' | 'link' | 'image' | 'table'; mark?: Mark | null }

const FILES: [RegExp, LinkKind][] = [
  [/\.(md|markdown|txt|rtf|docx?|pages|pdf|html?)$/i, { label: 'Document', icon: 'document' }],
  [/\.(csv|xlsx?|numbers|json|ya?ml)$/i, { label: 'Data', icon: 'table' }],
  [/\.(png|jpe?g|gif|svg|webp)$/i, { label: 'Image', icon: 'image' }],
  [/\.eml$/i, { label: 'Email', icon: 'mail' }],
]

export const linkKind = (link: { url: string; title: string }): LinkKind => {
  const { url } = link
  if (url.startsWith('file:')) return FILES.find(([pattern]) => pattern.test(url))?.[1] ?? { label: 'File', icon: 'document' }
  const mark = sourceOf(url)?.[2] ?? null
  return { ...kindOf(link), mark }
}

const kindOf = ({ url, title }: { url: string; title: string }): LinkKind => {
  if (/github\.com\/[^/]+\/[^/]+\/pull\//.test(url)) return { label: 'Pull request', icon: 'code' }
  if (/github\.com\/[^/]+\/[^/]+\/(tree|compare)\//.test(url)) return { label: 'Branch', icon: 'code' }
  const source = linkSource(url)
  if (source === 'Gmail' || source === 'Outlook') return { label: /draft/i.test(title) ? 'Email draft' : 'Email', icon: 'mail' }
  if (source === 'Slack') return { label: /draft/i.test(title) ? 'Slack draft' : 'Slack message', icon: 'mail' }
  if (source === 'Google Docs') return { label: 'Google Doc', icon: 'document' }
  if (source === 'Google Sheets') return { label: 'Google Sheet', icon: 'table' }
  if (source === 'Google Slides') return { label: 'Google Slides', icon: 'document' }
  if (source === 'Claude' && /\/artifact\//.test(url)) return { label: 'Artifact', icon: 'document' }
  return { label: source, icon: 'link' }
}

/**
 * What a session made to share, which both apps list as Artifacts apart from the rest: a file it
 * wrote, a Google Doc, Sheet or Slides, a Claude artifact. Pull requests, branches, drafts and sources stay Linked.
 */
export const isArtifact = (link: { url: string; title: string }): boolean =>
  link.url.startsWith('file:') || ['Google Doc', 'Google Sheet', 'Google Slides', 'Artifact'].includes(linkKind(link).label)

export const updateTone = (update: Update): EntryTone => {
  if (update.kind in ASKING) return update.open ? 'pilot' : 'quiet'
  if (update.kind === 'waiting') return 'paused'
  return 'quiet'
}

/** Where a task stands now, for the top of its timeline. */
export const nowText = (item: QueueItem): string => {
  switch (item.band) {
    case 'your_turn':
      return 'Waiting on you'
    case 'new':
      return 'Not started'
    case 'running':
      return runningText(item.session)
    case 'waiting':
      return 'Waiting on others'
    case 'snoozed':
      return item.task.snoozedUntil ? `Snoozed until ${shortDate(item.task.snoozedUntil)}` : 'Snoozed'
    case 'done':
      return item.task.state === 'canceled' ? 'Closed' : 'Done'
  }
}

/** A task in Running says what its session is really doing, not that it works when it does not. */
const runningText = (session: QueueItem['session']): string => {
  switch (session?.state) {
    case undefined:
      return 'Waiting for a session to start'
    case 'starting':
      return 'Starting the session'
    case 'working':
      return session.activity ?? 'The session is working'
    case 'idle':
      return 'The session stopped without handing over'
    case 'waiting_permission':
      return 'The session waits for a permission'
    case 'ended':
      return 'The session ended'
  }
}

export const nowTone = (item: QueueItem): EntryTone =>
  item.band === 'your_turn'
    ? 'pilot'
    : item.band === 'running'
      ? 'claude'
      : item.band === 'waiting' || item.band === 'snoozed'
        ? 'paused'
        : 'quiet'

/** How the task began, for the start of its timeline. */
export const createdText = (task: Task): string =>
  task.source.signal
    ? `Filed from ${task.source.signal.charAt(0).toUpperCase()}${task.source.signal.slice(1)}`
    : task.createdBy === 'system'
      ? 'Created by Autopilot'
      : task.createdBy === 'owner'
        ? 'Created by you'
        : 'Created by the session'

/** `Sun 25 Oct, 15:30`. */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const BEFORE_STARTING = /^Before starting:\s*$/m

/** A first look without its questions, for when they are asked on their own (Before I start). */
export const withoutQuestions = (body: string): string => body.split(BEFORE_STARTING)[0]?.trim() ?? body

/** What the first look asked before anyone starts: its "Before starting" lines. Both apps ask them as Before I start. */
export const firstLookQuestions = (updates: Update[]): string[] => {
  const look = [...updates].reverse().find((u) => u.author === 'scout' && u.kind === 'info')
  const after = look?.body.split(BEFORE_STARTING)[1]
  return after ? after.split('\n').flatMap((l) => (/^\s*[-*]\s+/.test(l) ? [l.replace(/^\s*[-*]\s+/, '').trim()] : [])) : []
}

/** The first line of a message as plain words: no Markdown marks, cut at a sentence or 140 characters. */
export const firstLine = (text: string): string => {
  const line =
    text
      .split('\n')
      .map((l) =>
        l
          .replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '')
          .replace(/[*_`]/g, '')
          .trim(),
      )
      .find((l) => l.length > 0) ?? ''
  return line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line
}

/**
 * Where a row stands, before its line, where the tab does not already say: what the ask wants of you
 * (a decision, a review, an answer), and why a task without one is your turn.
 */
export const rowStatus = (item: QueueItem): string | null => {
  if (item.band !== 'your_turn') return null
  if (item.openAsk) return updateLabel(item.openAsk)
  if (item.session?.state === 'waiting_permission') return 'Needs a permission'
  if (item.task.state === 'snoozed') return 'Back from snooze'
  return item.task.state === 'new' ? 'New' : 'Your turn'
}

/**
 * What a row in either app says under its title: what it is about now, in words that differ per
 * task. Snoozed says when it comes back; waiting on you, the question itself; running, what the
 * session is doing; new, the start of its brief.
 */
export const rowDetail = (item: QueueItem): string | null => {
  if (item.band === 'snoozed' && item.task.snoozedUntil) return `Until ${shortDate(item.task.snoozedUntil)}`
  if (item.openAsk) return firstLine(item.openAsk.body) || null
  if (item.session?.state === 'waiting_permission') return item.session.activity ?? null
  if (item.band === 'running') return item.session?.activity ?? 'Working'
  if (item.band === 'waiting') return 'Waiting on others'
  if (item.band === 'new' || item.task.state === 'new') return firstLine(item.task.brief) || 'Not started'
  return null
}

/**
 * A message long enough to have been pasted rather than typed: both apps show it as a pasted
 * card, a few words of it and a click to read the rest, so it does not push the page apart.
 */
export const isPaste = (text: string): boolean => text.length > 600 || text.split('\n').length > 10

/** What a pasted card says about its text: "48 lines", or "2.3k characters" on one line. */
export const pasteSize = (text: string): string => {
  const lines = text.trim().split('\n').length
  if (lines > 1) return `${lines} lines`
  return text.length >= 1000 ? `${(text.length / 1000).toFixed(1)}k characters` : `${text.length} characters`
}

/**
 * What a "your turn" notification is about: the ask waiting on you, or the task when it waits
 * without one. Both apps notify once per key, so an answered ask that flickers back into your
 * turn before the server's word arrives is not news.
 */
export const attentionKey = (item: QueueItem): string => item.openAsk?.id ?? `task:${item.task.id}`

/** What an empty list says, by tab (null: every open task), the same on both apps. */
export const emptyWords = (view: string | null): { title: string; line: string } => {
  switch (view) {
    case 'needs_me':
      return { title: 'All clear', line: 'Nothing needs you. The pilot has the controls.' }
    case 'triage':
      return { title: 'Nothing to sort', line: 'Whatever signals file lands here first, for you to start, snooze or let go.' }
    case 'running':
      return { title: 'Engines idle', line: 'No session is working. Start one with New.' }
    case 'waiting':
      return { title: 'Nobody owes you anything', line: 'Nothing is waiting on someone else.' }
    case 'snoozed':
      return { title: 'Wide awake', line: 'Nothing is snoozed.' }
    case 'done':
      return { title: 'A clean slate', line: 'Nothing done yet. Give it a day.' }
    default:
      return { title: 'Clear skies', line: 'No open tasks anywhere. Autopilot fills this as signals file and sessions hand over.' }
  }
}

/** The priorities by number, as a list's sections name them. */
export const PRIORITY_NAMES: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' }

/** How a list is cut into sections: by workstream, or by priority with each workstream together inside. */
export type GroupBy = 'workstream' | 'priority'

export type QueueSection = { key: string; title: string; items: QueueItem[] }

/** Workstreams in the order of their most pressing task (the queue comes sorted), the inbox last. */
const workstreams = (items: QueueItem[]): string[] => {
  const names = [...new Set(items.map((i) => i.task.workstream))]
  return [...names.filter((n) => n !== 'inbox'), ...names.filter((n) => n === 'inbox')]
}

const byWorkstream = (items: QueueItem[]): QueueItem[] =>
  workstreams(items).flatMap((name) => items.filter((i) => i.task.workstream === name))

/** A sorted list in sections, the same on the Mac and the iPhone; read top to bottom, it is the order Next steps through. */
export const sectionsOf = (items: QueueItem[], by: GroupBy): QueueSection[] =>
  by === 'workstream'
    ? workstreams(items).map((name) => ({ key: name, title: name, items: items.filter((i) => i.task.workstream === name) }))
    : [1, 2, 3, 4]
        .map((p) => ({ key: `p${p}`, title: PRIORITY_NAMES[p] ?? '', items: byWorkstream(items.filter((i) => i.task.priority === p)) }))
        .filter((s) => s.items.length > 0)
