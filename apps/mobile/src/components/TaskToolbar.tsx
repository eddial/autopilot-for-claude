import { Linking } from 'react-native'
import type { QueueItem } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import { useSyncInstance } from '../store.ts'
import { colours } from '../theme.ts'

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

/**
 * A task's actions as native bar items, in the order PRODUCT.md gives for the Duo's vertical bar:
 * the prominent action (Open session, or Start), then Snooze and Done.
 */
export const TaskToolbar = ({ item, closeAfter }: { item: QueueItem; closeAfter: boolean }) => {
  const sync = useSyncInstance()
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  const done = (outcome: 'done' | 'canceled') => {
    void sync?.send({ kind: 'close', taskId: task.id, outcome })
    if (closeAfter && router.canGoBack()) router.back()
  }
  return (
    <Stack.Toolbar placement="right">
      {live?.remoteControlUrl ? (
        <Stack.Toolbar.Button variant="prominent" tintColor={colours.clay} icon="arrow.up.forward.app" accessibilityLabel="Open session" onPress={() => void Linking.openURL(live.remoteControlUrl ?? '')} />
      ) : item.band === 'new' ? (
        <Stack.Toolbar.Button variant="prominent" tintColor={colours.clay} icon="play.fill" accessibilityLabel="Start" onPress={() => void sync?.send({ kind: 'start', taskId: task.id })} />
      ) : null}
      <Stack.Toolbar.Menu icon="moon.zzz" accessibilityLabel="Snooze" title="Snooze">
        {snoozeTimes().map((t) => (
          <Stack.Toolbar.MenuAction key={t.label} onPress={() => void sync?.send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() })}>
            {t.label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu icon="checkmark.circle" accessibilityLabel="Close" title="Close">
        <Stack.Toolbar.MenuAction icon="checkmark" onPress={() => done('done')}>
          Mark done
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="xmark" destructive onPress={() => done('canceled')}>
          Not for me
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  )
}
