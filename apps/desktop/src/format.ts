import type { QueueItem, Update } from '@autopilot/contracts'

/** `5m ago`, or `just now`. */
export const ago = (iso: string): string => {
  const a = age(iso)
  return a === 'now' ? 'just now' : `${a} ago`
}

export const age = (iso: string, now = Date.now()): string => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const ASK_LABEL: Record<string, string> = {
  decision: 'Needs your decision',
  question: 'Asked you',
  review: 'Ready to review',
  blocked: 'Stuck',
}

export const updateLabel = (update: Update): string => {
  switch (update.kind) {
    case 'decision':
    case 'question':
    case 'review':
    case 'blocked':
      return ASK_LABEL[update.kind] ?? update.kind
    case 'waiting':
      return update.waitingOn ? `Waiting on ${update.waitingOn}` : 'Waiting'
    case 'done':
      return 'Done'
    case 'info':
      return update.author === 'watcher' ? 'News' : update.author === 'system' ? 'Lay of the land' : 'Update'
    case 'signal':
      return 'New on the thread'
    case 'instruction':
      return 'You'
  }
}

export const titleCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const sourceOf = (item: QueueItem): string =>
  item.task.source.signal ? titleCase(item.task.source.signal) : item.task.createdBy === 'system' ? 'Autopilot' : 'You'

/** The line under a row's title. */
export const rowMeta = (item: QueueItem): string => {
  const what =
    item.openAsk !== null
      ? updateLabel(item.openAsk)
      : item.session?.state === 'waiting_permission'
        ? 'Waiting for a permission'
        : item.band === 'running'
          ? (item.session?.activity ?? 'Working')
          : item.band === 'snoozed' && item.task.snoozedUntil
            ? `Snoozed until ${new Date(item.task.snoozedUntil).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
            : null
  return [what, titleCase(item.task.workstream), sourceOf(item)].filter(Boolean).join(' · ')
}
