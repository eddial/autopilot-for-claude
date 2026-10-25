import type { QueueItem, Task, Update } from '@autopilot/contracts'

/**
 * How an update reads on a task's page, the same on the Mac and the iPhone: its label, who posted
 * it when the label does not say, and its tone (the names of `@autopilot/design`'s tones).
 */

export type EntryTone = 'attention' | 'good' | 'paused' | 'quiet'

const ASKING: Partial<Record<Update['kind'], string>> = {
  decision: 'Needs your decision',
  question: 'Asked you',
  review: 'Ready to review',
  blocked: 'Stuck',
}

/** The same asks once answered: history, not a call to act. */
const ASKED: Partial<Record<Update['kind'], string>> = {
  decision: 'Asked for a decision',
  question: 'Asked a question',
  review: 'Asked for a review',
  blocked: 'Was stuck',
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
export const linkSource = (url: string): string => {
  // Not URL: React Native's has no hostname.
  if (url.startsWith('file:')) return 'File'
  const hostname = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase()
  if (!hostname) return 'Link'
  return SOURCES.find(([pattern]) => pattern.test(hostname))?.[1] ?? hostname.replace(/^www\./, '')
}

export const updateTone = (update: Update): EntryTone => {
  if (update.kind in ASKING) return update.open ? 'attention' : 'quiet'
  if (update.kind === 'event') return 'quiet'
  if (update.kind === 'waiting') return 'paused'
  return update.kind === 'done' || update.kind === 'info' ? 'good' : 'quiet'
}

/** Where a task stands now, for the top of its timeline. */
export const nowText = (item: QueueItem): string => {
  switch (item.band) {
    case 'your_turn':
      return 'Waiting on you'
    case 'new':
      return 'Not started'
    case 'running':
      return item.session?.activity ?? 'The session is working'
    case 'waiting':
      return 'Waiting on others'
    case 'snoozed':
      return item.task.snoozedUntil ? `Snoozed until ${shortDate(item.task.snoozedUntil)}` : 'Snoozed'
    case 'done':
      return item.task.state === 'canceled' ? 'Closed' : 'Done'
  }
}

export const nowTone = (item: QueueItem): EntryTone =>
  item.band === 'your_turn'
    ? 'attention'
    : item.band === 'running' || item.band === 'done'
      ? 'good'
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
