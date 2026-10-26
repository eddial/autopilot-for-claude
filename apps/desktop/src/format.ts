import { rowDetail, signalName, updateLabel } from '@autopilot/client'
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

/** A row's second line: what it is about now, then where it came from; the workstream only where the list is not grouped by it. */
export const rowMeta = (item: QueueItem, withWorkstream = true): string =>
  [rowDetail(item), withWorkstream ? item.task.workstream : null, item.task.source.signal ? sourceOf(item) : null]
    .filter(Boolean)
    .join(' · ')

export { updateLabel }
