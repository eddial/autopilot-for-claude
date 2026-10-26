import { rowDetail, signalName, updateLabel } from '@autopilot/client'
import type { Band, QueueItem } from '@autopilot/contracts'

export const age = (iso: string, now = Date.now()): string => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** When something last happened, as a phrase: "just now", "5m ago". */
export const ago = (iso: string, now = Date.now()): string => {
  const when = age(iso, now)
  return when === 'now' ? 'just now' : `${when} ago`
}

export const titleCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const BAND_TITLE: Record<Band, string> = {
  your_turn: 'Your turn',
  new: 'New',
  running: 'Running',
  waiting: 'Waiting on others',
  snoozed: 'Snoozed',
  done: 'Done',
}

/** A row's second line, as on the Mac: what it is about now, then where it came from. */
export const rowMeta = (item: QueueItem, withWorkstream = true): string => {
  const what = item.task.id.startsWith('NEW-') ? 'Waiting to reach your Mac' : rowDetail(item)
  // Where it came from, when that was somewhere else: Slack, Linear.
  const source = item.task.source.signal ? signalName(item.task.source.signal) : null
  return [what, withWorkstream ? item.task.workstream : null, source].filter(Boolean).join(' · ')
}

export { updateLabel }
