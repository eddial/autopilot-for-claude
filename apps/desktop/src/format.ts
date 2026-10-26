import { signalName, updateLabel } from '@autopilot/client'
import type { QueueItem } from '@autopilot/contracts'

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

export const titleCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const sourceOf = (item: QueueItem): string =>
  item.task.source.signal ? signalName(item.task.source.signal) : item.task.createdBy === 'system' ? 'Autopilot' : 'You'

/** The line under a row's title. */
/** A row's second line; without the workstream where the list is already grouped by it. */
export const rowMeta = (item: QueueItem, withWorkstream = true): string => {
  const what =
    item.openAsk !== null
      ? updateLabel(item.openAsk)
      : item.session?.state === 'waiting_permission'
        ? 'Waiting for a permission'
        : item.band === 'running'
          ? (item.session?.activity ?? 'Working')
          : item.band === 'snoozed' && item.task.snoozedUntil
            ? `Snoozed until ${new Date(item.task.snoozedUntil).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
            : item.band === 'new'
              ? 'New'
              : null
  return [what, withWorkstream ? item.task.workstream : null, sourceOf(item)].filter(Boolean).join(' · ')
}

export { updateLabel }
