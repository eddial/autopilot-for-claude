import { Linking } from 'react-native'
import type { QueueItem } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import { firstLookQuestions } from '@autopilot/client'
import { useDetail, useSyncInstance } from '../store.ts'
import { colours } from '@autopilot/design'

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
 * the prominent action (Open session, or Start) in ink as on the Mac, then ⋯ for the rest.
 */
export const TaskToolbar = ({
  item,
  closeAfter,
  step,
}: {
  item: QueueItem
  closeAfter: boolean
  /** Through the list the task was opened from, as Mail goes through messages: up and down. */
  step?: { previous: (() => void) | null; next: (() => void) | null }
}) => {
  const sync = useSyncInstance()
  const { task, session } = item
  const live = session && session.state !== 'ended' ? session : null
  // Before I start in the timeline starts it when the first look has questions: one Start, there.
  const detail = useDetail(task.id)
  const asking = item.band === 'new' && firstLookQuestions(detail?.updates ?? []).length > 0
  const done = (outcome: 'done' | 'canceled') => {
    void sync?.send({ kind: 'close', taskId: task.id, outcome })
    if (closeAfter && router.canGoBack()) router.back()
  }
  return (
    <Stack.Toolbar placement="right">
      {live?.remoteControlUrl ? (
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colours.text}
          icon="arrow.up.forward.app"
          accessibilityLabel="Open session"
          onPress={() => void Linking.openURL(live.remoteControlUrl ?? '')}
        />
      ) : item.band === 'new' && !asking ? (
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colours.text}
          icon="play.fill"
          accessibilityLabel="Start"
          onPress={() => void sync?.send({ kind: 'start', taskId: task.id })}
        />
      ) : null}
      {/* The rest behind one ⋯, so the bar keeps room: Mark done, Snooze (its times a level down), Not for me. */}
      <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More" title="More">
        <Stack.Toolbar.MenuAction icon="checkmark" onPress={() => done('done')}>
          Mark done
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.Menu icon="moon" title="Snooze">
          {snoozeTimes().map((t) => (
            <Stack.Toolbar.MenuAction
              key={t.label}
              onPress={() => void sync?.send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() })}
            >
              {t.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.MenuAction icon="xmark" destructive onPress={() => done('canceled')}>
          Not for me
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      {/* Each its own item: the native toolbar takes its buttons directly, not inside a fragment. */}
      {step && (
        <Stack.Toolbar.Button
          icon="chevron.up"
          accessibilityLabel="Previous task"
          disabled={!step.previous}
          onPress={() => step.previous?.()}
        />
      )}
      {step && (
        <Stack.Toolbar.Button icon="chevron.down" accessibilityLabel="Next task" disabled={!step.next} onPress={() => step.next?.()} />
      )}
    </Stack.Toolbar>
  )
}
