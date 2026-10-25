import { updateLabel } from '@autopilot/client'
import type { Band, QueueItem } from '@autopilot/contracts'

export const age = (iso: string, now = Date.now()): string => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
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

export const rowMeta = (item: QueueItem): string => {
  const what = item.openAsk
    ? updateLabel(item.openAsk)
    : item.task.id.startsWith('NEW-')
      ? 'Waiting to reach your Mac'
      : item.band === 'running'
        ? (item.session?.activity ?? 'Working')
        : null
  const source = item.task.source.signal ? titleCase(item.task.source.signal) : item.task.createdBy === 'system' ? 'Autopilot' : 'You'
  return [what, titleCase(item.task.workstream), source].filter(Boolean).join(' · ')
}

export { updateLabel }
