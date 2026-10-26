import type { QueueItem, Task, Update } from '@autopilot/contracts'

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

const SOURCES: [RegExp, string][] = [
  [/(^|\.)mail\.google\.com$/, 'Gmail'],
  [/(^|\.)docs\.google\.com$/, 'Google Docs'],
  [/(^|\.)drive\.google\.com$/, 'Google Drive'],
  [/(^|\.)slack\.com$/, 'Slack'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)linear\.app$/, 'Linear'],
  [/(^|\.)notion\.(so|site)$/, 'Notion'],
  [/(^|\.)fathom\.video$/, 'Fathom'],
]

/** Where a link goes, for a list of linked things: `Gmail`, `GitHub`, `File`, or the host. */
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

export const linkSource = (url: string): string => {
  // Not URL: React Native's has no hostname.
  if (url.startsWith('file:')) return 'File'
  const hostname = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase()
  if (!hostname) return 'Link'
  return SOURCES.find(([pattern]) => pattern.test(hostname))?.[1] ?? hostname.replace(/^www\./, '')
}

/** What sort of thing a link is: the label, and the icon both apps draw. */
export type LinkKind = { label: string; icon: 'document' | 'code' | 'mail' | 'link' | 'image' | 'table' }

const FILES: [RegExp, LinkKind][] = [
  [/\.(md|markdown|txt|rtf|docx?|pages|pdf|html?)$/i, { label: 'Document', icon: 'document' }],
  [/\.(csv|xlsx?|numbers|json|ya?ml)$/i, { label: 'Data', icon: 'table' }],
  [/\.(png|jpe?g|gif|svg|webp)$/i, { label: 'Image', icon: 'image' }],
  [/\.eml$/i, { label: 'Email', icon: 'mail' }],
]

export const linkKind = (link: { url: string; title: string }): LinkKind => {
  const { url } = link
  if (url.startsWith('file:')) return FILES.find(([pattern]) => pattern.test(url))?.[1] ?? { label: 'File', icon: 'document' }
  if (/github\.com\/[^/]+\/[^/]+\/pull\//.test(url)) return { label: 'Pull request', icon: 'code' }
  if (/github\.com\/[^/]+\/[^/]+\/(tree|compare)\//.test(url)) return { label: 'Branch', icon: 'code' }
  const source = linkSource(url)
  if (source === 'Gmail') return { label: /draft/i.test(link.title) ? 'Email draft' : 'Email', icon: 'mail' }
  if (source === 'Slack') return { label: /draft/i.test(link.title) ? 'Slack draft' : 'Slack message', icon: 'mail' }
  if (source === 'Google Docs') return { label: 'Google Doc', icon: 'document' }
  return { label: source, icon: 'link' }
}

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
